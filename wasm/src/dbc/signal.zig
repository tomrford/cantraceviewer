//! DBC signal line parsing.
//!
//! Handles `SG_` records and stores enough metadata for the browser catalog
//! and later raw-payload signal decoding.

const std = @import("std");
const quotes = @import("quotes.zig");
const values = @import("values.zig");

/// DBC bit numbering mode for a signal payload.
pub const DbcEndian = enum { intel, motorola };

/// Prepared raw-payload decoder for repeatedly decoding the same signal.
pub const DecodePlan = struct {
    bit_offset: usize,
    bit_count: usize,
    endian: std.builtin.Endian,
    signedness: std.builtin.Signedness,
    required_payload_len: usize,
    factor: f64,
    offset: f64,

    /// Decodes one raw CAN payload into the signal's physical value.
    pub fn decode(self: DecodePlan, payload: []const u8) !f64 {
        if (payload.len != self.required_payload_len) return error.InvalidPayloadLength;

        const raw = switch (self.signedness) {
            .signed => raw: {
                const value = std.mem.readVarPackedInt(
                    i64,
                    payload,
                    self.bit_offset,
                    self.bit_count,
                    self.endian,
                    .signed,
                );
                break :raw @as(f64, @floatFromInt(value));
            },
            .unsigned => raw: {
                const value = std.mem.readVarPackedInt(
                    u64,
                    payload,
                    self.bit_offset,
                    self.bit_count,
                    self.endian,
                    .unsigned,
                );
                break :raw @as(f64, @floatFromInt(value));
            },
        };

        return raw * self.factor + self.offset;
    }
};

/// Parsed `SG_` signal definition.
pub const Signal = struct {
    name: []const u8,

    /// Start bit in DBC numbering.
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

    /// True when the signal uses multiplexing that this viewer does not decode.
    unsupported_mux: bool,

    /// Prepares the fixed bit-unpack arguments for repeated payload decoding.
    ///
    /// Motorola signals are planned against `msg_size_bytes`; callers must pass
    /// payload slices of that exact length to `DecodePlan.decode`.
    pub fn planDecode(self: Signal, msg_size_bytes: u8) !DecodePlan {
        if (self.unsupported_mux) return error.UnsupportedMultiplexing;
        if (self.value_type != .integer) return error.UnsupportedSignalValueType;
        if (self.bit_length == 0 or self.bit_length > 64) return error.InvalidSignalBitLength;

        const msg_bits = @as(usize, msg_size_bytes) * 8;
        const bit_count = @as(usize, self.bit_length);
        const bit_offset = switch (self.endianness) {
            .intel => @as(usize, self.start_bit),
            .motorola => offset: {
                const byte = @as(usize, self.start_bit / 8);
                const bit = @as(usize, self.start_bit % 8);
                const msb_offset = byte * 8 + (7 - bit);
                if (msb_offset + bit_count > msg_bits) return error.SignalOutsideMessage;
                break :offset msg_bits - msb_offset - bit_count;
            },
        };
        if (bit_offset + bit_count > msg_bits) return error.SignalOutsideMessage;

        return .{
            .bit_offset = bit_offset,
            .bit_count = bit_count,
            .endian = switch (self.endianness) {
                .intel => .little,
                .motorola => .big,
            },
            .signedness = self.signedness,
            .required_payload_len = msg_size_bytes,
            .factor = self.factor,
            .offset = self.offset,
        };
    }

    /// Parses one `SG_` signal line.
    ///
    /// The unit string and receiver list are allocated. Other text fields
    /// borrow from the source line.
    pub fn fromString(allocator: std.mem.Allocator, line: []const u8) !Signal {
        var cursor = std.mem.trim(u8, line, " \t\r");
        if (!std.mem.startsWith(u8, cursor, "SG_ ")) return error.InvalidSignalLine;
        cursor = std.mem.trim(u8, cursor["SG_ ".len..], " \t");

        const name_end = std.mem.indexOfAny(u8, cursor, " \t") orelse return error.InvalidSignalLine;
        const name = cursor[0..name_end];
        cursor = std.mem.trim(u8, cursor[name_end..], " \t");

        var unsupported_mux = false;
        if (!std.mem.startsWith(u8, cursor, ":")) {
            const marker_end = std.mem.indexOfAny(u8, cursor, " \t") orelse return error.InvalidSignalLine;
            unsupported_mux = true;
            cursor = std.mem.trim(u8, cursor[marker_end..], " \t");
        }
        if (!std.mem.startsWith(u8, cursor, ":")) return error.InvalidSignalLine;
        cursor = std.mem.trim(u8, cursor[1..], " \t");

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
        cursor = std.mem.trim(u8, cursor[2..], " \t");

        if (!std.mem.startsWith(u8, cursor, "(")) return error.InvalidSignalLine;
        cursor = cursor[1..];
        const factor_sep = std.mem.indexOfScalar(u8, cursor, ',') orelse return error.InvalidSignalLine;
        const factor = try parseFiniteFloat(cursor[0..factor_sep]);
        cursor = cursor[factor_sep + 1 ..];
        const offset_sep = std.mem.indexOfScalar(u8, cursor, ')') orelse return error.InvalidSignalLine;
        const offset = try parseFiniteFloat(cursor[0..offset_sep]);
        cursor = std.mem.trim(u8, cursor[offset_sep + 1 ..], " \t");

        if (!std.mem.startsWith(u8, cursor, "[")) return error.InvalidSignalLine;
        cursor = cursor[1..];
        const min_sep = std.mem.indexOfScalar(u8, cursor, '|') orelse return error.InvalidSignalLine;
        const minimum = try parseFiniteFloat(cursor[0..min_sep]);
        cursor = cursor[min_sep + 1 ..];
        const max_sep = std.mem.indexOfScalar(u8, cursor, ']') orelse return error.InvalidSignalLine;
        const maximum = try parseFiniteFloat(cursor[0..max_sep]);
        cursor = std.mem.trim(u8, cursor[max_sep + 1 ..], " \t");

        const unit = quotes.parseQuoted(allocator, &cursor) catch |err| switch (err) {
            error.OutOfMemory => return err,
            else => return error.InvalidSignalLine,
        };
        var unit_owned = true;
        errdefer if (unit_owned) allocator.free(unit);
        cursor = std.mem.trim(u8, cursor, " \t\r");

        var receivers: std.ArrayList([]const u8) = .empty;
        errdefer receivers.deinit(allocator);
        var receiver_tokens = std.mem.tokenizeScalar(u8, cursor, ',');
        while (receiver_tokens.next()) |receiver| {
            try receivers.append(allocator, std.mem.trim(u8, receiver, " \t\r"));
        }

        const receiver_slice = try receivers.toOwnedSlice(allocator);
        unit_owned = false;

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
            .receivers = receiver_slice,
            .value_descriptions = null,
            .value_type = .integer,
            .unsupported_mux = unsupported_mux,
        };
    }

    /// Returns attached `VAL_` or `VAL_TABLE_` descriptions, if any.
    pub fn getValueDescriptions(self: Signal) ?[]const values.ValueDescription {
        return self.value_descriptions;
    }
};

