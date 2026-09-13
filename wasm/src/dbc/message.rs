use super::{DbcError, Signal};

/// DBC encodes extended CAN IDs by setting bit 31 in the message ID.
const EXTENDED_FLAG: u32 = 0x8000_0000;

/// CAN 2.0B extended identifiers use the low 29 bits.
const EXTENDED_MASK: u32 = 0x1fff_ffff;

/// Parsed `BO_` message definition.
#[derive(Clone, Debug, PartialEq)]
pub struct Message {
    /// Raw DBC message ID as written in the file.
    pub dbc_id: u32,

    /// CAN arbitration ID with the DBC extended-frame flag removed.
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
        self.size_bytes <= 64 && (self.frame_format != "j1939" || self.size_bytes <= 8)
    }

    /// Parses one `BO_ <id> <name>: <size> <transmitter>` line.
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
    fn parses_message_line() {
        let message = Message::parse("BO_ 288 PowertrainStatus: 8 Agent").unwrap();

        assert_eq!(message.dbc_id, 288);
        assert_eq!(message.can_id, 288);
        assert!(!message.is_extended);
        assert!(!message.is_fd);
        assert_eq!(message.name, "PowertrainStatus");
        assert_eq!(message.size_bytes, 8);
        assert_eq!(message.transmitter, "Agent");
        assert!(message.signals.is_empty());
    }

    #[test]
    fn parses_tab_separated_message_line() {
        let message = Message::parse("BO_\t288\tPowertrainStatus:\t8\tAgent").unwrap();

        assert_eq!(message.dbc_id, 288);
        assert_eq!(message.name, "PowertrainStatus");
        assert_eq!(message.size_bytes, 8);
        assert_eq!(message.transmitter, "Agent");
    }

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
    fn marks_messages_larger_than_eight_bytes_as_fd() {
        let message = Message::parse("BO_ 512 LargePayload: 12 ECU").unwrap();

        assert!(message.is_fd);
        assert_eq!(message.size_bytes, 12);
    }

    #[test]
    fn parses_large_j1939_transport_message_length() {
        let message = Message::parse("BO_ 2566834942 J1939_DM01: 1785 OBC7_ST_J1939_PLC").unwrap();

        assert!(message.is_extended);
        assert!(message.is_fd);
        assert_eq!(message.size_bytes, 1785);
    }

    #[test]
    fn rejects_message_line_without_prefix() {
        assert!(matches!(
            Message::parse("SG_ Speed : 0|8@1+ (1,0) [0|0] \"\" ECU"),
            Err(DbcError::InvalidMessageLine)
        ));
    }

    #[test]
    fn rejects_message_line_without_name_colon() {
        assert!(matches!(
            Message::parse("BO_ 288 PowertrainStatus 8 Agent"),
            Err(DbcError::InvalidMessageLine)
        ));
    }

    #[test]
    fn rejects_non_numeric_message_id_with_context() {
        let error = Message::parse("BO_ nope PowertrainStatus: 8 Agent").unwrap_err();

        assert!(matches!(
            error,
            DbcError::InvalidInteger {
                field: "message ID",
                ..
            }
        ));
    }
}
