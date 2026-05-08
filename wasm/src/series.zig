//! Selected signal time-series extraction.
//!
//! The exported WASM boundary asks for one DBC message name and signal name,
//! then receives parallel `f64` arrays of `(time_ms, value)` samples.

const std = @import("std");
const asc_handle = @import("asc/handle.zig");
const dbc_handle = @import("dbc/handle.zig");
const message = @import("dbc/message.zig");
const signal = @import("dbc/signal.zig");
const trc_handle = @import("trc/handle.zig");

pub fn selectedAscSignalValues(
    allocator: std.mem.Allocator,
    dbc: *const dbc_handle.Handle,
    asc: *const asc_handle.Handle,
    message_name: []const u8,
    signal_name: []const u8,
) ![]f64 {
    const selection = try findSignal(dbc, message_name, signal_name);
    const plan = try selection.signal.planDecode(selection.message.size_bytes);

    const sample_count = countMatchingSamples(asc, selection.message);
    const values_offset = sample_count;
    const out = try allocator.alloc(f64, sample_count * 2);
    errdefer allocator.free(out);

    var sample_index: usize = 0;
    for (asc.asc.frames) |trace_frame| {
        if (!matchesMessage(trace_frame, selection.message)) continue;
        if (trace_frame.payload_len != selection.message.size_bytes) continue;

        const payload = payloadForFrame(asc.asc.payloads, trace_frame) orelse continue;
        out[sample_index] = timestampNsToMs(trace_frame.timestamp_ns);
        out[values_offset + sample_index] = try plan.decode(payload);
        sample_index += 1;
    }

    return out;
}

pub fn selectedTrcSignalValues(
    allocator: std.mem.Allocator,
    dbc: *const dbc_handle.Handle,
    trc: *const trc_handle.Handle,
    message_name: []const u8,
    signal_name: []const u8,
) ![]f64 {
    const selection = try findSignal(dbc, message_name, signal_name);
    const plan = try selection.signal.planDecode(selection.message.size_bytes);

    const sample_count = countMatchingTrcSamples(trc, selection.message);
    const values_offset = sample_count;
    const out = try allocator.alloc(f64, sample_count * 2);
    errdefer allocator.free(out);

    var sample_index: usize = 0;
    for (trc.trc.frames) |trace_frame| {
        if (!matchesMessage(trace_frame, selection.message)) continue;
        if (trace_frame.payload_len != selection.message.size_bytes) continue;

        const payload = payloadForFrame(trc.trc.payloads, trace_frame) orelse continue;
        out[sample_index] = timestampNsToMs(trace_frame.timestamp_ns);
        out[values_offset + sample_index] = try plan.decode(payload);
        sample_index += 1;
    }

    return out;
}

const SignalSelection = struct {
    message: message.Message,
    signal: signal.Signal,
};

fn findSignal(
    handle: *const dbc_handle.Handle,
    message_name: []const u8,
    signal_name: []const u8,
) !SignalSelection {
    for (handle.dbc.messages) |msg| {
        if (!std.mem.eql(u8, msg.name, message_name)) continue;

        for (msg.signals) |sig| {
            if (!std.mem.eql(u8, sig.name, signal_name)) continue;
            return .{ .message = msg, .signal = sig };
        }
        return error.SignalNotFound;
    }
    return error.MessageNotFound;
}

fn matchesMessage(trace_frame: anytype, msg: message.Message) bool {
    if (trace_frame.kind != .data) return false;
    const id = trace_frame.id orelse return false;
    return id.value == msg.can_id and
        id.is_extended == msg.is_extended and
        trace_frame.is_fd == msg.is_fd;
}

fn countMatchingSamples(asc: *const asc_handle.Handle, msg: message.Message) usize {
    var count: usize = 0;
    for (asc.asc.frames) |trace_frame| {
        if (!matchesMessage(trace_frame, msg)) continue;
        if (trace_frame.payload_len != msg.size_bytes) continue;
        if (payloadForFrame(asc.asc.payloads, trace_frame) == null) continue;
        count += 1;
    }
    return count;
}

fn countMatchingTrcSamples(trc: *const trc_handle.Handle, msg: message.Message) usize {
    var count: usize = 0;
    for (trc.trc.frames) |trace_frame| {
        if (!matchesMessage(trace_frame, msg)) continue;
        if (trace_frame.payload_len != msg.size_bytes) continue;
        if (payloadForFrame(trc.trc.payloads, trace_frame) == null) continue;
        count += 1;
    }
    return count;
}

fn payloadForFrame(payloads: []const u8, trace_frame: anytype) ?[]const u8 {
    const start: usize = @intCast(trace_frame.payload_offset);
    const end = start + @as(usize, trace_frame.payload_len);
    if (end > payloads.len) return null;
    return payloads[start..end];
}

fn timestampNsToMs(timestamp_ns: u64) f64 {
    return @as(f64, @floatFromInt(timestamp_ns)) / 1_000_000.0;
}

test "extracts selected signal values as relative-millisecond/value series" {
    const allocator = std.testing.allocator;
    const dbc_text =
        \\BO_ 291 Example: 2 ECU
        \\ SG_ Speed : 0|16@1+ (0.1,0) [0|250] "km/h" DASH
    ;
    const asc_text =
        \\base hex timestamps absolute
        \\0.001 1 123 Rx d 2 10 27
        \\0.002 1 124 Rx d 2 ff ff
        \\0.003 1 123 Rx d 2 20 4e
    ;

    const dbc = try dbc_handle.Handle.parse(allocator, dbc_text);
    defer dbc.deinit(allocator);
    const asc = try asc_handle.Handle.parse(allocator, asc_text);
    defer asc.deinit(allocator);

    const bytes = try selectedAscSignalValues(allocator, dbc, asc, "Example", "Speed");
    defer allocator.free(bytes);

    try std.testing.expectEqualSlices(f64, &.{ 1.0, 3.0, 1000.0, 2000.0 }, bytes);
}

