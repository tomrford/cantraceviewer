use std::error::Error as StdError;
use std::fmt;
use std::num::{ParseFloatError, ParseIntError};

/// Errors produced while parsing DBC data or decoding a DBC signal.
#[derive(Debug)]
pub enum DbcError {
    AtRecord {
        line: usize,
        column: usize,
        keyword: &'static str,
        source: Box<DbcError>,
    },
    InvalidMessageLine,
    UnterminatedRecord,
    InvalidSignalLine,
    SignalWithoutMessage,
    InvalidValueDescriptionLine,
    InvalidValueTableLine,
    InvalidSignalValueTypeLine,
    InvalidQuotedString,
    InvalidInteger {
        field: &'static str,
        source: ParseIntError,
    },
    InvalidFloat {
        field: &'static str,
        source: ParseFloatError,
    },
    NonFiniteSignalNumber {
        field: &'static str,
    },
    RawValueOutsideJsSafeIntegerRange(i64),
    UnsupportedMessageLength(u16),
    UnsupportedMultiplexing,
    UnsupportedSignalType,
    InvalidSignalBitLength(u16),
    SignalOutsideMessage,
    InvalidPayloadLength {
        expected: usize,
        actual: usize,
    },
}

impl DbcError {
    pub(crate) fn invalid_integer(field: &'static str, source: ParseIntError) -> Self {
        Self::InvalidInteger { field, source }
    }

    pub(crate) fn invalid_float(field: &'static str, source: ParseFloatError) -> Self {
        Self::InvalidFloat { field, source }
    }
}

impl fmt::Display for DbcError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::AtRecord {
                line,
                column,
                keyword,
                source,
            } => write!(formatter, "DBC input:{line}:{column}: {keyword}: {source}"),
            Self::UnterminatedRecord => {
                formatter.write_str("DBC record is missing its terminating semicolon")
            }
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
            Self::InvalidInteger { field, .. } => {
                write!(formatter, "invalid integer for {field}")
            }
            Self::InvalidFloat { field, .. } => {
                write!(formatter, "invalid number for {field}")
            }
            Self::NonFiniteSignalNumber { field, .. } => {
                write!(formatter, "non-finite number for {field}")
            }
            Self::RawValueOutsideJsSafeIntegerRange(value) => write!(
                formatter,
                "raw value {value} is outside JavaScript's safe integer range"
            ),
            Self::UnsupportedMessageLength(length) => {
                write!(formatter, "message length {length} exceeds 64 bytes")
            }
            Self::UnsupportedSignalType => {
                formatter.write_str("named signal types can change decoding and are not supported")
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
            Self::AtRecord { source, .. } => Some(source.as_ref()),
            Self::InvalidInteger { source, .. } => Some(source),
            Self::InvalidFloat { source, .. } => Some(source),
            _ => None,
        }
    }
}
