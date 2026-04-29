const std = @import("std");
pub const frame = @import("frame.zig");

pub const Base = frame.Base;

/// Timestamping modes used by the .asc format.
pub const TimestampMode = enum {
    absolute,
    relative,
};

/// Metadata from the .asc file header.
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

    frames: []const frame.Frame = &.{},

    /// Optional parse-time index for the hot path: decode every occurrence of
    /// one DBC message ID into a selected signal series.
    by_id: []const FrameIndexEntry = &.{},

    pub fn fromString(allocator: std.mem.Allocator, text: []const u8) !Asc {
        const source = try allocator.dupe(u8, text);
        errdefer allocator.free(source);

        var parsed: Asc = .{ .source = source };
        var frames: std.ArrayList(frame.Frame) = .empty;
        errdefer frames.deinit(allocator);

        var relative_timestamp_ns: u64 = 0;
        var lines = std.mem.splitScalar(u8, source, '\n');
        while (lines.next()) |raw_line| {
            const line = std.mem.trim(u8, raw_line, " \t\r");
            if (line.len == 0) continue;

            if (try parseHeaderLine(&parsed, line)) continue;

            if (try frame.Frame.fromString(parsed.base, line)) |line_frame| {
                var normalized = line_frame;
                if (parsed.timestamp_mode == .relative) {
                    relative_timestamp_ns = try std.math.add(u64, relative_timestamp_ns, normalized.timestamp_ns);
                    normalized.timestamp_ns = relative_timestamp_ns;
                }
                try frames.append(allocator, normalized);
            }
        }

        parsed.frames = try frames.toOwnedSlice(allocator);
        return parsed;
    }

    pub fn deinit(self: *Asc, allocator: std.mem.Allocator) void {
        allocator.free(self.source);
        allocator.free(self.frames);
        for (self.by_id) |entry| {
            allocator.free(entry.frame_indices);
        }
        allocator.free(self.by_id);
        self.* = .{ .source = &.{} };
    }
};

fn parseHeaderLine(parsed: *Asc, line: []const u8) !bool {
    if (std.mem.eql(u8, line, "no internal events logged")) {
        parsed.metadata.internal_events_logged = false;
        return true;
    }
    if (std.mem.eql(u8, line, "internal events logged")) {
        parsed.metadata.internal_events_logged = true;
        return true;
    }

    if (stripPrefix(line, "date ")) |date| {
        parsed.metadata.date = date;
        return true;
    }
    if (stripPrefix(line, "Begin Triggerblock ")) |triggerblock| {
        parsed.metadata.triggerblock_start = triggerblock;
        return true;
    }
    if (stripPrefix(line, "End TriggerBlock")) |triggerblock| {
        parsed.metadata.triggerblock_end = std.mem.trim(u8, triggerblock, " \t\r");
        return true;
    }
    if (stripPrefix(line, "// version ")) |version| {
        parsed.metadata.version = version;
        return true;
    }

    if (std.mem.startsWith(u8, line, "base ")) {
        try parseBaseLine(parsed, line);
        return true;
    }

    return false;
}

fn parseBaseLine(parsed: *Asc, line: []const u8) !void {
    var tokens = std.mem.tokenizeAny(u8, line, " \t\r");
    const base_keyword = tokens.next() orelse return error.InvalidBaseLine;
    if (!std.mem.eql(u8, base_keyword, "base")) return error.InvalidBaseLine;

    const base_text = tokens.next() orelse return error.InvalidBaseLine;
    parsed.base = if (std.mem.eql(u8, base_text, "hex"))
        .hex
    else if (std.mem.eql(u8, base_text, "dec"))
        .dec
    else
        return error.InvalidBaseLine;

    const timestamps_keyword = tokens.next() orelse return error.InvalidBaseLine;
    if (!std.mem.eql(u8, timestamps_keyword, "timestamps")) return error.InvalidBaseLine;

    const mode_text = tokens.next() orelse return error.InvalidBaseLine;
    parsed.timestamp_mode = if (std.mem.eql(u8, mode_text, "absolute"))
        .absolute
    else if (std.mem.eql(u8, mode_text, "relative"))
        .relative
    else
        return error.InvalidBaseLine;
}

