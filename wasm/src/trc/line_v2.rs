use crate::trace::{Frame, FrameKind, TraceError};

use super::frame::{self, ColumnMap};

pub(super) fn parse_line(
    columns: &ColumnMap,
    line: &str,
    payload_out: &mut [u8; 64],
) -> Result<Option<Frame>, TraceError> {
    let mut tokens = [""; 96];
    let mut token_count = 0;
    for token in line.split_whitespace() {
        if token_count == tokens.len() {
            return Err(TraceError::InvalidFrameLine);
        }
        tokens[token_count] = token;
        token_count += 1;
    }
    let tokens = &tokens[..token_count];
    if tokens.is_empty() {
        return Ok(None);
    }
    if tokens.len() < columns.token_count_before_data {
        return Err(TraceError::InvalidFrameLine);
    }

    let timestamp_ns = frame::parse_timestamp_ms_to_ns(token_at(
        tokens,
        columns.offset.expect("validated offset column"),
    ))?;
    let record_type = token_at(
        tokens,
        columns.record_type.expect("validated record type column"),
    );

    if is_non_data_record(record_type) {
        return Ok(Some(Frame {
            timestamp_ns,
            kind: if record_type == "ER" {
                FrameKind::Error
            } else {
                FrameKind::Unknown
            },
            ..Frame::default()
        }));
    }

    let id = match frame::id_from_text(token_at(tokens, columns.id.expect("validated id column"))) {
        Ok(id) => id,
        Err(_) => {
            return Ok(Some(Frame {
                timestamp_ns,
                kind: FrameKind::Unknown,
                ..Frame::default()
            }));
        }
    };

    if record_type == "RR" {
        return Ok(Some(Frame {
            timestamp_ns,
            kind: FrameKind::Remote,
            id: Some(id),
            dlc: parse_length_or_dlc(columns, tokens, false),
            ..Frame::default()
        }));
    }

    let is_fd = is_fd_record(record_type);
    if record_type != "DT" && !is_fd {
        return Ok(Some(Frame {
            timestamp_ns,
            kind: FrameKind::Unknown,
            ..Frame::default()
        }));
    }

    let dlc = match columns.dlc {
        Some(index) => frame::parse_dlc(token_at(tokens, index))?,
        None => frame::parse_dlc(token_at(
            tokens,
            columns.data_len.expect("validated length or DLC column"),
        ))?,
    };
    let payload_len = match columns.data_len {
        Some(index) => frame::parse_payload_length(token_at(tokens, index))?,
        None => frame::fd_length(dlc)?,
    };
    let expected_payload_len = if is_fd { frame::fd_length(dlc)? } else { dlc };
    if payload_len != expected_payload_len || (!is_fd && payload_len > 8) {
        return Err(TraceError::InvalidPayloadLength);
    }

    let data_start = columns.data.expect("validated data column");
    if tokens.len() < data_start + payload_len as usize {
        return Err(TraceError::InvalidFrameLine);
    }
    for (index, byte) in payload_out
        .iter_mut()
        .take(payload_len as usize)
        .enumerate()
    {
        *byte = frame::parse_byte(tokens[data_start + index])?;
    }

    Ok(Some(Frame {
        timestamp_ns,
        kind: FrameKind::Data,
        id: Some(id),
        is_fd,
        dlc,
        payload_len,
        ..Frame::default()
    }))
}

fn token_at<'a>(tokens: &'a [&str], index: usize) -> &'a str {
    tokens.get(index).copied().unwrap_or("")
}

fn parse_length_or_dlc(columns: &ColumnMap, tokens: &[&str], is_fd: bool) -> u8 {
    if let Some(index) = columns.data_len {
        return frame::parse_payload_length(token_at(tokens, index)).unwrap_or(0);
    }
    let dlc = columns
        .dlc
        .and_then(|index| frame::parse_dlc(token_at(tokens, index)).ok())
        .unwrap_or(0);
    if is_fd {
        frame::fd_length(dlc).unwrap_or(0)
    } else {
        dlc
    }
}

fn is_fd_record(record_type: &str) -> bool {
    matches!(record_type, "FD" | "FB" | "FE" | "BI")
}

fn is_non_data_record(record_type: &str) -> bool {
    matches!(record_type, "ST" | "ER" | "EC" | "EV")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_classic_and_fd_records_through_columns() {
        let columns = ColumnMap::from_text("N,O,T,B,I,d,R,L,D").unwrap();
        let mut payload = [0_u8; 64];

        let classic = parse_line(&columns, "1 0.100 DT 1 0123 Rx - 2 AA BB", &mut payload)
            .unwrap()
            .unwrap();
        assert_eq!(classic.kind, FrameKind::Data);
        assert!(!classic.is_fd);
        assert_eq!(classic.payload_len, 2);
        assert_eq!(payload[0], 0xaa);

        let fd = parse_line(
            &columns,
            "2 0.200 FD 1 18FEE900 Rx - 9 01 02 03 04 05 06 07 08 09 0A 0B 0C",
            &mut payload,
        )
        .unwrap()
        .unwrap();
        assert!(fd.is_fd);
        assert_eq!(fd.payload_len, 12);
        assert_eq!(payload[11], 0x0c);
    }

    #[test]
    fn rejects_more_than_ninety_six_tokens() {
        let columns = ColumnMap::from_text("N,O,T,B,I,d,R,L,D").unwrap();
        let mut payload = [0_u8; 64];
        let line = format!("1 0.100 DT 1 0123 Rx - 1 {}", "00 ".repeat(97));
        assert_eq!(
            parse_line(&columns, &line, &mut payload),
            Err(TraceError::InvalidFrameLine)
        );
    }
}
