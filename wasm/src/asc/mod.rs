mod frame;

use crate::trace::{FrameKind, Trace, TraceError, days_from_civil, lossy_utf8_line};

pub(crate) use frame::Base;
#[cfg(test)]
use frame::parse_decimal_seconds_to_ns;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TimestampMode {
    Absolute,
    Relative,
}

#[derive(Debug)]
struct ParserState {
    base: Base,
    timestamp_mode: TimestampMode,
    measurement_start_ms: Option<i64>,
}

impl Default for ParserState {
    fn default() -> Self {
        Self {
            base: Base::Hex,
            timestamp_mode: TimestampMode::Absolute,
            measurement_start_ms: None,
        }
    }
}

pub(crate) fn parse_bytes(bytes: &[u8]) -> Result<Trace, TraceError> {
    let mut state = ParserState::default();
    let mut trace = Trace::default();
    let mut payload_buffer = [0_u8; 64];
    let mut relative_timestamp_ns = 0_u64;
    let mut line_scratch = String::new();

    for raw_line_bytes in bytes.split(|&byte| byte == b'\n') {
        let line = trim_line(raw_line_bytes);
        if line.is_empty() {
            continue;
        }

        if could_be_header(line) {
            let header = lossy_utf8_line(line, &mut line_scratch);
            if parse_header_line(&mut state, header)? {
                continue;
            }
        }

        let parsed_frame = match frame::parse_line(state.base, line, &mut payload_buffer) {
            Ok(frame) => frame,
            Err(_) => {
                trace.skipped_line_count += 1;
                if state.timestamp_mode == TimestampMode::Relative
                    && let Some(delta) = frame::leading_timestamp_ns(line)
                {
                    relative_timestamp_ns = relative_timestamp_ns
                        .checked_add(delta)
                        .unwrap_or(relative_timestamp_ns);
                }
                continue;
            }
        };

        let Some(mut parsed_frame) = parsed_frame else {
            continue;
        };

        if state.timestamp_mode == TimestampMode::Relative {
            relative_timestamp_ns = relative_timestamp_ns
                .checked_add(parsed_frame.timestamp_ns)
                .ok_or(TraceError::TimestampOverflow)?;
            parsed_frame.timestamp_ns = relative_timestamp_ns;
        }

        if parsed_frame.kind == FrameKind::Data && parsed_frame.id.is_some() {
            let payload_len = parsed_frame.payload_len as usize;
            parsed_frame.payload_offset = u32::try_from(trace.payloads.len())
                .map_err(|_| TraceError::PayloadOffsetOverflow)?;
            trace
                .payloads
                .extend_from_slice(&payload_buffer[..payload_len]);
            trace.data_frame_count += 1;
            trace.last_data_timestamp_ns = Some(parsed_frame.timestamp_ns);
        }

        trace.frames.push(parsed_frame);
    }

    trace.measurement_start_ms = state.measurement_start_ms;
    Ok(trace)
}

#[cfg(test)]
pub(crate) fn parse(text: &str) -> Result<Trace, TraceError> {
    parse_bytes(text.as_bytes())
}

fn trim_line(line: &[u8]) -> &[u8] {
    let start = line
        .iter()
        .position(|&byte| !matches!(byte, b' ' | b'\t' | b'\r'))
        .unwrap_or(line.len());
    let end = line
        .iter()
        .rposition(|&byte| !matches!(byte, b' ' | b'\t' | b'\r'))
        .map_or(start, |index| index + 1);
    &line[start..end]
}

// Prefilter for `parse_header_line`: must cover every form it accepts, or a
// header line silently degrades into a skipped frame line.
fn could_be_header(line: &[u8]) -> bool {
    line == b"no internal events logged"
        || line == b"internal events logged"
        || line.starts_with(b"date ")
        || line.starts_with(b"Begin Triggerblock ")
        || line.starts_with(b"End TriggerBlock")
        || line.starts_with(b"// version ")
        || line.starts_with(b"base ")
}

