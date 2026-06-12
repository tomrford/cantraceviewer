const std = @import("std");

const min_file_header_size = 144;

const obj_header_base_size = 16;
const obj_header_v1_size = 16;
const log_container_size = 16;
const can_message_size = 16;
const can_error_ext_size = 32;
const can_fd_message_size = 84;
const can_fd_message_64_size = 40;

const can_message: u32 = 1;
const log_container: u32 = 10;
const can_error_ext: u32 = 73;
const can_fd_message: u32 = 100;
const can_fd_message_64: u32 = 101;

const no_compression: u16 = 0;
const fd64_edl_flag: u32 = 0x1000;
const time_one_nans: u32 = 0x0000_0002;

pub fn appendFileHeader(bytes: *std.ArrayList(u8), allocator: std.mem.Allocator) !void {
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

pub fn appendOuterContainer(bytes: *std.ArrayList(u8), allocator: std.mem.Allocator, payload: []const u8) !void {
    const object_size = obj_header_base_size + log_container_size + payload.len;
    try appendObjectBase(bytes, allocator, object_size, log_container, obj_header_base_size);
    try appendU16(bytes, allocator, no_compression);
    try bytes.appendNTimes(allocator, 0, 6);
    try appendU32(bytes, allocator, @intCast(payload.len));
    try bytes.appendNTimes(allocator, 0, 4);
    try bytes.appendSlice(allocator, payload);
    try bytes.appendNTimes(allocator, 0, paddingSize(object_size));
}

pub fn appendClassicCanObject(bytes: *std.ArrayList(u8), allocator: std.mem.Allocator, timestamp_ns: u64, can_id: u32, payload: []const u8) !void {
    try appendClassicCanObjectWithTimestampFlags(bytes, allocator, time_one_nans, timestamp_ns, can_id, payload);
}

pub fn appendClassicCanObjectWithTimestampFlags(bytes: *std.ArrayList(u8), allocator: std.mem.Allocator, timestamp_flags: u32, raw_timestamp: u64, can_id: u32, payload: []const u8) !void {
    const header_size = obj_header_base_size + obj_header_v1_size;
    const object_size = header_size + can_message_size;
    try appendObjectBase(bytes, allocator, object_size, can_message, header_size);
    try appendU32(bytes, allocator, timestamp_flags);
    try appendU16(bytes, allocator, 0);
    try appendU16(bytes, allocator, 0);
    try appendU64(bytes, allocator, raw_timestamp);
    try appendU16(bytes, allocator, 1);
    try bytes.append(allocator, 0);
    try bytes.append(allocator, @intCast(payload.len));
    try appendU32(bytes, allocator, can_id);
    try bytes.appendSlice(allocator, payload);
    try bytes.appendNTimes(allocator, 0, 8 - payload.len);
}

pub fn appendCanErrorExtObject(bytes: *std.ArrayList(u8), allocator: std.mem.Allocator, timestamp_ns: u64, can_id: u32, payload: []const u8) !void {
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

pub fn appendCanFdMessageObject(bytes: *std.ArrayList(u8), allocator: std.mem.Allocator, timestamp_ns: u64, can_id: u32, dlc: u8, payload: []const u8) !void {
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

pub fn appendCanFdMessage64Object(bytes: *std.ArrayList(u8), allocator: std.mem.Allocator, timestamp_ns: u64, can_id: u32, dlc: u8, valid_bytes: u8, payload: []const u8) !void {
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
}

pub fn appendUnknownTimedObject(bytes: *std.ArrayList(u8), allocator: std.mem.Allocator, object_type: u32, timestamp_ns: u64, body_len: usize) !void {
    const header_size = obj_header_base_size + obj_header_v1_size;
    const object_size = header_size + body_len;
    try appendObjectBase(bytes, allocator, object_size, object_type, header_size);
    try appendObjectTimestampV1(bytes, allocator, timestamp_ns);
    try bytes.appendNTimes(allocator, 0, body_len);
    try bytes.appendNTimes(allocator, 0, paddingSize(object_size));
}

fn appendObjectTimestampV1(bytes: *std.ArrayList(u8), allocator: std.mem.Allocator, timestamp_ns: u64) !void {
    try appendU32(bytes, allocator, time_one_nans);
    try appendU16(bytes, allocator, 0);
    try appendU16(bytes, allocator, 0);
    try appendU64(bytes, allocator, timestamp_ns);
}

pub fn appendObjectBase(bytes: *std.ArrayList(u8), allocator: std.mem.Allocator, object_size: usize, object_type: u32, header_size: usize) !void {
    try bytes.appendSlice(allocator, "LOBJ");
    try appendU16(bytes, allocator, @intCast(header_size));
    try appendU16(bytes, allocator, 1);
    try appendU32(bytes, allocator, @intCast(object_size));
    try appendU32(bytes, allocator, object_type);
}

pub fn appendU16(bytes: *std.ArrayList(u8), allocator: std.mem.Allocator, value: u16) !void {
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

fn paddingSize(size: usize) usize {
    return size % 4;
}
