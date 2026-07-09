use std::num::IntErrorKind;
use std::str::SplitWhitespace;

use crate::trace::{
    CanId, ExtraPrecision, Frame, FrameKind, TraceError, decimal_fraction_to_units,
};

pub(crate) use crate::trace::fd_payload_length_from_dlc;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Base {
    Hex,
    Dec,
}

impl Base {
    const fn radix(self) -> u32 {
        match self {
            Self::Hex => 16,
            Self::Dec => 10,
        }
    }
}

pub(crate) fn parse_line(
    base: Base,
    line: &str,
    payload_out: &mut [u8; 64],
) -> Result<Option<Frame>, TraceError> {
    let mut tokens = line.split_whitespace();
    let Some(timestamp_text) = tokens.next() else {
        return Ok(None);
    };
    let timestamp_ns = match parse_decimal_seconds_to_ns(timestamp_text) {
        Ok(timestamp) => timestamp,
        Err(TraceError::InvalidTimestamp) => return Ok(None),
        Err(error) => return Err(error),
    };

    let Some(first) = tokens.next() else {
        return Ok(Some(Frame {
            timestamp_ns,
            kind: FrameKind::Unknown,
            ..Frame::default()
        }));
    };
    if first == "CANFD" {
        return parse_can_fd(base, timestamp_ns, &mut tokens, payload_out).map(Some);
    }

    let Some(id_or_kind) = tokens.next() else {
        return Ok(Some(Frame {
            timestamp_ns,
            kind: FrameKind::Unknown,
            ..Frame::default()
        }));
    };
    if id_or_kind == "ErrorFrame" {
        return Ok(Some(Frame {
            timestamp_ns,
            kind: FrameKind::Error,
            ..Frame::default()
        }));
    }

    let id = match parse_id(base, id_or_kind) {
        Ok(id) => id,
        Err(_) => {
            return Ok(Some(Frame {
                timestamp_ns,
                kind: FrameKind::Unknown,
                ..Frame::default()
            }));
        }
    };
    if tokens.next().is_none() {
        return Ok(Some(unknown_frame(timestamp_ns)));
    }
    let Some(frame_kind) = tokens.next() else {
        return Ok(Some(unknown_frame(timestamp_ns)));
    };

    match frame_kind {
        "d" => {
            let dlc = parse_dlc(tokens.next().ok_or(TraceError::InvalidFrameLine)?)?;
            if dlc > 8 {
                return Err(TraceError::InvalidDlc);
            }
            for byte in payload_out.iter_mut().take(dlc as usize) {
                *byte = parse_byte(base, tokens.next().ok_or(TraceError::InvalidFrameLine)?)?;
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
        "r" => {
            let dlc = tokens.next().map(parse_dlc).transpose()?.unwrap_or(0);
            Ok(Some(Frame {
                timestamp_ns,
                kind: FrameKind::Remote,
                id: Some(id),
                dlc,
                ..Frame::default()
            }))
        }
        _ => Ok(Some(unknown_frame(timestamp_ns))),
    }
}

fn parse_can_fd(
    base: Base,
    timestamp_ns: u64,
    tokens: &mut SplitWhitespace<'_>,
    payload_out: &mut [u8; 64],
) -> Result<Frame, TraceError> {
    tokens.next().ok_or(TraceError::InvalidFrameLine)?;
    tokens.next().ok_or(TraceError::InvalidFrameLine)?;
    let id = parse_id(base, tokens.next().ok_or(TraceError::InvalidFrameLine)?)?;
    let after_id = tokens.next().ok_or(TraceError::InvalidFrameLine)?;
    if !is_unsigned_decimal(after_id) {
        tokens.next().ok_or(TraceError::InvalidFrameLine)?;
    }
    tokens.next().ok_or(TraceError::InvalidFrameLine)?;
    let dlc = parse_dlc(tokens.next().ok_or(TraceError::InvalidFrameLine)?)?;
    let payload_len = parse_payload_length(tokens.next().ok_or(TraceError::InvalidFrameLine)?)?;
    if payload_len != fd_payload_length_from_dlc(dlc)? {
        return Err(TraceError::InvalidPayloadLength);
    }

    for byte in payload_out.iter_mut().take(payload_len as usize) {
        *byte = parse_byte(base, tokens.next().ok_or(TraceError::InvalidFrameLine)?)?;
    }

    Ok(Frame {
        timestamp_ns,
        kind: FrameKind::Data,
        id: Some(id),
        is_fd: true,
        dlc,
        payload_len,
        ..Frame::default()
    })
}

fn unknown_frame(timestamp_ns: u64) -> Frame {
    Frame {
        timestamp_ns,
        kind: FrameKind::Unknown,
        ..Frame::default()
    }
}

fn is_unsigned_decimal(text: &str) -> bool {
    !text.is_empty() && text.bytes().all(|byte| byte.is_ascii_digit())
}

fn parse_id(base: Base, text: &str) -> Result<CanId, TraceError> {
    let (id_text, explicitly_extended) = match text.strip_suffix(['x', 'X']) {
        Some(id) => (id, true),
        None => (text, false),
    };
    let value = u32::from_str_radix(id_text, base.radix()).map_err(|_| TraceError::InvalidId)?;
    if explicitly_extended || value > 0x7ff {
        CanId::extended(value)
    } else {
        CanId::standard(value)
    }
}

fn parse_dlc(text: &str) -> Result<u8, TraceError> {
    let dlc = text.parse::<u8>().map_err(|_| TraceError::InvalidDlc)?;
    (dlc <= 15).then_some(dlc).ok_or(TraceError::InvalidDlc)
}

fn parse_payload_length(text: &str) -> Result<u8, TraceError> {
    let payload_len = text
        .parse::<u8>()
        .map_err(|_| TraceError::InvalidPayloadLength)?;
    (payload_len <= 64)
        .then_some(payload_len)
        .ok_or(TraceError::InvalidPayloadLength)
}

fn parse_byte(base: Base, text: &str) -> Result<u8, TraceError> {
    u8::from_str_radix(text, base.radix()).map_err(|_| TraceError::InvalidFrameLine)
}

pub(crate) fn parse_decimal_seconds_to_ns(text: &str) -> Result<u64, TraceError> {
    if text.is_empty() {
        return Err(TraceError::InvalidTimestamp);
    }
    let mut parts = text.split('.');
    let seconds_text = parts.next().ok_or(TraceError::InvalidTimestamp)?;
    let fraction = parts.next();
    if parts.next().is_some() {
        return Err(TraceError::InvalidTimestamp);
    }

    let seconds = seconds_text
        .parse::<u64>()
        .map_err(|error| match error.kind() {
            IntErrorKind::PosOverflow => TraceError::TimestampOverflow,
            _ => TraceError::InvalidTimestamp,
        })?;
    let mut nanoseconds = seconds
        .checked_mul(1_000_000_000)
        .ok_or(TraceError::TimestampOverflow)?;
    if let Some(fraction) = fraction {
        let fraction_ns =
            decimal_fraction_to_units(fraction, 1_000_000_000, 9, ExtraPrecision::Reject)?;
        nanoseconds = nanoseconds
            .checked_add(fraction_ns)
            .ok_or(TraceError::TimestampOverflow)?;
    }
    Ok(nanoseconds)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_classic_data_remote_error_and_decimal_frames() {
        let mut payload = [0_u8; 64];
        let data = parse_line(Base::Hex, "0.003040 1 123 Rx d 2 AA bb", &mut payload)
            .unwrap()
            .unwrap();
        assert_eq!(data.timestamp_ns, 3_040_000);
        assert_eq!(data.kind, FrameKind::Data);
        assert_eq!(data.id, Some(CanId::standard(0x123).unwrap()));
        assert_eq!(&payload[..2], &[0xaa, 0xbb]);

        let remote = parse_line(Base::Hex, "2.5 1 123 Rx r 8", &mut payload)
            .unwrap()
            .unwrap();
        assert_eq!(remote.kind, FrameKind::Remote);
        assert_eq!(remote.dlc, 8);

        let error = parse_line(Base::Hex, "3.0 2 ErrorFrame flags", &mut payload)
            .unwrap()
            .unwrap();
        assert_eq!(error.kind, FrameKind::Error);
        assert_eq!(error.id, None);

        let decimal = parse_line(Base::Dec, "4.0 1 291 Rx d 2 170 187", &mut payload)
            .unwrap()
            .unwrap();
        assert_eq!(decimal.id, Some(CanId::standard(291).unwrap()));
        assert_eq!(&payload[..2], &[0xaa, 0xbb]);
    }

    #[test]
    fn parses_extended_classic_frame() {
        let mut payload = [0_u8; 64];
        let frame = parse_line(Base::Hex, "1.0 CAN_A 18fee900x Tx d 1 55", &mut payload)
            .unwrap()
            .unwrap();
        assert_eq!(frame.id, Some(CanId::extended(0x18fee900).unwrap()));
    }

    #[test]
    fn parses_can_fd_with_and_without_symbol_placeholder() {
        let mut payload = [0_u8; 64];
        let symbolic = parse_line(
            Base::Hex,
            "5.0 CANFD 1 Rx 18fee900x - 1 0 9 12 01 02 03 04 05 06 07 08 09 0a 0b 0c",
            &mut payload,
        )
        .unwrap()
        .unwrap();
        assert!(symbolic.is_fd);
        assert_eq!(symbolic.dlc, 9);
        assert_eq!(symbolic.payload_len, 12);
        assert_eq!(payload[11], 0x0c);

        let no_symbol = parse_line(
            Base::Hex,
            "0.007015 CANFD 1 Rx 320 0 0 8 8 00 00 00 00 00 00 00 00 0 0 200000 0 0 0 0 0",
            &mut payload,
        )
        .unwrap()
        .unwrap();
        assert_eq!(no_symbol.id, Some(CanId::standard(0x320).unwrap()));
        assert_eq!(no_symbol.payload_len, 8);
    }

    #[test]
    fn rejects_can_fd_payload_length_mismatch() {
        let mut payload = [0_u8; 64];
        assert_eq!(
            parse_line(
                Base::Hex,
                "5.0 CANFD 1 Rx 18fee900x - 1 0 9 8 01 02 03 04 05 06 07 08",
                &mut payload,
            ),
            Err(TraceError::InvalidPayloadLength)
        );
    }

    #[test]
    fn preserves_timestamped_unknown_lines_and_ignores_headers() {
        let mut payload = [0_u8; 64];
        let unknown = parse_line(
            Base::Hex,
            "6.25 CANFD_STATISTIC whatever else",
            &mut payload,
        )
        .unwrap()
        .unwrap();
        assert_eq!(unknown.timestamp_ns, 6_250_000_000);
        assert_eq!(unknown.kind, FrameKind::Unknown);
        assert_eq!(
            parse_line(Base::Hex, "date Tue Apr 28 10:00:00.000 2026", &mut payload,),
            Ok(None)
        );
    }
}
