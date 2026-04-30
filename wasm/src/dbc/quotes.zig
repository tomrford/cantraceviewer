//! Quoted-string parsing for DBC records.
//!
//! DBC uses quoted fields for units and value-description labels. This module
//! consumes one quoted field and leaves the caller's cursor at the next byte.

const std = @import("std");

/// Parses one quoted string, including escaped bytes, and advances `cursor`.
pub fn parseQuoted(allocator: std.mem.Allocator, cursor: *[]const u8) ![]const u8 {
    if (!std.mem.startsWith(u8, cursor.*, "\"")) return error.InvalidQuotedString;
    cursor.* = cursor.*[1..];

    var out: std.ArrayList(u8) = .empty;
    errdefer out.deinit(allocator);

    while (cursor.*.len > 0) {
        const byte = cursor.*[0];
        cursor.* = cursor.*[1..];

        if (byte == '"') {
            return out.toOwnedSlice(allocator);
        }

        if (byte == '\\') {
            if (cursor.*.len == 0) return error.InvalidQuotedString;
            try out.append(allocator, cursor.*[0]);
            cursor.* = cursor.*[1..];
            continue;
        }

        try out.append(allocator, byte);
    }

    return error.InvalidQuotedString;
}

test "parse quoted string" {
    const allocator = std.testing.allocator;
    var cursor: []const u8 = "\"km/h\" Receiver";

    const parsed = try parseQuoted(allocator, &cursor);
    defer allocator.free(parsed);

    try std.testing.expectEqualStrings("km/h", parsed);
    try std.testing.expectEqualStrings(" Receiver", cursor);
}

test "parse escaped quoted string" {
    const allocator = std.testing.allocator;
    var cursor: []const u8 = "\"State \\\"On\\\" \\\\ A\" tail";

    const parsed = try parseQuoted(allocator, &cursor);
    defer allocator.free(parsed);

    try std.testing.expectEqualStrings("State \"On\" \\ A", parsed);
    try std.testing.expectEqualStrings(" tail", cursor);
}
