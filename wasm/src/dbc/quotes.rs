use super::DbcError;

pub(crate) fn parse_quoted(cursor: &str) -> Result<(String, &str), DbcError> {
    let bytes = cursor.as_bytes();
    if bytes.first() != Some(&b'"') {
        return Err(DbcError::InvalidQuotedString);
    }

    let mut output = Vec::new();
    let mut index = 1;
    while index < bytes.len() {
        match bytes[index] {
            b'"' => {
                let parsed = String::from_utf8(output)
                    .expect("removing ASCII DBC escape bytes preserves valid UTF-8");
                return Ok((parsed, &cursor[index + 1..]));
            }
            b'\\' => {
                index += 1;
                let Some(&escaped) = bytes.get(index) else {
                    return Err(DbcError::InvalidQuotedString);
                };
                output.push(escaped);
                index += 1;
            }
            byte => {
                output.push(byte);
                index += 1;
            }
        }
    }

    Err(DbcError::InvalidQuotedString)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_escaped_quoted_string() {
        let (parsed, cursor) = parse_quoted("\"State \\\"On\\\" \\\\ A\" tail").unwrap();

        assert_eq!(parsed, "State \"On\" \\ A");
        assert_eq!(cursor, " tail");
    }
}
