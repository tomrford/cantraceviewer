const std = @import("std");

pub const ValueType = enum { integer, float32, float64 };

pub const ValueDescription = struct { raw_value: i64, label: []const u8 };

pub const ValueDescriptionRef = union(enum) {
    table_name: []const u8,
    inline_values: []ValueDescription,
};

pub const SignalValueDescriptions = struct {
    message_id: u32,
    signal_name: []const u8,
    value_descriptions: ValueDescriptionRef,

    pub fn fromString(allocator: std.mem.Allocator, line: []const u8) !SignalValueDescriptions {
        var cursor = std.mem.trim(u8, line, " \t\r");
        if (!std.mem.startsWith(u8, cursor, "VAL_ ")) return error.InvalidValueDescriptionLine;
        cursor = std.mem.trim(u8, cursor["VAL_ ".len..], " \t");

        const message_id_end = std.mem.indexOfAny(u8, cursor, " \t") orelse return error.InvalidValueDescriptionLine;
        const message_id = try std.fmt.parseInt(u32, cursor[0..message_id_end], 10);
        cursor = std.mem.trim(u8, cursor[message_id_end..], " \t");

        const signal_name_end = std.mem.indexOfAny(u8, cursor, " \t") orelse return error.InvalidValueDescriptionLine;
        const signal_name = cursor[0..signal_name_end];
        cursor = std.mem.trim(u8, cursor[signal_name_end..], " \t");

        if (cursor.len == 0) return error.InvalidValueDescriptionLine;
        if (std.mem.endsWith(u8, cursor, ";")) {
            cursor = std.mem.trim(u8, cursor[0 .. cursor.len - 1], " \t\r");
        }
        if (cursor.len == 0) return error.InvalidValueDescriptionLine;

        return .{
            .message_id = message_id,
            .signal_name = signal_name,
            .value_descriptions = switch (cursor[0]) {
                '-', '0'...'9' => .{ .inline_values = try parseValueDescriptionPairs(allocator, cursor) },
                '"' => return error.InvalidValueDescriptionLine,
                else => .{ .table_name = cursor },
            },
        };
    }
};

pub const ValueTable = struct {
    name: []const u8,
    values: []ValueDescription,

    pub fn fromString(allocator: std.mem.Allocator, line: []const u8) !ValueTable {
        var cursor = std.mem.trim(u8, line, " \t\r");
        if (!std.mem.startsWith(u8, cursor, "VAL_TABLE_ ")) return error.InvalidValueTableLine;
        cursor = std.mem.trim(u8, cursor["VAL_TABLE_ ".len..], " \t");

        const name_end = std.mem.indexOfAny(u8, cursor, " \t") orelse return error.InvalidValueTableLine;
        const name = cursor[0..name_end];
        cursor = std.mem.trim(u8, cursor[name_end..], " \t");

        return .{
            .name = name,
            .values = try parseValueDescriptionPairs(allocator, cursor),
        };
    }
};

pub const SignalValueType = struct {
    message_id: u32,
    signal_name: []const u8,
    value_type: ValueType,

    pub fn fromString(line: []const u8) !SignalValueType {
        var cursor = std.mem.trim(u8, line, " \t\r");
        if (!std.mem.startsWith(u8, cursor, "SIG_VALTYPE_ ")) return error.InvalidSignalValueTypeLine;
        cursor = std.mem.trim(u8, cursor["SIG_VALTYPE_ ".len..], " \t");

        const message_id_end = std.mem.indexOfAny(u8, cursor, " \t") orelse return error.InvalidSignalValueTypeLine;
        const message_id = try std.fmt.parseInt(u32, cursor[0..message_id_end], 10);
        cursor = std.mem.trim(u8, cursor[message_id_end..], " \t");

        const signal_name_end = std.mem.indexOfAny(u8, cursor, " \t:") orelse return error.InvalidSignalValueTypeLine;
        const signal_name = cursor[0..signal_name_end];
        cursor = std.mem.trim(u8, cursor[signal_name_end..], " \t");
        if (std.mem.startsWith(u8, cursor, ":")) {
            cursor = std.mem.trim(u8, cursor[1..], " \t");
        }
        if (std.mem.endsWith(u8, cursor, ";")) {
            cursor = std.mem.trim(u8, cursor[0 .. cursor.len - 1], " \t\r");
        }

        return .{
            .message_id = message_id,
            .signal_name = signal_name,
            .value_type = switch (try std.fmt.parseInt(u8, cursor, 10)) {
                0 => .integer,
                1 => .float32,
                2 => .float64,
                else => return error.InvalidSignalValueTypeLine,
            },
        };
    }
};

fn parseValueDescriptionPairs(allocator: std.mem.Allocator, text: []const u8) ![]ValueDescription {
    var cursor = std.mem.trim(u8, text, " \t\r");
    if (std.mem.endsWith(u8, cursor, ";")) {
        cursor = std.mem.trim(u8, cursor[0 .. cursor.len - 1], " \t\r");
    }

    var descriptions: std.ArrayList(ValueDescription) = .empty;
    errdefer descriptions.deinit(allocator);

    while (cursor.len > 0) {
        const raw_end = std.mem.indexOfAny(u8, cursor, " \t") orelse return error.InvalidValueDescriptionLine;
        const raw_value = try std.fmt.parseInt(i64, cursor[0..raw_end], 10);
        cursor = std.mem.trim(u8, cursor[raw_end..], " \t");

        if (!std.mem.startsWith(u8, cursor, "\"")) return error.InvalidValueDescriptionLine;
        cursor = cursor[1..];

        const label_end = findClosingQuote(cursor) orelse return error.InvalidValueDescriptionLine;
        try descriptions.append(allocator, .{
            .raw_value = raw_value,
            .label = cursor[0..label_end],
        });
        cursor = std.mem.trim(u8, cursor[label_end + 1 ..], " \t");
    }

    return descriptions.toOwnedSlice(allocator);
}

