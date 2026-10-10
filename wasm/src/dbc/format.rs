use super::{DbcError, Diagnostic, Message, quotes::parse_quoted, source::Record};

pub(super) fn resolve(
    messages: &mut [Message],
    records: &[Record],
    warnings: &mut Vec<Diagnostic>,
) -> Result<(), DbcError> {
    let mut definition = None;
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
                if definition.is_some() {
                    return Err(invalid());
                }
                let (kind, tail) = value.split_once(char::is_whitespace).ok_or_else(invalid)?;
                let mut labels = Vec::new();
                match kind {
                    "INT" => {
                        let mut bounds = tail.split_whitespace();
                        let first: i64 = bounds
                            .next()
                            .ok_or_else(invalid)?
                            .parse()
                            .map_err(|_| invalid())?;
                        let last: i64 = bounds
                            .next()
                            .ok_or_else(invalid)?
                            .parse()
                            .map_err(|_| invalid())?;
                        if first > last || bounds.next().is_some() {
                            return Err(invalid());
                        }
                    }
                    "ENUM" => {
                        let mut tail = tail.trim();
                        loop {
                            let (label, rest) = parse_quoted(tail).map_err(|_| invalid())?;
                            labels.push(label);
                            if rest.trim().is_empty() {
                                break;
                            }
                            tail = rest.trim().strip_prefix(',').ok_or_else(invalid)?.trim();
                        }
                    }
                    _ => return Err(invalid()),
                }
                definition = Some(labels);
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
    let labels = definition.as_deref().unwrap_or(&[]);
    for message in messages {
        let assignment = assignments.get(&message.dbc_id).copied();
        for (position, keyword, value) in [
            assignment,
            default_format.filter(|(_, _, value)| *value != "\"\""),
            (j1939 && message.is_extended).then_some((message.position, "BO_", "\"J1939PG\"")),
        ]
        .into_iter()
        .flatten()
        {
            let resolved = frame_format(value, labels).filter(|&(format, extended, fd)| {
                message.is_extended == extended
                    && (extended || message.can_id <= 0x7ff)
                    && (format == "j1939" || message.size_bytes <= if fd { 64 } else { 8 })
            });
            let Some((format, _, fd)) = resolved else {
                if assignment.is_some() {
                    return Err(position.error(keyword, DbcError::InvalidDefinition(
                        "frame format conflicts with its definition, identifier or payload length",
                    )));
                }
                warnings.push(message.position.warning(
                    "omitted-feature",
                    "BO_",
                    "Incompatible inherited frame format was ignored.",
                ));
                continue;
            };
            message.frame_format = format;
            message.is_fd = fd;
            message.format_explicit = true;
            break;
        }
    }
    Ok(())
}

fn frame_format(value: &str, labels: &[String]) -> Option<(&'static str, bool, bool)> {
    let label = if let Some(value) = value.strip_prefix('"').and_then(|v| v.strip_suffix('"')) {
        value
    } else {
        let index: usize = value.parse().ok()?;
        if labels.is_empty() {
            match index {
                0 => "StandardCAN",
                1 => "ExtendedCAN",
                3 => "J1939PG",
                14 => "StandardCAN_FD",
                15 => "ExtendedCAN_FD",
                _ => return None,
            }
        } else {
            labels.get(index)?.as_str()
        }
    };
    Some(match label {
        "StandardCAN" => ("standard-can", false, false),
        "ExtendedCAN" => ("extended-can", true, false),
        "StandardCAN_FD" => ("standard-can-fd", false, true),
        "ExtendedCAN_FD" => ("extended-can-fd", true, true),
        "J1939PG" => ("j1939", true, false),
        _ => return None,
    })
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
    fn resolves_numeric_formats_and_ignores_incompatible_defaults() {
        let messages = "BO_ 7 Standard: 8 ECU\nBO_ 2147483651 Extended: 8 ECU\nBO_ 1 Fd: 12 ECU\nBO_ 2565489024 Long: 1785 ECU\n";
        for default in ["0", "\"StandardCAN\"", "\"\""] {
            let dbc = Dbc::parse(&format!("{messages}BA_DEF_ BO_ \"VFrameFormat\" INT -1 15;\nBA_DEF_DEF_ \"VFrameFormat\" {default};\nBA_DEF_DEF_ \"ProtocolType\" \"J1939\";\nBA_ \"VFrameFormat\" BO_ 2147483651 1;")).unwrap();
            assert_eq!(
                dbc.messages
                    .iter()
                    .map(|m| m.frame_format)
                    .collect::<Vec<_>>(),
                ["standard-can", "extended-can", "standard-can-fd", "j1939"]
            );
            assert_eq!(dbc.warnings.len(), if default == "\"\"" { 0 } else { 2 });
            assert!(
                dbc.warnings
                    .iter()
                    .all(|w| w.category == "omitted-feature" && w.keyword == "BO_")
            );
        }
        let dbc = Dbc::parse("BO_ 7 Standard: 8 ECU\nBO_ 2164195584 J1939: 8 ECU\nBA_DEF_ BO_ \"VFrameFormat\" INT 0 3;\nBA_DEF_DEF_ \"VFrameFormat\" 3;\nBA_ \"VFrameFormat\" BO_ 7 0;").unwrap();
        assert_eq!(dbc.messages[1].frame_format, "j1939");
        let dbc =
            Dbc::parse("BO_ 7 Standard: 8 ECU\nBA_DEF_DEF_ \"ProtocolType\" \"J1939\";").unwrap();
        assert_eq!(dbc.messages[0].frame_format, "standard-can");
    }

    #[test]
    fn retains_long_j1939_catalogue_and_pdu1_pgn() {
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
        for (id, size, value) in [
            (291, 2, "1"),
            (291, 2, "3"),
            (291, 2, "15"),
            (291, 2, "99"),
            (291, 12, "0"),
            (2147483939u32, 8, "14"),
        ] {
            let source =
                format!("BO_ {id} Message: {size} ECU\nBA_ \"VFrameFormat\" BO_ {id} {value};");
            let error = Dbc::parse(&source).unwrap_err().to_string();
            assert!(error.contains("DBC input:2:1:"));
        }
    }
}
