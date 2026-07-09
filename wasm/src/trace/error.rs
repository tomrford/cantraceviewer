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
    FrameIndexOverflow,
    OutOfMemory,
    UnsupportedTrcVersion,
    UnsupportedTrcColumn,
    InvalidTrcColumns,
    InvalidStartTime,
}

impl TraceError {
    pub(crate) const fn code(&self) -> &'static str {
        match self {
            Self::InvalidBaseLine => "InvalidBaseLine",
            Self::InvalidVectorDate => "InvalidVectorDate",
            Self::InvalidTimestamp => "InvalidTimestamp",
            Self::TimestampTooPrecise => "TimestampTooPrecise",
            Self::TimestampOverflow => "TimestampOverflow",
            Self::InvalidId => "InvalidId",
            Self::InvalidDlc => "InvalidDlc",
            Self::InvalidPayloadLength => "InvalidPayloadLength",
            Self::InvalidFrameLine => "InvalidFrameLine",
            Self::PayloadOffsetOverflow => "PayloadOffsetOverflow",
            Self::FrameIndexOverflow => "FrameIndexOverflow",
            Self::OutOfMemory => "OutOfMemory",
            Self::UnsupportedTrcVersion => "UnsupportedTrcVersion",
            Self::UnsupportedTrcColumn => "UnsupportedTrcColumn",
            Self::InvalidTrcColumns => "InvalidTrcColumns",
            Self::InvalidStartTime => "InvalidStartTime",
        }
    }
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
            Self::FrameIndexOverflow => "trace contains too many frames to index",
            Self::OutOfMemory => "not enough memory to store the trace",
            Self::UnsupportedTrcVersion => "unsupported PCAN TRC version",
            Self::UnsupportedTrcColumn => "unsupported PCAN TRC column",
            Self::InvalidTrcColumns => "invalid PCAN TRC column declaration",
            Self::InvalidStartTime => "invalid PCAN TRC measurement start",
        })
    }
}

impl Error for TraceError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exposes_stable_machine_codes() {
        assert_eq!(TraceError::InvalidFrameLine.code(), "InvalidFrameLine");
        assert_eq!(
            TraceError::UnsupportedTrcVersion.to_string(),
            "unsupported PCAN TRC version"
        );
    }
}
