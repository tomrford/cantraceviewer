//! DBC file parser orchestration.
//!
//! This module walks the input line by line, delegates line-level parsing to
//! domain modules, and attaches value metadata after all messages and signals
//! have been collected. Parsed DBC data is arena-scoped: callers provide an
//! arena allocator and release the returned model by releasing that arena.

const std = @import("std");
const signal = @import("signal.zig");
const message = @import("message.zig");
const values = @import("values.zig");

const DBC_WHITESPACE = " \t\r";

fn startsWithRecord(line: []const u8, keyword: []const u8) bool {
    return std.mem.startsWith(u8, line, keyword) and
        line.len > keyword.len and
        std.mem.indexOfScalar(u8, DBC_WHITESPACE, line[keyword.len]) != null;
}

/// Parsed subset of a DBC file used by the viewer.
pub const Dbc = struct {
    /// Messages in source order, each with its attached signals.
    messages: []message.Message,

    /// Value tables in source order.
    ///
    /// Signals that use a named `VAL_TABLE_` borrow their descriptions from
    /// this slice.
    value_tables: []values.ValueTable,

    /// Parses DBC text into arena-owned arrays while borrowing names from `text`.
    ///
    /// Use an arena allocator for `allocator`; release the returned `Dbc` by
    /// releasing that arena. The caller must keep `text` alive for the returned
    /// `Dbc`, or parse from an arena-owned source through `dbc/handle.zig`.
    pub fn fromString(allocator: std.mem.Allocator, text: []const u8) !Dbc {
        var messages: std.ArrayList(message.Message) = .empty;

        var value_tables: std.ArrayList(values.ValueTable) = .empty;

        var pending_values: std.ArrayList(values.SignalValueDescriptions) = .empty;
        defer pending_values.deinit(allocator);

        var pending_value_types: std.ArrayList(values.SignalValueType) = .empty;
        defer pending_value_types.deinit(allocator);

        var current_signals: std.ArrayList(signal.Signal) = .empty;

        var current_message: ?message.Message = null;
        var lines = std.mem.splitScalar(u8, text, '\n');
        while (lines.next()) |raw_line| {
            const line = std.mem.trim(u8, raw_line, DBC_WHITESPACE);
            if (line.len == 0) continue;

            if (startsWithRecord(line, "BO_")) {
                if (current_message) |*msg| {
                    msg.signals = try current_signals.toOwnedSlice(allocator);
                    try messages.append(allocator, msg.*);
                    current_signals = .empty;
                }
                current_message = try message.Message.fromString(line);
                continue;
            }

            if (std.mem.startsWith(u8, line, "VAL_TABLE_ ")) {
                try value_tables.append(allocator, try values.ValueTable.fromString(allocator, line));
                continue;
            }

            if (std.mem.startsWith(u8, line, "VAL_ ")) {
                try pending_values.append(allocator, try values.SignalValueDescriptions.fromString(allocator, line));
                continue;
            }

            if (std.mem.startsWith(u8, line, "SIG_VALTYPE_ ")) {
                try pending_value_types.append(allocator, try values.SignalValueType.fromString(line));
                continue;
            }

            if (startsWithRecord(line, "SG_")) {
                if (current_message == null) return error.SignalWithoutMessage;
                try current_signals.append(allocator, try signal.Signal.fromString(allocator, line));
                continue;
            }
        }

        if (current_message) |*msg| {
            msg.signals = try current_signals.toOwnedSlice(allocator);
            try messages.append(allocator, msg.*);
            current_signals = .empty;
        }

        const message_slice = try messages.toOwnedSlice(allocator);
        const value_table_slice = try value_tables.toOwnedSlice(allocator);

        for (pending_values.items) |pending| {
            attachValueDescriptions(message_slice, value_table_slice, pending);
        }
        for (pending_value_types.items) |pending| {
            attachValueType(message_slice, pending);
        }

        return .{
            .messages = message_slice,
            .value_tables = value_table_slice,
        };
    }
};

fn attachValueDescriptions(
    messages: []message.Message,
    value_tables: []const values.ValueTable,
    pending: values.SignalValueDescriptions,
) void {
    for (messages) |*msg| {
        if (msg.dbc_id != pending.message_id) continue;
        for (msg.signals) |*sig| {
            if (!std.mem.eql(u8, sig.name, pending.signal_name)) continue;
            sig.value_descriptions = switch (pending.value_descriptions) {
                .inline_values => |items| items,
                .table_name => |name| table: {
                    const table = findValueTable(value_tables, name) orelse return;
                    break :table table.values;
                },
            };
            return;
        }
    }
}