// Accepted forms must stay in sync with the `could_be_header` prefilter.
fn parse_header_line(state: &mut ParserState, line: &str) -> Result<bool, TraceError> {
    if matches!(line, "no internal events logged" | "internal events logged") {
        return Ok(true);
    }

    if let Some(date) = line.strip_prefix("date ") {
        if state.measurement_start_ms.is_none() {
            state.measurement_start_ms = parse_vector_date_to_unix_ms(date).ok();
        }
        return Ok(true);
    }
    if let Some(triggerblock) = line.strip_prefix("Begin Triggerblock ") {
        state.measurement_start_ms = parse_vector_date_to_unix_ms(triggerblock).ok();
        return Ok(true);
    }
    if line.starts_with("End TriggerBlock") || line.starts_with("// version ") {
        return Ok(true);
    }
    if line.starts_with("base ") {
        parse_base_line(state, line)?;
        return Ok(true);
    }

    Ok(false)
}

fn parse_base_line(state: &mut ParserState, line: &str) -> Result<(), TraceError> {
    let mut tokens = line.split_whitespace();
    if tokens.next() != Some("base") {
        return Err(TraceError::InvalidBaseLine);
    }
    state.base = match tokens.next() {
        Some("hex") => Base::Hex,
        Some("dec") => Base::Dec,
        _ => return Err(TraceError::InvalidBaseLine),
    };
    if tokens.next() != Some("timestamps") {
        return Err(TraceError::InvalidBaseLine);
    }
    state.timestamp_mode = match tokens.next() {
        Some("absolute") => TimestampMode::Absolute,
        Some("relative") => TimestampMode::Relative,
        _ => return Err(TraceError::InvalidBaseLine),
    };
    Ok(())
}

fn parse_vector_date_to_unix_ms(text: &str) -> Result<i64, TraceError> {
    // ASC dates do not carry a timezone. UTC keeps the browser result deterministic.
    let mut tokens = text.split_whitespace();
    tokens.next().ok_or(TraceError::InvalidVectorDate)?;
    let month = parse_month(tokens.next().ok_or(TraceError::InvalidVectorDate)?)
        .ok_or(TraceError::InvalidVectorDate)?;
    let day = tokens
        .next()
        .ok_or(TraceError::InvalidVectorDate)?
        .parse::<u8>()
        .map_err(|_| TraceError::InvalidVectorDate)?;
    let time = parse_time_of_day(tokens.next().ok_or(TraceError::InvalidVectorDate)?)?;
    let year = tokens
        .next()
        .ok_or(TraceError::InvalidVectorDate)?
        .parse::<i32>()
        .map_err(|_| TraceError::InvalidVectorDate)?;

    let seconds = days_from_civil(year, month, day)
        .checked_mul(86_400)
        .and_then(|value| value.checked_add(time.seconds))
        .ok_or(TraceError::InvalidVectorDate)?;
    seconds
        .checked_mul(1_000)
        .and_then(|value| value.checked_add(time.milliseconds))
        .ok_or(TraceError::InvalidVectorDate)
}

