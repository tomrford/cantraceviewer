//! WebAssembly-owned TRC trace handle.

const std = @import("std");
const trc = @import("trc.zig");
const metadata = @import("metadata.zig");

pub const Handle = struct {
    trc: trc.Trc,

    pub fn parse(parent_allocator: std.mem.Allocator, input: []const u8) !*Handle {
        const handle = try parent_allocator.create(Handle);
        errdefer parent_allocator.destroy(handle);

        handle.trc = try trc.Trc.fromString(parent_allocator, input);
        return handle;
    }

    pub fn deinit(self: *Handle, parent_allocator: std.mem.Allocator) void {
        self.trc.deinit(parent_allocator);
        parent_allocator.destroy(self);
    }

    pub fn toMetadataJson(self: *const Handle, allocator: std.mem.Allocator) ![]u8 {
        return metadata.toJson(allocator, self.trc);
    }
};

test "parses handle and exports metadata" {
    const allocator = std.testing.allocator;
    const text =
        \\;$FILEVERSION=1.1
        \\1 0.100 Rx 0123 2 AA BB
    ;

    const handle = try Handle.parse(allocator, text);
    defer handle.deinit(allocator);

    const json = try handle.toMetadataJson(allocator);
    defer allocator.free(json);

    try std.testing.expectEqual(@as(usize, 1), handle.trc.frames.len);
    try std.testing.expect(std.mem.indexOf(u8, json, "\"validMessageCount\":1") != null);
}
