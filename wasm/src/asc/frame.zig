const std = @import("std");

/// .asc files can store messages in either decimal or hexadecimal format.
/// This base is parsed from the file header.
pub const Base = enum {
    hex,
    dec,

    /// Returns the base as an integer.
    pub fn toInt(self: Base) u8 {
        return switch (self) {
            .hex => 16,
            .dec => 10,
        };
    }
};

/// Kinds of timestamped ASC events kept in frame order.
///
/// Unknown events preserve timestamped lines the parser does not decode so
/// relative timestamp normalization still accounts for them.
pub const Kind = enum {
    data,
    remote,
    error_frame,
    unknown,
};

pub const Id = struct {
    value: u32,
    is_extended: bool,

    pub fn standard(value: u32) Id {
        std.debug.assert(value <= 0x7ff);
        return .{ .value = value, .is_extended = false };
    }

    pub fn extended(value: u32) Id {
        std.debug.assert(value <= 0x1fff_ffff);
        return .{ .value = value, .is_extended = true };
    }
};

pub const FrameKey = struct {
    id: u32,
    is_extended: bool,

    pub fn fromFrame(frame: Frame) ?FrameKey {
        const id = frame.id orelse return null;
        return .{
            .id = id.value,
            .is_extended = id.is_extended,
        };
    }
};

pub const Frame = struct {
    /// Parsed event timestamp in nanoseconds. The file parser normalizes
    /// relative ASC timestamps after parsing each line.
    timestamp_ns: u64,

    kind: Kind,

    id: ?Id = null,

    /// Only needed to distinguish classic CAN from CAN FD payload limits.
    is_fd: bool = false,

    /// Raw DLC as written in the trace. For CAN FD, this is not necessarily the
    /// payload length: DLC 9..15 maps to 12,16,20,24,32,48,64 bytes.
    dlc: u8 = 0,
    payload_offset: u32 = 0,
    payload_len: u8 = 0,
};

const LineTokenIterator = std.mem.TokenIterator(u8, .any);

/// Parses one timestamped ASC line. Data-frame payload bytes are written to
/// `payload_out`; callers must copy `payload_out[0..frame.payload_len]` before
/// the buffer is reused for another line.
pub fn parseLine(base: Base, line: []const u8, payload_out: *[64]u8) !?Frame {
    var tokens = std.mem.tokenizeAny(u8, line, " \t\r");
    const timestamp_text = tokens.next() orelse return null;
    const timestamp_ns = parseDecimalSecondsToNs(timestamp_text) catch |err| switch (err) {
        error.InvalidCharacter => return null,
        else => return err,
    };

    const first = tokens.next() orelse return .{ .timestamp_ns = timestamp_ns, .kind = .unknown };
    if (std.mem.eql(u8, first, "CANFD")) {
        return try parseCanFd(base, timestamp_ns, &tokens, payload_out);
    }

    const id_or_kind = tokens.next() orelse return .{
        .timestamp_ns = timestamp_ns,
        .kind = .unknown,
    };
    if (std.mem.eql(u8, id_or_kind, "ErrorFrame")) {
        return .{
            .timestamp_ns = timestamp_ns,
            .kind = .error_frame,
        };
    }

    const id = parseId(base, id_or_kind) catch return .{
        .timestamp_ns = timestamp_ns,
        .kind = .unknown,
    };
    _ = tokens.next() orelse return .{
        .timestamp_ns = timestamp_ns,
        .kind = .unknown,
    };
    const frame_kind = tokens.next() orelse return .{
        .timestamp_ns = timestamp_ns,
        .kind = .unknown,
    };
    if (std.mem.eql(u8, frame_kind, "d")) {
        const dlc_text = tokens.next() orelse return error.InvalidFrameLine;
        const dlc = try parseDlc(dlc_text);
        if (dlc > 8) return error.InvalidDlc;

        var payload_len: usize = 0;
        while (payload_len < dlc) : (payload_len += 1) {
            const byte_text = tokens.next() orelse return error.InvalidFrameLine;
            payload_out[payload_len] = try parseByte(base, byte_text);
        }
        return .{
            .timestamp_ns = timestamp_ns,
            .kind = .data,
            .id = id,
            .dlc = dlc,
            .payload_len = @intCast(payload_len),
        };
    }

    if (std.mem.eql(u8, frame_kind, "r")) {
        const dlc = if (tokens.next()) |dlc_text| try parseDlc(dlc_text) else 0;
        return .{
            .timestamp_ns = timestamp_ns,
            .kind = .remote,
            .id = id,
            .dlc = dlc,
        };
    }

    return .{
        .timestamp_ns = timestamp_ns,
        .kind = .unknown,
    };
}

