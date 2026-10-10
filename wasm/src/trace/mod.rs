mod dlc;
mod error;
mod frame;
mod frame_index;
mod time;

pub(crate) use dlc::fd_payload_length_from_dlc;
pub(crate) use error::TraceError;
pub(crate) use frame::{CanId, Direction, Frame, FrameKind, RawSource, parse_channel};
pub(crate) use frame_index::FrameIndex;
pub(crate) use time::{ExtraPrecision, days_from_civil, decimal_fraction_to_units};

pub(crate) fn lossy_utf8_line<'a>(bytes: &'a [u8], scratch: &'a mut String) -> &'a str {
    if let Ok(line) = std::str::from_utf8(bytes) {
        return line;
    }

    scratch.clear();
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

    scratch
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