test "extracts selected float signal values as relative-millisecond/value series" {
    const allocator = std.testing.allocator;
    const dbc_text =
        \\BO_ 291 Example: 4 ECU
        \\ SG_ Temperature : 0|32@1+ (1,0) [-100|100] "degC" DASH
        \\SIG_VALTYPE_ 291 Temperature : 1;
    ;
    const asc_text =
        \\base hex timestamps absolute
        \\0.001 1 123 Rx d 4 00 00 c0 3f
    ;

    const dbc = try dbc_handle.Handle.parse(allocator, dbc_text);
    defer dbc.deinit(allocator);
    const asc = try asc_handle.Handle.parse(allocator, asc_text);
    defer asc.deinit(allocator);

    const bytes = try selectedAscSignalValues(allocator, dbc, asc, "Example", "Temperature");
    defer allocator.free(bytes);

    try std.testing.expectEqualSlices(f64, &.{ 1.0, 1.5 }, bytes);
}

test "extracts selected motorola float signal values as relative-millisecond/value series" {
    const allocator = std.testing.allocator;
    const dbc_text =
        \\BO_ 291 Example: 4 ECU
        \\ SG_ Temperature : 7|32@0+ (1,0) [-100|100] "degC" DASH
        \\SIG_VALTYPE_ 291 Temperature : 1;
    ;
    const asc_text =
        \\base hex timestamps absolute
        \\0.001 1 123 Rx d 4 3f c0 00 00
    ;

    const dbc = try dbc_handle.Handle.parse(allocator, dbc_text);
    defer dbc.deinit(allocator);
    const asc = try asc_handle.Handle.parse(allocator, asc_text);
    defer asc.deinit(allocator);

    const bytes = try selectedAscSignalValues(allocator, dbc, asc, "Example", "Temperature");
    defer allocator.free(bytes);

    try std.testing.expectEqualSlices(f64, &.{ 1.0, 1.5 }, bytes);
}

test "skips matching frames with unexpected payload length" {
    const allocator = std.testing.allocator;
    const dbc_text =
        \\BO_ 291 Example: 2 ECU
        \\ SG_ Speed : 0|16@1+ (1,0) [0|65535] "" DASH
    ;
    const asc_text =
        \\base hex timestamps absolute
        \\0.001 1 123 Rx d 1 10
        \\0.002 1 123 Rx d 2 34 12
    ;

    const dbc = try dbc_handle.Handle.parse(allocator, dbc_text);
    defer dbc.deinit(allocator);
    const asc = try asc_handle.Handle.parse(allocator, asc_text);
    defer asc.deinit(allocator);

    const bytes = try selectedAscSignalValues(allocator, dbc, asc, "Example", "Speed");
    defer allocator.free(bytes);

    try std.testing.expectEqualSlices(f64, &.{ 2.0, 4660.0 }, bytes);
}

test "matches classic and CAN FD frames by ID, extended flag, and payload length" {
    const allocator = std.testing.allocator;
    const dbc_text =
        \\BO_ 291 ClassicExample: 8 ECU
        \\ SG_ ClassicSpeed : 0|16@1+ (1,0) [0|65535] "" DASH
        \\BO_ 291 FdExample: 12 ECU
        \\ SG_ FdSpeed : 0|16@1+ (1,0) [0|65535] "" DASH
    ;
    const asc_text =
        \\base hex timestamps absolute
        \\0.001 1 123 Rx d 8 01 00 00 00 00 00 00 00
        \\0.002 CANFD 1 Rx 123 - 1 0 8 8 02 00 00 00 00 00 00 00
        \\0.003 CANFD 1 Rx 123 - 1 0 9 12 03 00 00 00 00 00 00 00 00 00 00 00
    ;

    const dbc = try dbc_handle.Handle.parse(allocator, dbc_text);
    defer dbc.deinit(allocator);
    const asc = try asc_handle.Handle.parse(allocator, asc_text);
    defer asc.deinit(allocator);

    const classic = try selectedAscSignalValues(allocator, dbc, asc, "ClassicExample", "ClassicSpeed");
    defer allocator.free(classic);
    const fd = try selectedAscSignalValues(allocator, dbc, asc, "FdExample", "FdSpeed");
    defer allocator.free(fd);

    try std.testing.expectEqualSlices(f64, &.{ 1.0, 1.0 }, classic);
    try std.testing.expectEqualSlices(f64, &.{ 3.0, 3.0 }, fd);
}

test "extracts selected signal values from TRC" {
    const allocator = std.testing.allocator;
    const dbc_text =
        \\BO_ 291 Example: 2 ECU
        \\ SG_ Speed : 0|16@1+ (1,0) [0|65535] "" DASH
    ;
    const trc_text =
        \\;$FILEVERSION=2.1
        \\;$COLUMNS=N,O,T,B,I,d,R,L,D
        \\1 0.100 DT 1 0123 Rx - 2 34 12
        \\2 0.200 RR 1 0123 Rx - 8
    ;

    const dbc = try dbc_handle.Handle.parse(allocator, dbc_text);
    defer dbc.deinit(allocator);
    const trc = try trc_handle.Handle.parse(allocator, trc_text);
    defer trc.deinit(allocator);

    const bytes = try selectedTrcSignalValues(allocator, dbc, trc, "Example", "Speed");
    defer allocator.free(bytes);

    try std.testing.expectEqualSlices(f64, &.{ 0.1, 4660.0 }, bytes);
}
