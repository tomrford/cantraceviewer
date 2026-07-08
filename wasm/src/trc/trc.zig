const std = @import("std");
pub const frame = @import("frame.zig");
const line_v1 = @import("line_v1.zig");
const line_v2 = @import("line_v2.zig");
const trace_text = @import("../trace/text.zig");
const trace_time = @import("../trace/time.zig");
const trace = @import("../trace/trace.zig");

const ParserState = struct {
    version: frame.Version = .v10,
    columns: ?frame.ColumnMap = null,
    measurement_start_ms: ?i64 = null,
    last_timestamp_ns: ?u64 = null,
};

pub fn fromString(allocator: std.mem.Allocator, text: []const u8) !trace.Trace {
    var state: ParserState = .{};
    var parsed_trace: trace.Trace = .{};
    var frames: std.ArrayList(frame.Frame) = .empty;
    errdefer frames.deinit(allocator);
    var payloads: std.ArrayList(u8) = .empty;
    errdefer payloads.deinit(allocator);

    var payload_buffer: [64]u8 = undefined;
    var lines = std.mem.splitScalar(u8, text, '\n');
    while (lines.next()) |raw_line| {
        const line = std.mem.trim(u8, raw_line, " \t\r");
        if (line.len == 0) continue;

        if (try parseHeaderLine(&state, line)) continue;
        if (state.version == .v30) return error.UnsupportedTrcVersion;
        if (state.version.isV2() and state.columns == null) return error.InvalidTrcColumns;

        const parsed_frame = (if (state.version.isV2())
            line_v2.parseLine(state.columns.?, line, &payload_buffer)
        else
            line_v1.parseLine(line, &payload_buffer)) catch {
            parsed_trace.skipped_line_count += 1;
            continue;
        };

        if (parsed_frame) |line_frame| {
            var stored = line_frame;
            if (stored.kind == .data and stored.id != null) {
                const start = payloads.items.len;
                try payloads.appendSlice(allocator, payload_buffer[0..stored.payload_len]);
                stored.payload_offset = @intCast(start);
                parsed_trace.data_frame_count += 1;
                parsed_trace.last_data_timestamp_ns = stored.timestamp_ns;
            }
            state.last_timestamp_ns = stored.timestamp_ns;
            try frames.append(allocator, stored);
        }
    }

    if (state.version.isV2() and state.columns == null) return error.InvalidTrcColumns;

    parsed_trace.measurement_start_ms = state.measurement_start_ms;
    errdefer parsed_trace.deinit(allocator);
    parsed_trace.frames = try frames.toOwnedSlice(allocator);
    parsed_trace.payloads = try payloads.toOwnedSlice(allocator);
    return parsed_trace;
}

fn parseHeaderLine(parsed: *ParserState, line: []const u8) !bool {
    if (!std.mem.startsWith(u8, line, ";")) return false;
    const body = std.mem.trim(u8, line[1..], " \t\r");

    if (trace_text.stripPrefix(body, "$FILEVERSION=")) |version_text| {
        parsed.version = try frame.Version.fromText(std.mem.trim(u8, version_text, " \t\r"));
        return true;
    }
    if (trace_text.stripPrefix(body, "$STARTTIME=")) |start_time| {
        parsed.measurement_start_ms = parseOleAutomationDaysToUnixMs(trimHeaderValue(start_time)) catch null;
        return true;
    }
    if (trace_text.stripPrefix(body, "$COLUMNS=")) |columns_text| {
        parsed.columns = try frame.ColumnMap.fromText(columns_text);
        return true;
    }

    return true;
}

fn trimHeaderValue(text: []const u8) []const u8 {
    return std.mem.trim(u8, text, " \t\r;");
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
        const fraction_ms: i64 = @intCast(try trace_time.decimalFractionToUnits(fraction, std.time.ms_per_day, 9, .truncate));
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

    var parsed = try fromString(allocator, text);
    defer parsed.deinit(allocator);

    try std.testing.expectEqual(@as(i64, 1_765_281_600_000), parsed.measurement_start_ms.?);
    try std.testing.expectEqual(@as(usize, 2), parsed.frames.len);
    try std.testing.expectEqual(@as(usize, 1), parsed.data_frame_count);
    try std.testing.expectEqual(@as(u64, 200_000), parsed.frames[parsed.frames.len - 1].timestamp_ns);
    try std.testing.expectEqual(@as(u8, 0xaa), parsed.payloads[0]);
}

test "parses high precision TRC start time without overflow" {
    try std.testing.expectEqual(
        @as(i64, 1_777_478_811_899),
        try parseOleAutomationDaysToUnixMs("46141.6714340249528"),
    );
}

