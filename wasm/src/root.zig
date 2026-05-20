//! Exported WebAssembly symbol table.
//!
//! Keep domain parsing, catalogs, and handle lifetimes in their domain modules;
//! this file adapts those normal Zig APIs to stable exported functions.

const std = @import("std");
const abi = @import("abi.zig");
pub const dbc = @import("dbc/dbc.zig");
pub const blf = @import("blf/blf.zig");
pub const asc = @import("asc/asc.zig");
const dbc_handle = @import("dbc/handle.zig");
pub const mf4 = @import("mf4/mf4.zig");
const series = @import("series.zig");
const trace_handle = @import("trace/handle.zig");
pub const trc = @import("trc/trc.zig");

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
/// `trace_free` after metadata exports and signal decoding are finished.
export fn asc_parse(input: *const abi.OwnedBytes) usize {
    const handle = trace_handle.Handle.parseAsc(abi.allocator, input.slice()) catch return 0;
    return @intFromPtr(handle);
}

/// Exports small parsed-trace metadata used by the browser plot axes.
///
/// The returned bytes are owned by WASM and must be released with
/// `owned_bytes_free` after JavaScript copies them out.
export fn trace_to_metadata_json(handle_value: usize) ?*abi.OwnedBytes {
    if (handle_value == 0) return null;

    const handle: *trace_handle.Handle = @ptrFromInt(handle_value);
    const json = handle.toMetadataJson(abi.allocator) catch return null;
    return abi.OwnedBytes.fromOwnedSlice(json) catch null;
}

/// Releases a parsed trace handle and all trace data behind it.
export fn trace_free(handle_value: usize) void {
    if (handle_value == 0) return;

    const handle: *trace_handle.Handle = @ptrFromInt(handle_value);
    handle.deinit(abi.allocator);
}

/// Parses a TRC trace file from an `OwnedBytes` input buffer.
export fn trc_parse(input: *const abi.OwnedBytes) usize {
    const handle = trace_handle.Handle.parseTrc(abi.allocator, input.slice()) catch return 0;
    return @intFromPtr(handle);
}

/// Parses a BLF trace file from an `OwnedBytes` input buffer.
export fn blf_parse(input: *const abi.OwnedBytes) usize {
    const handle = trace_handle.Handle.parseBlf(abi.allocator, input.slice()) catch return 0;
    return @intFromPtr(handle);
}

/// Parses an MF4 trace file from an `OwnedBytes` input buffer.
export fn mf4_parse(input: *const abi.OwnedBytes) usize {
    const handle = trace_handle.Handle.parseMf4(abi.allocator, input.slice()) catch return 0;
    return @intFromPtr(handle);
}

/// Exports packed parallel `f64` arrays for one DBC signal from a parsed trace.
///
/// The returned bytes store all relative millisecond values first, followed by
/// all decoded signal values.
export fn get_trace_signal_values(
    dbc_handle_value: usize,
    trace_handle_value: usize,
    can_id: u32,
    is_extended: bool,
    size_bytes: u16,
    signal_name: *const abi.OwnedBytes,
) ?*abi.OwnedFloat64s {
    if (dbc_handle_value == 0 or trace_handle_value == 0) return null;

    const dbc_ptr: *dbc_handle.Handle = @ptrFromInt(dbc_handle_value);
    const trace_ptr: *trace_handle.Handle = @ptrFromInt(trace_handle_value);
    const values = series.selectedSignalValues(
        abi.allocator,
        dbc_ptr,
        trace_ptr.trace,
        can_id,
        is_extended,
        size_bytes,
        signal_name.slice(),
    ) catch return null;

    return abi.OwnedFloat64s.fromOwnedSlice(values) catch null;
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

/// Returns the memory address of an `OwnedFloat64s` payload.
export fn owned_float64s_ptr(values: *const abi.OwnedFloat64s) usize {
    return values.ptr;
}

/// Returns the number of f64 values in an `OwnedFloat64s` payload.
export fn owned_float64s_len(values: *const abi.OwnedFloat64s) usize {
    return values.len;
}

/// Releases an `OwnedFloat64s` object allocated or returned by WASM.
export fn owned_float64s_free(values: *abi.OwnedFloat64s) void {
    values.deinit();
}

test "serializing failed parse handle returns null" {
    try std.testing.expectEqual(@as(?*abi.OwnedBytes, null), dbc_to_json(0));
}

test "serializing failed ASC parse handle returns null" {
    try std.testing.expectEqual(@as(?*abi.OwnedBytes, null), trace_to_metadata_json(0));
}
