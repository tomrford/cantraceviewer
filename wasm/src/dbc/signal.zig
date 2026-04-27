const std = @import("std");
const values = @import("values.zig");

pub const DbcEndian = enum { intel, motorola };

const SignalDecodePlan = struct {
    bit_offset: usize,
    bit_count: usize,
    endian: std.builtin.Endian,
    signedness: std.builtin.Signedness,
};

pub const Signal = struct {
    name: []const u8,
    start_bit: u16,
    bit_length: u16,
    endianness: DbcEndian,
    signedness: std.builtin.Signedness,
    factor: f64,
    offset: f64,
    minimum: ?f64,
    maximum: ?f64,
    unit: []const u8,
    receivers: [][]const u8,
    value_descriptions: ?[]values.ValueDescription,
    value_type: values.ValueType,
    unsupported_mux: bool,

    // pub fn planDecode(self: Signal, msg_size_bytes: u8) SignalDecodePlan {
    //     const signal = switch (self.endianness) {
    //         .intel => .{
    //             .offset = @as(usize, self.start_bit),
    //             .endian = std.builtin.Endian.little,
    //         },
    //         .motorola => blk: {
    //             const byte = self.start_bit / 8;
    //             const bit = self.start_bit % 8;
    //             const msb_offset = byte * 8 + (7 - bit);
    //             const msg_bits = @as(usize, msg_size_bytes) * 8;
    //             const zig_offset = msg_bits - msb_offset - self.bit_length;

    //             break :blk .{
    //                 .offset = zig_offset,
    //                 .endian = std.builtin.Endian.big,
    //             };
    //         },
    //     };
    //     return .{
    //         .bit_offset = signal.offset,
    //         .bit_count = self.bit_length,
    //         .endian = signal.endian,
    //         .signedness = self.signedness,
    //     };
    // }

    // pub fn decode(self: Signal, payload: []const u8) !DecodedValue {
    //     const signal = switch (self.endianness) {
    //         .intel => .{
    //             .offset = @as(usize, self.start_bit),
    //             .endian = std.builtin.Endian.little,
    //         },
    //         .motorola => blk: {
    //             const byte = self.start_bit / 8;
    //             const bit = self.start_bit % 8;
    //             const msb_offset = byte * 8 + (7 - bit);
    //             const zig_offset = (payload.len * 8) - msb_offset - self.bit_length;

    //             break :blk .{
    //                 .offset = zig_offset,
    //                 .endian = std.builtin.Endian.big,
    //             };
    //         },
    //     };

    //     const raw = std.mem.readVarPackedInt(u64, payload, signal.offset, self.bit_length, signal.endian, .unsigned);
    // }

    pub fn fromString(allocator: std.mem.Allocator, line: []const u8) !Signal {
        var cursor = std.mem.trim(u8, line, " \t\r");
        if (!std.mem.startsWith(u8, cursor, "SG_ ")) return error.InvalidSignalLine;
        cursor = std.mem.trimLeft(u8, cursor["SG_ ".len..], " \t");

        const name_end = std.mem.indexOfAny(u8, cursor, " \t") orelse return error.InvalidSignalLine;
        const name = cursor[0..name_end];
        cursor = std.mem.trimLeft(u8, cursor[name_end..], " \t");

        var unsupported_mux = false;
        if (!std.mem.startsWith(u8, cursor, ":")) {
            const marker_end = std.mem.indexOfAny(u8, cursor, " \t") orelse return error.InvalidSignalLine;
            unsupported_mux = true;
            cursor = std.mem.trimLeft(u8, cursor[marker_end..], " \t");
        }
        if (!std.mem.startsWith(u8, cursor, ":")) return error.InvalidSignalLine;
        cursor = std.mem.trimLeft(u8, cursor[1..], " \t");

        const start_sep = std.mem.indexOfScalar(u8, cursor, '|') orelse return error.InvalidSignalLine;
        const start_bit = try std.fmt.parseInt(u16, cursor[0..start_sep], 10);
        cursor = cursor[start_sep + 1 ..];

        const len_sep = std.mem.indexOfScalar(u8, cursor, '@') orelse return error.InvalidSignalLine;
        const bit_length = try std.fmt.parseInt(u16, cursor[0..len_sep], 10);
        cursor = cursor[len_sep + 1 ..];
        if (cursor.len < 2) return error.InvalidSignalLine;

        const endianness: DbcEndian = switch (cursor[0]) {
            '1' => .intel,
            '0' => .motorola,
            else => return error.InvalidSignalLine,
        };
        const signedness: std.builtin.Signedness = switch (cursor[1]) {
            '+' => .unsigned,
            '-' => .signed,
            else => return error.InvalidSignalLine,
        };
        cursor = std.mem.trimLeft(u8, cursor[2..], " \t");

        if (!std.mem.startsWith(u8, cursor, "(")) return error.InvalidSignalLine;
        cursor = cursor[1..];
        const factor_sep = std.mem.indexOfScalar(u8, cursor, ',') orelse return error.InvalidSignalLine;
        const factor = try std.fmt.parseFloat(f64, cursor[0..factor_sep]);
        cursor = cursor[factor_sep + 1 ..];
        const offset_sep = std.mem.indexOfScalar(u8, cursor, ')') orelse return error.InvalidSignalLine;
        const offset = try std.fmt.parseFloat(f64, cursor[0..offset_sep]);
        cursor = std.mem.trimLeft(u8, cursor[offset_sep + 1 ..], " \t");

        if (!std.mem.startsWith(u8, cursor, "[")) return error.InvalidSignalLine;
        cursor = cursor[1..];
        const min_sep = std.mem.indexOfScalar(u8, cursor, '|') orelse return error.InvalidSignalLine;
        const minimum = try std.fmt.parseFloat(f64, cursor[0..min_sep]);
        cursor = cursor[min_sep + 1 ..];
        const max_sep = std.mem.indexOfScalar(u8, cursor, ']') orelse return error.InvalidSignalLine;
        const maximum = try std.fmt.parseFloat(f64, cursor[0..max_sep]);
        cursor = std.mem.trimLeft(u8, cursor[max_sep + 1 ..], " \t");

        if (!std.mem.startsWith(u8, cursor, "\"")) return error.InvalidSignalLine;
        cursor = cursor[1..];
        const unit_end = std.mem.indexOfScalar(u8, cursor, '"') orelse return error.InvalidSignalLine;
        const unit = cursor[0..unit_end];
        cursor = std.mem.trim(u8, cursor[unit_end + 1 ..], " \t\r");

        var receivers: std.ArrayList([]const u8) = .empty;
        errdefer receivers.deinit(allocator);
        var receiver_tokens = std.mem.tokenizeScalar(u8, cursor, ',');
        while (receiver_tokens.next()) |receiver| {
            try receivers.append(allocator, std.mem.trim(u8, receiver, " \t\r"));
        }

        return .{
            .name = name,
            .start_bit = start_bit,
            .bit_length = bit_length,
            .endianness = endianness,
            .signedness = signedness,
            .factor = factor,
            .offset = offset,
            .minimum = minimum,
            .maximum = maximum,
            .unit = unit,
            .receivers = try receivers.toOwnedSlice(allocator),
            .value_descriptions = null,
            .value_type = .integer,
            .unsupported_mux = unsupported_mux,
        };
    }

    pub fn getValueDescriptions(self: Signal) ?[]const values.ValueDescription {
        return self.value_descriptions;
    }
};

