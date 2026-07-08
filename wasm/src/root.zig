//! Exported WebAssembly symbol table.
//!
//! Keep domain parsing, catalogs, and handle lifetimes in their domain modules;
//! this file adapts those normal Zig APIs to stable exported functions.

const std = @import("std");
const abi = @import("abi.zig");
const envelope = @import("envelope.zig");
pub const dbc = @import("dbc/dbc.zig");
pub const blf = @import("blf/blf.zig");
pub const asc = @import("asc/asc.zig");
const dbc_handle = @import("dbc/handle.zig");
const series = @import("series.zig");
const trace_handle = @import("trace/handle.zig");
pub const trc = @import("trc/trc.zig");

/// Allocates a byte buffer in WASM memory for JavaScript to populate.
export fn owned_bytes_alloc(len: usize) ?*abi.OwnedBytes {
    return abi.OwnedBytes.alloc(len) catch null;
}

/// Parses a DBC file from an `OwnedBytes` input buffer.
///
/// The returned envelope contains an opaque handle and the parsed catalog.
/// JavaScript must release the handle with `dbc_free`.
export fn dbc_parse(input: *const abi.OwnedBytes) ?*abi.OwnedBytes {
    const handle = dbc_handle.Handle.parse(abi.allocator, input.slice()) catch |err| {
        return envelope.failure(abi.allocator, err);
    };

    const catalog_json = handle.toCatalogJson(abi.allocator) catch |err| {
        handle.deinit(abi.allocator);
        return envelope.failure(abi.allocator, err);
    };
    defer abi.allocator.free(catalog_json);

    return envelope.successHandleWithRawJson(abi.allocator, @intFromPtr(handle), "catalog", catalog_json) catch |err| {
        handle.deinit(abi.allocator);
        return envelope.failure(abi.allocator, err);
    };
}

/// Releases a parsed DBC handle and all arena-owned parser data behind it.
export fn dbc_free(handle_value: usize) void {
    if (handle_value == 0) return;

    const handle: *dbc_handle.Handle = @ptrFromInt(handle_value);
    handle.deinit(abi.allocator);
}

/// Parses an ASC trace file from an `OwnedBytes` input buffer.
///
/// The returned envelope contains an opaque handle and parsed trace metadata.
/// JavaScript must release the handle with `trace_free`.
export fn asc_parse(input: *const abi.OwnedBytes) ?*abi.OwnedBytes {
    return parseTraceEnvelope(input, trace_handle.Handle.parseAsc);
}

/// Releases a parsed trace handle and all trace data behind it.
export fn trace_free(handle_value: usize) void {
    if (handle_value == 0) return;

    const handle: *trace_handle.Handle = @ptrFromInt(handle_value);
    handle.deinit(abi.allocator);
}

/// Parses a TRC trace file from an `OwnedBytes` input buffer.
export fn trc_parse(input: *const abi.OwnedBytes) ?*abi.OwnedBytes {
    return parseTraceEnvelope(input, trace_handle.Handle.parseTrc);
}

/// Parses a BLF trace file from an `OwnedBytes` input buffer.
export fn blf_parse(input: *const abi.OwnedBytes) ?*abi.OwnedBytes {
    return parseTraceEnvelope(input, trace_handle.Handle.parseBlf);
}

/// Exports packed parallel `f64` arrays for one DBC signal from a parsed trace.
///
/// The returned envelope contains an `OwnedFloat64s` address. JavaScript reads
/// and releases that address through the `owned_float64s_*` exports.
export fn get_trace_signal_values(
    dbc_handle_value: usize,
    trace_handle_value: usize,
    can_id: u32,
    is_extended: bool,
    size_bytes: u16,
    signal_name: *const abi.OwnedBytes,
) ?*abi.OwnedBytes {
    if (dbc_handle_value == 0 or trace_handle_value == 0) return envelope.failure(abi.allocator, error.InvalidHandle);

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
    ) catch |err| {
        return envelope.failure(abi.allocator, err);
    };

    const owned_values = abi.OwnedFloat64s.fromOwnedSlice(values) catch |err| {
        return envelope.failure(abi.allocator, err);
    };

    return envelope.successValues(abi.allocator, @intFromPtr(owned_values)) catch |err| {
        owned_values.deinit();
        return envelope.failure(abi.allocator, err);
    };
}

fn parseTraceEnvelope(
    input: *const abi.OwnedBytes,
    comptime parse: fn (std.mem.Allocator, []const u8) anyerror!*trace_handle.Handle,
) ?*abi.OwnedBytes {
    const handle = parse(abi.allocator, input.slice()) catch |err| {
        return envelope.failure(abi.allocator, err);
    };

    const metadata_json = handle.toMetadataJson(abi.allocator) catch |err| {
        handle.deinit(abi.allocator);
        return envelope.failure(abi.allocator, err);
    };
    defer abi.allocator.free(metadata_json);

    return envelope.successHandleWithRawJson(abi.allocator, @intFromPtr(handle), "metadata", metadata_json) catch |err| {
        handle.deinit(abi.allocator);
        return envelope.failure(abi.allocator, err);
    };
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

test "bad DBC parse returns failure envelope" {
    const input = try abi.OwnedBytes.fromOwnedSlice(try abi.allocator.dupe(u8, "BO_ broken"));
    defer input.deinit();

    const result = dbc_parse(input) orelse return error.ExpectedEnvelope;
    defer result.deinit();

    try std.testing.expect(std.mem.indexOf(u8, result.slice(), "\"ok\":false") != null);
    try std.testing.expect(std.mem.indexOf(u8, result.slice(), "\"code\":") != null);
}

test "good DBC parse returns handle and catalog envelope" {
    const text =
        \\BO_ 100 Example: 8 ECU
        \\ SG_ State : 0|8@1+ (1,0) [0|255] "" DASH
    ;
    const input = try abi.OwnedBytes.fromOwnedSlice(try abi.allocator.dupe(u8, text));
    defer input.deinit();

    const result = dbc_parse(input) orelse return error.ExpectedEnvelope;
    defer result.deinit();

    const json = result.slice();
    try std.testing.expect(std.mem.indexOf(u8, json, "\"ok\":true") != null);
    try std.testing.expect(std.mem.indexOf(u8, json, "\"handle\":") != null);
    try std.testing.expect(std.mem.indexOf(u8, json, "\"catalog\":{\"messages\"") != null);
}
