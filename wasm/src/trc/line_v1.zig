const std = @import("std");
const frame = @import("frame.zig");

pub fn parseLine(line: []const u8, payload_out: *[64]u8) !?frame.Frame {
    var tokens = std.mem.tokenizeAny(u8, line, " \t\r");
    const first = tokens.next() orelse return null;
    const timestamp_text = if (looksLikeLineNumber(first)) tokens.next() orelse return null else first;
    const timestamp_ns = frame.parseTimestampMsToNs(timestamp_text) catch |err| switch (err) {
        error.InvalidCharacter, error.InvalidTimestamp => return null,
        else => return err,
    };

    var rest: [96][]const u8 = undefined;
    var rest_len: usize = 0;
    while (tokens.next()) |token| {
        if (rest_len == rest.len) return error.InvalidFrameLine;
        rest[rest_len] = token;
        rest_len += 1;
    }

    const id_index = findIdIndex(rest[0..rest_len]) orelse return .{
        .timestamp_ns = timestamp_ns,
        .kind = .unknown,
    };
    const type_token = if (id_index > 0 and isTypeToken(rest[id_index - 1])) rest[id_index - 1] else "";
    const id_text = rest[id_index];

    if (std.mem.eql(u8, id_text, "FFFFFFFF") or isErrorType(type_token)) {
        return .{ .timestamp_ns = timestamp_ns, .kind = .error_frame };
    }

    const id = frame.Id.fromTrcText(id_text) catch return .{ .timestamp_ns = timestamp_ns, .kind = .unknown };

    const dlc_index = if (id_index + 1 < rest_len and std.mem.eql(u8, rest[id_index + 1], "-"))
        id_index + 2
    else
        id_index + 1;
    if (dlc_index >= rest_len) return .{ .timestamp_ns = timestamp_ns, .kind = .unknown };
    const dlc_text = rest[dlc_index];
    const dlc = try frame.parseDlc(dlc_text);
    if (dlc > 8) return error.InvalidDlc;

    const kind: frame.Kind = if (isRemoteType(type_token)) .remote else .data;
    if (kind == .remote) {
        return .{
            .timestamp_ns = timestamp_ns,
            .kind = .remote,
            .id = id,
            .dlc = dlc,
        };
    }

    var payload_len: usize = 0;
    while (payload_len < dlc) : (payload_len += 1) {
        const byte_index = dlc_index + 1 + payload_len;
        if (byte_index >= rest_len) return error.InvalidFrameLine;
        payload_out[payload_len] = try frame.parseByte(rest[byte_index]);
    }

    return .{
        .timestamp_ns = timestamp_ns,
        .kind = .data,
        .id = id,
        .dlc = dlc,
        .payload_len = @intCast(payload_len),
    };
}

fn findIdIndex(tokens: []const []const u8) ?usize {
    for (tokens, 0..) |token, index| {
        if (std.mem.eql(u8, token, "FFFFFFFF")) return index;
        if (token.len != 4 and token.len != 8) continue;
        _ = std.fmt.parseUnsigned(u32, token, 16) catch continue;
        return index;
    }
    return null;
}

fn looksLikeLineNumber(text: []const u8) bool {
    if (text.len == 0) return false;
    const digits = if (text[text.len - 1] == ')') text[0 .. text.len - 1] else text;
    if (digits.len == 0) return false;
    for (digits) |byte| {
        if (!std.ascii.isDigit(byte)) return false;
    }
    return true;
}

fn isDirection(text: []const u8) bool {
    return std.mem.eql(u8, text, "Rx") or std.mem.eql(u8, text, "Tx");
}

fn isTypeToken(text: []const u8) bool {
    return isDirection(text) or isRemoteType(text) or isErrorType(text);
}

fn isRemoteType(text: []const u8) bool {
    return std.mem.eql(u8, text, "RTR") or std.mem.eql(u8, text, "RR");
}

fn isErrorType(text: []const u8) bool {
    return std.mem.eql(u8, text, "Error") or std.mem.eql(u8, text, "ErrorFrame") or
        std.mem.eql(u8, text, "Warning");
}

test "parses TRC 1.x data and keeps timestamped remote frames" {
    var payload: [64]u8 = undefined;
    const data = (try parseLine("1 0.100 Rx 0123 2 AA bb", &payload)) orelse return error.ExpectedFrame;
    try std.testing.expectEqual(@as(u64, 100_000), data.timestamp_ns);
    try std.testing.expectEqual(@as(frame.Kind, .data), data.kind);
    try std.testing.expectEqual(@as(u32, 0x123), data.id.?.value);
    try std.testing.expectEqual(@as(u8, 0xaa), payload[0]);

    const remote = (try parseLine("2 0.200 RTR 0123 8", &payload)) orelse return error.ExpectedFrame;
    try std.testing.expectEqual(@as(frame.Kind, .remote), remote.kind);
    try std.testing.expectEqual(@as(u8, 8), remote.dlc);

    const with_bus = (try parseLine("3 0.300 1 Rx 0124 1 CC", &payload)) orelse return error.ExpectedFrame;
    try std.testing.expectEqual(@as(frame.Kind, .data), with_bus.kind);
    try std.testing.expectEqual(@as(u32, 0x124), with_bus.id.?.value);

    const pcan_v13 = (try parseLine("1) 1.600 1 Rx 10062123 - 6 D2 AF AA 88 18 80", &payload)) orelse return error.ExpectedFrame;
    try std.testing.expectEqual(@as(frame.Kind, .data), pcan_v13.kind);
    try std.testing.expectEqual(@as(u64, 1_600_000), pcan_v13.timestamp_ns);
    try std.testing.expectEqual(@as(u32, 0x10062123), pcan_v13.id.?.value);
    try std.testing.expectEqual(@as(u8, 6), pcan_v13.payload_len);
    try std.testing.expectEqual(@as(u8, 0xd2), payload[0]);
}
