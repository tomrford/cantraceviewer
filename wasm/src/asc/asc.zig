const std = @import("std");
pub const frame = @import("frame.zig");

pub const Base = frame.Base;

/// Timestamping modes used by the .asc format.
pub const TimestampMode = enum {
    absolute,
    relative,
};

pub const FrameIndexEntry = struct {
    key: frame.FrameKey,

    /// Indices into Asc.frames. The first implementation can build these
    /// arrays after parsing, then signal decode can iterate only matching
    /// frames instead of scanning the whole trace each time.
    frame_indices: []const u32,
};

pub const Asc = struct {
    base: Base = .hex,
    timestamp_mode: TimestampMode = .absolute,

    /// Measurement-start wall clock parsed from `Begin Triggerblock ...`, or
    /// from `date ...` when no triggerblock start has been seen.
    measurement_start_ms: ?i64 = null,

    frames: []const frame.Frame = &.{},

    /// Optional parse-time index for the hot path: decode every occurrence of
    /// one DBC message ID into a selected signal series.
    by_id: []const FrameIndexEntry = &.{},

    pub fn fromString(allocator: std.mem.Allocator, text: []const u8) !Asc {
        var parsed: Asc = .{};
        var frames: std.ArrayList(frame.Frame) = .empty;
        errdefer frames.deinit(allocator);

        var relative_timestamp_ns: u64 = 0;
        var lines = std.mem.splitScalar(u8, text, '\n');
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
        allocator.free(self.frames);
        for (self.by_id) |entry| {
            allocator.free(entry.frame_indices);
        }
        allocator.free(self.by_id);
        self.* = .{};
    }
};

fn parseHeaderLine(parsed: *Asc, line: []const u8) !bool {
    if (std.mem.eql(u8, line, "no internal events logged") or
        std.mem.eql(u8, line, "internal events logged"))
    {
        return true;
    }

    if (stripPrefix(line, "date ")) |date| {
        if (parsed.measurement_start_ms == null) {
            parsed.measurement_start_ms = parseVectorDateToUnixMs(date) catch null;
        }
        return true;
    }
    if (stripPrefix(line, "Begin Triggerblock ")) |triggerblock| {
        parsed.measurement_start_ms = parseVectorDateToUnixMs(triggerblock) catch null;
        return true;
    }
    if (std.mem.startsWith(u8, line, "End TriggerBlock")) {
        return true;
    }
    if (std.mem.startsWith(u8, line, "// version ")) {
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

fn parseVectorDateToUnixMs(text: []const u8) !i64 {
    // ASC date strings do not carry a timezone; use UTC for deterministic display.
    var tokens = std.mem.tokenizeAny(u8, text, " \t\r");
    _ = tokens.next() orelse return error.InvalidVectorDate;
    const month_text = tokens.next() orelse return error.InvalidVectorDate;
    const day = try std.fmt.parseInt(u8, tokens.next() orelse return error.InvalidVectorDate, 10);
    const time_text = tokens.next() orelse return error.InvalidVectorDate;
    const year = try std.fmt.parseInt(i32, tokens.next() orelse return error.InvalidVectorDate, 10);

    const month = parseMonth(month_text) orelse return error.InvalidVectorDate;
    const time = try parseTimeOfDay(time_text);
    const days = daysFromCivil(year, month, day);
    const seconds = try std.math.add(i64, try std.math.mul(i64, days, std.time.s_per_day), time.seconds);
    return try std.math.add(i64, try std.math.mul(i64, seconds, std.time.ms_per_s), time.milliseconds);
}

fn parseMonth(text: []const u8) ?u8 {
    const months = [_][]const u8{
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    };
    for (months, 1..) |month, index| {
        if (std.mem.eql(u8, text, month)) return @intCast(index);
    }
    return null;
}

fn parseTimeOfDay(text: []const u8) !struct { seconds: i64, milliseconds: i64 } {
    var parts = std.mem.splitScalar(u8, text, ':');
    const hour = try std.fmt.parseInt(u8, parts.next() orelse return error.InvalidVectorDate, 10);
    const minute = try std.fmt.parseInt(u8, parts.next() orelse return error.InvalidVectorDate, 10);
    const second_text = parts.next() orelse return error.InvalidVectorDate;
    if (parts.next() != null) return error.InvalidVectorDate;

    var seconds_parts = std.mem.splitScalar(u8, second_text, '.');
    const second = try std.fmt.parseInt(u8, seconds_parts.next() orelse return error.InvalidVectorDate, 10);
    const fraction = seconds_parts.next();
    if (seconds_parts.next() != null) return error.InvalidVectorDate;

    if (hour > 23 or minute > 59 or second > 59) return error.InvalidVectorDate;

    var milliseconds: i64 = 0;
    if (fraction) |digits| {
        if (digits.len > 3) return error.InvalidVectorDate;
        const fraction_value = try std.fmt.parseInt(i64, digits, 10);
        const scale_exponent: i64 = @intCast(3 - digits.len);
        milliseconds = fraction_value * std.math.pow(i64, 10, scale_exponent);
    }

    const seconds = @as(i64, hour) * std.time.s_per_hour +
        @as(i64, minute) * std.time.s_per_min +
        @as(i64, second);
    return .{ .seconds = seconds, .milliseconds = milliseconds };
}

fn daysFromCivil(year_value: i32, month_value: u8, day_value: u8) i64 {
    var year = @as(i64, year_value);
    const month = @as(i64, month_value);
    const day = @as(i64, day_value);

    year -= if (month <= 2) 1 else 0;
    const era = @divFloor(year, 400);
    const year_of_era = year - era * 400;
    const month_prime = month + if (month > 2) @as(i64, -3) else @as(i64, 9);
    const day_of_year = @divFloor(153 * month_prime + 2, 5) + day - 1;
    const day_of_era = year_of_era * 365 + @divFloor(year_of_era, 4) - @divFloor(year_of_era, 100) + day_of_year;
    return era * 146097 + day_of_era - 719468;
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

test "parses asc source with measurement start and decimal base" {
    const allocator = std.testing.allocator;
    const text =
        \\date Tue Apr 28 09:00:00.000 2026
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
    try std.testing.expectEqual(@as(i64, 1_777_370_400_000), parsed.measurement_start_ms.?);
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

test "parses vector date to unix milliseconds" {
    try std.testing.expectEqual(
        @as(i64, 1_777_370_400_123),
        try parseVectorDateToUnixMs("Tue Apr 28 10:00:00.123 2026"),
    );
}