fn findValueTable(value_tables: []const values.ValueTable, name: []const u8) ?values.ValueTable {
    for (value_tables) |table| {
        if (std.mem.eql(u8, table.name, name)) return table;
    }
    return null;
}

/// Applies parsed `SIG_VALTYPE_` metadata to its matching signal, when present.
fn attachValueType(messages: []message.Message, pending: values.SignalValueType) void {
    for (messages) |*msg| {
        if (msg.dbc_id != pending.message_id) continue;
        for (msg.signals) |*sig| {
            if (!std.mem.eql(u8, sig.name, pending.signal_name)) continue;
            sig.value_type = pending.value_type;
            return;
        }
    }
}

test "parse fixture DBC messages and signals" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    const text =
        \\VERSION ""
        \\BO_ 256 Heartbeat: 2 Agent
        \\ SG_ counter : 0|8@1+ (1,0) [0|255] "" Dashboard
        \\ SG_ mode : 8|8@1+ (1,0) [0|4] "" Dashboard
        \\BO_ 288 PowertrainStatus: 8 Agent
        \\ SG_ vehicle_speed : 0|16@1+ (0.1,0) [0|250] "km/h" Dashboard
        \\ SG_ engine_rpm : 16|16@1+ (1,0) [0|8000] "rpm" Dashboard
        \\ SG_ throttle : 32|8@1+ (0.5,0) [0|100] "%" Dashboard
        \\ SG_ coolant_temp : 40|8@1+ (1,-40) [-40|215] "degC" Dashboard
        \\BO_ 304 BodyStatus: 3 Agent
        \\ SG_ left_signal : 0|8@1+ (1,0) [0|1] "" Dashboard
        \\ SG_ right_signal : 8|8@1+ (1,0) [0|1] "" Dashboard
        \\ SG_ battery_voltage : 16|8@1+ (0.1,0) [0|25.5] "V" Dashboard
    ;
    const dbc = try Dbc.fromString(allocator, text);

    try std.testing.expectEqual(@as(usize, 3), dbc.messages.len);
    try std.testing.expectEqualStrings("Heartbeat", dbc.messages[0].name);
    try std.testing.expectEqual(@as(usize, 2), dbc.messages[0].signals.len);
    try std.testing.expectEqualStrings("vehicle_speed", dbc.messages[1].signals[0].name);
    try std.testing.expectEqual(@as(f64, 0.1), dbc.messages[1].signals[0].factor);
    try std.testing.expectEqualStrings("BodyStatus", dbc.messages[2].name);
    try std.testing.expectEqualStrings("battery_voltage", dbc.messages[2].signals[2].name);
}

test "parse DBC message and signal records separated by tabs" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    const text = "BO_\t288\tPowertrainStatus:\t8\tAgent\n" ++
        "\tSG_\tvehicle_speed\t:\t0|16@1+\t(0.1,0)\t[0|250]\t\"km/h\"\tDashboard";
    const dbc = try Dbc.fromString(allocator, text);

    try std.testing.expectEqual(@as(usize, 1), dbc.messages.len);
    try std.testing.expectEqualStrings("PowertrainStatus", dbc.messages[0].name);
    try std.testing.expectEqual(@as(usize, 1), dbc.messages[0].signals.len);
    try std.testing.expectEqualStrings("vehicle_speed", dbc.messages[0].signals[0].name);
}

