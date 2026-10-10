use super::{DbcError, Signal};

const EXTENDED_FLAG: u32 = 0x8000_0000;

const EXTENDED_MASK: u32 = 0x1fff_ffff;

#[derive(Clone, Debug, PartialEq)]
pub struct Message {
    pub dbc_id: u32,

    pub can_id: u32,

    pub is_extended: bool,
    pub is_fd: bool,
    pub frame_format: &'static str,
    pub(crate) format_explicit: bool,
    pub(super) position: super::source::Position,
    pub name: String,
    pub size_bytes: u16,
    pub transmitter: String,
    pub signals: Vec<Signal>,
}

impl Message {
    pub(crate) fn raw_frame_decodable(&self) -> bool {
        self.raw_frame_decode_error().is_none()
    }

    pub(crate) fn raw_frame_decode_error(&self) -> Option<&'static str> {
        if self.frame_format == "j1939" && self.size_bytes > 8 {
            Some("J1939 transport decoding is not supported.")
        } else if self.size_bytes > 64 {
            Some("Message exceeds 64 bytes.")
        } else {
            None
        }
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

        Ok(Self {
            dbc_id,
            can_id: if is_extended {
                dbc_id & EXTENDED_MASK
            } else {
                dbc_id
            },
            is_extended,
            is_fd: size_bytes > 8,
            frame_format: if size_bytes > 8 {
                if is_extended {
                    "extended-can-fd"
                } else {
                    "standard-can-fd"
                }
            } else if is_extended {
                "extended-can"
            } else {
                "standard-can"
            },
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