fn parse_month(text: &str) -> Option<u8> {
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    MONTHS
        .iter()
        .position(|month| *month == text)
        .map(|index| index as u8 + 1)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct TimeOfDay {
    seconds: i64,
    milliseconds: i64,
}

fn parse_time_of_day(text: &str) -> Result<TimeOfDay, TraceError> {
    let mut parts = text.split(':');
    let hour = parse_time_component(parts.next())?;
    let minute = parse_time_component(parts.next())?;
    let second_text = parts.next().ok_or(TraceError::InvalidVectorDate)?;
    if parts.next().is_some() {
        return Err(TraceError::InvalidVectorDate);
    }

    let mut second_parts = second_text.split('.');
    let second = parse_time_component(second_parts.next())?;
    let fraction = second_parts.next();
    if second_parts.next().is_some() || hour > 23 || minute > 59 || second > 59 {
        return Err(TraceError::InvalidVectorDate);
    }

    let milliseconds = match fraction {
        None => 0,
        Some(digits) if !digits.is_empty() && digits.len() <= 3 => {
            let value = digits
                .parse::<i64>()
                .map_err(|_| TraceError::InvalidVectorDate)?;
            value * 10_i64.pow((3 - digits.len()) as u32)
        }
        Some(_) => return Err(TraceError::InvalidVectorDate),
    };

    Ok(TimeOfDay {
        seconds: i64::from(hour) * 3_600 + i64::from(minute) * 60 + i64::from(second),
        milliseconds,
    })
}

fn parse_time_component(component: Option<&str>) -> Result<u8, TraceError> {
    component
        .ok_or(TraceError::InvalidVectorDate)?
        .parse::<u8>()
        .map_err(|_| TraceError::InvalidVectorDate)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::trace::{CanId, FrameKind};

    #[test]
    fn parses_decimal_seconds_without_floating_point() {
        assert_eq!(parse_decimal_seconds_to_ns("0"), Ok(0));
        assert_eq!(parse_decimal_seconds_to_ns("0.003040"), Ok(3_040_000));
        assert_eq!(parse_decimal_seconds_to_ns("10.01"), Ok(10_010_000_000));
        assert_eq!(parse_decimal_seconds_to_ns("3600"), Ok(3_600_000_000_000));
        assert_eq!(
            parse_decimal_seconds_to_ns("3600.000000001"),
            Ok(3_600_000_000_001)
        );
        assert_eq!(
            parse_decimal_seconds_to_ns("1.0000000001"),
            Err(TraceError::TimestampTooPrecise)
        );
    }

    #[test]
    fn parses_source_with_trigger_start_and_decimal_base() {
        let text = "date Tue Apr 28 09:00:00.000 2026\n\
                    base dec timestamps absolute\n\
                    internal events logged\n\
                    Begin Triggerblock Tue Apr 28 10:00:00.000 2026\n\
                    0.001 1 291 Rx d 2 170 187\n\
                    End TriggerBlock";

        let parsed = parse(text).unwrap();
        assert_eq!(parsed.measurement_start_ms, Some(1_777_370_400_000));
        assert_eq!(parsed.frames.len(), 1);
        assert_eq!(parsed.payloads, [0xaa, 0xbb]);
        assert_eq!(parsed.frames[0].timestamp_ns, 1_000_000);
        assert_eq!(parsed.frames[0].id, Some(CanId::standard(291).unwrap()));
    }

    #[test]
    fn normalizes_relative_timestamps_across_unknown_events() {
        let parsed = parse(
            "base hex timestamps relative\n\
             0.100000 1 123 Rx d 1 aa\n\
             0.200000 CANFD_STATISTIC whatever else\n\
             0.300000 1 123 Rx d 1 bb",
        )
        .unwrap();

        assert_eq!(parsed.frames.len(), 3);
        assert_eq!(parsed.frames[0].timestamp_ns, 100_000_000);
        assert_eq!(parsed.frames[1].timestamp_ns, 300_000_000);
        assert_eq!(parsed.frames[2].timestamp_ns, 600_000_000);
        assert_eq!(parsed.frames[1].kind, FrameKind::Unknown);
    }

    #[test]
    fn stores_only_data_payloads_in_the_side_buffer() {
        let parsed = parse(
            "base hex timestamps absolute\n\
             0.100000 1 123 Rx d 2 aa bb\n\
             0.200000 CANFD_STATISTIC whatever else\n\
             0.300000 1 123 Rx r 8\n\
             0.400000 CANFD 1 Rx 123 - 1 0 9 12 01 02 03 04 05 06 07 08 09 0a 0b 0c",
        )
        .unwrap();

        assert_eq!(parsed.frames.len(), 4);
        assert_eq!(parsed.payloads.len(), 14);
        assert_eq!(parsed.frames[0].payload_offset, 0);
        assert_eq!(parsed.frames[1].payload_len, 0);
        assert_eq!(parsed.frames[2].payload_len, 0);
        assert_eq!(parsed.frames[3].payload_offset, 2);
        assert_eq!(parsed.payloads[0], 0xaa);
        assert_eq!(parsed.payloads[13], 0x0c);
    }

    #[test]
    fn reports_duration_from_the_last_data_frame_only() {
        let parsed = parse(
            "base hex timestamps absolute\n\
             0.100000 1 123 Rx d 1 aa\n\
             0.200000 CANFD_STATISTIC whatever else\n\
             0.300000 1 123 Rx r 8\n\
             0.400000 1 123 Rx d 1 bb",
        )
        .unwrap();

        assert_eq!(parsed.data_frame_count, 2);
        assert_eq!(parsed.last_data_timestamp_ns, Some(400_000_000));
    }

    #[test]
    fn leaves_duration_empty_without_data_frames() {
        let parsed = parse(
            "base hex timestamps absolute\n\
             0.200000 CANFD_STATISTIC whatever else",
        )
        .unwrap();

        assert_eq!(parsed.data_frame_count, 0);
        assert_eq!(parsed.last_data_timestamp_ns, None);
    }

    #[test]
    fn skips_fd_payload_length_mismatch_and_keeps_neighbors() {
        let parsed = parse(
            "base hex timestamps absolute\n\
             0.001 1 123 Rx d 1 aa\n\
             0.002 CANFD 1 Rx 18fee900x - 1 0 9 8 01 02 03 04 05 06 07 08\n\
             0.003 1 123 Rx d 1 bb",
        )
        .unwrap();

        assert_eq!(parsed.frames.len(), 2);
        assert_eq!(parsed.skipped_line_count, 1);
        assert_eq!(parsed.last_data_timestamp_ns, Some(3_000_000));
    }

    #[test]
    fn keeps_relative_delta_from_a_skipped_line() {
        let parsed = parse(
            "base hex timestamps relative\n\
             0.100000 1 123 Rx d 1 aa\n\
             0.200000 1 123 Rx d 2 bb\n\
             0.300000 1 123 Rx d 1 cc",
        )
        .unwrap();

        assert_eq!(parsed.frames.len(), 2);
        assert_eq!(parsed.skipped_line_count, 1);
        assert_eq!(parsed.frames[0].timestamp_ns, 100_000_000);
        assert_eq!(parsed.frames[1].timestamp_ns, 600_000_000);
    }

    #[test]
    fn rejects_invalid_base_declaration() {
        assert_eq!(
            parse("base nope timestamps absolute\n0.001 1 123 Rx d 1 aa").unwrap_err(),
            TraceError::InvalidBaseLine
        );
    }

    #[test]
    fn parses_vector_date_to_unix_milliseconds() {
        assert_eq!(
            parse_vector_date_to_unix_ms("Tue Apr 28 10:00:00.123 2026"),
            Ok(1_777_370_400_123)
        );
    }

    #[test]
    fn matches_the_browser_integration_fixture_metadata() {
        let parsed = parse(include_str!("../../tests/fixtures/agentic-demo.asc")).unwrap();

        assert_eq!(parsed.measurement_start_ms, Some(1_777_550_400_000));
        assert_eq!(parsed.data_frame_count, 1_506);
        assert_eq!(parsed.skipped_line_count, 0);
        assert_eq!(parsed.last_data_timestamp_ns, Some(25_050_000_000));
    }

    #[test]
    fn preserves_relative_timing_on_non_utf8_lines() {
        let parsed = parse_bytes(
            b"base hex timestamps relative\n\
              0.100 1 123 Rx d 1 aa\n\
              0.200 unknown \xff event\n\
              0.300 1 123 Rx d 1 bb",
        )
        .unwrap();

        assert_eq!(parsed.frames.len(), 3);
        assert_eq!(parsed.data_frame_count, 2);
        assert_eq!(parsed.frames[0].timestamp_ns, 100_000_000);
        assert_eq!(parsed.frames[1].timestamp_ns, 300_000_000);
        assert_eq!(parsed.frames[2].timestamp_ns, 600_000_000);
        assert_eq!(parsed.skipped_line_count, 0);
    }

    #[test]
    fn counts_an_overflowing_timestamp_as_a_skipped_line() {
        let parsed = parse(
            "base hex timestamps absolute\n\
             18446744073709551616 1 123 Rx d 1 aa\n\
             0.001 1 123 Rx d 1 bb",
        )
        .unwrap();

        assert_eq!(parsed.skipped_line_count, 1);
        assert_eq!(parsed.data_frame_count, 1);
    }
}
