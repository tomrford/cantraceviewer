const std = @import("std");

pub const Metadata = struct {
    measurement_start_ms: ?i64,
    valid_message_count: usize,
    duration_ns: ?u64,
};

pub fn toJson(allocator: std.mem.Allocator, metadata: Metadata) ![]u8 {
    var out: std.Io.Writer.Allocating = .init(allocator);
    errdefer out.deinit();

    var writer: std.json.Stringify = .{ .writer = &out.writer };
    try writer.beginObject();
    try writeJsonField(&writer, "measurementStartMs", metadata.measurement_start_ms);
    try writeJsonField(&writer, "validMessageCount", metadata.valid_message_count);
    try writeJsonField(&writer, "durationNs", metadata.duration_ns);
    try writer.endObject();

    return out.toOwnedSlice();
}

fn writeJsonField(writer: *std.json.Stringify, field: []const u8, value: anytype) !void {
    try writer.objectField(field);
    try writer.write(value);
}

test "serializes shared trace metadata to JSON" {
    const allocator = std.testing.allocator;
    const json = try toJson(allocator, .{
        .measurement_start_ms = 1_777_366_800_000,
        .valid_message_count = 1,
        .duration_ns = 1_000_000,
    });
    defer allocator.free(json);

    try std.testing.expect(std.mem.indexOf(u8, json, "\"measurementStartMs\":1777366800000") != null);
    try std.testing.expect(std.mem.indexOf(u8, json, "\"validMessageCount\":1") != null);
    try std.testing.expect(std.mem.indexOf(u8, json, "\"durationNs\":1000000") != null);
}
