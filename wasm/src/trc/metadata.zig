//! TRC trace metadata exported for browser axis setup.

const std = @import("std");
const metadata = @import("../trace/metadata.zig");
const trc = @import("trc.zig");

pub fn toJson(allocator: std.mem.Allocator, parsed: trc.Trc) ![]u8 {
    return metadata.toJson(allocator, .{
        .measurement_start_ms = parsed.measurement_start_ms,
        .valid_message_count = parsed.data_frame_count,
        .duration_ns = parsed.last_data_timestamp_ns,
    });
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
    try std.testing.expect(std.mem.indexOf(u8, json, "\"durationNs\":100000") != null);
}
