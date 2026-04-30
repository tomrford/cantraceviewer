//! Browser-facing DBC catalog projection.
//!
//! The parser keeps the DBC model in Zig-owned structs. This module writes the
//! compact JSON shape consumed by the Svelte signal picker.

const std = @import("std");
const dbc = @import("dbc.zig");
const message = @import("message.zig");
const signal = @import("signal.zig");

/// Serializes the parsed DBC catalog used by the browser signal picker.
///
/// This is intentionally a UI catalog, not a full DBC interchange format.
/// Unsupported multiplexed signals are omitted because the viewer cannot
/// decode them yet.
pub fn toJson(allocator: std.mem.Allocator, parsed: dbc.Dbc) ![]u8 {
    var out: std.Io.Writer.Allocating = .init(allocator);
    errdefer out.deinit();

    var writer: std.json.Stringify = .{ .writer = &out.writer };
    try writer.beginObject();
    try writer.objectField("messages");
    try writer.beginArray();
    for (parsed.messages) |msg| {
        try writeMessageJson(&writer, msg);
    }
    try writer.endArray();
    try writer.endObject();

    return out.toOwnedSlice();
}

fn writeMessageJson(writer: *std.json.Stringify, msg: message.Message) !void {
    try writer.beginObject();
    try writeJsonField(writer, "name", msg.name);
    try writeJsonField(writer, "dbcId", msg.dbc_id);
    try writeJsonField(writer, "canId", msg.can_id);
    try writeJsonField(writer, "isExtended", msg.is_extended);
    try writeJsonField(writer, "isFd", msg.is_fd);
    try writeJsonField(writer, "sizeBytes", msg.size_bytes);
    try writeJsonField(writer, "transmitter", msg.transmitter);

    try writer.objectField("signals");
    try writer.beginArray();
    for (msg.signals) |sig| {
        if (sig.unsupported_mux) continue;
        try writeSignalJson(writer, sig);
    }
    try writer.endArray();
    try writer.endObject();
}

fn writeSignalJson(writer: *std.json.Stringify, sig: signal.Signal) !void {
    try writer.beginObject();
    try writeJsonField(writer, "name", sig.name);
    try writeJsonField(writer, "startBit", sig.start_bit);
    try writeJsonField(writer, "bitLength", sig.bit_length);
    try writeJsonField(writer, "endianness", @tagName(sig.endianness));
    try writeJsonField(writer, "signedness", @tagName(sig.signedness));
    try writeJsonField(writer, "factor", sig.factor);
    try writeJsonField(writer, "offset", sig.offset);
    try writeJsonField(writer, "minimum", sig.minimum);
    try writeJsonField(writer, "maximum", sig.maximum);
    try writeJsonField(writer, "unit", sig.unit);
    try writeJsonField(writer, "valueType", @tagName(sig.value_type));
    try writeJsonField(writer, "unsupportedMux", sig.unsupported_mux);

    try writer.objectField("receivers");
    try writer.beginArray();
    for (sig.receivers) |receiver| {
        try writer.write(receiver);
    }
    try writer.endArray();

    try writer.objectField("valueDescriptions");
    try writer.beginArray();
    if (sig.value_descriptions) |descriptions| {
        for (descriptions) |description| {
            try writer.beginObject();
            try writeJsonField(writer, "rawValue", description.raw_value);
            try writeJsonField(writer, "label", description.label);
            try writer.endObject();
        }
    }
    try writer.endArray();
    try writer.endObject();
}

fn writeJsonField(writer: *std.json.Stringify, field: []const u8, value: anytype) !void {
    try writer.objectField(field);
    try writer.write(value);
}

test "serializes parsed DBC catalog to JSON" {
    const allocator = std.testing.allocator;
    const text =
        \\BO_ 100 Example: 8 ECU
        \\ SG_ State : 0|8@1+ (1,0) [0|255] "" DASH
        \\VAL_ 100 State 0 "Off" 1 "On";
    ;
    var parsed = try dbc.Dbc.fromString(allocator, text);
    defer parsed.deinit(allocator);

    const json = try toJson(allocator, parsed);
    defer allocator.free(json);

    try std.testing.expect(std.mem.indexOf(u8, json, "\"messages\"") != null);
    try std.testing.expect(std.mem.indexOf(u8, json, "\"valueDescriptions\"") != null);
    try std.testing.expect(std.mem.indexOf(u8, json, "\"Off\"") != null);
}

test "omits unsupported multiplexed signals from catalog JSON" {
    const allocator = std.testing.allocator;
    const text =
        \\BO_ 100 Example: 8 ECU
        \\ SG_ Visible : 0|8@1+ (1,0) [0|255] "" DASH
        \\ SG_ Hidden m1 : 8|8@1+ (1,0) [0|255] "" DASH
    ;
    var parsed = try dbc.Dbc.fromString(allocator, text);
    defer parsed.deinit(allocator);

    try std.testing.expectEqual(@as(usize, 2), parsed.messages[0].signals.len);
    try std.testing.expect(parsed.messages[0].signals[1].unsupported_mux);

    const json = try toJson(allocator, parsed);
    defer allocator.free(json);

    try std.testing.expect(std.mem.indexOf(u8, json, "\"Visible\"") != null);
    try std.testing.expect(std.mem.indexOf(u8, json, "\"Hidden\"") == null);
    try std.testing.expect(std.mem.indexOf(u8, json, "\"unsupportedMux\":false") != null);
}
