mod dlc;
mod error;
mod frame;
mod frame_index;
mod time;

pub(crate) use dlc::fd_payload_length_from_dlc;
pub(crate) use error::TraceError;
pub(crate) use frame::{CanId, Frame, FrameKind};
pub(crate) use frame_index::FrameIndex;
pub(crate) use time::{ExtraPrecision, days_from_civil, decimal_fraction_to_units};

pub(crate) fn lossy_utf8_line<'a>(
    bytes: &'a [u8],
    scratch: &'a mut String,
) -> Result<&'a str, TraceError> {
    if let Ok(line) = std::str::from_utf8(bytes) {
        return Ok(line);
    }

    scratch.clear();
    let max_len = bytes.len().checked_mul(3).ok_or(TraceError::OutOfMemory)?;
    scratch
        .try_reserve(max_len)
        .map_err(|_| TraceError::OutOfMemory)?;

    let mut remaining = bytes;
    while !remaining.is_empty() {
        match std::str::from_utf8(remaining) {
            Ok(valid) => {
                scratch.push_str(valid);
                break;
            }
            Err(error) => {
                let valid_up_to = error.valid_up_to();
                let valid = std::str::from_utf8(&remaining[..valid_up_to])
                    .expect("UTF-8 validator marked this prefix as valid");
                scratch.push_str(valid);
                scratch.push('\u{fffd}');

                let Some(error_len) = error.error_len() else {
                    break;
                };
                remaining = &remaining[valid_up_to + error_len..];
            }
        }
    }

    Ok(scratch)
}

#[derive(Debug, Default)]
pub(crate) struct Trace {
    pub(crate) measurement_start_ms: Option<i64>,
    pub(crate) frames: Vec<Frame>,
    pub(crate) payloads: Vec<u8>,
    pub(crate) data_frame_count: usize,
    pub(crate) skipped_line_count: usize,
    pub(crate) last_data_timestamp_ns: Option<u64>,
}

impl Trace {
    pub(crate) fn payload(&self, frame: &Frame) -> Option<&[u8]> {
        if frame.kind != FrameKind::Data || frame.id.is_none() {
            return None;
        }

        let start = frame.payload_offset as usize;
        let end = start.checked_add(frame.payload_len as usize)?;
        self.payloads.get(start..end)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_only_owned_data_payloads() {
        let frame = Frame {
            kind: FrameKind::Data,
            id: Some(CanId::standard(0x123).unwrap()),
            payload_len: 2,
            ..Frame::default()
        };
        let trace = Trace {
            frames: vec![frame],
            payloads: vec![0xaa, 0xbb],
            data_frame_count: 1,
            ..Trace::default()
        };

        assert_eq!(trace.payload(&trace.frames[0]), Some(&[0xaa, 0xbb][..]));
    }

    #[test]
    fn replaces_invalid_utf8_without_losing_ascii_fields() {
        let mut scratch = String::new();
        let line = lossy_utf8_line(b"0.100 frame \xff tail", &mut scratch).unwrap();

        assert_eq!(line, "0.100 frame \u{fffd} tail");
    }
}