/// Returns the remainder of a string on the condition that the prefix is present.
fn stripPrefix(text: []const u8, prefix: []const u8) ?[]const u8 {
    if (!std.mem.startsWith(u8, text, prefix)) return null;
    return text[prefix.len..];
}

pub const parseDecimalSecondsToNs = frame.parseDecimalSecondsToNs;
pub const fdPayloadLengthFromDlc = frame.fdPayloadLengthFromDlc;

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

test "frame parser accepts asc base enum" {
    const parsed = (try frame.Frame.fromString(Base.hex, "0.001 1 123 Rx d 1 aa")) orelse return error.ExpectedFrame;
    try std.testing.expectEqual(@as(u32, 0x123), parsed.id.?.value);
    try std.testing.expectEqual(@as(u8, 0xaa), parsed.payload[0]);
}

test "parses asc source with header metadata and decimal base" {
    const allocator = std.testing.allocator;
    const text =
        \\date Tue Apr 28 10:00:00.000 2026
        \\base dec timestamps absolute
        \\internal events logged
        \\Begin Triggerblock Tue Apr 28 10:00:00.000 2026
        \\0.001 1 291 Rx d 2 170 187
        \\End TriggerBlock
    ;

    var parsed = try Asc.fromString(allocator, text);
    defer parsed.deinit(allocator);

    try std.testing.expectEqual(@as(Base, .dec), parsed.base);
    try std.testing.expectEqual(@as(TimestampMode, .absolute), parsed.timestamp_mode);
    try std.testing.expectEqualStrings("Tue Apr 28 10:00:00.000 2026", parsed.metadata.date.?);
    try std.testing.expectEqual(true, parsed.metadata.internal_events_logged.?);
    try std.testing.expectEqualStrings("Tue Apr 28 10:00:00.000 2026", parsed.metadata.triggerblock_start.?);
    try std.testing.expectEqual(@as(usize, 1), parsed.frames.len);
    try std.testing.expectEqual(@as(u64, 1_000_000), parsed.frames[0].timestamp_ns);
    try std.testing.expectEqual(@as(u32, 291), parsed.frames[0].id.?.value);
    try std.testing.expectEqual(@as(u8, 0xaa), parsed.frames[0].payload[0]);
    try std.testing.expectEqual(@as(u8, 0xbb), parsed.frames[0].payload[1]);
}

test "normalizes relative timestamps across unknown events" {
    const allocator = std.testing.allocator;
    const text =
        \\base hex timestamps relative
        \\0.100000 1 123 Rx d 1 aa
        \\0.200000 CANFD_STATISTIC whatever else
        \\0.300000 1 123 Rx d 1 bb
    ;

    var parsed = try Asc.fromString(allocator, text);
    defer parsed.deinit(allocator);

    try std.testing.expectEqual(@as(TimestampMode, .relative), parsed.timestamp_mode);
    try std.testing.expectEqual(@as(usize, 3), parsed.frames.len);
    try std.testing.expectEqual(@as(u64, 100_000_000), parsed.frames[0].timestamp_ns);
    try std.testing.expectEqual(@as(u64, 300_000_000), parsed.frames[1].timestamp_ns);
    try std.testing.expectEqual(@as(u64, 600_000_000), parsed.frames[2].timestamp_ns);
    try std.testing.expectEqual(@as(frame.Kind, .unknown), parsed.frames[1].kind);
}

test "channel tokens borrow from owned asc source" {
    const allocator = std.testing.allocator;
    const text =
        \\base hex timestamps absolute
        \\0.001 CAN_A 123 Rx d 1 aa
    ;

    var parsed = try Asc.fromString(allocator, text);
    defer parsed.deinit(allocator);

    const channel = parsed.frames[0].channel orelse return error.ExpectedChannel;
    try std.testing.expectEqualStrings("CAN_A", channel);

    const source_start = @intFromPtr(parsed.source.ptr);
    const source_end = source_start + parsed.source.len;
    const channel_start = @intFromPtr(channel.ptr);
    try std.testing.expect(channel_start >= source_start);
    try std.testing.expect(channel_start + channel.len <= source_end);
}