test "parse fixture DBC with extended multiplexed signals" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    const text =
        \\VERSION ""
        \\BO_ 2147483650 ext_MUX_multiplexors: 7 Vector__XXX
        \\ SG_ muxed_D_1 m1 : 48|8@1- (1,0) [0|0] "" Vector__XXX
        \\ SG_ muxed_D_0 m0 : 48|8@1- (1,0) [0|0] "" Vector__XXX
        \\ SG_ muxed_C_1_MUX_D m1M : 40|8@1- (1,0) [0|0] "" Vector__XXX
        \\ SG_ muxed_C_0 m0 : 40|16@1- (1,0) [0|0] "" Vector__XXX
        \\ SG_ MUX_C M : 32|8@1- (1,0) [0|0] "" Vector__XXX
        \\ SG_ muxed_B_5 m5 : 24|8@1- (1,0) [0|0] "" Vector__XXX
        \\ SG_ muxed_B_1 m1 : 24|8@1- (1,0) [0|0] "" Vector__XXX
        \\ SG_ muxed_B_2 m2 : 24|8@1- (1,0) [0|0] "" Vector__XXX
        \\ SG_ MUX_B M : 16|8@1- (1,0) [0|0] "" Vector__XXX
        \\ SG_ muxed_A_0 m0 : 8|8@1- (1,0) [0|0] "" Vector__XXX
        \\ SG_ muxed_A_1 m1 : 8|8@1- (1,0) [0|0] "" Vector__XXX
        \\ SG_ MUX_A M : 0|8@1- (1,0) [0|0] "" Vector__XXX
    ;
    const dbc = try Dbc.fromString(allocator, text);

    try std.testing.expectEqual(@as(usize, 1), dbc.messages.len);
    try std.testing.expectEqual(@as(u32, 2147483650), dbc.messages[0].dbc_id);
    try std.testing.expectEqual(@as(u32, 2), dbc.messages[0].can_id);
    try std.testing.expect(dbc.messages[0].is_extended);
    try std.testing.expectEqual(@as(usize, 12), dbc.messages[0].signals.len);
    try std.testing.expectEqualStrings("muxed_D_1", dbc.messages[0].signals[0].name);
    try std.testing.expect(dbc.messages[0].signals[0].unsupported_mux);
}

test "parse fixture DBC with inline value descriptions" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    const text =
        \\VERSION "1.0"
        \\BO_ 100 Example: 8 ECU
        \\    SG_ State : 0|8@1+ (1,0) [0|255] "" DASH
        \\VAL_ 100 State 0 "Off" 1 "On";
    ;
    const dbc = try Dbc.fromString(allocator, text);

    try std.testing.expectEqual(@as(usize, 1), dbc.messages.len);
    const state = dbc.messages[0].signals[0];
    const descriptions = state.getValueDescriptions() orelse return error.TestExpectedValueDescriptions;

    try std.testing.expectEqual(@as(usize, 2), descriptions.len);
    try std.testing.expectEqual(@as(i64, 0), descriptions[0].raw_value);
    try std.testing.expectEqualStrings("Off", descriptions[0].label);
    try std.testing.expectEqual(@as(i64, 1), descriptions[1].raw_value);
    try std.testing.expectEqualStrings("On", descriptions[1].label);
}

test "parse DBC with named value table reference" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    const text =
        \\VAL_TABLE_ GearStates 0 "Park" 1 "Drive";
        \\BO_ 100 Example: 8 ECU
        \\ SG_ Gear : 0|8@1+ (1,0) [0|255] "" DASH
        \\ SG_ RequestedGear : 8|8@1+ (1,0) [0|255] "" DASH
        \\VAL_ 100 Gear GearStates;
        \\VAL_ 100 RequestedGear GearStates;
    ;
    const dbc = try Dbc.fromString(allocator, text);

    const gear = dbc.messages[0].signals[0];
    const requested_gear = dbc.messages[0].signals[1];
    const gear_descriptions = gear.getValueDescriptions() orelse return error.TestExpectedValueDescriptions;
    const requested_descriptions = requested_gear.getValueDescriptions() orelse return error.TestExpectedValueDescriptions;

    try std.testing.expectEqual(@as(usize, 1), dbc.value_tables.len);
    try std.testing.expectEqual(@intFromPtr(dbc.value_tables[0].values.ptr), @intFromPtr(gear_descriptions.ptr));
    try std.testing.expectEqual(@intFromPtr(gear_descriptions.ptr), @intFromPtr(requested_descriptions.ptr));
    try std.testing.expectEqual(@as(usize, 2), gear_descriptions.len);
    try std.testing.expectEqualStrings("Drive", gear_descriptions[1].label);
}

test "parse DBC with signal value type" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    const text =
        \\BO_ 100 Example: 8 ECU
        \\ SG_ Temperature : 0|32@1+ (1,0) [0|0] "" DASH
        \\SIG_VALTYPE_ 100 Temperature : 1;
    ;
    const dbc = try Dbc.fromString(allocator, text);

    try std.testing.expectEqual(values.ValueType.float32, dbc.messages[0].signals[0].value_type);
}
