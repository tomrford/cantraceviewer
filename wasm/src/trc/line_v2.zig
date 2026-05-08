const std = @import("std");
const frame = @import("frame.zig");

pub fn parseLine(columns: frame.ColumnMap, line: []const u8, payload_out: *[64]u8) !?frame.Frame {
    var tokens_buffer: [96][]const u8 = undefined;
    var token_count: usize = 0;
    var tokens = std.mem.tokenizeAny(u8, line, " \t\r");
    while (tokens.next()) |token| {
        if (token_count == tokens_buffer.len) return error.InvalidFrameLine;
        tokens_buffer[token_count] = token;
        token_count += 1;
    }
    if (token_count == 0) return null;
    if (token_count < columns.token_count_before_data) return error.InvalidFrameLine;

    const timestamp_ns = try frame.parseTimestampMsToNs(tokenAt(tokens_buffer[0..token_count], columns.offset.?));
    const record_type = tokenAt(tokens_buffer[0..token_count], columns.record_type.?);

    if (isNonDataRecord(record_type)) {
        return .{ .timestamp_ns = timestamp_ns, .kind = if (std.mem.eql(u8, record_type, "ER")) .error_frame else .unknown };
    }

    const id = frame.Id.fromTrcText(tokenAt(tokens_buffer[0..token_count], columns.id.?)) catch return .{
        .timestamp_ns = timestamp_ns,
        .kind = .unknown,
    };

    if (std.mem.eql(u8, record_type, "RR")) {
        const dlc = parseLengthOrDlc(columns, tokens_buffer[0..token_count], false);
        return .{
            .timestamp_ns = timestamp_ns,
            .kind = .remote,
            .id = id,
            .dlc = dlc,
        };
    }

    const is_fd = isFdRecord(record_type);
    if (!std.mem.eql(u8, record_type, "DT") and !is_fd) {
        return .{ .timestamp_ns = timestamp_ns, .kind = .unknown };
    }

    const dlc = if (columns.dlc) |index| try frame.parseDlc(tokenAt(tokens_buffer[0..token_count], index)) else try frame.parseDlc(tokenAt(tokens_buffer[0..token_count], columns.data_len.?));
    const payload_len = if (columns.data_len) |index|
        try frame.parsePayloadLength(tokenAt(tokens_buffer[0..token_count], index))
    else
        try frame.fdPayloadLengthFromDlc(dlc);
    const expected_payload_len = if (is_fd) try frame.fdPayloadLengthFromDlc(dlc) else dlc;
    if (payload_len != expected_payload_len) return error.InvalidPayloadLength;
    if (!is_fd and payload_len > 8) return error.InvalidPayloadLength;

    const data_start = columns.data.?;
    if (token_count < data_start + @as(usize, payload_len)) return error.InvalidFrameLine;
    for (0..payload_len) |index| {
        payload_out[index] = try frame.parseByte(tokens_buffer[data_start + index]);
    }

    return .{
        .timestamp_ns = timestamp_ns,
        .kind = .data,
        .id = id,
        .is_fd = is_fd,
        .dlc = dlc,
        .payload_len = payload_len,
    };
}

fn tokenAt(tokens: []const []const u8, index: usize) []const u8 {
    return if (index < tokens.len) tokens[index] else "";
}

fn parseLengthOrDlc(columns: frame.ColumnMap, tokens: []const []const u8, is_fd: bool) u8 {
    if (columns.data_len) |index| {
        return frame.parsePayloadLength(tokenAt(tokens, index)) catch 0;
    }
    const dlc = if (columns.dlc) |index| frame.parseDlc(tokenAt(tokens, index)) catch 0 else 0;
    return if (is_fd) frame.fdPayloadLengthFromDlc(dlc) catch 0 else dlc;
}

fn isFdRecord(record_type: []const u8) bool {
    return std.mem.eql(u8, record_type, "FD") or std.mem.eql(u8, record_type, "FB") or
        std.mem.eql(u8, record_type, "FE") or std.mem.eql(u8, record_type, "BI");
}

fn isNonDataRecord(record_type: []const u8) bool {
    return std.mem.eql(u8, record_type, "ST") or std.mem.eql(u8, record_type, "ER") or
        std.mem.eql(u8, record_type, "EC") or std.mem.eql(u8, record_type, "EV");
}

test "parses TRC 2.x classic and CAN FD records through columns" {
    const columns = try frame.ColumnMap.fromText("N,O,T,B,I,d,R,L,D");
    var payload: [64]u8 = undefined;

    const classic = (try parseLine(columns, "1 0.100 DT 1 0123 Rx - 2 AA BB", &payload)) orelse return error.ExpectedFrame;
    try std.testing.expectEqual(@as(frame.Kind, .data), classic.kind);
    try std.testing.expect(!classic.is_fd);
    try std.testing.expectEqual(@as(u8, 2), classic.payload_len);
    try std.testing.expectEqual(@as(u8, 0xaa), payload[0]);

    const fd = (try parseLine(columns, "2 0.200 FD 1 18FEE900 Rx - 9 01 02 03 04 05 06 07 08 09 0A 0B 0C", &payload)) orelse return error.ExpectedFrame;
    try std.testing.expect(fd.is_fd);
    try std.testing.expectEqual(@as(u8, 12), fd.payload_len);
    try std.testing.expectEqual(@as(u8, 0x0c), payload[11]);
}