fn findClosingQuote(text: []const u8) ?usize {
    var index: usize = 0;
    while (index < text.len) : (index += 1) {
        if (text[index] == '\\') {
            index += 1;
            continue;
        }
        if (text[index] == '"') return index;
    }
    return null;
}

test "parse fixture VAL line" {
    const allocator = std.testing.allocator;
    const signal_values = try SignalValueDescriptions.fromString(allocator, "VAL_ 100 State 0 \"Off\" 1 \"On\";");
    const descriptions = switch (signal_values.value_descriptions) {
        .inline_values => |items| items,
        .table_name => unreachable,
    };
    defer allocator.free(descriptions);

    try std.testing.expectEqual(@as(u32, 100), signal_values.message_id);
    try std.testing.expectEqualStrings("State", signal_values.signal_name);
    try std.testing.expectEqual(@as(usize, 2), descriptions.len);
    try std.testing.expectEqual(@as(i64, 0), descriptions[0].raw_value);
    try std.testing.expectEqualStrings("Off", descriptions[0].label);
    try std.testing.expectEqual(@as(i64, 1), descriptions[1].raw_value);
    try std.testing.expectEqualStrings("On", descriptions[1].label);
}

test "parse VAL line referencing table" {
    const allocator = std.testing.allocator;
    const signal_values = try SignalValueDescriptions.fromString(allocator, "VAL_ 100 State GearStates;");
    const table_name = switch (signal_values.value_descriptions) {
        .inline_values => unreachable,
        .table_name => |name| name,
    };

    try std.testing.expectEqual(@as(u32, 100), signal_values.message_id);
    try std.testing.expectEqualStrings("State", signal_values.signal_name);
    try std.testing.expectEqualStrings("GearStates", table_name);
}

test "parse VAL_TABLE line" {
    const allocator = std.testing.allocator;
    const table = try ValueTable.fromString(allocator, "VAL_TABLE_ GearStates 0 \"Park\" 1 \"Drive\" 2 \"Reverse\";");
    defer allocator.free(table.values);

    try std.testing.expectEqualStrings("GearStates", table.name);
    try std.testing.expectEqual(@as(usize, 3), table.values.len);
    try std.testing.expectEqual(@as(i64, 2), table.values[2].raw_value);
    try std.testing.expectEqualStrings("Reverse", table.values[2].label);
}

test "parse signed value descriptions" {
    const allocator = std.testing.allocator;
    const table = try ValueTable.fromString(allocator, "VAL_TABLE_ SignedStates -1 \"Unknown\" 0 \"Off\";");
    defer allocator.free(table.values);

    try std.testing.expectEqual(@as(i64, -1), table.values[0].raw_value);
    try std.testing.expectEqualStrings("Unknown", table.values[0].label);
}

test "reject VAL line without VAL prefix" {
    const allocator = std.testing.allocator;
    try std.testing.expectError(error.InvalidValueDescriptionLine, SignalValueDescriptions.fromString(allocator, "VAL_TABLE_ State 0 \"Off\";"));
}

test "reject VAL line with missing label quote" {
    const allocator = std.testing.allocator;
    try std.testing.expectError(error.InvalidValueDescriptionLine, SignalValueDescriptions.fromString(allocator, "VAL_ 100 State 0 Off;"));
}

test "reject VAL line with non-numeric raw value" {
    const allocator = std.testing.allocator;
    try std.testing.expectError(error.InvalidCharacter, SignalValueDescriptions.fromString(allocator, "VAL_ 100 State 0x1 \"Off\";"));
}

test "reject VAL_TABLE line without table name" {
    const allocator = std.testing.allocator;
    try std.testing.expectError(error.InvalidValueTableLine, ValueTable.fromString(allocator, "VAL_TABLE_"));
}

test "reject VAL_TABLE line with unterminated label" {
    const allocator = std.testing.allocator;
    try std.testing.expectError(error.InvalidValueDescriptionLine, ValueTable.fromString(allocator, "VAL_TABLE_ State 0 \"Off;"));
}

test "parse SIG_VALTYPE line with colon" {
    const value_type = try SignalValueType.fromString("SIG_VALTYPE_ 100 Temperature : 1;");

    try std.testing.expectEqual(@as(u32, 100), value_type.message_id);
    try std.testing.expectEqualStrings("Temperature", value_type.signal_name);
    try std.testing.expectEqual(ValueType.float32, value_type.value_type);
}

test "parse SIG_VALTYPE line without colon" {
    const value_type = try SignalValueType.fromString("SIG_VALTYPE_ 100 Temperature 2;");

    try std.testing.expectEqual(ValueType.float64, value_type.value_type);
}

test "reject SIG_VALTYPE line with unsupported type" {
    try std.testing.expectError(error.InvalidSignalValueTypeLine, SignalValueType.fromString("SIG_VALTYPE_ 100 Temperature : 3;"));
}
