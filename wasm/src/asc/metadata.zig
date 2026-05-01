//! Trace metadata exported for browser axis setup.

const std = @import("std");
const asc = @import("asc.zig");

/// Serializes the small trace metadata object consumed by the TypeScript adapter.
pub fn toJson(allocator: std.mem.Allocator, parsed: asc.Asc) ![]u8 {
    var out: std.Io.Writer.Allocating = .init(allocator);
    errdefer out.deinit();

    var writer: std.json.Stringify = .{ .writer = &out.writer };
    try writer.beginObject();
    try writeJsonField(&writer, "measurementStartMs", parsed.measurement_start_ms);
    try writeJsonField(&writer, "validMessageCount", parsed.data_frame_count);
    try writeJsonField(&writer, "durationNs", parsed.last_data_timestamp_ns);
    try writer.endObject();

    return out.toOwnedSlice();
}

fn writeJsonField(writer: *std.json.Stringify, field: []const u8, value: anytype) !void {
    try writer.objectField(field);
    try writer.write(value);
}

test "serializes trace metadata to JSON" {
    const allocator = std.testing.allocator;
    const text =
        \\date Tue Apr 28 09:00:00.000 2026
        \\base dec timestamps absolute
        \\0.001 1 291 Rx d 2 170 187
        \\0.002 CANFD_STATISTIC whatever else
    ;
    var parsed = try asc.Asc.fromString(allocator, text);
    defer parsed.deinit(allocator);

    const json = try toJson(allocator, parsed);
    defer allocator.free(json);

    try std.testing.expect(std.mem.indexOf(u8, json, "\"measurementStartMs\":1777366800000") != null);
    try std.testing.expect(std.mem.indexOf(u8, json, "\"validMessageCount\":1") != null);
    try std.testing.expect(std.mem.indexOf(u8, json, "\"durationNs\":1000000") != null);
}
