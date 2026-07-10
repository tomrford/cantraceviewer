use std::num::IntErrorKind;

use crate::trace::{
    CanId, ExtraPrecision, TraceError, decimal_fraction_to_units, fd_payload_length_from_dlc,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum Version {
    V10,
    V11,
    V12,
    V13,
    V20,
    V21,
    V30,
}

impl Version {
    pub(super) fn from_text(text: &str) -> Result<Self, TraceError> {
        match text {
            "1.0" => Ok(Self::V10),
            "1.1" => Ok(Self::V11),
            "1.2" => Ok(Self::V12),
            "1.3" => Ok(Self::V13),
            "2.0" => Ok(Self::V20),
            "2.1" => Ok(Self::V21),
            "3.0" => Ok(Self::V30),
            _ => Err(TraceError::UnsupportedTrcVersion),
        }
    }

    pub(super) const fn is_v2(self) -> bool {
        matches!(self, Self::V20 | Self::V21)
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(super) struct ColumnMap {
    pub(super) number: Option<usize>,
    pub(super) offset: Option<usize>,
    pub(super) record_type: Option<usize>,
    pub(super) bus: Option<usize>,
    pub(super) id: Option<usize>,
    pub(super) direction: Option<usize>,
    pub(super) reserved: Option<usize>,
    pub(super) data_len: Option<usize>,
    pub(super) dlc: Option<usize>,
    pub(super) data: Option<usize>,
    pub(super) token_count_before_data: usize,
}

impl ColumnMap {
    pub(super) fn from_text(text: &str) -> Result<Self, TraceError> {
        let mut map = Self::default();
        for (index, raw_part) in text.split(',').enumerate() {
            match raw_part.trim_matches([' ', '\t', '\r']) {
                "N" => map.number = Some(index),
                "O" => map.offset = Some(index),
                "T" => map.record_type = Some(index),
                "B" => map.bus = Some(index),
                "I" => map.id = Some(index),
                "d" => map.direction = Some(index),
                "R" => map.reserved = Some(index),
                "l" => map.data_len = Some(index),
                "L" => map.dlc = Some(index),
                "D" => map.data = Some(index),
                _ => return Err(TraceError::UnsupportedTrcColumn),
            }
        }

        if map.offset.is_none()
            || map.record_type.is_none()
            || map.id.is_none()
            || map.direction.is_none()
            || map.data.is_none()
            || (map.data_len.is_none() && map.dlc.is_none())
        {
            return Err(TraceError::InvalidTrcColumns);
        }
        map.token_count_before_data = map.data.expect("data column checked above");
        Ok(map)
    }
}

pub(crate) fn parse_timestamp_ms_to_ns(text: &str) -> Result<u64, TraceError> {
    if text.is_empty() || text.starts_with('-') {
        return Err(TraceError::InvalidTimestamp);
    }
    let mut parts = text.split('.');
    let milliseconds = parts
        .next()
        .ok_or(TraceError::InvalidTimestamp)?
        .parse::<u64>()
        .map_err(|error| match error.kind() {
            IntErrorKind::PosOverflow => TraceError::TimestampOverflow,
            _ => TraceError::InvalidTimestamp,
        })?;
    let fraction = parts.next();
    if parts.next().is_some() {
        return Err(TraceError::InvalidTimestamp);
    }

    let mut nanoseconds = milliseconds
        .checked_mul(1_000_000)
        .ok_or(TraceError::TimestampOverflow)?;
    if let Some(fraction) = fraction {
        nanoseconds = nanoseconds
            .checked_add(decimal_fraction_to_units(
                fraction,
                1_000_000,
                6,
                ExtraPrecision::Reject,
            )?)
            .ok_or(TraceError::TimestampOverflow)?;
    }
    Ok(nanoseconds)
}

pub(super) fn id_from_text(text: &str) -> Result<CanId, TraceError> {
    if !matches!(text.len(), 4 | 8) {
        return Err(TraceError::InvalidId);
    }
    let value = u32::from_str_radix(text, 16).map_err(|_| TraceError::InvalidId)?;
    if text.len() == 8 {
        CanId::extended(value)
    } else {
        CanId::standard(value)
    }
}

pub(super) fn parse_dlc(text: &str) -> Result<u8, TraceError> {
    let dlc = text.parse::<u8>().map_err(|_| TraceError::InvalidDlc)?;
    (dlc <= 15).then_some(dlc).ok_or(TraceError::InvalidDlc)
}

pub(super) fn parse_payload_length(text: &str) -> Result<u8, TraceError> {
    let length = text
        .parse::<u8>()
        .map_err(|_| TraceError::InvalidPayloadLength)?;
    (length <= 64)
        .then_some(length)
        .ok_or(TraceError::InvalidPayloadLength)
}

pub(super) fn parse_byte(text: &str) -> Result<u8, TraceError> {
    u8::from_str_radix(text, 16).map_err(|_| TraceError::InvalidFrameLine)
}

pub(super) fn fd_length(dlc: u8) -> Result<u8, TraceError> {
    fd_payload_length_from_dlc(dlc)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_millisecond_timestamps_without_floats() {
        assert_eq!(parse_timestamp_ms_to_ns("0"), Ok(0));
        assert_eq!(parse_timestamp_ms_to_ns("1.234"), Ok(1_234_000));
        assert_eq!(parse_timestamp_ms_to_ns("1.234567"), Ok(1_234_567));
        assert_eq!(
            parse_timestamp_ms_to_ns("-1.0"),
            Err(TraceError::InvalidTimestamp)
        );
    }

    #[test]
    fn parses_id_width_into_standard_or_extended_identity() {
        assert_eq!(id_from_text("0123"), CanId::standard(0x123));
        assert_eq!(id_from_text("18FEE900"), CanId::extended(0x18fee900));
        assert_eq!(id_from_text("0800"), Err(TraceError::InvalidId));
    }

    #[test]
    fn validates_column_contract() {
        let columns = ColumnMap::from_text("N,O,T,B,I,d,R,L,D").unwrap();
        assert_eq!(columns.offset, Some(1));
        assert_eq!(columns.data, Some(8));
        assert_eq!(
            ColumnMap::from_text("N,O"),
            Err(TraceError::InvalidTrcColumns)
        );
    }
}