fn parseCanFd(base: Base, timestamp_ns: u64, tokens: *LineTokenIterator, payload_out: *[64]u8) !?Frame {
    _ = tokens.next() orelse return error.InvalidFrameLine;
    _ = tokens.next() orelse return error.InvalidFrameLine;
    const id = try parseId(base, tokens.next() orelse return error.InvalidFrameLine);
    _ = tokens.next() orelse return error.InvalidFrameLine;
    _ = tokens.next() orelse return error.InvalidFrameLine;
    _ = tokens.next() orelse return error.InvalidFrameLine;
    const dlc = try parseDlc(tokens.next() orelse return error.InvalidFrameLine);
    const payload_len = try parsePayloadLength(tokens.next() orelse return error.InvalidFrameLine);
    const expected_payload_len = try fdPayloadLengthFromDlc(dlc);
    if (payload_len != expected_payload_len) return error.InvalidPayloadLength;

    var index: usize = 0;
    while (index < payload_len) : (index += 1) {
        payload_out[index] = try parseByte(base, tokens.next() orelse return error.InvalidFrameLine);
    }
    return .{
        .timestamp_ns = timestamp_ns,
        .kind = .data,
        .id = id,
        .is_fd = true,
        .dlc = dlc,
        .payload_len = payload_len,
    };
}

fn parseId(base: Base, text: []const u8) !Id {
    var id_text = text;
    var is_extended = false;
    if (text.len > 0 and (text[text.len - 1] == 'x' or text[text.len - 1] == 'X')) {
        id_text = text[0 .. text.len - 1];
        is_extended = true;
    }

    const value = try std.fmt.parseUnsigned(u32, id_text, base.toInt());
    if (is_extended or value > 0x7ff) {
        if (value > 0x1fff_ffff) return error.InvalidId;
        return Id.extended(value);
    }
    return Id.standard(@intCast(value));
}

fn parseDlc(text: []const u8) !u8 {
    const dlc = try std.fmt.parseUnsigned(u8, text, 10);
    if (dlc > 15) return error.InvalidDlc;
    return dlc;
}

fn parsePayloadLength(text: []const u8) !u8 {
    const payload_len = try std.fmt.parseUnsigned(u8, text, 10);
    if (payload_len > 64) return error.InvalidPayloadLength;
    return payload_len;
}

fn parseByte(base: Base, text: []const u8) !u8 {
    return std.fmt.parseUnsigned(u8, text, base.toInt());
}

pub fn parseDecimalSecondsToNs(text: []const u8) !u64 {
    if (text.len == 0) return error.InvalidTimestamp;

    var parts = std.mem.splitScalar(u8, text, '.');
    const seconds_text = parts.next() orelse return error.InvalidTimestamp;
    const fraction_text = parts.next();
    if (parts.next() != null) return error.InvalidTimestamp;

    const seconds = try std.fmt.parseUnsigned(u64, seconds_text, 10);
    var ns = try std.math.mul(u64, seconds, std.time.ns_per_s);

    if (fraction_text) |fraction| {
        if (fraction.len > 9) return error.TimestampTooPrecise;

        const fraction_value = try std.fmt.parseUnsigned(u64, fraction, 10);
        const scale = std.math.pow(u64, 10, 9 - fraction.len);
        const fraction_ns = try std.math.mul(u64, fraction_value, scale);
        ns = try std.math.add(u64, ns, fraction_ns);
    }

    return ns;
}

/// returns the payload length based on the stated dlc in the frame.
pub fn fdPayloadLengthFromDlc(dlc: u8) !u8 {
    return switch (dlc) {
        0...8 => dlc,
        9 => 12,
        10 => 16,
        11 => 20,
        12 => 24,
        13 => 32,
        14 => 48,
        15 => 64,
        else => error.InvalidDlc,
    };
}

test "parses classic data frame" {
    var payload: [64]u8 = undefined;
    const parsed = (try parseLine(Base.hex, "0.003040 1 123 Rx d 2 AA bb", &payload)) orelse return error.ExpectedFrame;
    try std.testing.expectEqual(@as(u64, 3_040_000), parsed.timestamp_ns);
    try std.testing.expectEqual(@as(Kind, .data), parsed.kind);
    try std.testing.expectEqual(@as(u32, 0x123), parsed.id.?.value);
    try std.testing.expect(!parsed.id.?.is_extended);
    try std.testing.expectEqual(@as(u8, 2), parsed.dlc);
    try std.testing.expectEqual(@as(u8, 2), parsed.payload_len);
    try std.testing.expectEqual(@as(u8, 0xaa), payload[0]);
    try std.testing.expectEqual(@as(u8, 0xbb), payload[1]);
}

