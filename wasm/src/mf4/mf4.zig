const std = @import("std");
const trace = @import("../trace/trace.zig");
const trace_frame = @import("../trace/frame.zig");

const id_block_size = 64;
const common_header_size = 24;
const max_dz_uncompressed_size = 500 * 1024 * 1024;

const flag_cg_bus_event: u16 = 0x0002;
const source_bus: u8 = 2;
const bus_type_can: u8 = 2;

const channel_type_master: u8 = 2;
const sync_type_time: u8 = 1;
const data_type_uint_le: u8 = 0;
const data_type_float_le: u8 = 4;
const data_type_byte_array: u8 = 10;

const Block = struct {
    id: *const [4]u8,
    offset: usize,
    length: usize,
    link_count: usize,
    data_offset: usize,
    data_end: usize,

    fn link(self: Block, bytes: []const u8, index: usize) u64 {
        std.debug.assert(index < self.link_count);
        return readU64(bytes, self.offset + common_header_size + index * 8);
    }
};

const Channel = struct {
    name: []const u8,
    channel_type: u8,
    sync_type: u8,
    data_type: u8,
    byte_offset: u32,
    bit_offset: u8,
    bit_count: u32,
};

const Group = struct {
    kind: trace_frame.Kind,
    record_id: u64,
    cycles: usize,
    sample_size: usize,
    record_size: usize,
    data_addr: u64,
    time: ?Channel = null,
    id: ?Channel = null,
    ide: ?Channel = null,
    dlc: ?Channel = null,
    data_length: ?Channel = null,
    data_bytes: ?Channel = null,
    edl: ?Channel = null,
};

