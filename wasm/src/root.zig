const std = @import("std");
const builtin = @import("builtin");

pub const dbc = @import("dbc/dbc.zig");
const values = @import("dbc/values.zig");

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
    const handle: *DbcHandle = @ptrFromInt(handle_value);
    const json = dbcToJson(root_allocator, handle.dbc) catch return null;
    errdefer root_allocator.free(json);

    const owned = root_allocator.create(OwnedBytes) catch return null;
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
    var out: std.ArrayList(u8) = .empty;
    errdefer out.deinit(allocator);

    try out.appendSlice(allocator, "{\"messages\":[");
    for (parsed.messages, 0..) |msg, msg_index| {
        if (msg_index != 0) try out.append(allocator, ',');
        try out.append(allocator, '{');
        try appendJsonFieldString(allocator, &out, "name", msg.name, false);
        try appendJsonFieldInt(allocator, &out, "dbcId", msg.dbc_id);
        try appendJsonFieldInt(allocator, &out, "canId", msg.can_id);
        try appendJsonFieldBool(allocator, &out, "isExtended", msg.is_extended);
        try appendJsonFieldBool(allocator, &out, "isFd", msg.is_fd);
        try appendJsonFieldInt(allocator, &out, "sizeBytes", msg.size_bytes);
        try appendJsonFieldString(allocator, &out, "transmitter", msg.transmitter, true);

        try out.appendSlice(allocator, ",\"signals\":[");
        for (msg.signals, 0..) |sig, sig_index| {
            if (sig_index != 0) try out.append(allocator, ',');
            try out.append(allocator, '{');
            try appendJsonFieldString(allocator, &out, "name", sig.name, false);
            try appendJsonFieldInt(allocator, &out, "startBit", sig.start_bit);
            try appendJsonFieldInt(allocator, &out, "bitLength", sig.bit_length);
            try appendJsonFieldString(allocator, &out, "endianness", switch (sig.endianness) {
                .intel => "intel",
                .motorola => "motorola",
            }, true);
            try appendJsonFieldString(allocator, &out, "signedness", switch (sig.signedness) {
                .signed => "signed",
                .unsigned => "unsigned",
            }, true);
            try appendJsonFieldFloat(allocator, &out, "factor", sig.factor);
            try appendJsonFieldFloat(allocator, &out, "offset", sig.offset);
            try appendJsonOptionalFloat(allocator, &out, "minimum", sig.minimum);
            try appendJsonOptionalFloat(allocator, &out, "maximum", sig.maximum);
            try appendJsonFieldString(allocator, &out, "unit", sig.unit, true);
            try appendJsonFieldString(allocator, &out, "valueType", valueTypeName(sig.value_type), true);
            try appendJsonFieldBool(allocator, &out, "unsupportedMux", sig.unsupported_mux);

            try out.appendSlice(allocator, ",\"receivers\":[");
            for (sig.receivers, 0..) |receiver, receiver_index| {
                if (receiver_index != 0) try out.append(allocator, ',');
                try appendJsonString(allocator, &out, receiver);
            }
            try out.append(allocator, ']');

            try out.appendSlice(allocator, ",\"valueDescriptions\":[");
            if (sig.value_descriptions) |descriptions| {
                for (descriptions, 0..) |description, description_index| {
                    if (description_index != 0) try out.append(allocator, ',');
                    try out.append(allocator, '{');
                    try appendJsonString(allocator, &out, "rawValue");
                    try out.print(allocator, ":{d}", .{description.raw_value});
                    try appendJsonFieldString(allocator, &out, "label", description.label, true);
                    try out.append(allocator, '}');
                }
            }
            try out.append(allocator, ']');

            try out.append(allocator, '}');
        }
        try out.appendSlice(allocator, "]}");
    }
    try out.appendSlice(allocator, "]}");

    return out.toOwnedSlice(allocator);
}

fn appendJsonFieldString(
    allocator: std.mem.Allocator,
    out: *std.ArrayList(u8),
    field: []const u8,
    value: []const u8,
    comma: bool,
) !void {
    if (comma) try out.append(allocator, ',');
    try appendJsonString(allocator, out, field);
    try out.append(allocator, ':');
    try appendJsonString(allocator, out, value);
}

fn appendJsonFieldInt(
    allocator: std.mem.Allocator,
    out: *std.ArrayList(u8),
    field: []const u8,
    value: anytype,
) !void {
    try out.append(allocator, ',');
    try appendJsonString(allocator, out, field);
    try out.print(allocator, ":{d}", .{value});
}

fn appendJsonFieldBool(
    allocator: std.mem.Allocator,
    out: *std.ArrayList(u8),
    field: []const u8,
    value: bool,
) !void {
    try out.append(allocator, ',');
    try appendJsonString(allocator, out, field);
    try out.append(allocator, ':');
    try out.appendSlice(allocator, if (value) "true" else "false");
}

fn appendJsonFieldFloat(
    allocator: std.mem.Allocator,
    out: *std.ArrayList(u8),
    field: []const u8,
    value: f64,
) !void {
    try out.append(allocator, ',');
    try appendJsonString(allocator, out, field);
    try out.print(allocator, ":{d}", .{value});
}

fn appendJsonOptionalFloat(
    allocator: std.mem.Allocator,
    out: *std.ArrayList(u8),
    field: []const u8,
    value: ?f64,
) !void {
    try out.append(allocator, ',');
    try appendJsonString(allocator, out, field);
    try out.append(allocator, ':');
    if (value) |number| {
        try out.print(allocator, "{d}", .{number});
    } else {
        try out.appendSlice(allocator, "null");
    }
}

fn appendJsonString(allocator: std.mem.Allocator, out: *std.ArrayList(u8), value: []const u8) !void {
    try out.append(allocator, '"');
    for (value) |byte| {
        switch (byte) {
            '"' => try out.appendSlice(allocator, "\\\""),
            '\\' => try out.appendSlice(allocator, "\\\\"),
            else => {
                if (byte == '\n') {
                    try out.appendSlice(allocator, "\\n");
                } else if (byte == '\r') {
                    try out.appendSlice(allocator, "\\r");
                } else if (byte == '\t') {
                    try out.appendSlice(allocator, "\\t");
                } else if (byte < 0x20) {
                    try out.print(allocator, "\\u{x:0>4}", .{byte});
                } else {
                    try out.append(allocator, byte);
                }
            },
        }
    }
    try out.append(allocator, '"');
}

fn valueTypeName(value_type: values.ValueType) []const u8 {
    return switch (value_type) {
        .integer => "integer",
        .float32 => "float32",
        .float64 => "float64",
    };
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
