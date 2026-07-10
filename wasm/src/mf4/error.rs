use std::fmt;

#[derive(Debug)]
pub(crate) enum Mf4Error {
    InvalidHeader,
    UnsupportedVersion(String),
    UnsupportedUnfinalized,
    Truncated(&'static str),
    InvalidBlock(&'static str),
    LinkCycle,
    UnsupportedDataBlock(String),
    UnsupportedCompression(u8),
    DecompressedBlockTooLarge,
    InvalidCompressedData,
    InvalidRecord,
    UnsupportedRecordIdSize(u8),
    UnsupportedChannel(String),
    InvalidTimestamp,
    InvalidCanId,
    PayloadStorageTooLarge,
    NoPlottableData,
    SignalNotFound,
}

impl fmt::Display for Mf4Error {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidHeader => formatter.write_str("file is not a valid MDF4 file"),
            Self::UnsupportedVersion(version) => {
                write!(
                    formatter,
                    "unsupported MDF version {version}; open an MDF4 .mf4 file"
                )
            }
            Self::UnsupportedUnfinalized => formatter.write_str(
                "unfinalized MDF4 files are not supported; finalize the recording before opening it",
            ),
            Self::Truncated(section) => write!(formatter, "truncated MDF4 {section}"),
            Self::InvalidBlock(block) => write!(formatter, "invalid MDF4 {block} block"),
            Self::LinkCycle => formatter.write_str("MDF4 block links contain a cycle"),
            Self::UnsupportedDataBlock(block) => {
                write!(formatter, "unsupported MDF4 data block {block}")
            }
            Self::UnsupportedCompression(method) => {
                write!(formatter, "unsupported MDF4 compression method {method}")
            }
            Self::DecompressedBlockTooLarge => {
                formatter.write_str("MDF4 compressed data expands beyond the trace limit")
            }
            Self::InvalidCompressedData => {
                formatter.write_str("invalid compressed data in MDF4 file")
            }
            Self::InvalidRecord => formatter.write_str("invalid or truncated MDF4 record data"),
            Self::UnsupportedRecordIdSize(size) => {
                write!(formatter, "unsupported MDF4 record identifier size {size}")
            }
            Self::UnsupportedChannel(name) => {
                write!(formatter, "unsupported MDF4 channel encoding for {name}")
            }
            Self::InvalidTimestamp => formatter.write_str("invalid MDF4 time channel value"),
            Self::InvalidCanId => formatter.write_str("invalid CAN identifier in MDF4 data"),
            Self::PayloadStorageTooLarge => {
                formatter.write_str("MDF4 payload storage exceeds 4 GiB")
            }
            Self::NoPlottableData => formatter.write_str(
                "MF4 file contains neither raw CAN data frames nor plottable numeric channels",
            ),
            Self::SignalNotFound => formatter.write_str("MF4 signal is no longer available"),
        }
    }
}

impl std::error::Error for Mf4Error {}