const Parser = struct {
    allocator: std.mem.Allocator,
    bytes: []const u8,
    parsed_trace: trace.Trace = .{},
    frames: std.ArrayList(trace_frame.Frame) = .empty,
    payloads: std.ArrayList(u8) = .empty,

    fn deinit(self: *Parser) void {
        self.frames.deinit(self.allocator);
        self.payloads.deinit(self.allocator);
    }

    fn finish(self: *Parser) !trace.Trace {
        self.parsed_trace.frames = try self.frames.toOwnedSlice(self.allocator);
        self.parsed_trace.payloads = try self.payloads.toOwnedSlice(self.allocator);
        return self.parsed_trace;
    }

    fn parseDataGroups(self: *Parser, first_dg_addr: u64) !void {
        var dg_addr = first_dg_addr;
        while (dg_addr != 0) {
            const dg = try readBlock(self.bytes, dg_addr);
            if (!std.mem.eql(u8, dg.id, "##DG") or dg.link_count < 3) return error.InvalidMf4DataGroup;
            if (dg.data_end - dg.data_offset < 8) return error.InvalidMf4DataGroup;

            var groups = std.ArrayList(Group).empty;
            defer groups.deinit(self.allocator);
            var cg_addr = dg.link(self.bytes, 1);
            while (cg_addr != 0) {
                const cg = try readBlock(self.bytes, cg_addr);
                if (!std.mem.eql(u8, cg.id, "##CG") or cg.link_count < 4) return error.InvalidMf4ChannelGroup;
                if (try self.groupFromChannelGroup(cg, dg.link(self.bytes, 2))) |group| {
                    try groups.append(self.allocator, group);
                }
                cg_addr = cg.link(self.bytes, 0);
            }

            const record_id_len = self.bytes[dg.data_offset];
            if (record_id_len == 0) {
                for (groups.items) |group| {
                    try self.parseSortedRecords(group);
                }
            } else {
                try self.parseUnsortedRecords(dg.link(self.bytes, 2), record_id_len, groups.items);
            }

            dg_addr = dg.link(self.bytes, 0);
        }
    }

    fn groupFromChannelGroup(self: *Parser, cg: Block, data_addr: u64) !?Group {
        if (cg.data_end - cg.data_offset < 32) return error.InvalidMf4ChannelGroup;
        const cycles = readU64(self.bytes, cg.data_offset + 8);
        const flags = readU16(self.bytes, cg.data_offset + 16);
        const sample_size = readU32(self.bytes, cg.data_offset + 24);
        if ((flags & flag_cg_bus_event) == 0 or cycles == 0 or sample_size == 0 or data_addr == 0) return null;

        const si_addr = cg.link(self.bytes, 3);
        if (si_addr == 0 or !try isCanBusSource(self.bytes, si_addr)) return null;

        var group = Group{
            .kind = .unknown,
            .record_id = readU64(self.bytes, cg.data_offset),
            .cycles = @intCast(cycles),
            .sample_size = @intCast(sample_size),
            .record_size = @intCast(sample_size + readU32(self.bytes, cg.data_offset + 28)),
            .data_addr = data_addr,
        };

        var cn_addr = cg.link(self.bytes, 1);
        while (cn_addr != 0) {
            const cn = try readChannel(self.bytes, cn_addr);
            const block = try readBlock(self.bytes, cn_addr);
            applyChannel(&group, cn);
            var component_addr = block.link(self.bytes, 1);
            while (component_addr != 0) {
                const component = try readChannel(self.bytes, component_addr);
                applyChannel(&group, component);
                const component_block = try readBlock(self.bytes, component_addr);
                component_addr = component_block.link(self.bytes, 0);
            }
            cn_addr = block.link(self.bytes, 0);
        }

        if (group.kind == .unknown or group.time == null or group.id == null or group.dlc == null) return null;
        if (group.kind == .data and (group.data_length == null or group.data_bytes == null)) return null;
        return group;
    }

    fn parseSortedRecords(self: *Parser, group: Group) !void {
        const data = try self.dataBytes(group.data_addr);
        defer if (data.owned) self.allocator.free(data.bytes);

        const needed = try std.math.mul(usize, group.cycles, group.record_size);
        if (needed > data.bytes.len) return error.TruncatedMf4DataBlock;

        var index: usize = 0;
        while (index < group.cycles) : (index += 1) {
            const record = data.bytes[index * group.record_size ..][0..group.sample_size];
            try self.parseRecord(group, record);
        }
    }

    fn parseUnsortedRecords(self: *Parser, data_addr: u64, record_id_len: u8, groups: []const Group) !void {
        if (record_id_len != 1 and record_id_len != 2 and record_id_len != 4 and record_id_len != 8) return error.UnsupportedMf4RecordIdSize;

        const data = try self.dataBytes(data_addr);
        defer if (data.owned) self.allocator.free(data.bytes);

        var pos: usize = 0;
        while (pos < data.bytes.len) {
            if (pos + record_id_len > data.bytes.len) return error.TruncatedMf4DataBlock;
            const record_id = readRecordId(data.bytes[pos..], record_id_len);
            pos += record_id_len;
            const group = findGroup(groups, record_id) orelse return error.InvalidMf4RecordId;
            if (pos + group.record_size > data.bytes.len) return error.TruncatedMf4DataBlock;
            try self.parseRecord(group, data.bytes[pos..][0..group.sample_size]);
            pos += group.record_size;
        }
    }

    fn parseRecord(self: *Parser, group: Group, record: []const u8) !void {
        const time_seconds = try readF64Channel(record, group.time.?);
        const timestamp_ns = try secondsToNs(time_seconds);
        const raw_id = try readUnsignedChannel(record, group.id.?);
        const id_value: u32 = @intCast(raw_id & 0x1fff_ffff);
        const is_extended = if (group.ide) |ide| (try readUnsignedChannel(record, ide)) != 0 else id_value > 0x7ff;
        const id = if (is_extended) trace_frame.Id.extended(id_value) else trace_frame.Id.standard(id_value);
        const dlc: u8 = @intCast(@min(try readUnsignedChannel(record, group.dlc.?), 0xff));

        var stored: trace_frame.Frame = .{
            .timestamp_ns = timestamp_ns,
            .kind = group.kind,
            .id = id,
            .is_fd = if (group.edl) |edl| (try readUnsignedChannel(record, edl)) != 0 else false,
            .dlc = dlc,
        };

        if (group.kind == .data or group.kind == .error_frame) {
            const payload_len: u8 = if (group.data_length) |data_length|
                @intCast(@min(try readUnsignedChannel(record, data_length), 64))
            else
                0;
            stored.payload_len = payload_len;

            if (payload_len > 0 and group.data_bytes != null) {
                const payload = try readBytesChannel(record, group.data_bytes.?, payload_len);
                const payload_offset = self.payloads.items.len;
                try self.payloads.appendSlice(self.allocator, payload);
                stored.payload_offset = @intCast(payload_offset);
            }
        }

        if (group.kind == .data) {
            self.parsed_trace.data_frame_count += 1;
            self.parsed_trace.last_data_timestamp_ns = if (self.parsed_trace.last_data_timestamp_ns) |last|
                @max(last, timestamp_ns)
            else
                timestamp_ns;
        }
        try self.frames.append(self.allocator, stored);
    }

    fn dataBytes(self: *Parser, addr: u64) !DataBytes {
        const block = try readBlock(self.bytes, addr);
        if (std.mem.eql(u8, block.id, "##DT")) {
            return .{ .bytes = self.bytes[block.data_offset..block.data_end] };
        }
        if (std.mem.eql(u8, block.id, "##DZ")) {
            return .{ .bytes = try self.inflateDz(block), .owned = true };
        }
        return error.UnsupportedMf4DataBlock;
    }

    fn inflateDz(self: *Parser, block: Block) ![]u8 {
        if (block.data_end - block.data_offset < 24) return error.InvalidMf4DzBlock;
        if (!std.mem.eql(u8, self.bytes[block.data_offset..][0..2], "DT")) return error.UnsupportedMf4DzBlock;

        const zip_type = self.bytes[block.data_offset + 2];
        const zip_parameter = readU32(self.bytes, block.data_offset + 4);
        const original_size = readU64(self.bytes, block.data_offset + 8);
        const zip_size = readU64(self.bytes, block.data_offset + 16);
        if (original_size > max_dz_uncompressed_size) return error.Mf4DzBlockTooLarge;

        const compressed = self.bytes[block.data_offset + 24 .. block.data_end];
        if (zip_size > compressed.len) return error.TruncatedMf4DzBlock;
        const inflated = try inflateZlib(self.allocator, compressed[0..@intCast(zip_size)], @intCast(original_size));
        errdefer self.allocator.free(inflated);

        if (zip_type == 0) return inflated;
        if (zip_type != 1 or zip_parameter == 0) return error.UnsupportedMf4DzBlock;
        return self.untransposeDz(inflated, @intCast(original_size), @intCast(zip_parameter));
    }

    fn untransposeDz(self: *Parser, inflated: []u8, original_size: usize, row_size: usize) ![]u8 {
        errdefer self.allocator.free(inflated);
        if (row_size == 0 or original_size != inflated.len) return error.InvalidMf4DzBlock;

        const untransposed = try self.allocator.alloc(u8, original_size);
        errdefer self.allocator.free(untransposed);

        const matrix_size = original_size - (original_size % row_size);
        const row_count = matrix_size / row_size;
        for (0..row_size) |column| {
            for (0..row_count) |row| {
                untransposed[row * row_size + column] = inflated[column * row_count + row];
            }
        }
        @memcpy(untransposed[matrix_size..], inflated[matrix_size..]);
        self.allocator.free(inflated);
        return untransposed;
    }
};

