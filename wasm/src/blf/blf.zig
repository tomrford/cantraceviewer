const std = @import("std");
const trace = @import("../trace/trace.zig");
const trace_frame = @import("../trace/frame.zig");

const file_header_parsed_size = 72;
const min_file_header_size = 144;

const obj_header_base_size = 16;
const obj_header_v1_size = 16;
const obj_header_v2_size = 24;
const log_container_size = 16;
const can_message_size = 16;
const can_error_ext_size = 32;
const can_fd_message_size = 84;
const can_fd_message_64_size = 40;

const can_message: u32 = 1;
const log_container: u32 = 10;
const can_error_ext: u32 = 73;
const can_message2: u32 = 86;
const can_fd_message: u32 = 100;
const can_fd_message_64: u32 = 101;

const no_compression: u16 = 0;
const zlib_deflate: u16 = 2;

const can_msg_ext: u32 = 0x8000_0000;
const remote_flag: u8 = 0x80;
const fd64_remote_flag: u32 = 0x0010;
const fd64_edl_flag: u32 = 0x1000;

const time_ten_mics: u32 = 0x0000_0001;
const time_one_nans: u32 = 0x0000_0002;

const Parser = struct {
    allocator: std.mem.Allocator,
    measurement_start_ms: ?i64,
    parsed_trace: trace.Trace = .{},
    frames: std.ArrayList(trace_frame.Frame) = .empty,
    payloads: std.ArrayList(u8) = .empty,
    tail: std.ArrayList(u8) = .empty,

    fn deinit(self: *Parser) void {
        self.frames.deinit(self.allocator);
        self.payloads.deinit(self.allocator);
        self.tail.deinit(self.allocator);
    }

    fn finish(self: *Parser) !trace.Trace {
        self.parsed_trace.measurement_start_ms = self.measurement_start_ms;
        self.parsed_trace.frames = try self.frames.toOwnedSlice(self.allocator);
        self.parsed_trace.payloads = try self.payloads.toOwnedSlice(self.allocator);
        return self.parsed_trace;
    }

    fn parseContainer(self: *Parser, container: []const u8) !void {
        var buffer = std.ArrayList(u8).empty;
        defer buffer.deinit(self.allocator);

        try buffer.ensureTotalCapacity(self.allocator, self.tail.items.len + container.len);
        try buffer.appendSlice(self.allocator, self.tail.items);
        try buffer.appendSlice(self.allocator, container);
        self.tail.clearRetainingCapacity();

        var pos: usize = 0;
        while (pos < buffer.items.len) {
            const search_start = pos;
            const object_start = findNextObject(buffer.items, pos) orelse {
                if (pos + 8 > buffer.items.len) {
                    try self.tail.appendSlice(self.allocator, buffer.items[search_start..]);
                    return;
                }
                return error.InvalidBlfObject;
            };

            if (object_start + obj_header_base_size > buffer.items.len) {
                try self.tail.appendSlice(self.allocator, buffer.items[search_start..]);
                return;
            }

            const header_size = readU16(buffer.items, object_start + 4);
            const header_version = readU16(buffer.items, object_start + 6);
            const object_size = readU32(buffer.items, object_start + 8);
            const object_type = readU32(buffer.items, object_start + 12);
            if (object_size < obj_header_base_size or header_size < obj_header_base_size) {
                return error.InvalidBlfObjectSize;
            }

            const object_end = object_start + object_size;
            if (object_end > buffer.items.len) {
                try self.tail.appendSlice(self.allocator, buffer.items[search_start..]);
                return;
            }

            var cursor = object_start + obj_header_base_size;
            const timestamp = switch (header_version) {
                1 => timestamp: {
                    if (cursor + obj_header_v1_size > object_end) return error.InvalidBlfObjectHeader;
                    const flags = readU32(buffer.items, cursor);
                    const raw_timestamp = readU64(buffer.items, cursor + 8);
                    cursor += obj_header_v1_size;
                    break :timestamp try timestampToNs(flags, raw_timestamp);
                },
                2 => timestamp: {
                    if (cursor + obj_header_v2_size > object_end) return error.InvalidBlfObjectHeader;
                    const flags = readU32(buffer.items, cursor);
                    const raw_timestamp = readU64(buffer.items, cursor + 8);
                    cursor += obj_header_v2_size;
                    break :timestamp try timestampToNs(flags, raw_timestamp);
                },
                else => {
                    pos = object_end + paddingSize(object_size);
                    if (pos > buffer.items.len) return error.TruncatedBlfObjectPadding;
                    continue;
                },
            };

            switch (object_type) {
                can_message, can_message2 => try self.parseCanMessage(buffer.items[cursor..object_end], timestamp),
                can_error_ext => try self.parseCanErrorExt(buffer.items[cursor..object_end], timestamp),
                can_fd_message => try self.parseCanFdMessage(buffer.items[cursor..object_end], timestamp),
                can_fd_message_64 => try self.parseCanFdMessage64(buffer.items[cursor..object_end], header_size, object_size, timestamp),
                else => {},
            }
            pos = object_end + paddingSize(object_size);
            if (pos > buffer.items.len) return error.TruncatedBlfObjectPadding;
        }
    }

    fn parseCanMessage(self: *Parser, body: []const u8, timestamp_ns: u64) !void {
        if (body.len < can_message_size) return error.InvalidBlfCanMessage;

        const flags = body[2];
        const dlc = body[3];
        const payload_len: u8 = @min(dlc, 8);
        const raw_id = readU32(body, 4);
        const id_value = raw_id & 0x1fff_ffff;
        const id = if ((raw_id & can_msg_ext) != 0)
            trace_frame.Id.extended(id_value)
        else
            trace_frame.Id.standard(@intCast(id_value));

        var stored: trace_frame.Frame = .{
            .timestamp_ns = timestamp_ns,
            .kind = if ((flags & remote_flag) != 0) .remote else .data,
            .id = id,
            .dlc = dlc,
            .payload_len = payload_len,
        };

        if (stored.kind == .data) {
            const payload_start = 8;
            const payload_offset = self.payloads.items.len;
            try self.payloads.appendSlice(self.allocator, body[payload_start .. payload_start + payload_len]);
            stored.payload_offset = @intCast(payload_offset);
            self.parsed_trace.data_frame_count += 1;
            self.parsed_trace.last_data_timestamp_ns = timestamp_ns;
        }
        try self.frames.append(self.allocator, stored);
    }

    fn parseCanErrorExt(self: *Parser, body: []const u8, timestamp_ns: u64) !void {
        if (body.len < can_error_ext_size) return error.InvalidBlfCanErrorExt;

        const dlc = body[10];
        const payload_len: u8 = @min(dlc, 8);
        const raw_id = readU32(body, 16);
        var stored: trace_frame.Frame = .{
            .timestamp_ns = timestamp_ns,
            .kind = .error_frame,
            .id = idFromRaw(raw_id),
            .dlc = dlc,
            .payload_len = payload_len,
        };
        try self.copyPayload(&stored, body[24 .. 24 + payload_len]);
        try self.frames.append(self.allocator, stored);
    }

    fn parseCanFdMessage(self: *Parser, body: []const u8, timestamp_ns: u64) !void {
        if (body.len < can_fd_message_size) return error.InvalidBlfCanFdMessage;

        const flags = body[2];
        const dlc = body[3];
        const raw_id = readU32(body, 4);
        const valid_bytes: u8 = @min(body[14], 64);
        var stored: trace_frame.Frame = .{
            .timestamp_ns = timestamp_ns,
            .kind = if ((flags & remote_flag) != 0) .remote else .data,
            .id = idFromRaw(raw_id),
            .is_fd = true,
            .dlc = dlc,
            .payload_len = valid_bytes,
        };
        if (stored.kind == .data) {
            try self.copyPayload(&stored, body[20 .. 20 + valid_bytes]);
            self.parsed_trace.data_frame_count += 1;
            self.parsed_trace.last_data_timestamp_ns = timestamp_ns;
        }
        try self.frames.append(self.allocator, stored);
    }

    fn parseCanFdMessage64(self: *Parser, body: []const u8, header_size: usize, object_size: usize, timestamp_ns: u64) !void {
        if (body.len < can_fd_message_64_size) return error.InvalidBlfCanFdMessage64;

        const dlc = body[1];
        const valid_bytes: u8 = @min(body[2], 64);
        const raw_id = readU32(body, 4);
        const flags = readU32(body, 12);
        const ext_data_offset = body[35];
        const data_field_end = if (ext_data_offset != 0) @as(usize, ext_data_offset) else object_size;
        const available_payload_len = data_field_end -| (header_size + can_fd_message_64_size);
        const copied_payload_len = @min(@as(usize, valid_bytes), @min(available_payload_len, body.len - can_fd_message_64_size));

        var stored: trace_frame.Frame = .{
            .timestamp_ns = timestamp_ns,
            .kind = if ((flags & fd64_remote_flag) != 0) .remote else .data,
            .id = idFromRaw(raw_id),
            .is_fd = (flags & fd64_edl_flag) != 0,
            .dlc = dlc,
            .payload_len = valid_bytes,
        };

        if (stored.kind == .data) {
            const payload_offset = self.payloads.items.len;
            try self.payloads.appendSlice(self.allocator, body[can_fd_message_64_size .. can_fd_message_64_size + copied_payload_len]);
            try self.payloads.appendNTimes(self.allocator, 0, valid_bytes - copied_payload_len);
            stored.payload_offset = @intCast(payload_offset);
            self.parsed_trace.data_frame_count += 1;
            self.parsed_trace.last_data_timestamp_ns = timestamp_ns;
        }
        try self.frames.append(self.allocator, stored);
    }

    fn copyPayload(self: *Parser, stored: *trace_frame.Frame, payload: []const u8) !void {
        const payload_offset = self.payloads.items.len;
        try self.payloads.appendSlice(self.allocator, payload);
        stored.payload_offset = @intCast(payload_offset);
    }
};

