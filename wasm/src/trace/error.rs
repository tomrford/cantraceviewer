use std::error::Error;
use std::fmt;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum TraceError {
    InvalidBaseLine,
    InvalidVectorDate,
    InvalidTimestamp,
    TimestampTooPrecise,
    TimestampOverflow,
    InvalidId,
    InvalidDlc,
    InvalidPayloadLength,
    InvalidFrameLine,
    PayloadOffsetOverflow,
    UnsupportedTrcVersion,
    UnsupportedTrcColumn,
    InvalidTrcColumns,
    InvalidStartTime,
}

impl fmt::Display for TraceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::InvalidBaseLine => "invalid ASC base declaration",
            Self::InvalidVectorDate => "invalid ASC measurement date",
            Self::InvalidTimestamp => "invalid trace timestamp",
            Self::TimestampTooPrecise => "trace timestamp has more precision than supported",
            Self::TimestampOverflow => "trace timestamp is outside the supported range",
            Self::InvalidId => "invalid CAN identifier",
            Self::InvalidDlc => "invalid CAN data length code",
            Self::InvalidPayloadLength => "payload length does not match the CAN data length code",
            Self::InvalidFrameLine => "invalid trace frame line",
            Self::PayloadOffsetOverflow => "trace payload storage exceeds the supported range",
            Self::UnsupportedTrcVersion => "unsupported PCAN TRC version",
            Self::UnsupportedTrcColumn => "unsupported PCAN TRC column",
            Self::InvalidTrcColumns => "invalid PCAN TRC column declaration",
            Self::InvalidStartTime => "invalid PCAN TRC measurement start",
        })
    }
}

impl Error for TraceError {}