test "parse fixture signal line" {
    const allocator = std.testing.allocator;
    const sig = try Signal.fromString(allocator, " SG_ vehicle_speed : 0|16@1+ (0.1,0) [0|250] \"km/h\" Dashboard");
    defer allocator.free(sig.receivers);

    try std.testing.expectEqualStrings("vehicle_speed", sig.name);
    try std.testing.expectEqual(@as(u16, 0), sig.start_bit);
    try std.testing.expectEqual(@as(u16, 16), sig.bit_length);
    try std.testing.expectEqual(DbcEndian.intel, sig.endianness);
    try std.testing.expectEqual(std.builtin.Signedness.unsigned, sig.signedness);
    try std.testing.expectEqual(@as(f64, 0.1), sig.factor);
    try std.testing.expectEqual(@as(f64, 0), sig.offset);
    try std.testing.expectEqual(@as(f64, 0), sig.minimum.?);
    try std.testing.expectEqual(@as(f64, 250), sig.maximum.?);
    try std.testing.expectEqualStrings("km/h", sig.unit);
    try std.testing.expectEqual(@as(usize, 1), sig.receivers.len);
    try std.testing.expectEqualStrings("Dashboard", sig.receivers[0]);
    try std.testing.expect(!sig.unsupported_mux);
}

test "parse fixture signal line with negative offset" {
    const allocator = std.testing.allocator;
    const sig = try Signal.fromString(allocator, " SG_ coolant_temp : 40|8@1+ (1,-40) [-40|215] \"degC\" Dashboard");
    defer allocator.free(sig.receivers);

    try std.testing.expectEqualStrings("coolant_temp", sig.name);
    try std.testing.expectEqual(@as(u16, 40), sig.start_bit);
    try std.testing.expectEqual(@as(u16, 8), sig.bit_length);
    try std.testing.expectEqual(@as(f64, -40), sig.offset);
    try std.testing.expectEqual(@as(f64, -40), sig.minimum.?);
    try std.testing.expectEqual(@as(f64, 215), sig.maximum.?);
    try std.testing.expectEqualStrings("degC", sig.unit);
}

test "parse fixture multiplexed signal as unsupported" {
    const allocator = std.testing.allocator;
    const sig = try Signal.fromString(allocator, " SG_ muxed_D_1 m1 : 48|8@1- (1,0) [0|0] \"\" Vector__XXX");
    defer allocator.free(sig.receivers);

    try std.testing.expectEqualStrings("muxed_D_1", sig.name);
    try std.testing.expectEqual(std.builtin.Signedness.signed, sig.signedness);
    try std.testing.expect(sig.unsupported_mux);
}

test "reject signal line without SG prefix" {
    const allocator = std.testing.allocator;
    try std.testing.expectError(error.InvalidSignalLine, Signal.fromString(allocator, "BO_ 288 PowertrainStatus: 8 Agent"));
}

test "reject signal line with invalid endian marker" {
    const allocator = std.testing.allocator;
    try std.testing.expectError(error.InvalidSignalLine, Signal.fromString(allocator, " SG_ vehicle_speed : 0|16@2+ (0.1,0) [0|250] \"km/h\" Dashboard"));
}

test "reject signal line with missing unit quotes" {
    const allocator = std.testing.allocator;
    try std.testing.expectError(error.InvalidSignalLine, Signal.fromString(allocator, " SG_ vehicle_speed : 0|16@1+ (0.1,0) [0|250] km/h Dashboard"));
}

test "reject signal line with non-numeric factor" {
    const allocator = std.testing.allocator;
    try std.testing.expectError(error.InvalidCharacter, Signal.fromString(allocator, " SG_ vehicle_speed : 0|16@1+ (fast,0) [0|250] \"km/h\" Dashboard"));
}