fn idFromRaw(raw_id: u32) trace_frame.Id {
    const id_value = raw_id & 0x1fff_ffff;
    return if ((raw_id & can_msg_ext) != 0)
        trace_frame.Id.extended(id_value)
    else
        trace_frame.Id.standard(@intCast(id_value));
}

pub fn fromBytes(allocator: std.mem.Allocator, bytes: []const u8) !trace.Trace {
    if (bytes.len < file_header_parsed_size) return error.InvalidBlfHeader;
    if (!std.mem.eql(u8, bytes[0..4], "LOGG")) return error.InvalidBlfSignature;

    const header_size = readU32(bytes, 4);
    if (header_size < file_header_parsed_size or header_size > bytes.len) return error.InvalidBlfHeaderSize;

    var parser: Parser = .{
        .allocator = allocator,
        .measurement_start_ms = parseSystemTimeToUnixMs(bytes[40..56]) catch null,
    };
    errdefer {
        parser.parsed_trace.deinit(allocator);
        parser.deinit();
    }

    var pos: usize = @intCast(header_size);
    while (pos < bytes.len) {
        if (pos + obj_header_base_size > bytes.len) return error.TruncatedBlfObjectHeader;
        if (!std.mem.eql(u8, bytes[pos .. pos + 4], "LOBJ")) return error.InvalidBlfObject;

        const object_size = readU32(bytes, pos + 8);
        const object_type = readU32(bytes, pos + 12);
        if (object_size < obj_header_base_size) return error.InvalidBlfObjectSize;
        const object_end = pos + object_size;
        if (object_end > bytes.len) return error.TruncatedBlfObject;

        if (object_type == log_container) {
            const object_body = bytes[pos + obj_header_base_size .. object_end];
            const container = try decodeContainer(allocator, object_body);
            defer if (container.owned) allocator.free(container.bytes);
            try parser.parseContainer(container.bytes);
        }

        pos = object_end + paddingSize(object_size);
        if (pos > bytes.len) return error.TruncatedBlfObjectPadding;
    }

    if (parser.tail.items.len != 0) return error.TruncatedBlfObject;
    const parsed = try parser.finish();
    parser.deinit();
    return parsed;
}

