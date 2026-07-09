//! Selected signal time-series extraction.
//!
//! The WebAssembly boundary asks for one DBC frame identity and signal name,
//! then receives a packed `f64` buffer containing parallel time and value
//! arrays: `[time_0, ..., time_n, value_0, ..., value_n]`.

use std::error::Error as StdError;
use std::fmt;

use crate::dbc::{Dbc, DbcError, Message};
use crate::trace::{Frame, FrameIndex, Trace};

#[derive(Debug)]
pub(crate) enum SeriesError {
    SignalNotFound,
    Decode(DbcError),
}

impl fmt::Display for SeriesError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SignalNotFound => formatter.write_str("Signal not found in DBC"),
            Self::Decode(error) => error.fmt(formatter),
        }
    }
}

impl StdError for SeriesError {
    fn source(&self) -> Option<&(dyn StdError + 'static)> {
        match self {
            Self::SignalNotFound => None,
            Self::Decode(error) => Some(error),
        }
    }
}

impl From<DbcError> for SeriesError {
    fn from(error: DbcError) -> Self {
        Self::Decode(error)
    }
}

pub(crate) fn selected_signal_values(
    dbc: &Dbc,
    trace: &Trace,
    index: &FrameIndex,
    can_id: u32,
    is_extended: bool,
    size_bytes: u16,
    signal_name: &str,
) -> Result<Vec<f64>, SeriesError> {
    let (message, signal) = dbc
        .find_signal(can_id, is_extended, size_bytes, signal_name)
        .ok_or(SeriesError::SignalNotFound)?;
    let plan = signal.plan_decode(message.size_bytes)?;
    let frame_indices = index.lookup(message.can_id, message.is_extended);

    let sample_count = frame_indices
        .iter()
        .filter(|&&frame_index| {
            trace
                .frames
                .get(frame_index as usize)
                .and_then(|frame| payload_prefix_for_message(trace, frame, message))
                .is_some()
        })
        .count();

    let mut packed = vec![0.0; sample_count * 2];
    let values_offset = sample_count;
    let mut sample_index = 0;

    for &frame_index in frame_indices {
        let Some(frame) = trace.frames.get(frame_index as usize) else {
            continue;
        };
        let Some(payload) = payload_prefix_for_message(trace, frame, message) else {
            continue;
        };

        packed[sample_index] = frame.timestamp_ns as f64 / 1_000_000.0;
        packed[values_offset + sample_index] = plan.decode(payload)?;
        sample_index += 1;
    }

    Ok(packed)
}

fn payload_prefix_for_message<'a>(
    trace: &'a Trace,
    frame: &Frame,
    message: &Message,
) -> Option<&'a [u8]> {
    if !frame_can_carry_message(frame, message) {
        return None;
    }

    trace.payload(frame)?.get(..usize::from(message.size_bytes))
}

fn frame_can_carry_message(frame: &Frame, message: &Message) -> bool {
    let payload_len = u16::from(frame.payload_len);
    if frame.is_fd {
        return payload_len == message.size_bytes;
    }
    if payload_len < message.size_bytes {
        return false;
    }
    message.is_fd || payload_len <= 8
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{asc, dbc::Dbc};

    fn decode(dbc_text: &str, asc_text: &str, size: u16, signal: &str) -> Vec<f64> {
        let dbc = Dbc::parse(dbc_text).unwrap();
        let trace = asc::parse(asc_text).unwrap();
        let index = FrameIndex::build(&trace.frames);
        selected_signal_values(&dbc, &trace, &index, 0x123, false, size, signal).unwrap()
    }

    #[test]
    fn extracts_parallel_time_and_value_arrays() {
        let values = decode(
            "BO_ 291 Example: 2 ECU\n SG_ Speed : 0|16@1+ (0.1,0) [0|250] \"km/h\" DASH",
            "base hex timestamps absolute\n0.001 1 123 Rx d 2 10 27\n0.003 1 123 Rx d 2 20 4e",
            2,
            "Speed",
        );

        assert_eq!(values, [1.0, 3.0, 1000.0, 2000.0]);
    }

    #[test]
    fn skips_short_frames_and_decodes_classic_padding() {
        let values = decode(
            "BO_ 291 Example: 2 ECU\n SG_ Speed : 0|16@1+ (1,0) [0|65535] \"\" DASH",
            "base hex timestamps absolute\n0.001 1 123 Rx d 1 10\n0.002 1 123 Rx d 2 34 12\n0.003 1 123 Rx d 8 78 56 aa bb cc dd ee ff\n0.004 CANFD 1 Rx 123 - 1 0 8 8 9a bc aa bb cc dd ee ff",
            2,
            "Speed",
        );

        assert_eq!(values, [2.0, 3.0, 4660.0, 22136.0]);
    }

    #[test]
    fn separates_classic_and_fd_messages_by_payload_length() {
        let dbc = Dbc::parse(
            "BO_ 291 Classic: 8 ECU\n SG_ ClassicSpeed : 0|16@1+ (1,0) [0|65535] \"\" DASH\nBO_ 291 Fd: 12 ECU\n SG_ FdSpeed : 0|16@1+ (1,0) [0|65535] \"\" DASH",
        )
        .unwrap();
        let trace = asc::parse(
            "base hex timestamps absolute\n0.001 1 123 Rx d 8 01 00 00 00 00 00 00 00\n0.002 CANFD 1 Rx 123 - 1 0 8 8 02 00 00 00 00 00 00 00\n0.003 CANFD 1 Rx 123 - 1 0 9 12 03 00 00 00 00 00 00 00 00 00 00 00",
        )
        .unwrap();
        let index = FrameIndex::build(&trace.frames);

        assert_eq!(
            selected_signal_values(&dbc, &trace, &index, 0x123, false, 8, "ClassicSpeed").unwrap(),
            [1.0, 2.0, 1.0, 2.0]
        );
        assert_eq!(
            selected_signal_values(&dbc, &trace, &index, 0x123, false, 12, "FdSpeed").unwrap(),
            [3.0, 3.0]
        );
    }
}
