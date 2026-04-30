//! DBC value metadata parsing.
//!
//! Handles `VAL_`, `VAL_TABLE_`, and `SIG_VALTYPE_` records that decorate
//! signals after message parsing.

const std = @import("std");
const quotes = @import("quotes.zig");

/// Largest exact integer representable by JavaScript `number`.
const JS_SAFE_INTEGER_MAX: i64 = 9_007_199_254_740_991;

/// Numeric representation requested by `SIG_VALTYPE_`.
pub const ValueType = enum { integer, float32, float64 };

/// One raw numeric value and its display label.
pub const ValueDescription = struct { raw_value: i64, label: []const u8 };

/// Duplicates value descriptions so a signal can own a copy of a named table.
pub fn dupeValueDescriptions(allocator: std.mem.Allocator, descriptions: []const ValueDescription) ![]ValueDescription {
    const copy = try allocator.alloc(ValueDescription, descriptions.len);
    errdefer allocator.free(copy);

    var copied_labels: usize = 0;
    errdefer {
        for (copy[0..copied_labels]) |description| {
            allocator.free(description.label);
        }
    }

    for (descriptions, copy) |description, *target| {
        target.* = .{
            .raw_value = description.raw_value,
            .label = try allocator.dupe(u8, description.label),
        };
        copied_labels += 1;
    }

    return copy;
}

/// Releases only labels inside a value-description slice.
pub fn freeValueDescriptionLabels(allocator: std.mem.Allocator, descriptions: []const ValueDescription) void {
    for (descriptions) |description| {
        allocator.free(description.label);
    }
}

/// Releases labels and the slice allocated for value descriptions.
pub fn freeValueDescriptions(allocator: std.mem.Allocator, descriptions: []const ValueDescription) void {
    freeValueDescriptionLabels(allocator, descriptions);
    allocator.free(descriptions);
}

/// Parsed `VAL_` payload before it is attached to a signal.
pub const ValueDescriptionRef = union(enum) {
    table_name: []const u8,
    inline_values: []ValueDescription,
};

/// Signal-specific value descriptions from a `VAL_` record.
pub const SignalValueDescriptions = struct {
    message_id: u32,
    signal_name: []const u8,
    value_descriptions: ValueDescriptionRef,

    /// Parses either inline value descriptions or a named value-table reference.
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

/// Named set of value descriptions from a `VAL_TABLE_` record.
pub const ValueTable = struct {
    name: []const u8,
    values: []ValueDescription,

    /// Parses a named table and its raw-value/label pairs.
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

/// Signal numeric type metadata from a `SIG_VALTYPE_` record.
pub const SignalValueType = struct {
    message_id: u32,
    signal_name: []const u8,
    value_type: ValueType,

    /// Parses the integer type code used by DBC value-type metadata.
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

/// Parses repeated `<raw> "<label>"` pairs.
fn parseValueDescriptionPairs(allocator: std.mem.Allocator, text: []const u8) ![]ValueDescription {
    var cursor = std.mem.trim(u8, text, " \t\r");
    if (std.mem.endsWith(u8, cursor, ";")) {
        cursor = std.mem.trim(u8, cursor[0 .. cursor.len - 1], " \t\r");
    }

    var descriptions: std.ArrayList(ValueDescription) = .empty;
    errdefer {
        freeValueDescriptionLabels(allocator, descriptions.items);
        descriptions.deinit(allocator);
    }

    while (cursor.len > 0) {
        const raw_end = std.mem.indexOfAny(u8, cursor, " \t") orelse return error.InvalidValueDescriptionLine;
        const raw_value = try std.fmt.parseInt(i64, cursor[0..raw_end], 10);
        try ensureJsSafeInteger(raw_value);
        cursor = std.mem.trim(u8, cursor[raw_end..], " \t");

        const label = quotes.parseQuoted(allocator, &cursor) catch |err| switch (err) {
            error.OutOfMemory => return err,
            else => return error.InvalidValueDescriptionLine,
        };
        descriptions.append(allocator, .{
            .raw_value = raw_value,
            .label = label,
        }) catch |err| {
            allocator.free(label);
            return err;
        };
        cursor = std.mem.trim(u8, cursor, " \t");
    }

    return descriptions.toOwnedSlice(allocator);
}

/// Keeps JSON-facing raw values exact when they reach TypeScript.
fn ensureJsSafeInteger(value: i64) !void {
    if (value < -JS_SAFE_INTEGER_MAX or value > JS_SAFE_INTEGER_MAX) {
        return error.RawValueOutsideJsSafeIntegerRange;
    }
}

test "parse fixture VAL line" {
    const allocator = std.testing.allocator;
    const signal_values = try SignalValueDescriptions.fromString(allocator, "VAL_ 100 State 0 \"Off\" 1 \"On\";");
    const descriptions = switch (signal_values.value_descriptions) {
        .inline_values => |items| items,
        .table_name => unreachable,
    };
    defer freeValueDescriptions(allocator, descriptions);

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
    defer freeValueDescriptions(allocator, table.values);

    try std.testing.expectEqualStrings("GearStates", table.name);
    try std.testing.expectEqual(@as(usize, 3), table.values.len);
    try std.testing.expectEqual(@as(i64, 2), table.values[2].raw_value);
    try std.testing.expectEqualStrings("Reverse", table.values[2].label);
}

test "parse signed value descriptions" {
    const allocator = std.testing.allocator;
    const table = try ValueTable.fromString(allocator, "VAL_TABLE_ SignedStates -1 \"Unknown\" 0 \"Off\";");
    defer freeValueDescriptions(allocator, table.values);

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

test "reject VAL line with unsafe raw value" {
    const allocator = std.testing.allocator;
    try std.testing.expectError(error.RawValueOutsideJsSafeIntegerRange, SignalValueDescriptions.fromString(allocator, "VAL_ 100 State 9007199254740992 \"Too Big\";"));
}

test "parse VAL line with escaped label" {
    const allocator = std.testing.allocator;
    const signal_values = try SignalValueDescriptions.fromString(allocator, "VAL_ 100 State 1 \"State \\\"On\\\"\";");
    const descriptions = switch (signal_values.value_descriptions) {
        .inline_values => |items| items,
        .table_name => unreachable,
    };
    defer freeValueDescriptions(allocator, descriptions);

    try std.testing.expectEqualStrings("State \"On\"", descriptions[0].label);
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
