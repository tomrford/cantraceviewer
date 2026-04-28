const std = @import("std");
const builtin = @import("builtin");

pub const dbc = @import("dbc/dbc.zig");
pub const asc = @import("asc/asc.zig");
const message = @import("dbc/message.zig");
const signal = @import("dbc/signal.zig");

const root_allocator = if (builtin.target.cpu.arch.isWasm()) std.heap.wasm_allocator else std.heap.page_allocator;

const DbcHandle = struct {
    arena: std.heap.ArenaAllocator,
    dbc: dbc.Dbc,
};

const OwnedBytes = extern struct {
    ptr: usize,
    len: usize,
};

export fn alloc(len: usize) ?[*]u8 {
    const bytes = root_allocator.alloc(u8, len) catch return null;
    return bytes.ptr;
}

export fn free(ptr: [*]u8, len: usize) void {
    root_allocator.free(ptr[0..len]);
}

export fn dbc_parse(ptr: [*]const u8, len: usize) usize {
    const input = ptr[0..len];

    const handle = root_allocator.create(DbcHandle) catch return 0;
    handle.arena = std.heap.ArenaAllocator.init(root_allocator);

    const arena = handle.arena.allocator();
    const source = arena.dupe(u8, input) catch {
        handle.arena.deinit();
        root_allocator.destroy(handle);
        return 0;
    };

    handle.dbc = dbc.Dbc.fromString(arena, source) catch {
        handle.arena.deinit();
        root_allocator.destroy(handle);
        return 0;
    };

    return @intFromPtr(handle);
}

export fn dbc_to_json(handle_value: usize) ?*OwnedBytes {
    if (handle_value == 0) return null;

    const handle: *DbcHandle = @ptrFromInt(handle_value);
    return dbcToOwnedBytes(handle.dbc) catch null;
}

fn dbcToOwnedBytes(parsed: dbc.Dbc) !*OwnedBytes {
    const json = try dbcToJson(root_allocator, parsed);
    errdefer root_allocator.free(json);

    const owned = try root_allocator.create(OwnedBytes);
    owned.* = .{
        .ptr = @intFromPtr(json.ptr),
        .len = json.len,
    };
    return owned;
}

export fn dbc_free(handle_value: usize) void {
    if (handle_value == 0) return;

    const handle: *DbcHandle = @ptrFromInt(handle_value);
    handle.arena.deinit();
    root_allocator.destroy(handle);
}

export fn owned_bytes_ptr(bytes: *const OwnedBytes) usize {
    return bytes.ptr;
}

export fn owned_bytes_len(bytes: *const OwnedBytes) usize {
    return bytes.len;
}

export fn owned_bytes_free(bytes: *OwnedBytes) void {
    const ptr: [*]u8 = @ptrFromInt(bytes.ptr);
    root_allocator.free(ptr[0..bytes.len]);
    root_allocator.destroy(bytes);
}

fn dbcToJson(allocator: std.mem.Allocator, parsed: dbc.Dbc) ![]u8 {
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

test "serializes parsed DBC to JSON" {
    const allocator = std.testing.allocator;
    const text =
        \\BO_ 100 Example: 8 ECU
        \\ SG_ State : 0|8@1+ (1,0) [0|255] "" DASH
        \\VAL_ 100 State 0 "Off" 1 "On";
    ;
    var parsed = try dbc.Dbc.fromString(allocator, text);
    defer parsed.deinit(allocator);

    const json = try dbcToJson(allocator, parsed);
    defer allocator.free(json);

    try std.testing.expect(std.mem.indexOf(u8, json, "\"messages\"") != null);
    try std.testing.expect(std.mem.indexOf(u8, json, "\"valueDescriptions\"") != null);
    try std.testing.expect(std.mem.indexOf(u8, json, "\"Off\"") != null);
}

test "serializing failed parse handle returns null" {
    try std.testing.expectEqual(@as(?*OwnedBytes, null), dbc_to_json(0));
}

test "omits unsupported multiplexed signals from JSON" {
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

    const json = try dbcToJson(allocator, parsed);
    defer allocator.free(json);

    try std.testing.expect(std.mem.indexOf(u8, json, "\"Visible\"") != null);
    try std.testing.expect(std.mem.indexOf(u8, json, "\"Hidden\"") == null);
    try std.testing.expect(std.mem.indexOf(u8, json, "\"unsupportedMux\":false") != null);
}
