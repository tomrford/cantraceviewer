mod frame;
mod line_v1;
mod line_v2;

use crate::trace::{
    ExtraPrecision, FrameKind, Trace, TraceError, decimal_fraction_to_units, lossy_utf8_line,
};

use frame::{ColumnMap, Version};

#[derive(Debug)]
struct ParserState {
    version: Version,
    columns: Option<ColumnMap>,
    measurement_start_ms: Option<i64>,
}

impl Default for ParserState {
    fn default() -> Self {
        Self {
            version: Version::V10,
            columns: None,
            measurement_start_ms: None,
        }
    }
}

pub(crate) fn parse_bytes(bytes: &[u8]) -> Result<Trace, TraceError> {
    let mut state = ParserState::default();
    let mut trace = Trace::default();
    let mut payload_buffer = [0_u8; 64];
    let mut line_scratch = String::new();

    for raw_line_bytes in bytes.split(|&byte| byte == b'\n') {
        let raw_line = lossy_utf8_line(raw_line_bytes, &mut line_scratch)?;
        let line = raw_line.trim_matches([' ', '\t', '\r']);
        if line.is_empty() {
            continue;
        }
        if parse_header_line(&mut state, line)? {
            continue;
        }
        if state.version == Version::V30 {
            return Err(TraceError::UnsupportedTrcVersion);
        }
        if state.version.is_v2() && state.columns.is_none() {
            return Err(TraceError::InvalidTrcColumns);
        }

        let parsed_frame = if state.version.is_v2() {
            line_v2::parse_line(
                state.columns.as_ref().expect("v2 columns checked above"),
                line,
                &mut payload_buffer,
            )
        } else {
            line_v1::parse_line(line, &mut payload_buffer)
        };

        let parsed_frame = match parsed_frame {
            Ok(frame) => frame,
            Err(_) => {
                trace.skipped_line_count += 1;
                continue;
            }
        };
        let Some(mut parsed_frame) = parsed_frame else {
            continue;
        };

        trace
            .frames
            .try_reserve(1)
            .map_err(|_| TraceError::OutOfMemory)?;
        if parsed_frame.kind == FrameKind::Data && parsed_frame.id.is_some() {
            let payload_len = parsed_frame.payload_len as usize;
            trace
                .payloads
                .try_reserve(payload_len)
                .map_err(|_| TraceError::OutOfMemory)?;
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

    if state.version.is_v2() && state.columns.is_none() {
        return Err(TraceError::InvalidTrcColumns);
    }

    trace.measurement_start_ms = state.measurement_start_ms;
    Ok(trace)
}

#[cfg(test)]
pub(crate) fn parse(text: &str) -> Result<Trace, TraceError> {
    parse_bytes(text.as_bytes())
}

fn parse_header_line(state: &mut ParserState, line: &str) -> Result<bool, TraceError> {
    let Some(body) = line.strip_prefix(';') else {
        return Ok(false);
    };
    let body = body.trim_matches([' ', '\t', '\r']);

    if let Some(version) = body.strip_prefix("$FILEVERSION=") {
        state.version = Version::from_text(version.trim_matches([' ', '\t', '\r']))?;
    } else if let Some(start_time) = body.strip_prefix("$STARTTIME=") {
        state.measurement_start_ms =
            parse_ole_automation_days_to_unix_ms(start_time.trim_matches([' ', '\t', '\r', ';']))
                .ok();
    } else if let Some(columns) = body.strip_prefix("$COLUMNS=") {
        state.columns = Some(ColumnMap::from_text(columns)?);
    }

    Ok(true)
}

fn parse_ole_automation_days_to_unix_ms(text: &str) -> Result<i64, TraceError> {
    if text.is_empty() || text.starts_with('-') {
        return Err(TraceError::InvalidStartTime);
    }
    let mut parts = text.split('.');
    let days = parts
        .next()
        .ok_or(TraceError::InvalidStartTime)?
        .parse::<i64>()
        .map_err(|_| TraceError::InvalidStartTime)?;
    let fraction = parts.next();
    if parts.next().is_some() {
        return Err(TraceError::InvalidStartTime);
    }

    let mut milliseconds = days
        .checked_sub(25_569)
        .and_then(|value| value.checked_mul(86_400_000))
        .ok_or(TraceError::InvalidStartTime)?;
    if let Some(fraction) = fraction {
        let fraction_ms =
            decimal_fraction_to_units(fraction, 86_400_000, 9, ExtraPrecision::Truncate)?;
        milliseconds = milliseconds
            .checked_add(i64::try_from(fraction_ms).map_err(|_| TraceError::InvalidStartTime)?)
            .ok_or(TraceError::InvalidStartTime)?;
    }
    Ok(milliseconds)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::trace::FrameKind;

    #[test]
    fn parses_v1_file_and_metadata() {
        let parsed = parse(
            ";$FILEVERSION=1.1\n\
             ;$STARTTIME=46000.5\n\
             1 0.100 Rx 0123 2 AA BB\n\
             2 0.200 RTR 0123 8",
        )
        .unwrap();

        assert_eq!(parsed.measurement_start_ms, Some(1_765_281_600_000));
        assert_eq!(parsed.frames.len(), 2);
        assert_eq!(parsed.data_frame_count, 1);
        assert_eq!(parsed.frames[1].timestamp_ns, 200_000);
        assert_eq!(parsed.payloads, [0xaa, 0xbb]);
    }

    #[test]
    fn parses_high_precision_start_time_without_floats() {
        assert_eq!(
            parse_ole_automation_days_to_unix_ms("46141.6714340249528"),
            Ok(1_777_478_811_899)
        );
    }

    #[test]
    fn accepts_trailing_semicolon_on_start_time() {
        let parsed = parse(
            ";$FILEVERSION=1.2\n\
             ;$STARTTIME=39878.6772258947;\n\
             1 1059.900 1 Rx 0300 7 00 00 00 00 04 00 00",
        )
        .unwrap();
        assert_eq!(
            parsed.measurement_start_ms,
            Some(parse_ole_automation_days_to_unix_ms("39878.6772258947").unwrap())
        );
    }

    #[test]
    fn keeps_long_v13_j1939_record_as_unknown() {
        let parsed = parse(
            ";$FILEVERSION=1.3\n\
             1) 1.000 1 Rx 10062123 - 9 D2 AF AA 88 18 80 01 02 03\n\
             2) 2.000 1 Rx 0123 - 2 AA BB",
        )
        .unwrap();

        assert_eq!(parsed.frames.len(), 2);
        assert_eq!(parsed.frames[0].kind, FrameKind::Unknown);
        assert_eq!(parsed.frames[1].kind, FrameKind::Data);
        assert_eq!(parsed.data_frame_count, 1);
    }

    #[test]
    fn parses_v2_file_from_declared_columns() {
        let parsed = parse(
            ";$FILEVERSION=2.1\n\
             ;$COLUMNS=N,O,T,B,I,d,R,L,D\n\
             1 0.100 DT 1 0123 Rx - 2 AA BB\n\
             2 0.200 ER 1 - - - 0",
        )
        .unwrap();

        assert_eq!(parsed.frames.len(), 2);
        assert_eq!(parsed.data_frame_count, 1);
        assert_eq!(parsed.frames[1].kind, FrameKind::Error);
        assert_eq!(parsed.frames[1].timestamp_ns, 200_000);
    }

    #[test]
    fn rejects_unsupported_v3_and_invalid_v2_columns() {
        assert_eq!(
            parse(
                ";$FILEVERSION=3.0\n\
                 ;$COLUMNS=N,O,T,I,d,L,D\n\
                 1 0.100 DT 0123 Rx 2 AA BB"
            )
            .unwrap_err(),
            TraceError::UnsupportedTrcVersion
        );
        assert_eq!(
            parse(
                ";$FILEVERSION=2.1\n\
                 ;$COLUMNS=N,O\n\
                 1 0.100 DT 1 0123 Rx - 1 AA"
            )
            .unwrap_err(),
            TraceError::InvalidTrcColumns
        );
    }

    #[test]
    fn skips_truncated_v1_lines() {
        let parsed = parse(
            ";$FILEVERSION=1.1\n\
             1 0.100 Rx 0123 1 AA\n\
             2 0.200 Rx 0123 2 BB\n\
             3 0.300 Rx 0123 1 CC",
        )
        .unwrap();

        assert_eq!(parsed.frames.len(), 2);
        assert_eq!(parsed.data_frame_count, 2);
        assert_eq!(parsed.skipped_line_count, 1);
        assert_eq!(parsed.last_data_timestamp_ns, Some(300_000));
    }

    #[test]
    fn skips_truncated_v2_lines() {
        let parsed = parse(
            ";$FILEVERSION=2.1\n\
             ;$COLUMNS=N,O,T,B,I,d,R,L,D\n\
             1 0.100 DT 1 0123 Rx - 1 AA\n\
             2 0.200 DT 1 0123 Rx - 2 BB\n\
             3 0.300 DT 1 0123 Rx - 1 CC",
        )
        .unwrap();

        assert_eq!(parsed.frames.len(), 2);
        assert_eq!(parsed.data_frame_count, 2);
        assert_eq!(parsed.skipped_line_count, 1);
        assert_eq!(parsed.last_data_timestamp_ns, Some(300_000));
    }

    #[test]
    fn keeps_ascii_frame_fields_around_non_utf8_bytes() {
        let parsed =
            parse_bytes(b";$FILEVERSION=1.1\n1 0.100 Rx 0123 1 AA \xff\n2 0.200 Rx 0123 1 BB")
                .unwrap();

        assert_eq!(parsed.frames.len(), 2);
        assert_eq!(parsed.data_frame_count, 2);
        assert_eq!(parsed.skipped_line_count, 0);
    }

    #[test]
    fn counts_an_overflowing_v1_timestamp_as_a_skipped_line() {
        let parsed = parse(
            ";$FILEVERSION=1.1\n\
             1 18446744073709551616 Rx 0123 1 AA\n\
             2 0.100 Rx 0123 1 BB",
        )
        .unwrap();

        assert_eq!(parsed.skipped_line_count, 1);
        assert_eq!(parsed.data_frame_count, 1);
    }
}
