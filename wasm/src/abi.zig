//! Shared WebAssembly ABI primitives.
//!
//! Domain modules own their handles and data shapes. This file only owns the
//! byte-buffer type used to move data across the JavaScript/WASM boundary.

const std = @import("std");
const builtin = @import("builtin");

/// Allocator used by the exported WebAssembly functions.
pub const allocator = if (builtin.target.cpu.arch.isWasm()) std.heap.wasm_allocator else std.heap.page_allocator;

/// Heap-owned byte slice returned across the WebAssembly boundary.
///
/// JavaScript reads the pointer and length, copies the bytes out of WASM
/// memory, and then calls `owned_bytes_free`.
pub const OwnedBytes = extern struct {
    /// Address of the first byte in WebAssembly linear memory.
    ptr: usize,

    /// Number of bytes available at `ptr`.
    len: usize,

    /// Allocates an empty byte buffer that JavaScript can fill before passing
    /// it back into a domain-specific exported function.
    pub fn alloc(len: usize) !*OwnedBytes {
        const bytes = try allocator.alloc(u8, len);
        return fromOwnedSlice(bytes);
    }

    /// Wraps an already-owned heap slice in the boundary shape expected by
    /// JavaScript. Ownership of `bytes` moves into the returned object.
    pub fn fromOwnedSlice(bytes: []u8) !*OwnedBytes {
        errdefer allocator.free(bytes);

        const owned = try allocator.create(OwnedBytes);
        owned.* = .{
            .ptr = @intFromPtr(bytes.ptr),
            .len = bytes.len,
        };
        return owned;
    }

    /// Releases both the byte payload and the boundary object.
    pub fn deinit(self: *OwnedBytes) void {
        const ptr: [*]u8 = @ptrFromInt(self.ptr);
        allocator.free(ptr[0..self.len]);
        allocator.destroy(self);
    }

    /// Borrows the payload for use inside a WASM call.
    ///
    /// The returned slice is only valid while this object remains allocated.
    pub fn slice(self: *const OwnedBytes) []const u8 {
        const ptr: [*]const u8 = @ptrFromInt(self.ptr);
        return ptr[0..self.len];
    }
};
