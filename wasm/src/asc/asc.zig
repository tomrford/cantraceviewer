const std = @import("std");
pub const frame = @import("frame.zig");

pub const Base = enum {
    hex,
    dec,

    pub fn toInt(self: Base) usize {
        return switch (self) {
            self.hex => 16,
            self.dec => 10,
        };
    }
};

pub const TimestampMode = enum {
    absolute,
    relative,
};

pub const Metadata = struct {
    /// Raw `date ...` line payload. Keep this as display/source metadata until
    /// we decide how much Vector date parsing we need in Zig.
    date: ?[]const u8 = null,

    /// Raw `Begin Triggerblock ...` payload. This often matches `date`, but it
    /// is a separate source field and should not be deduped during parse.
    triggerblock_start: ?[]const u8 = null,
    triggerblock_end: ?[]const u8 = null,

    version: ?[]const u8 = null,
    internal_events_logged: ?bool = null,
};

pub const FrameIndexEntry = struct {
    key: frame.FrameKey,

    /// Indices into Asc.frames. The first implementation can build these
    /// arrays after parsing, then signal decode can iterate only matching
    /// frames instead of scanning the whole trace each time.
    frame_indices: []const u32,
};

pub const Asc = struct {
    source: []const u8,
    metadata: Metadata = .{},

    base: Base = .hex,
    timestamp_mode: TimestampMode = .absolute,

    /// Measurement-start wall clock in JavaScript-safe millisecond precision,
    /// if we choose to parse it. Relative nanoseconds stay separate so long
    /// traces preserve ordering and sub-millisecond detail.
    measurement_start_ms: ?i64 = null,

    channels: []const frame.Channel = &.{},
    frames: []const frame.Frame = &.{},

    /// Optional parse-time index for the hot path: decode every occurrence of
    /// one DBC message ID into a selected signal series.
    by_id: []const FrameIndexEntry = &.{},

    pub fn deinit(self: *Asc, allocator: std.mem.Allocator) void {
        allocator.free(self.source);
        allocator.free(self.channels);
        allocator.free(self.frames);
        for (self.by_id) |entry| {
            allocator.free(entry.frame_indices);
        }
        allocator.free(self.by_id);
        self.* = .{ .source = &.{} };
    }
};

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

test "parses decimal seconds into nanoseconds without floating point" {
    try std.testing.expectEqual(@as(u64, 0), try parseDecimalSecondsToNs("0"));
    try std.testing.expectEqual(@as(u64, 3_040_000), try parseDecimalSecondsToNs("0.003040"));
    try std.testing.expectEqual(@as(u64, 10_010_000_000), try parseDecimalSecondsToNs("10.01"));
    try std.testing.expectEqual(@as(u64, 3_600_000_000_000), try parseDecimalSecondsToNs("3600"));
    try std.testing.expectEqual(@as(u64, 3_600_000_000_001), try parseDecimalSecondsToNs("3600.000000001"));
    try std.testing.expectError(error.TimestampTooPrecise, parseDecimalSecondsToNs("1.0000000001"));
}

test "maps CAN FD DLC to payload length" {
    try std.testing.expectEqual(@as(u8, 8), try fdPayloadLengthFromDlc(8));
    try std.testing.expectEqual(@as(u8, 12), try fdPayloadLengthFromDlc(9));
    try std.testing.expectEqual(@as(u8, 64), try fdPayloadLengthFromDlc(15));
    try std.testing.expectError(error.InvalidDlc, fdPayloadLengthFromDlc(16));
}
