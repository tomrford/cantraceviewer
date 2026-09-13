use super::{DbcError, Diagnostic, Message, quotes::parse_quoted, source::Record};

// Consume the same records as the DBC parser, including multiline attributes.
pub(super) fn resolve(
    messages: &mut [Message],
    records: &[Record],
    warnings: &mut Vec<Diagnostic>,
) -> Result<(), DbcError> {
    let mut labels = Vec::new();
    let mut default_format = None;
    let mut protocol = None;
    let mut default_protocol = None;
    let mut assignments = std::collections::HashMap::new();
    for record in records {
        let invalid = || {
            record.position.error(
                record.keyword,
                DbcError::InvalidDefinition("invalid frame-format attribute"),
            )
        };
        let (_, rest) = record
            .text
            .split_once(char::is_whitespace)
            .ok_or_else(invalid)?;
        let rest = rest.trim().strip_suffix(';').ok_or_else(invalid)?.trim();
        let scoped = rest.strip_prefix("BO_").map(str::trim);
        if scoped.is_none() && !rest.starts_with('"') {
            warnings.push(record.position.warning(
                "unsupported-record",
                record.keyword,
                "Attribute is not used by the viewer.",
            ));
            continue;
        }
        let (name, value) = parse_quoted(scoped.unwrap_or(rest))
            .map_err(|error| record.position.error(record.keyword, error))?;
        let value = value.trim();
        match (record.keyword, name.as_str()) {
            ("BA_DEF_", "VFrameFormat") if scoped.is_some() => {
                if !labels.is_empty() {
                    return Err(invalid());
                }
                let mut tail = value.strip_prefix("ENUM").ok_or_else(invalid)?.trim();
                loop {
                    let (label, rest) = parse_quoted(tail).map_err(|_| invalid())?;
                    labels.push(label);
                    if rest.trim().is_empty() {
                        break;
                    }
                    tail = rest.trim().strip_prefix(',').ok_or_else(invalid)?.trim();
                }
            }
            ("BA_DEF_DEF_", "VFrameFormat") => {
                if default_format
                    .replace((record.position, record.keyword, value))
                    .is_some()
                {
                    return Err(invalid());
                }
            }
            ("BA_", "VFrameFormat") => {
                let mut parts = value.split_whitespace();
                if parts.next() != Some("BO_") {
                    return Err(invalid());
                }
                let id: u32 = parts
                    .next()
                    .ok_or_else(invalid)?
                    .parse()
                    .map_err(|_| invalid())?;
                let value = parts.next().ok_or_else(invalid)?;
                if parts.next().is_some()
                    || assignments
                        .insert(id, (record.position, record.keyword, value))
                        .is_some()
                {
                    return Err(invalid());
                }
                match messages.iter().filter(|m| m.dbc_id == id).count() {
                    0 => warnings.push(record.position.warning(
                        "dangling-reference",
                        "BA_",
                        "Unknown message; frame-format attachment was ignored.",
                    )),
                    1 => {}
                    _ => return Err(invalid()),
                }
            }
            ("BA_" | "BA_DEF_DEF_", "ProtocolType") => {
                let (value, tail) = parse_quoted(value).map_err(|_| invalid())?;
                if !tail.trim().is_empty() {
                    return Err(invalid());
                }
                let target = if record.keyword == "BA_" {
                    &mut protocol
                } else {
                    &mut default_protocol
                };
                if target.replace(value).is_some() {
                    return Err(invalid());
                }
            }
            _ => warnings.push(record.position.warning(
                "unsupported-record",
                record.keyword,
                "Attribute is not used by the viewer.",
            )),
        }
    }
    let j1939 = protocol
        .or(default_protocol)
        .is_some_and(|value| value.eq_ignore_ascii_case("J1939"));
    for message in messages {
        let Some((position, keyword, value)) = assignments
            .get(&message.dbc_id)
            .copied()
            .or(default_format)
            .or_else(|| j1939.then_some((message.position, "BO_", "\"J1939PG\"")))
        else {
            continue;
        };
        let invalid = || {
            position.error(
                keyword,
                DbcError::InvalidDefinition(
                    "frame format conflicts with its definition, identifier or payload length",
                ),
            )
        };
        let label = if let Some(value) = value.strip_prefix('"').and_then(|v| v.strip_suffix('"')) {
            value
        } else {
            let index: usize = value.parse().map_err(|_| invalid())?;
            if labels.is_empty() {
                match index {
                    0 => "StandardCAN",
                    1 => "ExtendedCAN",
                    3 => "J1939PG",
                    14 => "StandardCAN_FD",
                    15 => "ExtendedCAN_FD",
                    _ => return Err(invalid()),
                }
            } else {
                labels.get(index).ok_or_else(invalid)?.as_str()
            }
        };
        let (format, extended, fd) = match label {
            "StandardCAN" => ("standard-can", false, false),
            "ExtendedCAN" => ("extended-can", true, false),
            "StandardCAN_FD" => ("standard-can-fd", false, true),
            "ExtendedCAN_FD" => ("extended-can-fd", true, true),
            "J1939PG" => ("j1939", true, false),
            _ => return Err(invalid()),
        };
        if message.is_extended != extended
            || (!extended && message.can_id > 0x7ff)
            || (format != "j1939" && message.size_bytes > if fd { 64 } else { 8 })
        {
            return Err(invalid());
        }
        message.frame_format = format;
        message.is_fd = fd;
        message.format_explicit = true;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::dbc::Dbc;

    #[test]
    fn resolves_enum_indices_by_definition_and_message_over_default() {
        let dbc = Dbc::parse("BO_ 291 ShortFd: 2 ECU\n SG_ Value : 0|8@1+ (1,0) [0|0] \"\" ECU\nBA_DEF_ BO_ \"VFrameFormat\" ENUM \"ExtendedCAN\",\"StandardCAN_FD\",\"StandardCAN\";\nBA_DEF_DEF_ \"VFrameFormat\" \"StandardCAN\";\nBA_ \"VFrameFormat\" BO_   291   1;").unwrap();
        assert_eq!(dbc.messages[0].frame_format, "standard-can-fd");
        assert!(dbc.messages[0].is_fd);
    }

    #[test]
    fn retains_long_j1939_catalogue_and_pdu1_pgn() {
        // 0x18EA2180 is PDU1: destination 0x21 is excluded from PGN 0xEA00.
        let dbc = Dbc::parse("BO_ 2565489024 Long: 1785 ECU\n SG_ Late : 1544|32@1+ (1,0) [0|0] \"\" ECU\nBA_DEF_DEF_ \"ProtocolType\" \"J1939\";").unwrap();
        let message = &dbc.messages[0];
        assert_eq!(message.frame_format, "j1939");
        assert!(!message.is_fd);
        let json = dbc.to_catalog_json();
        assert!(json.contains("\"rawFrameDecodable\":false"));
        assert!(json.contains("\"pgn\":59904"), "{json}");
        assert!(json.contains("\"Late\""));
        assert!(message.signals[0].plan_decode(message.size_bytes).is_err());
    }

    #[test]
    fn rejects_conflicting_format_and_identifier() {
        for value in ["1", "3", "15", "99"] {
            let source = format!("BO_ 291 Standard: 2 ECU\nBA_ \"VFrameFormat\" BO_ 291 {value};");
            let error = Dbc::parse(&source).unwrap_err().to_string();
            assert!(error.contains("DBC input:2:1:"));
        }
    }
}
