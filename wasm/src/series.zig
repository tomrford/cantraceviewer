//! Selected signal time-series extraction.
//!
//! The exported WASM boundary asks for one DBC CAN identity and signal name,
//! then receives parallel `f64` arrays of `(time_ms, value)` samples.

const std = @import("std");
const asc = @import("asc/asc.zig");
const dbc_handle = @import("dbc/handle.zig");
const message = @import("dbc/message.zig");
const signal = @import("dbc/signal.zig");
const trace_frame = @import("trace/frame.zig");
const trace = @import("trace/trace.zig");
const trc = @import("trc/trc.zig");

pub fn selectedSignalValues(
    allocator: std.mem.Allocator,
    dbc: *const dbc_handle.Handle,
    parsed_trace: trace.Trace,
    can_id: u32,
    is_extended: bool,
    signal_name: []const u8,
) ![]f64 {
    const selection = try findSignal(dbc, can_id, is_extended, signal_name);
    const plan = try selection.signal.planDecode(selection.message.size_bytes);

    const sample_count = countMatchingSamples(parsed_trace, selection.message);
    const values_offset = sample_count;
    const out = try allocator.alloc(f64, sample_count * 2);
    errdefer allocator.free(out);

    var sample_index: usize = 0;
    for (parsed_trace.frames) |frame| {
        if (!matchesMessage(frame, selection.message)) continue;
        if (@as(u16, frame.payload_len) != selection.message.size_bytes) continue;

        const payload = payloadForFrame(parsed_trace.payloads, frame) orelse continue;
        out[sample_index] = timestampNsToMs(frame.timestamp_ns);
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
    can_id: u32,
    is_extended: bool,
    signal_name: []const u8,
) !SignalSelection {
    for (handle.dbc.messages) |msg| {
        if (msg.can_id != can_id or msg.is_extended != is_extended) continue;

        for (msg.signals) |sig| {
            if (!std.mem.eql(u8, sig.name, signal_name)) continue;
            return .{ .message = msg, .signal = sig };
        }
    }
    return error.SignalNotFound;
}

fn matchesMessage(frame: trace_frame.Frame, msg: message.Message) bool {
    if (frame.kind != .data) return false;
    const id = frame.id orelse return false;
    return id.value == msg.can_id and
        id.is_extended == msg.is_extended;
}

fn countMatchingSamples(parsed_trace: trace.Trace, msg: message.Message) usize {
    var count: usize = 0;
    for (parsed_trace.frames) |frame| {
        if (!matchesMessage(frame, msg)) continue;
        if (@as(u16, frame.payload_len) != msg.size_bytes) continue;
        if (payloadForFrame(parsed_trace.payloads, frame) == null) continue;
        count += 1;
    }
    return count;
}

fn payloadForFrame(payloads: []const u8, frame: trace_frame.Frame) ?[]const u8 {
    const start: usize = @intCast(frame.payload_offset);
    const end = start + @as(usize, frame.payload_len);
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
    var parsed = try asc.fromString(allocator, asc_text);
    defer parsed.deinit(allocator);

    const bytes = try selectedSignalValues(
        allocator,
        dbc,
        parsed,
        0x123,
        false,
        "Speed",
    );
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
    var parsed = try asc.fromString(allocator, asc_text);
    defer parsed.deinit(allocator);

    const bytes = try selectedSignalValues(
        allocator,
        dbc,
        parsed,
        0x123,
        false,
        "Temperature",
    );
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
    var parsed = try asc.fromString(allocator, asc_text);
    defer parsed.deinit(allocator);

    const bytes = try selectedSignalValues(
        allocator,
        dbc,
        parsed,
        0x123,
        false,
        "Temperature",
    );
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
    var parsed = try asc.fromString(allocator, asc_text);
    defer parsed.deinit(allocator);

    const bytes = try selectedSignalValues(
        allocator,
        dbc,
        parsed,
        0x123,
        false,
        "Speed",
    );
    defer allocator.free(bytes);

    try std.testing.expectEqualSlices(f64, &.{ 2.0, 4660.0 }, bytes);
}

test "selects same-name messages by CAN identity" {
    const allocator = std.testing.allocator;
    const dbc_text =
        \\BO_ 256 Status: 1 ECU
        \\ SG_ Value : 0|8@1+ (1,0) [0|255] "" DASH
        \\BO_ 512 Status: 1 ECU
        \\ SG_ Value : 0|8@1+ (1,0) [0|255] "" DASH
    ;
    const asc_text =
        \\base hex timestamps absolute
        \\0.001 1 100 Rx d 1 11
        \\0.002 1 200 Rx d 1 22
    ;

    const dbc = try dbc_handle.Handle.parse(allocator, dbc_text);
    defer dbc.deinit(allocator);
    var parsed = try asc.fromString(allocator, asc_text);
    defer parsed.deinit(allocator);

    const bytes = try selectedSignalValues(
        allocator,
        dbc,
        parsed,
        0x200,
        false,
        "Value",
    );
    defer allocator.free(bytes);

    try std.testing.expectEqualSlices(f64, &.{ 2.0, 34.0 }, bytes);
}

test "does not require FD flag when ID, extended flag, and payload length match" {
    const allocator = std.testing.allocator;
    const dbc_text =
        \\BO_ 291 Example: 8 ECU
        \\ SG_ Speed : 0|16@1+ (1,0) [0|65535] "" DASH
    ;
    const asc_text =
        \\base hex timestamps absolute
        \\0.001 1 123 Rx d 8 01 00 00 00 00 00 00 00
        \\0.002 CANFD 1 Rx 123 - 1 0 8 8 02 00 00 00 00 00 00 00
        \\0.003 CANFD 1 Rx 123 - 1 0 9 12 03 00 00 00 00 00 00 00 00 00 00 00
    ;

    const dbc = try dbc_handle.Handle.parse(allocator, dbc_text);
    defer dbc.deinit(allocator);
    var parsed = try asc.fromString(allocator, asc_text);
    defer parsed.deinit(allocator);

    const bytes = try selectedSignalValues(
        allocator,
        dbc,
        parsed,
        0x123,
        false,
        "Speed",
    );
    defer allocator.free(bytes);

    try std.testing.expectEqualSlices(f64, &.{ 1.0, 2.0, 1.0, 2.0 }, bytes);
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
    var parsed = try trc.fromString(allocator, trc_text);
    defer parsed.deinit(allocator);

    const bytes = try selectedSignalValues(
        allocator,
        dbc,
        parsed,
        0x123,
        false,
        "Speed",
    );
    defer allocator.free(bytes);

    try std.testing.expectEqualSlices(f64, &.{ 0.1, 4660.0 }, bytes);
}
