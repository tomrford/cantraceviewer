//! Selected signal time-series extraction.
//!
//! The exported WASM boundary asks for one DBC message name and signal name,
//! then receives a binary stream of `(timestamp_ns, value_f64)` samples.

const std = @import("std");
const asc_handle = @import("asc/handle.zig");
const dbc_handle = @import("dbc/handle.zig");
const message = @import("dbc/message.zig");
const signal = @import("dbc/signal.zig");
const frame = @import("asc/frame.zig");

const SAMPLE_BYTES: usize = 16;

pub fn selectedSignalValues(
    allocator: std.mem.Allocator,
    dbc: *const dbc_handle.Handle,
    asc: *const asc_handle.Handle,
    message_name: []const u8,
    signal_name: []const u8,
) ![]u8 {
    const selection = try findSignal(dbc, message_name, signal_name);
    const plan = try selection.signal.planDecode(selection.message.size_bytes);

    var out: std.ArrayList(u8) = .empty;
    errdefer out.deinit(allocator);

    for (asc.asc.frames) |trace_frame| {
        if (!matchesMessage(trace_frame, selection.message)) continue;
        if (trace_frame.payload_len != selection.message.size_bytes) return error.InvalidPayloadLength;

        const payload = trace_frame.payload[0..selection.message.size_bytes];
        const value = try plan.decode(payload);
        try appendSample(allocator, &out, trace_frame.timestamp_ns, value);
    }

    return out.toOwnedSlice(allocator);
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

fn matchesMessage(trace_frame: frame.Frame, msg: message.Message) bool {
    if (trace_frame.kind != .data) return false;
    const id = trace_frame.id orelse return false;
    return id.value == msg.can_id and id.is_extended == msg.is_extended;
}

fn appendSample(allocator: std.mem.Allocator, out: *std.ArrayList(u8), timestamp_ns: u64, value: f64) !void {
    const start = out.items.len;
    try out.resize(allocator, start + SAMPLE_BYTES);
    std.mem.writeInt(u64, out.items[start..][0..8], timestamp_ns, .little);
    std.mem.writeInt(u64, out.items[start + 8 ..][0..8], @as(u64, @bitCast(value)), .little);
}

test "extracts selected signal values as timestamp/value samples" {
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

    const bytes = try selectedSignalValues(allocator, dbc, asc, "Example", "Speed");
    defer allocator.free(bytes);

    try std.testing.expectEqual(@as(usize, 32), bytes.len);
    try std.testing.expectEqual(@as(u64, 1_000_000), std.mem.readInt(u64, bytes[0..8], .little));
    try std.testing.expectEqual(@as(u64, 3_000_000), std.mem.readInt(u64, bytes[16..24], .little));
    try std.testing.expectEqual(@as(f64, 1000.0), @as(f64, @bitCast(std.mem.readInt(u64, bytes[8..16], .little))));
    try std.testing.expectEqual(@as(f64, 2000.0), @as(f64, @bitCast(std.mem.readInt(u64, bytes[24..32], .little))));
}

test "extracts selected float signal values as timestamp/value samples" {
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

    const bytes = try selectedSignalValues(allocator, dbc, asc, "Example", "Temperature");
    defer allocator.free(bytes);

    try std.testing.expectEqual(@as(usize, 16), bytes.len);
    try std.testing.expectEqual(@as(u64, 1_000_000), std.mem.readInt(u64, bytes[0..8], .little));
    try std.testing.expectEqual(@as(f64, 1.5), @as(f64, @bitCast(std.mem.readInt(u64, bytes[8..16], .little))));
}

test "extracts selected motorola float signal values as timestamp/value samples" {
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

    const bytes = try selectedSignalValues(allocator, dbc, asc, "Example", "Temperature");
    defer allocator.free(bytes);

    try std.testing.expectEqual(@as(usize, 16), bytes.len);
    try std.testing.expectEqual(@as(u64, 1_000_000), std.mem.readInt(u64, bytes[0..8], .little));
    try std.testing.expectEqual(@as(f64, 1.5), @as(f64, @bitCast(std.mem.readInt(u64, bytes[8..16], .little))));
}

test "rejects matching frames with unexpected payload length" {
    const allocator = std.testing.allocator;
    const dbc_text =
        \\BO_ 291 Example: 2 ECU
        \\ SG_ Speed : 0|16@1+ (1,0) [0|65535] "" DASH
    ;
    const asc_text =
        \\base hex timestamps absolute
        \\0.001 1 123 Rx d 1 10
    ;

    const dbc = try dbc_handle.Handle.parse(allocator, dbc_text);
    defer dbc.deinit(allocator);
    const asc = try asc_handle.Handle.parse(allocator, asc_text);
    defer asc.deinit(allocator);

    try std.testing.expectError(
        error.InvalidPayloadLength,
        selectedSignalValues(allocator, dbc, asc, "Example", "Speed"),
    );
}
