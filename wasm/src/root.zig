//! Exported WebAssembly symbol table.
//!
//! Keep domain parsing, catalogs, and handle lifetimes in their domain modules;
//! this file adapts those normal Zig APIs to stable exported functions.

const std = @import("std");
const abi = @import("abi.zig");
pub const dbc = @import("dbc/dbc.zig");
pub const asc = @import("asc/asc.zig");
const asc_handle = @import("asc/handle.zig");
const dbc_handle = @import("dbc/handle.zig");

/// Allocates a byte buffer in WASM memory for JavaScript to populate.
export fn owned_bytes_alloc(len: usize) ?*abi.OwnedBytes {
    return abi.OwnedBytes.alloc(len) catch null;
}

/// Parses a DBC file from an `OwnedBytes` input buffer.
///
/// The returned integer is an opaque handle. JavaScript must release it with
/// `dbc_free` after catalog exports and signal decoding are finished.
export fn dbc_parse(input: *const abi.OwnedBytes) usize {
    const handle = dbc_handle.Handle.parse(abi.allocator, input.slice()) catch return 0;
    return @intFromPtr(handle);
}

/// Exports the parsed DBC catalog used by the browser signal picker.
///
/// The returned bytes are owned by WASM and must be released with
/// `owned_bytes_free` after JavaScript copies them out.
export fn dbc_to_json(handle_value: usize) ?*abi.OwnedBytes {
    if (handle_value == 0) return null;

    const handle: *dbc_handle.Handle = @ptrFromInt(handle_value);
    const json = handle.toCatalogJson(abi.allocator) catch return null;
    return abi.OwnedBytes.fromOwnedSlice(json) catch null;
}

/// Releases a parsed DBC handle and all arena-owned parser data behind it.
export fn dbc_free(handle_value: usize) void {
    if (handle_value == 0) return;

    const handle: *dbc_handle.Handle = @ptrFromInt(handle_value);
    handle.deinit(abi.allocator);
}

/// Parses an ASC trace file from an `OwnedBytes` input buffer.
///
/// The returned integer is an opaque handle. JavaScript must release it with
/// `asc_free` after metadata exports and signal decoding are finished.
export fn asc_parse(input: *const abi.OwnedBytes) usize {
    const handle = asc_handle.Handle.parse(abi.allocator, input.slice()) catch return 0;
    return @intFromPtr(handle);
}

/// Exports small parsed-trace metadata used by the browser plot axes.
///
/// The returned bytes are owned by WASM and must be released with
/// `owned_bytes_free` after JavaScript copies them out.
export fn asc_to_metadata_json(handle_value: usize) ?*abi.OwnedBytes {
    if (handle_value == 0) return null;

    const handle: *asc_handle.Handle = @ptrFromInt(handle_value);
    const json = handle.toMetadataJson(abi.allocator) catch return null;
    return abi.OwnedBytes.fromOwnedSlice(json) catch null;
}

/// Releases a parsed ASC handle and all trace data behind it.
export fn asc_free(handle_value: usize) void {
    if (handle_value == 0) return;

    const handle: *asc_handle.Handle = @ptrFromInt(handle_value);
    handle.deinit(abi.allocator);
}

/// Returns the memory address of an `OwnedBytes` payload.
export fn owned_bytes_ptr(bytes: *const abi.OwnedBytes) usize {
    return bytes.ptr;
}

/// Returns the byte length of an `OwnedBytes` payload.
export fn owned_bytes_len(bytes: *const abi.OwnedBytes) usize {
    return bytes.len;
}

/// Releases an `OwnedBytes` object allocated or returned by WASM.
export fn owned_bytes_free(bytes: *abi.OwnedBytes) void {
    bytes.deinit();
}

test "serializing failed parse handle returns null" {
    try std.testing.expectEqual(@as(?*abi.OwnedBytes, null), dbc_to_json(0));
}

test "serializing failed ASC parse handle returns null" {
    try std.testing.expectEqual(@as(?*abi.OwnedBytes, null), asc_to_metadata_json(0));
}