/// Parses a DBC floating-point field and rejects non-finite values.
fn parseFiniteFloat(text: []const u8) !f64 {
    const value = try std.fmt.parseFloat(f64, text);
    if (!std.math.isFinite(value)) return error.NonFiniteSignalNumber;
    return value;
}

test "parse fixture signal line" {
    const allocator = std.testing.allocator;
    const sig = try Signal.fromString(allocator, " SG_ vehicle_speed : 0|16@1+ (0.1,0) [0|250] \"km/h\" Dashboard");
    defer allocator.free(sig.receivers);
    defer allocator.free(sig.unit);

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
    defer allocator.free(sig.unit);

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
    defer allocator.free(sig.unit);

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

test "reject signal line with non-finite factor" {
    const allocator = std.testing.allocator;
    try std.testing.expectError(error.NonFiniteSignalNumber, Signal.fromString(allocator, " SG_ vehicle_speed : 0|16@1+ (nan,0) [0|250] \"km/h\" Dashboard"));
}

test "reject signal line with overflowing maximum" {
    const allocator = std.testing.allocator;
    try std.testing.expectError(error.NonFiniteSignalNumber, Signal.fromString(allocator, " SG_ vehicle_speed : 0|16@1+ (1,0) [0|1e9999] \"km/h\" Dashboard"));
}

test "parse signal line with escaped unit" {
    const allocator = std.testing.allocator;
    const sig = try Signal.fromString(allocator, " SG_ status : 0|8@1+ (1,0) [0|1] \"State \\\"On\\\"\" Dashboard");
    defer allocator.free(sig.receivers);
    defer allocator.free(sig.unit);

    try std.testing.expectEqualStrings("State \"On\"", sig.unit);
    try std.testing.expectEqualStrings("Dashboard", sig.receivers[0]);
}
