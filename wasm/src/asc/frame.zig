const std = @import("std");

pub const Base = enum {
    hex,
    dec,

    pub fn toInt(self: Base) u8 {
        return switch (self) {
            .hex => 16,
            .dec => 10,
        };
    }
};

pub const Kind = enum {
    data,
    remote,
    error_frame,
    unknown,
};

pub const Channel = union(enum) {
    numeric: u16,
    label: []const u8,
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

    channel: ?Channel = null,

    kind: Kind,

    id: ?Id = null,

    /// Only needed to distinguish classic CAN from CAN FD payload limits.
    is_fd: bool = false,

    /// Raw DLC as written in the trace. For CAN FD, this is not necessarily the
    /// payload length: DLC 9..15 maps to 12,16,20,24,32,48,64 bytes.
    dlc: u8 = 0,
    payload_len: u8 = 0,
    payload: [64]u8 = [_]u8{0} ** 64,

    pub fn data(
        timestamp_ns: u64,
        channel: Channel,
        id: Id,
        dlc: u8,
        payload: []const u8,
    ) Frame {
        std.debug.assert(payload.len <= 8);

        var frame: Frame = .{
            .timestamp_ns = timestamp_ns,
            .channel = channel,
            .kind = .data,
            .id = id,
            .dlc = dlc,
            .payload_len = @intCast(payload.len),
        };
        @memcpy(frame.payload[0..payload.len], payload);
        return frame;
    }

    pub fn remote(
        timestamp_ns: u64,
        channel: Channel,
        id: Id,
        dlc: u8,
    ) Frame {
        return .{
            .timestamp_ns = timestamp_ns,
            .channel = channel,
            .kind = .remote,
            .id = id,
            .dlc = dlc,
        };
    }

    pub fn canFdData(
        timestamp_ns: u64,
        channel: Channel,
        id: Id,
        dlc: u8,
        payload: []const u8,
    ) Frame {
        std.debug.assert(payload.len <= 64);

        var frame: Frame = .{
            .timestamp_ns = timestamp_ns,
            .channel = channel,
            .kind = .data,
            .id = id,
            .is_fd = true,
            .dlc = dlc,
            .payload_len = @intCast(payload.len),
        };
        @memcpy(frame.payload[0..payload.len], payload);
        return frame;
    }

    pub fn nonData(
        kind: Kind,
        timestamp_ns: u64,
        channel: ?Channel,
    ) Frame {
        std.debug.assert(kind != .data);
        return .{
            .timestamp_ns = timestamp_ns,
            .channel = channel,
            .kind = kind,
        };
    }

    pub fn fromString(base: Base, line: []const u8) !?Frame {
        var tokens = std.mem.tokenizeAny(u8, line, " \t\r");
        const timestamp_text = tokens.next() orelse return null;
        const timestamp_ns = parseDecimalSecondsToNs(timestamp_text) catch |err| switch (err) {
            error.InvalidCharacter => return null,
            else => return err,
        };

        const first = tokens.next() orelse return Frame.nonData(.unknown, timestamp_ns, null);
        if (std.mem.eql(u8, first, "CANFD")) {
            return try parseCanFd(base, timestamp_ns, &tokens);
        }

        const channel = parseChannel(first);
        const id_or_kind = tokens.next() orelse return Frame.nonData(.unknown, timestamp_ns, channel);
        if (std.mem.eql(u8, id_or_kind, "ErrorFrame")) {
            return Frame.nonData(.error_frame, timestamp_ns, channel);
        }

        const id = parseId(base, id_or_kind) catch return Frame.nonData(.unknown, timestamp_ns, channel);
        _ = tokens.next() orelse return Frame.nonData(.unknown, timestamp_ns, channel);
        const frame_kind = tokens.next() orelse return Frame.nonData(.unknown, timestamp_ns, channel);
        if (std.mem.eql(u8, frame_kind, "d")) {
            const dlc_text = tokens.next() orelse return error.InvalidFrameLine;
            const dlc = try parseDlc(dlc_text);
            if (dlc > 8) return error.InvalidDlc;

            var payload: [8]u8 = undefined;
            var payload_len: usize = 0;
            while (payload_len < dlc) : (payload_len += 1) {
                const byte_text = tokens.next() orelse return error.InvalidFrameLine;
                payload[payload_len] = try parseByte(base, byte_text);
            }
            return Frame.data(timestamp_ns, channel, id, dlc, payload[0..payload_len]);
        }

        if (std.mem.eql(u8, frame_kind, "r")) {
            const dlc = if (tokens.next()) |dlc_text| try parseDlc(dlc_text) else 0;
            return Frame.remote(timestamp_ns, channel, id, dlc);
        }

        return Frame.nonData(.unknown, timestamp_ns, channel);
    }
};

