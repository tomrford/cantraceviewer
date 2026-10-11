use serde::{Serialize, Serializer};

use super::{DbcError, Signal};

const EXTENDED_FLAG: u32 = 0x8000_0000;

const EXTENDED_MASK: u32 = 0x1fff_ffff;

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct J1939 {
    pub pgn: u32,
    pub source_address: u32,
    pub priority: u32,
}

impl J1939 {
    pub(crate) fn from_can_id(can_id: u32) -> Self {
        let mut pgn = (can_id >> 8) & 0x3_ffff;
        if (pgn >> 8) & 0xff < 240 {
            pgn &= 0x3_ff00;
        }
        Self {
            pgn,
            source_address: can_id & 0xff,
            priority: can_id >> 26,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub dbc_id: u32,

    pub can_id: u32,

    pub is_extended: bool,
    pub is_fd: bool,
    pub frame_format: &'static str,
    pub raw_frame_decodable: bool,
    pub j1939: Option<J1939>,
    #[serde(skip)]
    pub(crate) format_explicit: bool,
    #[serde(skip)]
    pub(super) position: super::source::Position,
    pub name: String,
    pub size_bytes: u16,
    pub transmitter: String,
    #[serde(serialize_with = "serialize_catalog_signals")]
    pub signals: Vec<Signal>,
}

fn serialize_catalog_signals<S>(signals: &[Signal], serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    serializer.collect_seq(signals.iter().filter(|signal| signal.in_catalog))
}

fn frame_decode_error(frame_format: &str, size_bytes: u16) -> Option<&'static str> {
    if frame_format == "j1939" && size_bytes > 8 {
        Some("J1939 transport decoding is not supported.")
    } else if size_bytes > 64 {
        Some("Message exceeds 64 bytes.")
    } else {
        None
    }
}

impl Message {
    pub(crate) fn raw_frame_decode_error(&self) -> Option<&'static str> {
        frame_decode_error(self.frame_format, self.size_bytes)
    }

    pub(crate) fn apply_frame_format(&mut self, format: &'static str, is_fd: bool) {
        self.frame_format = format;
        self.is_fd = is_fd;
        self.format_explicit = true;
        self.j1939 = (format == "j1939").then(|| J1939::from_can_id(self.can_id));
        self.raw_frame_decodable = self.raw_frame_decode_error().is_none();
    }

    pub fn parse(line: &str) -> Result<Self, DbcError> {
        let mut tokens = line.split_ascii_whitespace();

        if tokens.next() != Some("BO_") {
            return Err(DbcError::InvalidMessageLine);
        }
        let dbc_id_text = tokens.next().ok_or(DbcError::InvalidMessageLine)?;
        let name_text = tokens.next().ok_or(DbcError::InvalidMessageLine)?;
        let size_text = tokens.next().ok_or(DbcError::InvalidMessageLine)?;
        let transmitter = tokens.next().ok_or(DbcError::InvalidMessageLine)?;

        let Some(name) = name_text.strip_suffix(':') else {
            return Err(DbcError::InvalidMessageLine);
        };
        let dbc_id = dbc_id_text
            .parse()
            .map_err(|error| DbcError::invalid_integer("message ID", error))?;
        let size_bytes = size_text
            .parse()
            .map_err(|error| DbcError::invalid_integer("message size", error))?;
        let is_extended = dbc_id & EXTENDED_FLAG != 0;
        let frame_format = if size_bytes > 8 {
            if is_extended {
                "extended-can-fd"
            } else {
                "standard-can-fd"
            }
        } else if is_extended {
            "extended-can"
        } else {
            "standard-can"
        };
        Ok(Self {
            dbc_id,
            can_id: if is_extended {
                dbc_id & EXTENDED_MASK
            } else {
                dbc_id
            },
            is_extended,
            is_fd: size_bytes > 8,
            frame_format,
            raw_frame_decodable: frame_decode_error(frame_format, size_bytes).is_none(),
            j1939: None,
            format_explicit: false,
            position: Default::default(),
            name: name.to_owned(),
            size_bytes,
            transmitter: transmitter.to_owned(),
            signals: Vec::new(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_extended_message_line() {
        let message = Message::parse("BO_ 2147483650 ext_MUX_multiplexors: 7 Vector__XXX").unwrap();

        assert_eq!(message.dbc_id, 2_147_483_650);
        assert_eq!(message.can_id, 2);
        assert!(message.is_extended);
        assert!(!message.is_fd);
        assert_eq!(message.name, "ext_MUX_multiplexors");
        assert_eq!(message.size_bytes, 7);
        assert_eq!(message.transmitter, "Vector__XXX");
    }

    #[test]
    fn rejects_message_line_without_name_colon() {
        assert!(matches!(
            Message::parse("BO_ 288 PowertrainStatus 8 Agent"),
            Err(DbcError::InvalidMessageLine)
        ));
    }
}
