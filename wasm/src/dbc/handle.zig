//! WebAssembly-owned DBC handle.
//!
//! The handle keeps parsed DBC data alive across exported calls without
//! exposing parser allocation details to JavaScript.

const std = @import("std");
const catalog = @import("catalog.zig");
const dbc = @import("dbc.zig");

/// Parsed DBC owned by a WebAssembly handle.
///
/// The input text is copied into the arena so names and other parsed slices
/// remain valid until `deinit`.
pub const Handle = struct {
    arena: std.heap.ArenaAllocator,
    dbc: dbc.Dbc,

    /// Copies DBC text into an arena, parses it, and returns an opaque handle.
    pub fn parse(parent_allocator: std.mem.Allocator, input: []const u8) !*Handle {
        const handle = try parent_allocator.create(Handle);
        errdefer parent_allocator.destroy(handle);

        handle.arena = std.heap.ArenaAllocator.init(parent_allocator);
        errdefer handle.arena.deinit();

        const arena = handle.arena.allocator();
        const source = try arena.dupe(u8, input);
        handle.dbc = try dbc.Dbc.fromString(arena, source);

        return handle;
    }

    /// Releases the arena that owns the parsed DBC and its backing source text.
    pub fn deinit(self: *Handle, parent_allocator: std.mem.Allocator) void {
        self.arena.deinit();
        parent_allocator.destroy(self);
    }

    /// Builds the JSON catalog consumed by the TypeScript adapter.
    pub fn toCatalogJson(self: *const Handle, allocator: std.mem.Allocator) ![]u8 {
        return catalog.toJson(allocator, self.dbc);
    }
};

test "parses handle with arena-owned source" {
    const allocator = std.testing.allocator;
    const text =
        \\BO_ 100 Example: 8 ECU
        \\ SG_ State : 0|8@1+ (1,0) [0|255] "" DASH
    ;

    const handle = try Handle.parse(allocator, text);
    defer handle.deinit(allocator);

    try std.testing.expectEqual(@as(usize, 1), handle.dbc.messages.len);
    try std.testing.expectEqualStrings("Example", handle.dbc.messages[0].name);
}