const DataBytes = struct {
    bytes: []const u8,
    owned: bool = false,
};

fn applyChannel(group: *Group, cn: Channel) void {
    if (std.mem.eql(u8, cn.name, "CAN_DataFrame")) {
        group.kind = .data;
    } else if (std.mem.eql(u8, cn.name, "CAN_ErrorFrame")) {
        group.kind = .error_frame;
    } else if (std.mem.eql(u8, cn.name, "CAN_RemoteFrame")) {
        group.kind = .remote;
    } else if (cn.channel_type == channel_type_master and cn.sync_type == sync_type_time) {
        group.time = cn;
    } else if (endsWith(cn.name, ".ID")) {
        group.id = cn;
    } else if (endsWith(cn.name, ".IDE")) {
        group.ide = cn;
    } else if (endsWith(cn.name, ".DLC")) {
        group.dlc = cn;
    } else if (endsWith(cn.name, ".DataLength")) {
        group.data_length = cn;
    } else if (endsWith(cn.name, ".DataBytes")) {
        group.data_bytes = cn;
    } else if (endsWith(cn.name, ".EDL")) {
        group.edl = cn;
    }
}

fn findGroup(groups: []const Group, record_id: u64) ?Group {
    for (groups) |group| {
        if (group.record_id == record_id) return group;
    }
    return null;
}