const ContainerBytes = struct {
    bytes: []const u8,
    owned: bool = false,
};

fn decodeContainer(allocator: std.mem.Allocator, object_body: []const u8) !ContainerBytes {
    if (object_body.len < log_container_size) return error.InvalidBlfContainer;
    const method = readU16(object_body, 0);
    const uncompressed_size = readU32(object_body, 8);
    const payload = object_body[log_container_size..];

    return switch (method) {
        no_compression => .{ .bytes = payload },
        zlib_deflate => .{ .bytes = try inflateZlib(allocator, payload, uncompressed_size), .owned = true },
        else => error.UnsupportedBlfCompression,
    };
}

fn inflateZlib(allocator: std.mem.Allocator, compressed: []const u8, expected_len: usize) ![]u8 {
    const output = try allocator.alloc(u8, expected_len);
    errdefer allocator.free(output);

    var reader: std.Io.Reader = .fixed(compressed);
    var buffer: [std.compress.flate.max_window_len]u8 = undefined;
    var inflate: std.compress.flate.Decompress = .init(&reader, .zlib, &buffer);
    var writer: std.Io.Writer = .fixed(output);
    const written = try inflate.reader.streamRemaining(&writer);
    if (written != expected_len) return error.InvalidBlfContainerSize;
    return output;
}

