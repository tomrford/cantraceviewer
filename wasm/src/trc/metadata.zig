//! TRC trace metadata exported for browser axis setup.

const std = @import("std");
const trc = @import("trc.zig");

pub fn toJson(allocator: std.mem.Allocator, parsed: trc.Trc) ![]u8 {
    var out: std.Io.Writer.Allocating = .init(allocator);
    errdefer out.deinit();

    var writer: std.json.Stringify = .{ .writer = &out.writer };
    try writer.beginObject();
    try writeJsonField(&writer, "measurementStartMs", parsed.measurement_start_ms);
    try writeJsonField(&writer, "validMessageCount", parsed.data_frame_count);
    try writeJsonField(&writer, "durationNs", parsed.last_timestamp_ns);
    try writer.endObject();

    return out.toOwnedSlice();
}

fn writeJsonField(writer: *std.json.Stringify, field: []const u8, value: anytype) !void {
    try writer.objectField(field);
    try writer.write(value);
}

test "serializes TRC metadata to JSON" {
    const allocator = std.testing.allocator;
    const text =
        \\;$FILEVERSION=1.1
        \\1 0.100 Rx 0123 2 AA BB
        \\2 0.200 RTR 0123 8
    ;

    var parsed = try trc.Trc.fromString(allocator, text);
    defer parsed.deinit(allocator);

    const json = try toJson(allocator, parsed);
    defer allocator.free(json);

    try std.testing.expect(std.mem.indexOf(u8, json, "\"validMessageCount\":1") != null);
    try std.testing.expect(std.mem.indexOf(u8, json, "\"durationNs\":200000") != null);
}