test "parses TRC start time with trailing semicolon" {
    const allocator = std.testing.allocator;
    const text =
        \\;$FILEVERSION=1.2
        \\;$STARTTIME=39878.6772258947;
        \\1 1059.900 1 Rx 0300 7 00 00 00 00 04 00 00
    ;

    var parsed = try fromString(allocator, text);
    defer parsed.deinit(allocator);

    try std.testing.expectEqual(
        try parseOleAutomationDaysToUnixMs("39878.6772258947"),
        parsed.measurement_start_ms.?,
    );
}

test "keeps unsupported TRC 1.3 long J1939 records as unknown frames" {
    const allocator = std.testing.allocator;
    const text =
        \\;$FILEVERSION=1.3
        \\1) 1.000 1 Rx 10062123 - 9 D2 AF AA 88 18 80 01 02 03
        \\2) 2.000 1 Rx 0123 - 2 AA BB
    ;

    var parsed = try fromString(allocator, text);
    defer parsed.deinit(allocator);

    try std.testing.expectEqual(@as(usize, 2), parsed.frames.len);
    try std.testing.expectEqual(frame.Kind.unknown, parsed.frames[0].kind);
    try std.testing.expectEqual(frame.Kind.data, parsed.frames[1].kind);
    try std.testing.expectEqual(@as(usize, 1), parsed.data_frame_count);
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

    var parsed = try fromString(allocator, text);
    defer parsed.deinit(allocator);

    try std.testing.expectEqual(@as(usize, 2), parsed.frames.len);
    try std.testing.expectEqual(@as(usize, 1), parsed.data_frame_count);
    try std.testing.expectEqual(@as(u64, 200_000), parsed.frames[parsed.frames.len - 1].timestamp_ns);
}

test "rejects unsupported TRC 3.0" {
    const allocator = std.testing.allocator;
    const text =
        \\;$FILEVERSION=3.0
        \\;$COLUMNS=N,O,T,I,d,L,D
        \\1 0.100 DT 0123 Rx 2 AA BB
    ;

    try std.testing.expectError(error.UnsupportedTrcVersion, fromString(allocator, text));
}

test "skips truncated TRC 1.x line and oversized token line" {
    const allocator = std.testing.allocator;
    const text =
        \\;$FILEVERSION=1.1
        \\1 0.100 Rx 0123 1 AA
        \\2 0.200 Rx 0123 2 BB
        \\3 0.300 Rx 0123 1 CC
        \\4 0.400 Rx 0123 1 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
    ;

    var parsed = try fromString(allocator, text);
    defer parsed.deinit(allocator);

    try std.testing.expectEqual(@as(usize, 2), parsed.frames.len);
    try std.testing.expectEqual(@as(usize, 2), parsed.data_frame_count);
    try std.testing.expectEqual(@as(usize, 2), parsed.skipped_line_count);
    try std.testing.expectEqual(@as(u64, 300_000), parsed.last_data_timestamp_ns.?);
}

test "skips truncated TRC 2.x line and oversized token line" {
    const allocator = std.testing.allocator;
    const text =
        \\;$FILEVERSION=2.1
        \\;$COLUMNS=N,O,T,B,I,d,R,L,D
        \\1 0.100 DT 1 0123 Rx - 1 AA
        \\2 0.200 DT 1 0123 Rx - 2 BB
        \\3 0.300 DT 1 0123 Rx - 1 CC
        \\4 0.400 DT 1 0123 Rx - 1 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
    ;

    var parsed = try fromString(allocator, text);
    defer parsed.deinit(allocator);

    try std.testing.expectEqual(@as(usize, 2), parsed.frames.len);
    try std.testing.expectEqual(@as(usize, 2), parsed.data_frame_count);
    try std.testing.expectEqual(@as(usize, 2), parsed.skipped_line_count);
    try std.testing.expectEqual(@as(u64, 300_000), parsed.last_data_timestamp_ns.?);
}

test "rejects invalid TRC columns" {
    const allocator = std.testing.allocator;
    const text =
        \\;$FILEVERSION=2.1
        \\;$COLUMNS=N,O
        \\1 0.100 DT 1 0123 Rx - 1 AA
    ;

    try std.testing.expectError(error.InvalidTrcColumns, fromString(allocator, text));
}

test "cleans up owned frames when payload finalization fails" {
    try std.testing.checkAllAllocationFailures(std.testing.allocator, struct {
        pub fn f(allocator: std.mem.Allocator) !void {
            var parsed = try fromString(allocator,
                \\;$FILEVERSION=1.1
                \\1 0.100 Rx 0123 2 AA BB
                \\
            );
            defer parsed.deinit(allocator);
        }
    }.f, .{});
}
