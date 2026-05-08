const std = @import("std");
pub const frame = @import("frame.zig");
const line_v1 = @import("line_v1.zig");
const line_v2 = @import("line_v2.zig");

pub const Trc = struct {
    version: frame.Version = .v10,
    columns: ?frame.ColumnMap = null,
    measurement_start_ms: ?i64 = null,
    frames: []const frame.Frame = &.{},
    payloads: []const u8 = &.{},
    data_frame_count: usize = 0,
    last_timestamp_ns: ?u64 = null,
    last_data_timestamp_ns: ?u64 = null,

    pub fn fromString(allocator: std.mem.Allocator, text: []const u8) !Trc {
        var parsed: Trc = .{};
        var frames: std.ArrayList(frame.Frame) = .empty;
        errdefer frames.deinit(allocator);
        var payloads: std.ArrayList(u8) = .empty;
        errdefer payloads.deinit(allocator);

        var payload_buffer: [64]u8 = undefined;
        var lines = std.mem.splitScalar(u8, text, '\n');
        while (lines.next()) |raw_line| {
            const line = std.mem.trim(u8, raw_line, " \t\r");
            if (line.len == 0) continue;

            if (try parseHeaderLine(&parsed, line)) continue;
            if (parsed.version == .v30) return error.UnsupportedTrcVersion;
            if (parsed.version.isV2() and parsed.columns == null) return error.InvalidTrcColumns;

            const parsed_frame = if (parsed.version.isV2())
                try line_v2.parseLine(parsed.columns.?, line, &payload_buffer)
            else
                try line_v1.parseLine(line, &payload_buffer);

            if (parsed_frame) |line_frame| {
                var stored = line_frame;
                if (stored.kind == .data and stored.id != null) {
                    const start = payloads.items.len;
                    try payloads.appendSlice(allocator, payload_buffer[0..stored.payload_len]);
                    stored.payload_offset = @intCast(start);
                    parsed.data_frame_count += 1;
                    parsed.last_data_timestamp_ns = stored.timestamp_ns;
                }
                parsed.last_timestamp_ns = stored.timestamp_ns;
                try frames.append(allocator, stored);
            }
        }

        if (parsed.version.isV2() and parsed.columns == null) return error.InvalidTrcColumns;

        parsed.frames = try frames.toOwnedSlice(allocator);
        parsed.payloads = try payloads.toOwnedSlice(allocator);
        return parsed;
    }

    pub fn deinit(self: *Trc, allocator: std.mem.Allocator) void {
        allocator.free(self.frames);
        allocator.free(self.payloads);
        self.* = .{};
    }
};

fn parseHeaderLine(parsed: *Trc, line: []const u8) !bool {
    if (!std.mem.startsWith(u8, line, ";")) return false;
    const body = std.mem.trim(u8, line[1..], " \t\r");

    if (stripPrefix(body, "$FILEVERSION=")) |version_text| {
        parsed.version = try frame.Version.fromText(std.mem.trim(u8, version_text, " \t\r"));
        return true;
    }
    if (stripPrefix(body, "$STARTTIME=")) |start_time| {
        parsed.measurement_start_ms = parseOleAutomationDaysToUnixMs(std.mem.trim(u8, start_time, " \t\r")) catch null;
        return true;
    }
    if (stripPrefix(body, "$COLUMNS=")) |columns_text| {
        parsed.columns = try frame.ColumnMap.fromText(columns_text);
        return true;
    }

    return true;
}

fn stripPrefix(text: []const u8, prefix: []const u8) ?[]const u8 {
    if (!std.mem.startsWith(u8, text, prefix)) return null;
    return text[prefix.len..];
}

fn parseOleAutomationDaysToUnixMs(text: []const u8) !i64 {
    if (text.len == 0 or text[0] == '-') return error.InvalidStartTime;

    var parts = std.mem.splitScalar(u8, text, '.');
    const days_text = parts.next() orelse return error.InvalidStartTime;
    const fraction_text = parts.next();
    if (parts.next() != null) return error.InvalidStartTime;

    const days = try std.fmt.parseInt(i64, days_text, 10);
    var ms = try std.math.mul(i64, days - 25_569, std.time.ms_per_day);

    if (fraction_text) |fraction| {
        const fraction_value = try std.fmt.parseInt(i64, fraction, 10);
        const scale = std.math.pow(i64, 10, @intCast(fraction.len));
        const fraction_ms = @divTrunc(try std.math.mul(i64, fraction_value, std.time.ms_per_day), scale);
        ms = try std.math.add(i64, ms, fraction_ms);
    }

    return ms;
}

pub const parseTimestampMsToNs = frame.parseTimestampMsToNs;

test "parses TRC 1.x file into frame storage and metadata counters" {
    const allocator = std.testing.allocator;
    const text =
        \\;$FILEVERSION=1.1
        \\;$STARTTIME=46000.5
        \\1 0.100 Rx 0123 2 AA BB
        \\2 0.200 RTR 0123 8
    ;

    var parsed = try Trc.fromString(allocator, text);
    defer parsed.deinit(allocator);

    try std.testing.expectEqual(@as(frame.Version, .v11), parsed.version);
    try std.testing.expectEqual(@as(i64, 1_765_281_600_000), parsed.measurement_start_ms.?);
    try std.testing.expectEqual(@as(usize, 2), parsed.frames.len);
    try std.testing.expectEqual(@as(usize, 1), parsed.data_frame_count);
    try std.testing.expectEqual(@as(u64, 200_000), parsed.last_timestamp_ns.?);
    try std.testing.expectEqual(@as(u8, 0xaa), parsed.payloads[0]);
}

test "parses TRC 2.x file with columns" {
    const allocator = std.testing.allocator;
    const text =
        \\;$FILEVERSION=2.1
        \\;$COLUMNS=N,O,T,B,I,d,R,L,D
        \\1 0.100 DT 1 0123 Rx - 2 AA BB
        \\2 0.200 ER 1 - - - 0
    ;

    var parsed = try Trc.fromString(allocator, text);
    defer parsed.deinit(allocator);

    try std.testing.expectEqual(@as(frame.Version, .v21), parsed.version);
    try std.testing.expectEqual(@as(usize, 2), parsed.frames.len);
    try std.testing.expectEqual(@as(usize, 1), parsed.data_frame_count);
    try std.testing.expectEqual(@as(u64, 200_000), parsed.last_timestamp_ns.?);
}

test "rejects TRC 3.0 for now" {
    const allocator = std.testing.allocator;
    const text =
        \\;$FILEVERSION=3.0
        \\;$COLUMNS=N,O,T,I,d,L,D
        \\1 0.100 DT 0123 Rx 2 AA BB
    ;

    try std.testing.expectError(error.UnsupportedTrcVersion, Trc.fromString(allocator, text));
}
