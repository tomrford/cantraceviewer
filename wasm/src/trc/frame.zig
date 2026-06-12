const std = @import("std");
const trace_dlc = @import("../trace/dlc.zig");
const trace_frame = @import("../trace/frame.zig");
const trace_time = @import("../trace/time.zig");

pub const Version = enum {
    v10,
    v11,
    v12,
    v13,
    v20,
    v21,
    v30,

    pub fn fromText(text: []const u8) !Version {
        if (std.mem.eql(u8, text, "1.0")) return .v10;
        if (std.mem.eql(u8, text, "1.1")) return .v11;
        if (std.mem.eql(u8, text, "1.2")) return .v12;
        if (std.mem.eql(u8, text, "1.3")) return .v13;
        if (std.mem.eql(u8, text, "2.0")) return .v20;
        if (std.mem.eql(u8, text, "2.1")) return .v21;
        if (std.mem.eql(u8, text, "3.0")) return .v30;
        return error.UnsupportedTrcVersion;
    }

    pub fn isV2(self: Version) bool {
        return self == .v20 or self == .v21;
    }
};

pub const Kind = trace_frame.Kind;
pub const Id = trace_frame.Id;
pub const Frame = trace_frame.Frame;

pub fn idFromText(text: []const u8) !Id {
    if (text.len != 4 and text.len != 8) return error.InvalidId;
    const value = try std.fmt.parseUnsigned(u32, text, 16);
    if (text.len == 8) {
        if (value > 0x1fff_ffff) return error.InvalidId;
        return Id.extended(value);
    }
    if (value > 0x7ff) return error.InvalidId;
    return Id.standard(@intCast(value));
}

pub const ColumnMap = struct {
    number: ?usize = null,
    offset: ?usize = null,
    record_type: ?usize = null,
    bus: ?usize = null,
    id: ?usize = null,
    direction: ?usize = null,
    reserved: ?usize = null,
    data_len: ?usize = null,
    dlc: ?usize = null,
    data: ?usize = null,
    token_count_before_data: usize = 0,

    pub fn fromText(text: []const u8) !ColumnMap {
        var map: ColumnMap = .{};
        var index: usize = 0;
        var parts = std.mem.splitScalar(u8, text, ',');
        while (parts.next()) |raw_part| : (index += 1) {
            const part = std.mem.trim(u8, raw_part, " \t\r");
            if (std.mem.eql(u8, part, "N")) {
                map.number = index;
            } else if (std.mem.eql(u8, part, "O")) {
                map.offset = index;
            } else if (std.mem.eql(u8, part, "T")) {
                map.record_type = index;
            } else if (std.mem.eql(u8, part, "B")) {
                map.bus = index;
            } else if (std.mem.eql(u8, part, "I")) {
                map.id = index;
            } else if (std.mem.eql(u8, part, "d")) {
                map.direction = index;
            } else if (std.mem.eql(u8, part, "R")) {
                map.reserved = index;
            } else if (std.mem.eql(u8, part, "l")) {
                map.data_len = index;
            } else if (std.mem.eql(u8, part, "L")) {
                map.dlc = index;
            } else if (std.mem.eql(u8, part, "D")) {
                map.data = index;
            } else {
                return error.UnsupportedTrcColumn;
            }
        }

        if (map.offset == null or map.record_type == null or map.id == null or
            map.direction == null or map.data == null or (map.data_len == null and map.dlc == null))
        {
            return error.InvalidTrcColumns;
        }
        map.token_count_before_data = map.data.?;
        return map;
    }
};

pub fn parseTimestampMsToNs(text: []const u8) !u64 {
    if (text.len == 0 or text[0] == '-') return error.InvalidTimestamp;

    var parts = std.mem.splitScalar(u8, text, '.');
    const ms_text = parts.next() orelse return error.InvalidTimestamp;
    const fraction_text = parts.next();
    if (parts.next() != null) return error.InvalidTimestamp;

    const milliseconds = try std.fmt.parseUnsigned(u64, ms_text, 10);
    var ns = try std.math.mul(u64, milliseconds, std.time.ns_per_ms);

    if (fraction_text) |fraction| {
        const fraction_ns = try trace_time.decimalFractionToUnits(fraction, std.time.ns_per_ms, 6, .reject);
        ns = try std.math.add(u64, ns, fraction_ns);
    }

    return ns;
}

pub fn parseDlc(text: []const u8) !u8 {
    const dlc = try std.fmt.parseUnsigned(u8, text, 10);
    if (dlc > 15) return error.InvalidDlc;
    return dlc;
}

pub fn parsePayloadLength(text: []const u8) !u8 {
    const payload_len = try std.fmt.parseUnsigned(u8, text, 10);
    if (payload_len > 64) return error.InvalidPayloadLength;
    return payload_len;
}

pub fn parseByte(text: []const u8) !u8 {
    return std.fmt.parseUnsigned(u8, text, 16);
}

pub const fdPayloadLengthFromDlc = trace_dlc.fdPayloadLengthFromDlc;

test "parses TRC millisecond timestamps into nanoseconds" {
    try std.testing.expectEqual(@as(u64, 0), try parseTimestampMsToNs("0"));
    try std.testing.expectEqual(@as(u64, 1_234_000), try parseTimestampMsToNs("1.234"));
    try std.testing.expectEqual(@as(u64, 1_234_567), try parseTimestampMsToNs("1.234567"));
    try std.testing.expectError(error.InvalidTimestamp, parseTimestampMsToNs("-1.0"));
}

test "parses TRC ID width into standard or extended IDs" {
    try std.testing.expectEqual(Id{ .value = 0x123, .is_extended = false }, try idFromText("0123"));
    try std.testing.expectEqual(Id{ .value = 0x18fee900, .is_extended = true }, try idFromText("18FEE900"));
    try std.testing.expectError(error.InvalidId, idFromText("0800"));
}
