//! Trace metadata exported for browser axis setup.

const std = @import("std");
const asc = @import("asc.zig");
const metadata = @import("../trace/metadata.zig");

/// Serializes the small trace metadata object consumed by the TypeScript adapter.
pub fn toJson(allocator: std.mem.Allocator, parsed: asc.Asc) ![]u8 {
    return metadata.toJson(allocator, .{
        .measurement_start_ms = parsed.measurement_start_ms,
        .valid_message_count = parsed.data_frame_count,
        .duration_ns = parsed.last_data_timestamp_ns,
    });
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
