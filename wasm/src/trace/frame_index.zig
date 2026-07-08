//! Lazy per-message trace frame index.
//!
//! Trace handles build this index on the first signal decode for a trace. The
//! buckets contain data-frame indices in file order, keyed only by CAN identity;
//! DBC payload-length rules remain decode-time checks within the selected bucket.

const std = @import("std");
const trace_frame = @import("frame.zig");

const Key = packed struct {
    can_id: u32,
    is_extended: bool,
};

const Bucket = std.ArrayListUnmanaged(u32);

pub const FrameIndex = struct {
    buckets: std.AutoHashMapUnmanaged(Key, Bucket) = .{},

    pub fn build(allocator: std.mem.Allocator, frames: []const trace_frame.Frame) !FrameIndex {
        var index: FrameIndex = .{};
        errdefer index.deinit(allocator);

        for (frames, 0..) |frame, frame_index| {
            if (frame.kind != .data) continue;
            const id = frame.id orelse continue;

            const result = try index.buckets.getOrPut(allocator, .{
                .can_id = id.value,
                .is_extended = id.is_extended,
            });
            if (!result.found_existing) result.value_ptr.* = .empty;
            try result.value_ptr.append(allocator, @intCast(frame_index));
        }

        return index;
    }

    pub fn lookup(self: *const FrameIndex, can_id: u32, is_extended: bool) []const u32 {
        const bucket = self.buckets.get(.{ .can_id = can_id, .is_extended = is_extended }) orelse return &.{};
        return bucket.items;
    }

    pub fn deinit(self: *FrameIndex, allocator: std.mem.Allocator) void {
        var iterator = self.buckets.valueIterator();
        while (iterator.next()) |bucket| {
            bucket.deinit(allocator);
        }
        self.buckets.deinit(allocator);
        self.* = .{ .buckets = .empty };
    }
};
