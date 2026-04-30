//! WebAssembly-owned ASC trace handle.
//!
//! The handle keeps parsed trace data alive across exported calls without
//! exposing parser allocation details to JavaScript.

const std = @import("std");
const asc = @import("asc.zig");
const metadata = @import("metadata.zig");

/// Parsed ASC trace owned by a WebAssembly handle.
pub const Handle = struct {
    asc: asc.Asc,

    /// Parses ASC text and returns an opaque handle.
    pub fn parse(parent_allocator: std.mem.Allocator, input: []const u8) !*Handle {
        const handle = try parent_allocator.create(Handle);
        errdefer parent_allocator.destroy(handle);

        handle.asc = try asc.Asc.fromString(parent_allocator, input);
        return handle;
    }

    /// Releases the parsed trace arrays owned by this handle.
    pub fn deinit(self: *Handle, parent_allocator: std.mem.Allocator) void {
        self.asc.deinit(parent_allocator);
        parent_allocator.destroy(self);
    }

    /// Builds the JSON metadata consumed by the TypeScript adapter.
    pub fn toMetadataJson(self: *const Handle, allocator: std.mem.Allocator) ![]u8 {
        return metadata.toJson(allocator, self.asc);
    }
};

test "parses handle and exports metadata" {
    const allocator = std.testing.allocator;
    const text =
        \\base hex timestamps relative
        \\0.100000 1 123 Rx d 1 aa
    ;

    const handle = try Handle.parse(allocator, text);
    defer handle.deinit(allocator);

    const json = try handle.toMetadataJson(allocator);
    defer allocator.free(json);

    try std.testing.expectEqual(@as(usize, 1), handle.asc.frames.len);
    try std.testing.expect(std.mem.indexOf(u8, json, "\"frameCount\":1") != null);
}
