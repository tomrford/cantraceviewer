//! Selected signal time-series extraction.
//!
//! The WebAssembly boundary asks for one DBC frame identity and signal name,
//! then receives a packed `f64` buffer containing parallel time and value
//! arrays: `[time_0, ..., time_n, value_0, ..., value_n]`.

use std::error::Error as StdError;
use std::fmt;

use crate::dbc::{ActivityPlan, Dbc, DbcError, Message};
use crate::trace::{Frame, FrameIndex, Trace};

#[derive(Debug)]
pub(crate) enum SeriesError {
    SignalNotFound,
    Source(&'static str),
    Decode(DbcError),
}

impl fmt::Display for SeriesError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Source(message) => formatter.write_str(message),
            Self::SignalNotFound => formatter.write_str("Signal not found in DBC"),
            Self::Decode(error) => error.fmt(formatter),
        }
    }
}

impl StdError for SeriesError {
    fn source(&self) -> Option<&(dyn StdError + 'static)> {
        match self {
            Self::SignalNotFound | Self::Source(_) => None,
            Self::Decode(error) => Some(error),
        }
    }
}

impl From<DbcError> for SeriesError {
    fn from(error: DbcError) -> Self {
        Self::Decode(error)
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn selected_signal_values(
    dbc: &Dbc,
    trace: &Trace,
    index: &FrameIndex,
    can_id: u32,
    is_extended: bool,
    size_bytes: u16,
    signal_name: &str,
    source: Option<crate::trace::RawSource>,
) -> Result<Vec<f64>, SeriesError> {
    let (message, signal) = dbc
        .find_signal(can_id, is_extended, size_bytes, signal_name)
        .ok_or(SeriesError::SignalNotFound)?;
    if !message.raw_frame_decodable() {
        return Err(DbcError::InvalidDefinition(
            "Message requires transport reassembly or a payload longer than 64 bytes",
        )
        .into());
    }
    let plan = signal.plan_decode(message.size_bytes)?;
    let lookup = index
        .lookup(
            message.can_id,
            message.is_extended,
            message.size_bytes,
            source,
        )
        .map_err(SeriesError::Source)?;
    let frame_indices = lookup.frame_indices;

    let all_frames_carry =
        lookup.all_frames_carry && !message.format_explicit && signal.multiplex.is_none();
    let activity = ActivityPlan::new(message, signal)?;
    let compatible = frame_indices.iter().filter_map(|&frame_index| {
        let frame = &trace.frames[frame_index as usize];
        let payload = if all_frames_carry {
            let start = frame.payload_offset as usize;
            &trace.payloads[start..start + usize::from(message.size_bytes)]
        } else {
            payload_prefix_for_message(trace, frame, message)?
        };
        activity.active(payload).then_some((frame, payload))
    });
    let count = if all_frames_carry {
        frame_indices.len()
    } else {
        compatible.clone().count()
    };
    let mut packed = vec![0.0; count * 2];
    let (times, values) = packed.split_at_mut(count);
    for ((time, value), (frame, payload)) in times.iter_mut().zip(values).zip(compatible) {
        *time = frame.timestamp_ns as f64 / 1_000_000.0;
        *value = plan.decode(payload)?;
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
    if message.format_explicit && frame.is_fd != message.is_fd {
        return false;
    }
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
        selected_signal_values(&dbc, &trace, &index, 0x123, false, size, signal, None).unwrap()
    }

    #[test]
    fn separates_sources_and_rejects_ambiguous_selection() {
        use crate::trace::{Direction, RawSource};
        let dbc = Dbc::parse("BO_ 291 Example: 1 ECU\n SG_ Value : 0|8@1+ (1,0) [0|255] \"\" ECU")
            .unwrap();
        let trace = asc::parse("base hex timestamps absolute\n0.005 1 123 Rx d 1 55\n0.002 2 123 Rx d 1 22\n0.003 1 123 Tx d 1 33\n0.004 1 123x Rx d 1 44\n0.001 1 123 Rx d 1 11\n0.001 1 123 Rx d 1 77\n0.006 0 123 ? d 1 66").unwrap();
        let index = FrameIndex::build(&trace.frames);
        assert!(matches!(
            selected_signal_values(&dbc, &trace, &index, 291, false, 1, "Value", None),
            Err(SeriesError::Source(_))
        ));
        for (channel, direction, expected) in [
            (
                Some(1),
                Direction::Rx,
                vec![1.0, 1.0, 5.0, 17.0, 119.0, 85.0],
            ),
            (Some(2), Direction::Rx, vec![2.0, 34.0]),
            (Some(1), Direction::Tx, vec![3.0, 51.0]),
            (None, Direction::Unknown, vec![6.0, 102.0]),
            (Some(3), Direction::Rx, vec![]),
        ] {
            let source = RawSource {
                channel: channel.and_then(std::num::NonZeroU16::new),
                direction,
            };
            assert_eq!(
                selected_signal_values(&dbc, &trace, &index, 291, false, 1, "Value", Some(source))
                    .unwrap(),
                expected
            );
        }
    }

    #[test]
    fn orders_mixed_payload_lengths_and_preserves_equal_time_values() {
        let values = decode(
            "BO_ 291 Example: 2 ECU\n SG_ Value : 0|16@1+ (1,0) [0|65535] \"\" ECU",
            "base hex timestamps absolute\n0.300 1 123 Rx d 2 03 00\n0.100 1 123 Rx d 8 01 00 00 00 00 00 00 00\n0.200 1 123 Rx d 1 ff\n0.100 1 123 Rx d 2 04 00",
            2,
            "Value",
        );
        assert_eq!(values, [100.0, 100.0, 300.0, 1.0, 4.0, 3.0]);
    }

    #[test]
    fn comments_do_not_change_multiplex_activity() {
        let base = "BO_ 291 M: 2 ECU\n SG_ Mode M : 0|8@1+ (1,0) [0|255] \"\" ECU\n SG_ Value m1 : 8|8@1+ (1,0) [0|255] \"\" ECU\n";
        let trace =
            "base hex timestamps absolute\n0.001 1 123 Rx d 2 01 11\n0.002 1 123 Rx d 2 02 22";
        let comment = "CM_ \"An example, not a definition:\nSG_MUL_VAL_ 291 Value Mode 1-2;\n\";\n";
        assert_eq!(
            decode(&format!("{base}{comment}"), trace, 2, "Value"),
            [1.0, 17.0]
        );
        let ranges = "SG_MUL_VAL_\n 291 Value Mode\n 1 - 2;\n";
        assert_eq!(
            decode(&format!("{base}{ranges}"), trace, 2, "Value"),
            [1.0, 2.0, 17.0, 34.0]
        );
    }

    #[test]
    fn multiline_frame_format_selects_fd_instead_of_classical_samples() {
        let dbc = "BO_ 291 M: 1 ECU\n SG_ Value : 0|8@1+ (1,0) [0|255] \"\" ECU\nBA_DEF_ BO_ \"VFrameFormat\" ENUM\n \"StandardCAN_FD\", \"StandardCAN\";\nBA_ \"VFrameFormat\"\n BO_ 291 0;\n";
        let trace = "base hex timestamps absolute\n0.001 1 123 Rx d 1 11\n0.002 CANFD 1 Rx 123 - 1 0 1 1 22";
        assert_eq!(decode(dbc, trace, 1, "Value"), [2.0, 34.0]);
    }

    #[test]
    fn simple_motorola_selector_compares_wire_value_and_omits_inactive_frames() {
        let dbc = "BO_ 291 Simple: 2 ECU\n SG_ Mode M : 7|2@0+ (10,100) [0|0] \"\" ECU\n SG_ Value m2 : 8|8@1+ (2,-1) [0|0] \"\" ECU";
        let trace = "base hex timestamps absolute\n0.001 1 123 Rx d 2 80 05\n0.002 1 123 Rx d 2 40 ff\n0.003 1 123 Rx d 2 bf 08";
        assert_eq!(decode(dbc, trace, 2, "Value"), [1.0, 3.0, 9.0, 15.0]);
    }

    #[test]
    fn long_j1939_catalogue_does_not_enable_partial_raw_frame_decoding() {
        for size in [9, 1785] {
            let dbc = Dbc::parse(&format!("BO_ 2566834942 Long: {size} ECU\n SG_ Value : 0|8@1+ (1,0) [0|0] \"\" ECU\nBA_ \"ProtocolType\" \"J1939\";")).unwrap();
            let trace = asc::parse(
                "base hex timestamps absolute\n0.001 1 18fecafex Rx d 8 01 00 00 00 00 00 00 00",
            )
            .unwrap();
            let index = FrameIndex::build(&trace.frames);
            let error = selected_signal_values(
                &dbc,
                &trace,
                &index,
                dbc.messages[0].can_id,
                true,
                size,
                "Value",
                None,
            )
            .unwrap_err()
            .to_string();
            assert!(error.contains("transport reassembly"), "{error}");
        }
    }

    #[test]
    fn filters_nested_activity_before_decoding_signed_scaled_values() {
        let dbc = include_str!("../tests/fixtures/nested-selectors.dbc");
        let trace = "base hex timestamps absolute\n0.001 1 123 Rx d 4 01 03 00 64\n0.002 1 123 Rx d 4 02 03 00 64\n0.003 1 123 Rx d 4 02 05 ff 9c\n0.004 1 123 Rx d 4 02 06 00 64\n0.005 1 123 Rx d 4 02 09 01 00";
        assert_eq!(
            decode(dbc, trace, 4, "Data"),
            [2.0, 3.0, 5.0, 40.0, -60.0, 118.0]
        );
        assert_eq!(
            decode(dbc, trace, 4, "Child"),
            [2.0, 3.0, 4.0, 5.0, 106.0, 110.0, 112.0, 118.0]
        );
    }

    #[test]
    fn declared_short_fd_and_classic_formats_filter_same_length_frames() {
        let base = "BO_ 291 Example: 2 ECU\n SG_ Value : 0|16@1+ (1,0) [0|0] \"\" ECU\n";
        let trace = "base hex timestamps absolute\n0.001 1 123 Rx d 2 34 12\n0.002 CANFD 1 Rx 123 - 1 0 2 2 78 56";
        assert_eq!(
            decode(
                &format!("{base}BA_ \"VFrameFormat\" BO_ 291 14;"),
                trace,
                2,
                "Value"
            ),
            [2.0, 22136.0]
        );
        assert_eq!(
            decode(
                &format!("{base}BA_ \"VFrameFormat\" BO_ 291 0;"),
                trace,
                2,
                "Value"
            ),
            [1.0, 4660.0]
        );
        // A uniform bucket must still honour the declared format.
        let only_classic = "base hex timestamps absolute\n0.001 1 123 Rx d 2 34 12";
        assert!(
            decode(
                &format!("{base}BA_ \"VFrameFormat\" BO_ 291 14;"),
                only_classic,
                2,
                "Value"
            )
            .is_empty()
        );
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
            selected_signal_values(&dbc, &trace, &index, 0x123, false, 8, "ClassicSpeed", None)
                .unwrap(),
            [1.0, 2.0, 1.0, 2.0]
        );
        assert_eq!(
            selected_signal_values(&dbc, &trace, &index, 0x123, false, 12, "FdSpeed", None)
                .unwrap(),
            [3.0, 3.0]
        );
    }
}
