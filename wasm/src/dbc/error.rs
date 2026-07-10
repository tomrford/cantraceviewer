use std::error::Error as StdError;
use std::fmt;
use std::num::{ParseFloatError, ParseIntError};

/// Errors produced while parsing DBC data or decoding a DBC signal.
#[derive(Debug)]
pub enum DbcError {
    InvalidMessageLine,
    InvalidSignalLine,
    SignalWithoutMessage,
    InvalidValueDescriptionLine,
    InvalidValueTableLine,
    InvalidSignalValueTypeLine,
    InvalidQuotedString,
    InvalidInteger {
        field: &'static str,
        value: String,
        source: ParseIntError,
    },
    InvalidFloat {
        field: &'static str,
        value: String,
        source: ParseFloatError,
    },
    NonFiniteSignalNumber {
        field: &'static str,
        value: String,
    },
    RawValueOutsideJsSafeIntegerRange(i64),
    UnsupportedMessageLength(u16),
    UnsupportedMultiplexing,
    InvalidSignalBitLength(u16),
    SignalOutsideMessage,
    InvalidPayloadLength {
        expected: usize,
        actual: usize,
    },
}

impl DbcError {
    pub(crate) fn invalid_integer(field: &'static str, value: &str, source: ParseIntError) -> Self {
        Self::InvalidInteger {
            field,
            value: value.to_owned(),
            source,
        }
    }

    pub(crate) fn invalid_float(field: &'static str, value: &str, source: ParseFloatError) -> Self {
        Self::InvalidFloat {
            field,
            value: value.to_owned(),
            source,
        }
    }
}

impl fmt::Display for DbcError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidMessageLine => formatter.write_str("invalid DBC message record"),
            Self::InvalidSignalLine => formatter.write_str("invalid DBC signal record"),
            Self::SignalWithoutMessage => {
                formatter.write_str("DBC signal appears before a message record")
            }
            Self::InvalidValueDescriptionLine => {
                formatter.write_str("invalid DBC value-description record")
            }
            Self::InvalidValueTableLine => formatter.write_str("invalid DBC value-table record"),
            Self::InvalidSignalValueTypeLine => {
                formatter.write_str("invalid DBC signal value-type record")
            }
            Self::InvalidQuotedString => formatter.write_str("invalid quoted DBC string"),
            Self::InvalidInteger { field, value, .. } => {
                write!(formatter, "invalid integer for {field}: {value:?}")
            }
            Self::InvalidFloat { field, value, .. } => {
                write!(formatter, "invalid number for {field}: {value:?}")
            }
            Self::NonFiniteSignalNumber { field, value } => {
                write!(formatter, "non-finite number for {field}: {value:?}")
            }
            Self::RawValueOutsideJsSafeIntegerRange(value) => write!(
                formatter,
                "raw value {value} is outside JavaScript's safe integer range"
            ),
            Self::UnsupportedMessageLength(length) => {
                write!(formatter, "message length {length} exceeds 64 bytes")
            }
            Self::UnsupportedMultiplexing => {
                formatter.write_str("multiplexed DBC signals are not supported")
            }
            Self::InvalidSignalBitLength(length) => {
                write!(formatter, "invalid signal bit length: {length}")
            }
            Self::SignalOutsideMessage => {
                formatter.write_str("signal bit range falls outside its message")
            }
            Self::InvalidPayloadLength { expected, actual } => write!(
                formatter,
                "payload length is {actual} bytes, expected {expected} bytes"
            ),
        }
    }
}

impl StdError for DbcError {
    fn source(&self) -> Option<&(dyn StdError + 'static)> {
        match self {
            Self::InvalidInteger { source, .. } => Some(source),
            Self::InvalidFloat { source, .. } => Some(source),
            _ => None,
        }
    }
}