fn readRecordId(bytes: []const u8, len: u8) u64 {
    var value: u64 = 0;
    for (bytes[0..len], 0..) |byte, index| {
        value |= @as(u64, byte) << @intCast(index * 8);
    }
    return value;
}

pub fn fromBytes(allocator: std.mem.Allocator, bytes: []const u8) !trace.Trace {
    if (bytes.len < id_block_size + common_header_size) return error.InvalidMf4Header;
    if (!std.mem.eql(u8, bytes[0..8], "MDF     ")) return error.InvalidMf4Signature;
    if (bytes[8] != '4') return error.UnsupportedMf4Version;

    const hd = try readBlock(bytes, id_block_size);
    if (!std.mem.eql(u8, hd.id, "##HD") or hd.link_count < 1) return error.InvalidMf4Header;

    var parser: Parser = .{ .allocator = allocator, .bytes = bytes };
    errdefer {
        parser.parsed_trace.deinit(allocator);
        parser.deinit();
    }

    parser.parsed_trace.measurement_start_ms = if (hd.data_end - hd.data_offset >= 8)
        @intCast(readU64(bytes, hd.data_offset) / std.time.ns_per_ms)
    else
        null;

    try parser.parseDataGroups(hd.link(bytes, 0));
    const parsed = try parser.finish();
    parser.deinit();
    return parsed;
}

fn readBlock(bytes: []const u8, addr: u64) !Block {
    const offset: usize = @intCast(addr);
    if (offset + common_header_size > bytes.len) return error.TruncatedMf4Block;
    const length: usize = @intCast(readU64(bytes, offset + 8));
    const link_count: usize = @intCast(readU64(bytes, offset + 16));
    const data_offset = offset + common_header_size + link_count * 8;
    const data_end = offset + length;
    if (length < common_header_size or data_offset > data_end or data_end > bytes.len) return error.InvalidMf4Block;
    return .{
        .id = bytes[offset..][0..4],
        .offset = offset,
        .length = length,
        .link_count = link_count,
        .data_offset = data_offset,
        .data_end = data_end,
    };
}

fn readChannel(bytes: []const u8, addr: u64) !Channel {
    const block = try readBlock(bytes, addr);
    if (!std.mem.eql(u8, block.id, "##CN") or block.link_count < 3) return error.InvalidMf4Channel;
    if (block.data_end - block.data_offset < 16) return error.InvalidMf4Channel;
    return .{
        .name = try readTx(bytes, block.link(bytes, 2)),
        .channel_type = bytes[block.data_offset],
        .sync_type = bytes[block.data_offset + 1],
        .data_type = bytes[block.data_offset + 2],
        .bit_offset = bytes[block.data_offset + 3],
        .byte_offset = readU32(bytes, block.data_offset + 4),
        .bit_count = readU32(bytes, block.data_offset + 8),
    };
}

