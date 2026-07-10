use super::TraceError;

pub(crate) fn fd_payload_length_from_dlc(dlc: u8) -> Result<u8, TraceError> {
    match dlc {
        0..=8 => Ok(dlc),
        9 => Ok(12),
        10 => Ok(16),
        11 => Ok(20),
        12 => Ok(24),
        13 => Ok(32),
        14 => Ok(48),
        15 => Ok(64),
        _ => Err(TraceError::InvalidDlc),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_can_fd_dlc_to_payload_length() {
        assert_eq!(fd_payload_length_from_dlc(8), Ok(8));
        assert_eq!(fd_payload_length_from_dlc(9), Ok(12));
        assert_eq!(fd_payload_length_from_dlc(15), Ok(64));
        assert_eq!(fd_payload_length_from_dlc(16), Err(TraceError::InvalidDlc));
    }
}
