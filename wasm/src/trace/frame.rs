use super::TraceError;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) enum FrameKind {
    Data,
    Remote,
    Error,
    #[default]
    Unknown,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(crate) struct CanId {
    pub(crate) value: u32,
    pub(crate) is_extended: bool,
}

impl CanId {
    pub(crate) fn standard(value: u32) -> Result<Self, TraceError> {
        if value > 0x7ff {
            return Err(TraceError::InvalidId);
        }
        Ok(Self {
            value,
            is_extended: false,
        })
    }

    pub(crate) fn extended(value: u32) -> Result<Self, TraceError> {
        if value > 0x1fff_ffff {
            return Err(TraceError::InvalidId);
        }
        Ok(Self {
            value,
            is_extended: true,
        })
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) struct Frame {
    pub(crate) timestamp_ns: u64,
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
        assert!(!CanId::standard(0x7ff).unwrap().is_extended);
        assert!(CanId::extended(0x1fff_ffff).unwrap().is_extended);
        assert_eq!(CanId::standard(0x800), Err(TraceError::InvalidId));
        assert_eq!(CanId::extended(0x2000_0000), Err(TraceError::InvalidId));
    }
}