const LineTokenIterator = std.mem.TokenIterator(u8, .any);

fn parseCanFd(base: Base, timestamp_ns: u64, tokens: *LineTokenIterator) !?Frame {
    const channel_text = tokens.next() orelse return error.InvalidFrameLine;
    const channel = parseChannel(channel_text);
    _ = tokens.next() orelse return error.InvalidFrameLine;
    const id = try parseId(base, tokens.next() orelse return error.InvalidFrameLine);
    _ = tokens.next() orelse return error.InvalidFrameLine;
    _ = tokens.next() orelse return error.InvalidFrameLine;
    _ = tokens.next() orelse return error.InvalidFrameLine;
    const dlc = try parseDlc(tokens.next() orelse return error.InvalidFrameLine);
    const payload_len = try parsePayloadLength(tokens.next() orelse return error.InvalidFrameLine);
    const expected_payload_len = try fdPayloadLengthFromDlc(dlc);
    if (payload_len > expected_payload_len) return error.InvalidPayloadLength;

    var payload: [64]u8 = undefined;
    var index: usize = 0;
    while (index < payload_len) : (index += 1) {
        payload[index] = try parseByte(base, tokens.next() orelse return error.InvalidFrameLine);
    }
    return Frame.canFdData(timestamp_ns, channel, id, dlc, payload[0..payload_len]);
}

