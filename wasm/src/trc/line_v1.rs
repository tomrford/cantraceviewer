use crate::trace::{Frame, FrameKind, TraceError};

use super::frame;

pub(super) fn parse_line(
    line: &str,
    payload_out: &mut [u8; 64],
) -> Result<Option<Frame>, TraceError> {
    let mut tokens = line.split_whitespace();
    let Some(first) = tokens.next() else {
        return Ok(None);
    };
    let timestamp_text = if looks_like_line_number(first) {
        let Some(timestamp) = tokens.next() else {
            return Ok(None);
        };
        timestamp
    } else {
        first
    };
    let timestamp_ns = match frame::parse_timestamp_ms_to_ns(timestamp_text) {
        Ok(timestamp) => timestamp,
        Err(TraceError::InvalidTimestamp) => return Ok(None),
        Err(error) => return Err(error),
    };

    let mut rest = [""; 96];
    let mut rest_len = 0;
    for token in tokens {
        if rest_len == rest.len() {
            return Err(TraceError::InvalidFrameLine);
        }
        rest[rest_len] = token;
        rest_len += 1;
    }
    let rest = &rest[..rest_len];
    let Some(id_index) = find_id_index(rest) else {
        return Ok(Some(unknown_frame(timestamp_ns)));
    };
    let type_token = if id_index > 0 && is_type_token(rest[id_index - 1]) {
        rest[id_index - 1]
    } else {
        ""
    };
    let id_text = rest[id_index];

    if id_text == "FFFFFFFF" || is_error_type(type_token) {
        return Ok(Some(Frame {
            timestamp_ns,
            kind: FrameKind::Error,
            ..Frame::default()
        }));
    }
    let id = match frame::id_from_text(id_text) {
        Ok(id) => id,
        Err(_) => return Ok(Some(unknown_frame(timestamp_ns))),
    };

    let dlc_index = if rest.get(id_index + 1) == Some(&"-") {
        id_index + 2
    } else {
        id_index + 1
    };
    let Some(dlc_text) = rest.get(dlc_index) else {
        return Ok(Some(unknown_frame(timestamp_ns)));
    };
    let dlc = frame::parse_dlc(dlc_text)?;
    if dlc > 8 {
        return Ok(Some(unknown_frame(timestamp_ns)));
    }

    let data_marker = rest.get(dlc_index + 1).copied().unwrap_or("");
    if is_error_type(data_marker) {
        return Ok(Some(Frame {
            timestamp_ns,
            kind: FrameKind::Error,
            ..Frame::default()
        }));
    }
    if is_remote_type(type_token) || is_remote_type(data_marker) {
        return Ok(Some(Frame {
            timestamp_ns,
            kind: FrameKind::Remote,
            id: Some(id),
            dlc,
            ..Frame::default()
        }));
    }

    for (index, byte) in payload_out.iter_mut().take(dlc as usize).enumerate() {
        *byte = frame::parse_byte(
            rest.get(dlc_index + 1 + index)
                .ok_or(TraceError::InvalidFrameLine)?,
        )?;
    }
    Ok(Some(Frame {
        timestamp_ns,
        kind: FrameKind::Data,
        id: Some(id),
        dlc,
        payload_len: dlc,
        ..Frame::default()
    }))
}

fn unknown_frame(timestamp_ns: u64) -> Frame {
    Frame {
        timestamp_ns,
        kind: FrameKind::Unknown,
        ..Frame::default()
    }
}

fn find_id_index(tokens: &[&str]) -> Option<usize> {
    tokens.iter().position(|token| {
        *token == "FFFFFFFF"
            || (matches!(token.len(), 4 | 8) && u32::from_str_radix(token, 16).is_ok())
    })
}

fn looks_like_line_number(text: &str) -> bool {
    let digits = text.strip_suffix(')').unwrap_or(text);
    !digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_digit())
}

fn is_type_token(text: &str) -> bool {
    matches!(text, "Rx" | "Tx") || is_remote_type(text) || is_error_type(text)
}

fn is_remote_type(text: &str) -> bool {
    matches!(text, "RTR" | "RR")
}

fn is_error_type(text: &str) -> bool {
    matches!(
        text,
        "Error" | "ErrorFrame" | "ERROR" | "ERRORFRAME" | "Warning"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::trace::CanId;

    #[test]
    fn parses_data_remote_error_bus_and_v13_shapes() {
        let mut payload = [0_u8; 64];
        let data = parse_line("1 0.100 Rx 0123 2 AA bb", &mut payload)
            .unwrap()
            .unwrap();
        assert_eq!(data.timestamp_ns, 100_000);
        assert_eq!(data.kind, FrameKind::Data);
        assert_eq!(data.id, Some(CanId::standard(0x123).unwrap()));
        assert_eq!(payload[0], 0xaa);

        let remote = parse_line("2 0.200 RTR 0123 8", &mut payload)
            .unwrap()
            .unwrap();
        assert_eq!(remote.kind, FrameKind::Remote);
        assert_eq!(remote.dlc, 8);

        let marker_remote = parse_line("2 0.250 Rx 0123 3 RTR", &mut payload)
            .unwrap()
            .unwrap();
        assert_eq!(marker_remote.kind, FrameKind::Remote);

        let marker_error = parse_line("2 0.275 Rx 0123 3 ERROR", &mut payload)
            .unwrap()
            .unwrap();
        assert_eq!(marker_error.kind, FrameKind::Error);

        let with_bus = parse_line("3 0.300 1 Rx 0124 1 CC", &mut payload)
            .unwrap()
            .unwrap();
        assert_eq!(with_bus.id, Some(CanId::standard(0x124).unwrap()));

        let v13 = parse_line("1) 1.600 1 Rx 10062123 - 6 D2 AF AA 88 18 80", &mut payload)
            .unwrap()
            .unwrap();
        assert_eq!(v13.timestamp_ns, 1_600_000);
        assert_eq!(v13.id, Some(CanId::extended(0x10062123).unwrap()));

        let long = parse_line(
            "2) 1.700 1 Rx 10062123 - 9 D2 AF AA 88 18 80 01 02 03",
            &mut payload,
        )
        .unwrap()
        .unwrap();
        assert_eq!(long.kind, FrameKind::Unknown);
    }

    #[test]
    fn rejects_more_than_ninety_six_tokens() {
        let mut payload = [0_u8; 64];
        let line = format!("1 0.100 Rx 0123 1 {}", "00 ".repeat(97));
        assert_eq!(
            parse_line(&line, &mut payload),
            Err(TraceError::InvalidFrameLine)
        );
    }
}
