const std = @import("std");

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

pub const SourceSpan = struct {
    start: u32,
    len: u32,
};

pub const Frame = struct {
    /// Normalized offset from the ASC measurement start. If the ASC header uses
    /// relative timestamps, this is the accumulated timestamp.
    timestamp_ns: u64,

    /// Index into Asc.channels. Keeping the channel payload out of each frame
    /// makes the hot "all frames for CAN ID X" path smaller.
    channel_index: u16,

    kind: Kind,

    id: ?Id = null,

    /// Only needed to distinguish classic CAN from CAN FD payload limits. FD
    /// timing/BRS/ESI details stay in raw_line unless they affect signal plots.
    is_fd: bool = false,

    /// Raw DLC as written in the trace. For CAN FD, this is not necessarily the
    /// payload length: DLC 9..15 maps to 12,16,20,24,32,48,64 bytes.
    dlc: u8 = 0,
    payload_len: u8 = 0,
    payload: [64]u8 = [_]u8{0} ** 64,

    raw_line: SourceSpan,

    pub fn data(
        timestamp_ns: u64,
        channel_index: u16,
        id: Id,
        dlc: u8,
        payload: []const u8,
        raw_line: SourceSpan,
    ) Frame {
        std.debug.assert(payload.len <= 8);

        var frame: Frame = .{
            .timestamp_ns = timestamp_ns,
            .channel_index = channel_index,
            .kind = .data,
            .id = id,
            .dlc = dlc,
            .payload_len = @intCast(payload.len),
            .raw_line = raw_line,
        };
        @memcpy(frame.payload[0..payload.len], payload);
        return frame;
    }

    pub fn remote(
        timestamp_ns: u64,
        channel_index: u16,
        id: Id,
        dlc: u8,
        raw_line: SourceSpan,
    ) Frame {
        return .{
            .timestamp_ns = timestamp_ns,
            .channel_index = channel_index,
            .kind = .remote,
            .id = id,
            .dlc = dlc,
            .raw_line = raw_line,
        };
    }

    pub fn canFdData(
        timestamp_ns: u64,
        channel_index: u16,
        id: Id,
        dlc: u8,
        payload: []const u8,
        raw_line: SourceSpan,
    ) Frame {
        std.debug.assert(payload.len <= 64);

        var frame: Frame = .{
            .timestamp_ns = timestamp_ns,
            .channel_index = channel_index,
            .kind = .data,
            .id = id,
            .is_fd = true,
            .dlc = dlc,
            .payload_len = @intCast(payload.len),
            .raw_line = raw_line,
        };
        @memcpy(frame.payload[0..payload.len], payload);
        return frame;
    }

    pub fn nonData(
        kind: Kind,
        timestamp_ns: u64,
        channel_index: u16,
        raw_line: SourceSpan,
    ) Frame {
        std.debug.assert(kind != .data);
        return .{
            .timestamp_ns = timestamp_ns,
            .channel_index = channel_index,
            .kind = kind,
            .raw_line = raw_line,
        };
    }
};

test "classic and fd frames share the same storage shape" {
    const classic = Frame.data(
        1_000_000,
        0,
        Id.standard(0x123),
        2,
        &.{ 0xaa, 0xbb },
        .{ .start = 0, .len = 32 },
    );
    try std.testing.expect(!classic.is_fd);
    try std.testing.expectEqual(@as(u8, 2), classic.payload_len);
    try std.testing.expectEqual(@as(u8, 0xaa), classic.payload[0]);

    const fd = Frame.canFdData(
        2_000_000,
        0,
        Id.extended(0x18fee900),
        15,
        &([_]u8{0x55} ** 64),
        .{ .start = 33, .len = 120 },
    );
    try std.testing.expect(fd.is_fd);
    try std.testing.expectEqual(@as(u8, 15), fd.dlc);
    try std.testing.expectEqual(@as(u8, 64), fd.payload_len);
}