fn timestampToNs(flags: u32, raw_timestamp: u64) !u64 {
    if ((flags & time_one_nans) != 0) return raw_timestamp;
    if ((flags & time_ten_mics) != 0) return std.math.mul(u64, raw_timestamp, 10_000);
    return raw_timestamp;
}

fn findNextObject(bytes: []const u8, start: usize) ?usize {
    var pos = start;
    const end = @min(start + 8, bytes.len);
    while (pos + 4 <= end) : (pos += 1) {
        if (std.mem.eql(u8, bytes[pos .. pos + 4], "LOBJ")) return pos;
    }
    return null;
}

fn paddingSize(size: usize) usize {
    return size % 4;
}

fn readU16(bytes: []const u8, offset: usize) u16 {
    return std.mem.readInt(u16, bytes[offset..][0..2], .little);
}

fn readU32(bytes: []const u8, offset: usize) u32 {
    return std.mem.readInt(u32, bytes[offset..][0..4], .little);
}

fn readU64(bytes: []const u8, offset: usize) u64 {
    return std.mem.readInt(u64, bytes[offset..][0..8], .little);
}

fn parseSystemTimeToUnixMs(bytes: []const u8) !i64 {
    const year = readU16(bytes, 0);
    const month = readU16(bytes, 2);
    const day = readU16(bytes, 6);
    const hour = readU16(bytes, 8);
    const minute = readU16(bytes, 10);
    const second = readU16(bytes, 12);
    const millisecond = readU16(bytes, 14);
    if (year == 0 or month == 0 or day == 0) return error.InvalidSystemTime;
    if (month > 12 or day > 31 or hour > 23 or minute > 59 or second > 59 or millisecond > 999) {
        return error.InvalidSystemTime;
    }

    const days = daysFromCivil(@intCast(year), @intCast(month), @intCast(day));
    const seconds = try std.math.add(i64, try std.math.mul(i64, days, std.time.s_per_day), @as(i64, hour) * std.time.s_per_hour + @as(i64, minute) * std.time.s_per_min + @as(i64, second));
    return try std.math.add(i64, try std.math.mul(i64, seconds, std.time.ms_per_s), millisecond);
}

fn daysFromCivil(year_value: i32, month_value: u8, day_value: u8) i64 {
    var year = @as(i64, year_value);
    const month = @as(i64, month_value);
    const day = @as(i64, day_value);

    year -= if (month <= 2) 1 else 0;
    const era = @divFloor(year, 400);
    const year_of_era = year - era * 400;
    const month_prime = month + if (month > 2) @as(i64, -3) else @as(i64, 9);
    const day_of_year = @divFloor(153 * month_prime + 2, 5) + day - 1;
    const day_of_era = year_of_era * 365 + @divFloor(year_of_era, 4) - @divFloor(year_of_era, 100) + day_of_year;
    return era * 146097 + day_of_era - 719468;
}

fn appendFileHeader(bytes: *std.ArrayList(u8), allocator: std.mem.Allocator) !void {
    try bytes.appendSlice(allocator, "LOGG");
    try appendU32(bytes, allocator, min_file_header_size);
    try bytes.appendNTimes(allocator, 0, 32);
    try appendSystemTime(bytes, allocator, 2026, 5, 11, 10, 20, 30, 400);
    try bytes.appendNTimes(allocator, 0, min_file_header_size - bytes.items.len);
}

fn appendSystemTime(bytes: *std.ArrayList(u8), allocator: std.mem.Allocator, year: u16, month: u16, day: u16, hour: u16, minute: u16, second: u16, millisecond: u16) !void {
    try appendU16(bytes, allocator, year);
    try appendU16(bytes, allocator, month);
    try appendU16(bytes, allocator, 0);
    try appendU16(bytes, allocator, day);
    try appendU16(bytes, allocator, hour);
    try appendU16(bytes, allocator, minute);
    try appendU16(bytes, allocator, second);
    try appendU16(bytes, allocator, millisecond);
}

