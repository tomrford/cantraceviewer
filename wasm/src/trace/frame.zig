const std = @import("std");

pub const Kind = enum {
    data,
    remote,
    error_frame,
    unknown,
};

pub const Id = struct {
    value: u32,
    is_extended: bool,

    pub fn standard(value: u32) Id {
        std.debug.assert(value <= 0x7ff);
        return .{ .value = value, .is_extended = false };
    }

    pub fn extended(value: u32) Id {
        std.debug.assert(value <= 0x1fff_ffff);
        return .{ .value = value, .is_extended = true };
    }
};

pub const Frame = struct {
    timestamp_ns: u64,
    kind: Kind,
    id: ?Id = null,
    is_fd: bool = false,
    dlc: u8 = 0,
    payload_offset: u32 = 0,
    payload_len: u8 = 0,
};