test "parses extended classic data frame" {
    var payload: [64]u8 = undefined;
    const parsed = (try parseLine(Base.hex, "1.0 CAN_A 18fee900x Tx d 1 55", &payload)) orelse return error.ExpectedFrame;
    try std.testing.expectEqual(@as(u32, 0x18fee900), parsed.id.?.value);
    try std.testing.expect(parsed.id.?.is_extended);
}

test "parses classic remote frame" {
    var payload: [64]u8 = undefined;
    const parsed = (try parseLine(Base.hex, "2.5 1 123 Rx r 8", &payload)) orelse return error.ExpectedFrame;
    try std.testing.expectEqual(@as(u64, 2_500_000_000), parsed.timestamp_ns);
    try std.testing.expectEqual(@as(Kind, .remote), parsed.kind);
    try std.testing.expectEqual(@as(u8, 8), parsed.dlc);
    try std.testing.expectEqual(@as(u8, 0), parsed.payload_len);
}

test "parses classic error frame" {
    var payload: [64]u8 = undefined;
    const parsed = (try parseLine(Base.hex, "3.0 2 ErrorFrame flags", &payload)) orelse return error.ExpectedFrame;
    try std.testing.expectEqual(@as(Kind, .error_frame), parsed.kind);
    try std.testing.expectEqual(@as(?Id, null), parsed.id);
}

test "parses decimal base IDs and bytes" {
    var payload: [64]u8 = undefined;
    const parsed = (try parseLine(Base.dec, "4.0 1 291 Rx d 2 170 187", &payload)) orelse return error.ExpectedFrame;
    try std.testing.expectEqual(@as(u32, 291), parsed.id.?.value);
    try std.testing.expectEqual(@as(u8, 0xaa), payload[0]);
    try std.testing.expectEqual(@as(u8, 0xbb), payload[1]);
}

test "parses CAN FD data frame payload length from data length field" {
    var payload: [64]u8 = undefined;
    const parsed = (try parseLine(Base.hex, "5.0 CANFD 1 Rx 18fee900x - 1 0 9 12 01 02 03 04 05 06 07 08 09 0a 0b 0c", &payload)) orelse return error.ExpectedFrame;
    try std.testing.expectEqual(@as(Kind, .data), parsed.kind);
    try std.testing.expect(parsed.is_fd);
    try std.testing.expectEqual(@as(u8, 9), parsed.dlc);
    try std.testing.expectEqual(@as(u8, 12), parsed.payload_len);
    try std.testing.expectEqual(@as(u8, 0x01), payload[0]);
    try std.testing.expectEqual(@as(u8, 0x0c), payload[11]);
}

test "rejects CAN FD data frame when data length does not match DLC" {
    var payload: [64]u8 = undefined;
    try std.testing.expectError(
        error.InvalidPayloadLength,
        parseLine(Base.hex, "5.0 CANFD 1 Rx 18fee900x - 1 0 9 8 01 02 03 04 05 06 07 08", &payload),
    );
}

test "keeps timestamped unrecognized lines as unknown frames" {
    var payload: [64]u8 = undefined;
    const parsed = (try parseLine(Base.hex, "6.25 CANFD_STATISTIC whatever else", &payload)) orelse return error.ExpectedFrame;
    try std.testing.expectEqual(@as(u64, 6_250_000_000), parsed.timestamp_ns);
    try std.testing.expectEqual(@as(Kind, .unknown), parsed.kind);
    try std.testing.expectEqual(@as(?Id, null), parsed.id);
}

test "keeps timestamp-only lines as unknown frames" {
    var payload: [64]u8 = undefined;
    const parsed = (try parseLine(Base.hex, "6.5", &payload)) orelse return error.ExpectedFrame;
    try std.testing.expectEqual(@as(u64, 6_500_000_000), parsed.timestamp_ns);
    try std.testing.expectEqual(@as(Kind, .unknown), parsed.kind);
}

test "returns null for empty line" {
    var payload: [64]u8 = undefined;
    try std.testing.expectEqual(@as(?Frame, null), try parseLine(Base.hex, " \t\r", &payload));
}

test "returns null for non-frame header line" {
    var payload: [64]u8 = undefined;
    try std.testing.expectEqual(@as(?Frame, null), try parseLine(Base.hex, "date Tue Apr 28 10:00:00.000 2026", &payload));
}
