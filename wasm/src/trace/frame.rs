use super::TraceError;
use std::num::{NonZeroU16, NonZeroU32};

#[derive(Clone, Copy, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub(crate) enum Direction {
    #[default]
    Unknown,
    Rx,
    Tx,
}

impl Direction {
    pub(crate) fn from_text(text: &[u8]) -> Self {
        match text {
            b"Rx" => Self::Rx,
            b"Tx" => Self::Tx,
            _ => Self::Unknown,
        }
    }
    pub(crate) fn from_bit(value: u64) -> Self {
        match value {
            0 => Self::Rx,
            1 => Self::Tx,
            _ => Self::Unknown,
        }
    }
    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::Unknown => "unknown",
            Self::Rx => "rx",
            Self::Tx => "tx",
        }
    }
}

/// One-based format channel. Zero denotes unavailable channel metadata.
#[derive(Clone, Copy, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub(crate) struct RawSource {
    pub(crate) channel: Option<NonZeroU16>,
    pub(crate) direction: Direction,
}

pub(crate) fn parse_channel(text: &[u8]) -> Result<Option<NonZeroU16>, TraceError> {
    let text = std::str::from_utf8(text).map_err(|_| TraceError::InvalidFrameLine)?;
    let value = text
        .parse::<u16>()
        .map_err(|_| TraceError::InvalidFrameLine)?;
    Ok(NonZeroU16::new(value))
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) enum FrameKind {
    Data,
    Remote,
    Error,
    #[default]
    Unknown,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
// The validity bit gives Option<CanId> a zero niche. Channel and direction then
// fit in the existing 24-byte Frame rather than growing every occurrence to 32.
pub(crate) struct CanId(NonZeroU32);

impl CanId {
    pub(crate) fn standard(value: u32) -> Result<Self, TraceError> {
        if value > 0x7ff {
            return Err(TraceError::InvalidId);
        }
        Ok(Self(NonZeroU32::new(value | 0x4000_0000).unwrap()))
    }

    pub(crate) fn extended(value: u32) -> Result<Self, TraceError> {
        if value > 0x1fff_ffff {
            return Err(TraceError::InvalidId);
        }
        Ok(Self(NonZeroU32::new(value | 0xc000_0000).unwrap()))
    }

    pub(crate) fn value(self) -> u32 {
        self.0.get() & 0x1fff_ffff
    }
    pub(crate) fn is_extended(self) -> bool {
        self.0.get() & 0x8000_0000 != 0
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) struct Frame {
    pub(crate) timestamp_ns: u64,
    pub(crate) source: RawSource,
    pub(crate) kind: FrameKind,
    pub(crate) id: Option<CanId>,
    pub(crate) is_fd: bool,
    pub(crate) dlc: u8,
    pub(crate) payload_offset: u32,
    pub(crate) payload_len: u8,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_standard_and_extended_ids() {
        assert!(!CanId::standard(0x7ff).unwrap().is_extended());
        assert!(CanId::extended(0x1fff_ffff).unwrap().is_extended());
        assert_eq!(CanId::standard(0).unwrap().value(), 0);
        assert_eq!(CanId::extended(0x1fff_ffff).unwrap().value(), 0x1fff_ffff);
        assert_eq!(CanId::standard(0x800), Err(TraceError::InvalidId));
        assert_eq!(CanId::extended(0x2000_0000), Err(TraceError::InvalidId));
    }
}
