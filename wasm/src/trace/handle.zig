//! WebAssembly-owned parsed CAN trace handle.

const std = @import("std");
const asc = @import("../asc/asc.zig");
const blf = @import("../blf/blf.zig");
const metadata = @import("metadata.zig");
const trace = @import("trace.zig");
const trc = @import("../trc/trc.zig");

pub const Handle = struct {
    trace: trace.Trace,

    pub fn parseAsc(parent_allocator: std.mem.Allocator, input: []const u8) !*Handle {
        const handle = try parent_allocator.create(Handle);
        errdefer parent_allocator.destroy(handle);

        handle.trace = try asc.fromString(parent_allocator, input);
        return handle;
    }

    pub fn parseTrc(parent_allocator: std.mem.Allocator, input: []const u8) !*Handle {
        const handle = try parent_allocator.create(Handle);
        errdefer parent_allocator.destroy(handle);

        handle.trace = try trc.fromString(parent_allocator, input);
        return handle;
    }

    pub fn parseBlf(parent_allocator: std.mem.Allocator, input: []const u8) !*Handle {
        const handle = try parent_allocator.create(Handle);
        errdefer parent_allocator.destroy(handle);

        handle.trace = try blf.fromBytes(parent_allocator, input);
        return handle;
    }

    pub fn deinit(self: *Handle, parent_allocator: std.mem.Allocator) void {
        self.trace.deinit(parent_allocator);
        parent_allocator.destroy(self);
    }

    pub fn toMetadataJson(self: *const Handle, allocator: std.mem.Allocator) ![]u8 {
        return metadata.toJson(allocator, self.trace.toMetadata());
    }
};

test "parses ASC handle and exports metadata" {
    const allocator = std.testing.allocator;
    const text =
        \\base hex timestamps relative
        \\0.100000 1 123 Rx d 1 aa
    ;

    const handle = try Handle.parseAsc(allocator, text);
    defer handle.deinit(allocator);

    const json = try handle.toMetadataJson(allocator);
    defer allocator.free(json);

    try std.testing.expectEqual(@as(usize, 1), handle.trace.frames.len);
    try std.testing.expect(std.mem.indexOf(u8, json, "\"validMessageCount\":1") != null);
}

test "parses TRC handle and exports metadata" {
    const allocator = std.testing.allocator;
    const text =
        \\;$FILEVERSION=1.1
        \\1 0.100 Rx 0123 2 AA BB
    ;

    const handle = try Handle.parseTrc(allocator, text);
    defer handle.deinit(allocator);

    const json = try handle.toMetadataJson(allocator);
    defer allocator.free(json);

    try std.testing.expectEqual(@as(usize, 1), handle.trace.frames.len);
    try std.testing.expect(std.mem.indexOf(u8, json, "\"validMessageCount\":1") != null);
}