fn appendOuterContainer(bytes: *std.ArrayList(u8), allocator: std.mem.Allocator, payload: []const u8) !void {
    const object_size = obj_header_base_size + log_container_size + payload.len;
    try appendObjectBase(bytes, allocator, object_size, log_container, obj_header_base_size);
    try appendU16(bytes, allocator, no_compression);
    try bytes.appendNTimes(allocator, 0, 6);
    try appendU32(bytes, allocator, @intCast(payload.len));
    try bytes.appendNTimes(allocator, 0, 4);
    try bytes.appendSlice(allocator, payload);
    try bytes.appendNTimes(allocator, 0, paddingSize(object_size));
}

fn appendClassicCanObject(bytes: *std.ArrayList(u8), allocator: std.mem.Allocator, timestamp_ns: u64, can_id: u32, payload: []const u8) !void {
    const header_size = obj_header_base_size + obj_header_v1_size;
    const object_size = header_size + can_message_size;
    try appendObjectBase(bytes, allocator, object_size, can_message, header_size);
    try appendU32(bytes, allocator, time_one_nans);
    try appendU16(bytes, allocator, 0);
    try appendU16(bytes, allocator, 0);
    try appendU64(bytes, allocator, timestamp_ns);
    try appendU16(bytes, allocator, 1);
    try bytes.append(allocator, 0);
    try bytes.append(allocator, @intCast(payload.len));
    try appendU32(bytes, allocator, can_id);
    try bytes.appendSlice(allocator, payload);
    try bytes.appendNTimes(allocator, 0, 8 - payload.len);
}

fn appendCanErrorExtObject(bytes: *std.ArrayList(u8), allocator: std.mem.Allocator, timestamp_ns: u64, can_id: u32, payload: []const u8) !void {
    const header_size = obj_header_base_size + obj_header_v1_size;
    const object_size = header_size + can_error_ext_size;
    try appendObjectBase(bytes, allocator, object_size, can_error_ext, header_size);
    try appendObjectTimestampV1(bytes, allocator, timestamp_ns);
    try appendU16(bytes, allocator, 1);
    try appendU16(bytes, allocator, 0);
    try appendU32(bytes, allocator, 0);
    try bytes.append(allocator, 0);
    try bytes.append(allocator, 0);
    try bytes.append(allocator, @intCast(payload.len));
    try bytes.append(allocator, 0);
    try appendU32(bytes, allocator, 0);
    try appendU32(bytes, allocator, can_id);
    try appendU16(bytes, allocator, 0);
    try bytes.appendNTimes(allocator, 0, 2);
    try bytes.appendSlice(allocator, payload);
    try bytes.appendNTimes(allocator, 0, 8 - payload.len);
}

fn appendCanFdMessageObject(bytes: *std.ArrayList(u8), allocator: std.mem.Allocator, timestamp_ns: u64, can_id: u32, dlc: u8, payload: []const u8) !void {
    const header_size = obj_header_base_size + obj_header_v1_size;
    const object_size = header_size + can_fd_message_size;
    try appendObjectBase(bytes, allocator, object_size, can_fd_message, header_size);
    try appendObjectTimestampV1(bytes, allocator, timestamp_ns);
    try appendU16(bytes, allocator, 1);
    try bytes.append(allocator, 0);
    try bytes.append(allocator, dlc);
    try appendU32(bytes, allocator, can_id);
    try appendU32(bytes, allocator, 0);
    try bytes.append(allocator, 0);
    try bytes.append(allocator, 0x07);
    try bytes.append(allocator, @intCast(payload.len));
    try bytes.appendNTimes(allocator, 0, 5);
    try bytes.appendSlice(allocator, payload);
    try bytes.appendNTimes(allocator, 0, 64 - payload.len);
}

