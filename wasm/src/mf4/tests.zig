const std = @import("std");
const mf4 = @import("mf4.zig");
const trace_frame = @import("../trace/frame.zig");

test "parses python-can MDF4 classic, FD, remote, and error records" {
    const parsed = try parseFixture("fixtures/python-can-classic-fd.mf4");
    defer freeParsed(parsed);

    try std.testing.expectEqual(@as(?i64, 1_704_164_645_122), parsed.measurement_start_ms);
    try std.testing.expectEqual(@as(usize, 4), parsed.frames.len);
    try std.testing.expectEqual(@as(usize, 2), parsed.data_frame_count);
    try expectNearNs(200_000_000, parsed.last_data_timestamp_ns.?);

    try expectNearNs(100_000_000, parsed.frames[0].timestamp_ns);
    try std.testing.expectEqual(trace_frame.Kind.data, parsed.frames[0].kind);
    try std.testing.expectEqual(trace_frame.Id.standard(0x123), parsed.frames[0].id.?);
    try std.testing.expectEqual(@as(u8, 4), parsed.frames[0].dlc);
    try std.testing.expectEqualSlices(u8, &.{ 1, 2, 3, 4 }, parsed.payloads[0..4]);

    try expectNearNs(200_000_000, parsed.frames[1].timestamp_ns);
    try std.testing.expectEqual(trace_frame.Id.extended(0x18fee900), parsed.frames[1].id.?);
    try std.testing.expect(parsed.frames[1].is_fd);
    try std.testing.expectEqual(@as(u8, 9), parsed.frames[1].dlc);
    try std.testing.expectEqual(@as(u8, 12), parsed.frames[1].payload_len);
    try std.testing.expectEqualSlices(u8, &.{ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 }, parsed.payloads[4..16]);

    try std.testing.expectEqual(trace_frame.Kind.error_frame, parsed.frames[2].kind);
    try expectNearNs(300_000_000, parsed.frames[2].timestamp_ns);
    try std.testing.expectEqual(trace_frame.Id.standard(0x456), parsed.frames[2].id.?);
    try std.testing.expectEqualSlices(u8, &.{ 0xaa, 0xbb }, parsed.payloads[16..18]);

    try std.testing.expectEqual(trace_frame.Kind.remote, parsed.frames[3].kind);
    try expectNearNs(250_000_000, parsed.frames[3].timestamp_ns);
    try std.testing.expectEqual(trace_frame.Id.standard(0x321), parsed.frames[3].id.?);
    try std.testing.expectEqual(@as(u8, 8), parsed.frames[3].dlc);
}

test "dispatches unsorted data group records by channel-group record ID" {
    const parsed = try parseFixture("fixtures/unsorted-can-groups.mf4");
    defer freeParsed(parsed);

    try std.testing.expectEqual(@as(usize, 4), parsed.frames.len);
    try std.testing.expectEqual(@as(usize, 2), parsed.data_frame_count);
    try std.testing.expectEqual(trace_frame.Id.standard(0x123), parsed.frames[0].id.?);
    try std.testing.expectEqual(trace_frame.Kind.remote, parsed.frames[1].kind);
    try std.testing.expectEqual(trace_frame.Id.extended(0x18fee900), parsed.frames[2].id.?);
    try std.testing.expectEqual(trace_frame.Kind.error_frame, parsed.frames[3].kind);
    try std.testing.expectEqualSlices(u8, &.{ 1, 2, 3, 4 }, parsed.payloads[0..4]);
    try std.testing.expectEqualSlices(u8, &.{ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 }, parsed.payloads[4..16]);
    try std.testing.expectEqualSlices(u8, &.{ 0xaa, 0xbb }, parsed.payloads[16..18]);
}

test "decodes transposed DZ data with a partial final row" {
    const parsed = try parseFixture("fixtures/partial-row-dz.mf4");
    defer freeParsed(parsed);

    try std.testing.expectEqual(@as(usize, 1), parsed.frames.len);
    try std.testing.expectEqual(@as(usize, 1), parsed.data_frame_count);
    try std.testing.expectEqual(trace_frame.Id.standard(0x123), parsed.frames[0].id.?);
    try std.testing.expectEqualSlices(u8, &.{ 1, 2, 3, 4 }, parsed.payloads[0..4]);
}

fn parseFixture(comptime path: []const u8) !@import("../trace/trace.zig").Trace {
    return mf4.fromBytes(std.testing.allocator, @embedFile(path));
}

fn freeParsed(parsed: @import("../trace/trace.zig").Trace) void {
    var owned = parsed;
    owned.deinit(std.testing.allocator);
}

fn expectNearNs(expected: u64, actual: u64) !void {
    const delta = if (actual > expected) actual - expected else expected - actual;
    try std.testing.expect(delta <= 128);
}
