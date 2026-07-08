const std = @import("std");
const frame = @import("frame.zig");
const metadata = @import("metadata.zig");

pub const Trace = struct {
    measurement_start_ms: ?i64 = null,
    frames: []const frame.Frame = &.{},
    payloads: []const u8 = &.{},
    data_frame_count: usize = 0,
    skipped_line_count: usize = 0,
    last_data_timestamp_ns: ?u64 = null,

    pub fn deinit(self: *Trace, allocator: std.mem.Allocator) void {
        allocator.free(self.frames);
        allocator.free(self.payloads);
        self.* = .{};
    }

    pub fn toMetadata(self: Trace) metadata.Metadata {
        return .{
            .measurement_start_ms = self.measurement_start_ms,
            .valid_message_count = self.data_frame_count,
            .skipped_line_count = self.skipped_line_count,
            .duration_ns = self.last_data_timestamp_ns,
        };
    }
};