fn parseChannel(text: []const u8) Channel {
    const value = std.fmt.parseUnsigned(u16, text, 10) catch return .{ .label = text };
    return .{ .numeric = value };
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

test "classic and fd frames share the same storage shape" {
    const classic = Frame.data(
        1_000_000,
        .{ .numeric = 1 },
        Id.standard(0x123),
        2,
        &.{ 0xaa, 0xbb },
    );
    try std.testing.expect(!classic.is_fd);
    try std.testing.expectEqual(@as(u8, 2), classic.payload_len);
    try std.testing.expectEqual(@as(u8, 0xaa), classic.payload[0]);

    const fd = Frame.canFdData(
        2_000_000,
        .{ .numeric = 1 },
        Id.extended(0x18fee900),
        15,
        &([_]u8{0x55} ** 64),
    );
    try std.testing.expect(fd.is_fd);
    try std.testing.expectEqual(@as(u8, 15), fd.dlc);
    try std.testing.expectEqual(@as(u8, 64), fd.payload_len);
}

test "parses classic data frame" {
    const parsed = (try Frame.fromString(Base.hex, "0.003040 1 123 Rx d 2 AA bb")) orelse return error.ExpectedFrame;
    try std.testing.expectEqual(@as(u64, 3_040_000), parsed.timestamp_ns);
    try std.testing.expectEqual(@as(Kind, .data), parsed.kind);
    try expectNumericChannel(1, parsed.channel);
    try std.testing.expectEqual(@as(u32, 0x123), parsed.id.?.value);
    try std.testing.expect(!parsed.id.?.is_extended);
    try std.testing.expectEqual(@as(u8, 2), parsed.dlc);
    try std.testing.expectEqual(@as(u8, 2), parsed.payload_len);
    try std.testing.expectEqual(@as(u8, 0xaa), parsed.payload[0]);
    try std.testing.expectEqual(@as(u8, 0xbb), parsed.payload[1]);
}

test "parses extended classic data frame" {
    const parsed = (try Frame.fromString(Base.hex, "1.0 CAN_A 18fee900x Tx d 1 55")) orelse return error.ExpectedFrame;
    try expectLabelChannel("CAN_A", parsed.channel);
    try std.testing.expectEqual(@as(u32, 0x18fee900), parsed.id.?.value);
    try std.testing.expect(parsed.id.?.is_extended);
}

test "parses classic remote frame" {
    const parsed = (try Frame.fromString(Base.hex, "2.5 1 123 Rx r 8")) orelse return error.ExpectedFrame;
    try std.testing.expectEqual(@as(u64, 2_500_000_000), parsed.timestamp_ns);
    try std.testing.expectEqual(@as(Kind, .remote), parsed.kind);
    try std.testing.expectEqual(@as(u8, 8), parsed.dlc);
    try std.testing.expectEqual(@as(u8, 0), parsed.payload_len);
}

test "parses classic error frame" {
    const parsed = (try Frame.fromString(Base.hex, "3.0 2 ErrorFrame flags")) orelse return error.ExpectedFrame;
    try std.testing.expectEqual(@as(Kind, .error_frame), parsed.kind);
    try expectNumericChannel(2, parsed.channel);
    try std.testing.expectEqual(@as(?Id, null), parsed.id);
}

test "parses decimal base IDs and bytes" {
    const parsed = (try Frame.fromString(Base.dec, "4.0 1 291 Rx d 2 170 187")) orelse return error.ExpectedFrame;
    try std.testing.expectEqual(@as(u32, 291), parsed.id.?.value);
    try std.testing.expectEqual(@as(u8, 0xaa), parsed.payload[0]);
    try std.testing.expectEqual(@as(u8, 0xbb), parsed.payload[1]);
}

test "parses CAN FD data frame payload length from data length field" {
    const parsed = (try Frame.fromString(Base.hex, "5.0 CANFD 1 Rx 18fee900x - 1 0 9 12 01 02 03 04 05 06 07 08 09 0a 0b 0c")) orelse return error.ExpectedFrame;
    try std.testing.expectEqual(@as(Kind, .data), parsed.kind);
    try std.testing.expect(parsed.is_fd);
    try std.testing.expectEqual(@as(u8, 9), parsed.dlc);
    try std.testing.expectEqual(@as(u8, 12), parsed.payload_len);
    try std.testing.expectEqual(@as(u8, 0x01), parsed.payload[0]);
    try std.testing.expectEqual(@as(u8, 0x0c), parsed.payload[11]);
}

test "keeps timestamped unrecognized lines as unknown frames" {
    const parsed = (try Frame.fromString(Base.hex, "6.25 CANFD_STATISTIC whatever else")) orelse return error.ExpectedFrame;
    try std.testing.expectEqual(@as(u64, 6_250_000_000), parsed.timestamp_ns);
    try std.testing.expectEqual(@as(Kind, .unknown), parsed.kind);
    try expectLabelChannel("CANFD_STATISTIC", parsed.channel);
    try std.testing.expectEqual(@as(?Id, null), parsed.id);
}

test "keeps timestamp-only lines as unknown frames" {
    const parsed = (try Frame.fromString(Base.hex, "6.5")) orelse return error.ExpectedFrame;
    try std.testing.expectEqual(@as(u64, 6_500_000_000), parsed.timestamp_ns);
    try std.testing.expectEqual(@as(Kind, .unknown), parsed.kind);
    try std.testing.expectEqual(@as(?Channel, null), parsed.channel);
}

test "returns null for empty line" {
    try std.testing.expectEqual(@as(?Frame, null), try Frame.fromString(Base.hex, " \t\r"));
}

test "returns null for non-frame header line" {
    try std.testing.expectEqual(@as(?Frame, null), try Frame.fromString(Base.hex, "date Tue Apr 28 10:00:00.000 2026"));
}

fn expectNumericChannel(expected: u16, actual: ?Channel) !void {
    const channel = actual orelse return error.ExpectedChannel;
    switch (channel) {
        .numeric => |value| try std.testing.expectEqual(expected, value),
        .label => return error.ExpectedNumericChannel,
    }
}

fn expectLabelChannel(expected: []const u8, actual: ?Channel) !void {
    const channel = actual orelse return error.ExpectedChannel;
    switch (channel) {
        .numeric => return error.ExpectedLabelChannel,
        .label => |value| try std.testing.expectEqualStrings(expected, value),
    }
}
