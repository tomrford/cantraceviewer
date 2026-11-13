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
