//! DBC message line parsing.
//!
//! Handles `BO_` records and derives the CAN identifier fields used for trace
//! matching.

const std = @import("std");
const signal = @import("signal.zig");

const DBC_WHITESPACE = " \t\r";

/// DBC encodes extended CAN IDs by setting bit 31 in the message ID.
const EXTENDED_FLAG: u32 = 0x8000_0000;

/// CAN 2.0B extended identifiers use the low 29 bits.
const EXTENDED_MASK: u32 = 0x1FFF_FFFF;

/// Parsed `BO_` message definition.
pub const Message = struct {
    /// Raw DBC message ID as written in the file.
    dbc_id: u32,

    /// CAN arbitration ID with the DBC extended-frame flag removed.
    can_id: u32,

    is_extended: bool,
    is_fd: bool,
    name: []const u8,
    size_bytes: u8,
    transmitter: []const u8,
    signals: []signal.Signal,

    /// Parses one `BO_ <id> <name>: <size> <transmitter>` line.
    pub fn fromString(line: []const u8) !Message {
        var tokens = std.mem.tokenizeAny(u8, std.mem.trim(u8, line, DBC_WHITESPACE), DBC_WHITESPACE);

        const prefix = tokens.next() orelse return error.InvalidMessageLine;
        if (!std.mem.eql(u8, prefix, "BO_")) return error.InvalidMessageLine;

        const dbc_id_text = tokens.next() orelse return error.InvalidMessageLine;
        const name_text = tokens.next() orelse return error.InvalidMessageLine;
        const size_text = tokens.next() orelse return error.InvalidMessageLine;
        const transmitter = tokens.next() orelse return error.InvalidMessageLine;

        if (name_text.len == 0 or name_text[name_text.len - 1] != ':') return error.InvalidMessageLine;

        const dbc_id = try std.fmt.parseInt(u32, dbc_id_text, 10);
        const size_bytes = try std.fmt.parseInt(u8, size_text, 10);
        const is_extended = (dbc_id & EXTENDED_FLAG) != 0;

        return .{
            .dbc_id = dbc_id,
            .can_id = if (is_extended) dbc_id & EXTENDED_MASK else dbc_id,
            .is_extended = is_extended,
            .is_fd = size_bytes > 8,
            .name = name_text[0 .. name_text.len - 1],
            .size_bytes = size_bytes,
            .transmitter = transmitter,
            .signals = &.{},
        };
    }
};

test "parse fixture message line" {
    const msg = try Message.fromString("BO_ 288 PowertrainStatus: 8 Agent");

    try std.testing.expectEqual(@as(u32, 288), msg.dbc_id);
    try std.testing.expectEqual(@as(u32, 288), msg.can_id);
    try std.testing.expect(!msg.is_extended);
    try std.testing.expect(!msg.is_fd);
    try std.testing.expectEqualStrings("PowertrainStatus", msg.name);
    try std.testing.expectEqual(@as(u8, 8), msg.size_bytes);
    try std.testing.expectEqualStrings("Agent", msg.transmitter);
    try std.testing.expectEqual(@as(usize, 0), msg.signals.len);
}

test "parse message line separated by tabs" {
    const msg = try Message.fromString("BO_\t288\tPowertrainStatus:\t8\tAgent");

    try std.testing.expectEqual(@as(u32, 288), msg.dbc_id);
    try std.testing.expectEqualStrings("PowertrainStatus", msg.name);
    try std.testing.expectEqual(@as(u8, 8), msg.size_bytes);
    try std.testing.expectEqualStrings("Agent", msg.transmitter);
}

test "parse fixture extended message line" {
    const msg = try Message.fromString("BO_ 2147483650 ext_MUX_multiplexors: 7 Vector__XXX");

    try std.testing.expectEqual(@as(u32, 2147483650), msg.dbc_id);
    try std.testing.expectEqual(@as(u32, 2), msg.can_id);
    try std.testing.expect(msg.is_extended);
    try std.testing.expect(!msg.is_fd);
    try std.testing.expectEqualStrings("ext_MUX_multiplexors", msg.name);
    try std.testing.expectEqual(@as(u8, 7), msg.size_bytes);
    try std.testing.expectEqualStrings("Vector__XXX", msg.transmitter);
}

test "message larger than eight bytes is marked FD" {
    const msg = try Message.fromString("BO_ 512 LargePayload: 12 ECU");

    try std.testing.expect(msg.is_fd);
    try std.testing.expectEqual(@as(u8, 12), msg.size_bytes);
}

test "reject message line without BO prefix" {
    try std.testing.expectError(error.InvalidMessageLine, Message.fromString("SG_ Speed : 0|8@1+ (1,0) [0|0] \"\" ECU"));
}

test "reject message line without name colon" {
    try std.testing.expectError(error.InvalidMessageLine, Message.fromString("BO_ 288 PowertrainStatus 8 Agent"));
}

test "reject message line with non-numeric id" {
    try std.testing.expectError(error.InvalidCharacter, Message.fromString("BO_ nope PowertrainStatus: 8 Agent"));
}
