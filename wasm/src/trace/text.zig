const std = @import("std");

/// Returns the remainder of a string when the prefix is present.
pub fn stripPrefix(text: []const u8, prefix: []const u8) ?[]const u8 {
    if (!std.mem.startsWith(u8, text, prefix)) return null;
    return text[prefix.len..];
}
