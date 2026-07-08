//! JSON result envelopes for fallible WebAssembly exports.

const std = @import("std");
const abi = @import("abi.zig");

pub fn successHandleWithRawJson(
    allocator: std.mem.Allocator,
    handle: usize,
    raw_field: []const u8,
    raw_json: []const u8,
) !*abi.OwnedBytes {
    var out: std.Io.Writer.Allocating = .init(allocator);
    errdefer out.deinit();

    var writer: std.json.Stringify = .{ .writer = &out.writer };
    try writer.beginObject();
    try writer.objectField("ok");
    try writer.write(true);
    try writer.objectField("handle");
    try writer.write(handle);
    try writer.objectField(raw_field);
    try writeRawJson(&writer, raw_json);
    try writer.endObject();

    return abi.OwnedBytes.fromOwnedSlice(try out.toOwnedSlice());
}

pub fn successValues(allocator: std.mem.Allocator, values: usize) !*abi.OwnedBytes {
    var out: std.Io.Writer.Allocating = .init(allocator);
    errdefer out.deinit();

    var writer: std.json.Stringify = .{ .writer = &out.writer };
    try writer.beginObject();
    try writer.objectField("ok");
    try writer.write(true);
    try writer.objectField("values");
    try writer.write(values);
    try writer.endObject();

    return abi.OwnedBytes.fromOwnedSlice(try out.toOwnedSlice());
}

pub fn failure(allocator: std.mem.Allocator, err: anyerror) ?*abi.OwnedBytes {
    return failureWithMessage(allocator, err, messageFor(err)) catch null;
}

pub fn failureWithMessage(
    allocator: std.mem.Allocator,
    err: anyerror,
    message: []const u8,
) !*abi.OwnedBytes {
    var out: std.Io.Writer.Allocating = .init(allocator);
    errdefer out.deinit();

    var writer: std.json.Stringify = .{ .writer = &out.writer };
    try writer.beginObject();
    try writer.objectField("ok");
    try writer.write(false);
    try writer.objectField("code");
    try writer.write(@errorName(err));
    try writer.objectField("message");
    try writer.write(message);
    try writer.endObject();

    return abi.OwnedBytes.fromOwnedSlice(try out.toOwnedSlice());
}

fn writeRawJson(writer: *std.json.Stringify, json: []const u8) !void {
    try writer.beginWriteRaw();
    try writer.writer.writeAll(json);
    writer.endWriteRaw();
}

fn messageFor(err: anyerror) []const u8 {
    return switch (err) {
        error.OutOfMemory => "Out of memory",
        error.InvalidHandle => "Invalid handle",
        error.SignalNotFound => "Signal not found in DBC",
        else => @errorName(err),
    };
}

test "serializes failure envelope" {
    const bytes = try failureWithMessage(abi.allocator, error.SignalNotFound, "Signal not found in DBC");
    defer bytes.deinit();

    try std.testing.expect(std.mem.indexOf(u8, bytes.slice(), "\"ok\":false") != null);
    try std.testing.expect(std.mem.indexOf(u8, bytes.slice(), "\"code\":\"SignalNotFound\"") != null);
}