fn readTx(bytes: []const u8, addr: u64) ![]const u8 {
    if (addr == 0) return "";
    const block = try readBlock(bytes, addr);
    if (!std.mem.eql(u8, block.id, "##TX") and !std.mem.eql(u8, block.id, "##MD")) return error.InvalidMf4TextBlock;
    return std.mem.sliceTo(bytes[block.data_offset..block.data_end], 0);
}

fn isCanBusSource(bytes: []const u8, addr: u64) !bool {
    const block = try readBlock(bytes, addr);
    if (!std.mem.eql(u8, block.id, "##SI") or block.data_end - block.data_offset < 2) return false;
    return bytes[block.data_offset] == source_bus and bytes[block.data_offset + 1] == bus_type_can;
}

fn readUnsignedChannel(record: []const u8, channel: Channel) !u64 {
    if (channel.data_type != data_type_uint_le or channel.bit_offset != 0 or channel.bit_count == 0 or channel.bit_count > 64) return error.UnsupportedMf4ChannelType;
    const byte_len: usize = @intCast((channel.bit_count + 7) / 8);
    const offset: usize = @intCast(channel.byte_offset);
    if (offset + byte_len > record.len) return error.TruncatedMf4Record;

    var value: u64 = 0;
    for (record[offset .. offset + byte_len], 0..) |byte, index| {
        value |= @as(u64, byte) << @intCast(index * 8);
    }
    if (channel.bit_count == 64) return value;
    return value & ((@as(u64, 1) << @intCast(channel.bit_count)) - 1);
}

fn readF64Channel(record: []const u8, channel: Channel) !f64 {
    if (channel.data_type != data_type_float_le or channel.bit_offset != 0 or channel.bit_count != 64) return error.UnsupportedMf4TimeChannel;
    const offset: usize = @intCast(channel.byte_offset);
    if (offset + 8 > record.len) return error.TruncatedMf4Record;
    return @bitCast(readU64(record, offset));
}

fn readBytesChannel(record: []const u8, channel: Channel, len: usize) ![]const u8 {
    if (channel.data_type != data_type_byte_array or channel.bit_offset != 0) return error.UnsupportedMf4PayloadChannel;
    const offset: usize = @intCast(channel.byte_offset);
    const max_len: usize = @intCast(channel.bit_count / 8);
    if (len > max_len or offset + len > record.len) return error.TruncatedMf4Record;
    return record[offset .. offset + len];
}

fn secondsToNs(seconds: f64) !u64 {
    if (!std.math.isFinite(seconds) or seconds < 0) return error.InvalidMf4Timestamp;
    const ns = @round(seconds * @as(f64, @floatFromInt(std.time.ns_per_s)));
    if (ns > @as(f64, @floatFromInt(std.math.maxInt(u64)))) return error.InvalidMf4Timestamp;
    return @intFromFloat(ns);
}

fn inflateZlib(allocator: std.mem.Allocator, compressed: []const u8, expected_len: usize) ![]u8 {
    const output = try allocator.alloc(u8, expected_len);
    errdefer allocator.free(output);

    var reader: std.Io.Reader = .fixed(compressed);
    var buffer: [std.compress.flate.max_window_len]u8 = undefined;
    var inflate: std.compress.flate.Decompress = .init(&reader, .zlib, &buffer);
    var writer: std.Io.Writer = .fixed(output);
    const written = try inflate.reader.streamRemaining(&writer);
    if (written != expected_len) return error.InvalidMf4DzBlock;
    return output;
}

fn endsWith(haystack: []const u8, needle: []const u8) bool {
    return haystack.len >= needle.len and std.mem.eql(u8, haystack[haystack.len - needle.len ..], needle);
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

test {
    _ = @import("tests.zig");
}