fn appendCanFdMessage64Object(bytes: *std.ArrayList(u8), allocator: std.mem.Allocator, timestamp_ns: u64, can_id: u32, dlc: u8, valid_bytes: u8, payload: []const u8) !void {
    const header_size = obj_header_base_size + obj_header_v1_size;
    const object_size = header_size + can_fd_message_64_size + payload.len;
    try appendObjectBase(bytes, allocator, object_size, can_fd_message_64, header_size);
    try appendObjectTimestampV1(bytes, allocator, timestamp_ns);
    try bytes.append(allocator, 1);
    try bytes.append(allocator, dlc);
    try bytes.append(allocator, valid_bytes);
    try bytes.append(allocator, 0);
    try appendU32(bytes, allocator, can_id);
    try appendU32(bytes, allocator, 0);
    try appendU32(bytes, allocator, fd64_edl_flag);
    try appendU32(bytes, allocator, 0);
    try appendU32(bytes, allocator, 0);
    try appendU32(bytes, allocator, 0);
    try appendU32(bytes, allocator, 0);
    try appendU16(bytes, allocator, 0);
    try bytes.append(allocator, 0);
    try bytes.append(allocator, 0);
    try appendU32(bytes, allocator, 0);
    try bytes.appendSlice(allocator, payload);
    try bytes.appendNTimes(allocator, 0, paddingSize(object_size));
}

fn appendObjectTimestampV1(bytes: *std.ArrayList(u8), allocator: std.mem.Allocator, timestamp_ns: u64) !void {
    try appendU32(bytes, allocator, time_one_nans);
    try appendU16(bytes, allocator, 0);
    try appendU16(bytes, allocator, 0);
    try appendU64(bytes, allocator, timestamp_ns);
}

fn appendObjectBase(bytes: *std.ArrayList(u8), allocator: std.mem.Allocator, object_size: usize, object_type: u32, header_size: usize) !void {
    try bytes.appendSlice(allocator, "LOBJ");
    try appendU16(bytes, allocator, @intCast(header_size));
    try appendU16(bytes, allocator, 1);
    try appendU32(bytes, allocator, @intCast(object_size));
    try appendU32(bytes, allocator, object_type);
}

fn appendU16(bytes: *std.ArrayList(u8), allocator: std.mem.Allocator, value: u16) !void {
    var raw: [2]u8 = undefined;
    std.mem.writeInt(u16, &raw, value, .little);
    try bytes.appendSlice(allocator, &raw);
}

fn appendU32(bytes: *std.ArrayList(u8), allocator: std.mem.Allocator, value: u32) !void {
    var raw: [4]u8 = undefined;
    std.mem.writeInt(u32, &raw, value, .little);
    try bytes.appendSlice(allocator, &raw);
}

fn appendU64(bytes: *std.ArrayList(u8), allocator: std.mem.Allocator, value: u64) !void {
    var raw: [8]u8 = undefined;
    std.mem.writeInt(u64, &raw, value, .little);
    try bytes.appendSlice(allocator, &raw);
}

test "parses uncompressed classic CAN BLF container" {
    const allocator = std.testing.allocator;
    var inner: std.ArrayList(u8) = .empty;
    defer inner.deinit(allocator);
    try appendClassicCanObject(&inner, allocator, 123_456_789, 0x123, &.{ 0xaa, 0xbb });

    var file: std.ArrayList(u8) = .empty;
    defer file.deinit(allocator);
    try appendFileHeader(&file, allocator);
    try appendOuterContainer(&file, allocator, inner.items);

    var parsed = try fromBytes(allocator, file.items);
    defer parsed.deinit(allocator);

    try std.testing.expectEqual(@as(i64, 1_778_494_830_400), parsed.measurement_start_ms.?);
    try std.testing.expectEqual(@as(usize, 1), parsed.frames.len);
    try std.testing.expectEqual(@as(usize, 1), parsed.data_frame_count);
    try std.testing.expectEqual(@as(u64, 123_456_789), parsed.frames[0].timestamp_ns);
    try std.testing.expectEqual(trace_frame.Id.standard(0x123), parsed.frames[0].id.?);
    try std.testing.expectEqualSlices(u8, &.{ 0xaa, 0xbb }, parsed.payloads);
}

test "carries an inner object split across containers" {
    const allocator = std.testing.allocator;
    var inner: std.ArrayList(u8) = .empty;
    defer inner.deinit(allocator);
    try appendClassicCanObject(&inner, allocator, 10_000, can_msg_ext | 0x18fee900, &.{0xcc});

    var file: std.ArrayList(u8) = .empty;
    defer file.deinit(allocator);
    try appendFileHeader(&file, allocator);
    try appendOuterContainer(&file, allocator, inner.items[0..20]);
    try appendOuterContainer(&file, allocator, inner.items[20..]);

    var parsed = try fromBytes(allocator, file.items);
    defer parsed.deinit(allocator);

    try std.testing.expectEqual(@as(usize, 1), parsed.frames.len);
    try std.testing.expectEqual(trace_frame.Id.extended(0x18fee900), parsed.frames[0].id.?);
    try std.testing.expectEqual(@as(u8, 0xcc), parsed.payloads[0]);
}

