/// Returns the CAN FD payload length represented by a DLC value.
pub fn fdPayloadLengthFromDlc(dlc: u8) !u8 {
    return switch (dlc) {
        0...8 => dlc,
        9 => 12,
        10 => 16,
        11 => 20,
        12 => 24,
        13 => 32,
        14 => 48,
        15 => 64,
        else => error.InvalidDlc,
    };
}