test "rejects unsupported container compression" {
    const allocator = std.testing.allocator;
    var file: std.ArrayList(u8) = .empty;
    defer file.deinit(allocator);
    try appendFileHeader(&file, allocator);
    try appendObjectBase(&file, allocator, obj_header_base_size + log_container_size, log_container, obj_header_base_size);
    try appendU16(&file, allocator, 99);
    try file.appendNTimes(allocator, 0, 14);

    try std.testing.expectError(error.UnsupportedBlfCompression, fromBytes(allocator, file.items));
}

test "parses remaining BLF CAN frame object types" {
    const allocator = std.testing.allocator;
    var inner: std.ArrayList(u8) = .empty;
    defer inner.deinit(allocator);
    try appendCanErrorExtObject(&inner, allocator, 1_000, can_msg_ext | 0x19999999, &.{ 0xcc, 0xdd });
    try appendCanFdMessageObject(&inner, allocator, 2_000, 0x123, 9, &.{ 0x10, 0x20, 0x30, 0x40 });
    try appendCanFdMessage64Object(&inner, allocator, 3_000, 0x456, 15, 64, &.{ 0xaa, 0xbb });

    var file: std.ArrayList(u8) = .empty;
    defer file.deinit(allocator);
    try appendFileHeader(&file, allocator);
    try appendOuterContainer(&file, allocator, inner.items);

    var parsed = try fromBytes(allocator, file.items);
    defer parsed.deinit(allocator);

    try std.testing.expectEqual(@as(usize, 3), parsed.frames.len);
    try std.testing.expectEqual(@as(usize, 2), parsed.data_frame_count);
    try std.testing.expectEqual(trace_frame.Kind.error_frame, parsed.frames[0].kind);
    try std.testing.expectEqual(trace_frame.Id.extended(0x19999999), parsed.frames[0].id.?);
    try std.testing.expectEqual(@as(u8, 2), parsed.frames[0].payload_len);

    try std.testing.expect(parsed.frames[1].is_fd);
    try std.testing.expectEqual(@as(u8, 9), parsed.frames[1].dlc);
    try std.testing.expectEqual(@as(u8, 4), parsed.frames[1].payload_len);

    try std.testing.expect(parsed.frames[2].is_fd);
    try std.testing.expectEqual(@as(u8, 15), parsed.frames[2].dlc);
    try std.testing.expectEqual(@as(u8, 64), parsed.frames[2].payload_len);
    const fd64_payload = parsed.payloads[parsed.frames[2].payload_offset..][0..parsed.frames[2].payload_len];
    try std.testing.expectEqual(@as(u8, 0xaa), fd64_payload[0]);
    try std.testing.expectEqual(@as(u8, 0xbb), fd64_payload[1]);
    try std.testing.expectEqual(@as(u8, 0), fd64_payload[63]);
}

test "ignores trailing inner object padding" {
    const allocator = std.testing.allocator;
    var inner: std.ArrayList(u8) = .empty;
    defer inner.deinit(allocator);
    try appendCanFdMessage64Object(&inner, allocator, 4_000, 0x456, 9, 12, &.{ 0xaa, 0xbb });

    var file: std.ArrayList(u8) = .empty;
    defer file.deinit(allocator);
    try appendFileHeader(&file, allocator);
    try appendOuterContainer(&file, allocator, inner.items);

    var parsed = try fromBytes(allocator, file.items);
    defer parsed.deinit(allocator);

    try std.testing.expectEqual(@as(usize, 1), parsed.frames.len);
    try std.testing.expectEqual(@as(u8, 12), parsed.frames[0].payload_len);
    const payload = parsed.payloads[parsed.frames[0].payload_offset..][0..parsed.frames[0].payload_len];
    try std.testing.expectEqual(@as(u8, 0xaa), payload[0]);
    try std.testing.expectEqual(@as(u8, 0), payload[11]);
}
