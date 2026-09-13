use std::{borrow::Cow, fmt::Write};

use super::{Dbc, DbcError, catalog::write_json_string};

/// Recoverable warning at the record keyword. Positions are one-based Unicode
/// scalar columns in decoded text, excluding an initial BOM; tabs count as one.
#[derive(Clone, Debug, PartialEq)]
pub struct Diagnostic {
    pub category: &'static str,
    pub keyword: &'static str,
    pub line: usize,
    pub column: usize,
    pub message: &'static str,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(super) struct Position {
    pub(super) line: usize,
    pub(super) column: usize,
}

impl Position {
    pub fn warning(
        self,
        category: &'static str,
        keyword: &'static str,
        message: &'static str,
    ) -> Diagnostic {
        Diagnostic {
            category,
            keyword,
            line: self.line,
            column: self.column,
            message,
        }
    }

    pub fn error(self, keyword: &'static str, source: DbcError) -> DbcError {
        DbcError::AtRecord {
            line: self.line,
            column: self.column,
            keyword,
            source: Box::new(source),
        }
    }
}

impl Dbc {
    pub fn warnings_json(&self) -> String {
        let mut output = String::from("[");
        for (index, warning) in self.warnings.iter().enumerate() {
            if index > 0 {
                output.push(',');
            }
            write!(
                output,
                "{{\"line\":{},\"column\":{}",
                warning.line, warning.column
            )
            .unwrap();
            for (key, value) in [
                ("category", warning.category),
                ("keyword", warning.keyword),
                ("message", warning.message),
            ] {
                write!(output, ",\"{key}\":").unwrap();
                write_json_string(&mut output, value);
            }
            output.push('}');
        }
        output.push(']');
        output
    }
}

pub(super) fn decode(bytes: &[u8]) -> Cow<'_, str> {
    let bytes = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes);
    if let Ok(text) = std::str::from_utf8(bytes) {
        return Cow::Borrowed(text);
    }
    const C1: [char; 32] = [
        '€', '\u{fffd}', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u{fffd}', 'Ž',
        '\u{fffd}', '\u{fffd}', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ',
        '\u{fffd}', 'ž', 'Ÿ',
    ];
    Cow::Owned(
        bytes
            .iter()
            .map(|&byte| {
                if (0x80..=0x9f).contains(&byte) {
                    C1[usize::from(byte - 0x80)]
                } else {
                    char::from(byte)
                }
            })
            .collect(),
    )
}

#[derive(Clone, Copy)]
pub(super) struct Record<'a> {
    pub text: &'a str,
    pub keyword: &'static str,
    pub position: Position,
}

// Use a fixed vocabulary so diagnostics never echo arbitrary source tokens.
const KEYWORDS: &[&str] = &[
    "BO_",
    "SG_",
    "VAL_TABLE_",
    "VAL_",
    "SIG_VALTYPE_",
    "VERSION",
    "NS_",
    "BS_",
    "BU_",
    "CM_",
    "BA_",
    "BA_DEF_",
    "BA_DEF_DEF_",
    "SG_MUL_VAL_",
    "BO_TX_BU_",
    "SIG_GROUP_",
    "EV_",
    "EV_DATA_",
    "ENVVAR_DATA_",
    "SGTYPE_",
    "SGTYPE_VAL_",
    "SIG_TYPE_REF_",
    "BA_DEF_SGTYPE_",
    "BA_SGTYPE_",
    "SIGTYPE_VALTYPE_",
    "CAT_DEF_",
    "CAT_",
    "FILTER",
    "BA_DEF_REL_",
    "BA_REL_",
    "BA_DEF_DEF_REL_",
    "BU_SG_REL_",
    "BU_EV_REL_",
    "BU_BO_REL_",
];

/// Separate line records from semicolon records without interpreting quoted
/// comment contents as definitions. Namespace declarations are not records.
pub(super) fn records(text: &str) -> impl Iterator<Item = Result<Record<'_>, DbcError>> {
    let mut remaining = text;
    let mut position = Position { line: 1, column: 1 };
    let mut namespace = false;
    std::iter::from_fn(move || {
        while !remaining.is_empty() {
            let whitespace =
                remaining.len() - remaining.trim_start_matches([' ', '\t', '\r', '\n']).len();
            advance(&remaining[..whitespace], &mut position);
            remaining = &remaining[whitespace..];
            if remaining.is_empty() {
                break;
            }
            let token = remaining
                .split([' ', '\t', '\r', '\n', ':'])
                .next()
                .unwrap();
            let keyword = KEYWORDS
                .iter()
                .copied()
                .find(|&known| known == token)
                .unwrap_or("unknown");
            let line_end = remaining.find('\n').unwrap_or(remaining.len());
            if namespace
                && remaining[..line_end].split_ascii_whitespace().all(|token| {
                    token.bytes().all(|byte| {
                        byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_'
                    })
                })
            {
                advance(&remaining[..line_end], &mut position);
                remaining = &remaining[line_end..];
                continue;
            }
            namespace = keyword == "NS_";
            let input = remaining;
            remaining = ""; // A malformed record ends iteration.
            let line_record = matches!(keyword, "BO_" | "SG_" | "VERSION" | "NS_" | "BS_" | "BU_");
            let end = if line_record {
                line_end
            } else {
                let mut quoted = false;
                let mut escaped = false;
                let mut end = None;
                for (index, character) in input.char_indices() {
                    if escaped {
                        escaped = false;
                        continue;
                    }
                    if quoted && character == '\\' {
                        escaped = true;
                        continue;
                    }
                    if character == '"' {
                        quoted = !quoted;
                    }
                    if character == '\n' && !quoted && starts_record(&input[index + 1..]) {
                        return Some(Err(position.error(keyword, DbcError::UnterminatedRecord)));
                    }
                    if character == ';' && !quoted {
                        end = Some(index + 1);
                        break;
                    }
                }
                match end {
                    Some(end) => end,
                    None => {
                        return Some(Err(position.error(
                            keyword,
                            if quoted {
                                DbcError::InvalidQuotedString
                            } else {
                                DbcError::UnterminatedRecord
                            },
                        )));
                    }
                }
            };
            let raw = &input[..end];
            let record = Record {
                text: raw,
                keyword,
                position,
            };
            advance(raw, &mut position);
            remaining = &input[end..];
            return Some(Ok(record));
        }
        None
    })
}

fn advance(text: &str, position: &mut Position) {
    for character in text.chars() {
        if character == '\n' {
            position.line += 1;
            position.column = 1;
        } else {
            position.column += 1;
        }
    }
}

// Attribute scope continuations can begin BO_ or SG_ too, but only a
// definition has a colon outside its quoted strings.
fn starts_record(text: &str) -> bool {
    let line = text.split('\n').next().unwrap_or("").trim();
    if matches!(
        line.split_ascii_whitespace().next(),
        Some(
            "VAL_"
                | "SG_MUL_VAL_"
                | "BA_"
                | "BA_DEF_"
                | "BA_DEF_DEF_"
                | "VAL_TABLE_"
                | "SIG_VALTYPE_"
                | "SGTYPE_"
                | "SGTYPE_VAL_"
                | "SIG_TYPE_REF_"
                | "SIGTYPE_VALTYPE_"
                | "BA_DEF_SGTYPE_"
                | "BA_SGTYPE_"
        )
    ) {
        return true;
    }
    if !matches!(line.split_ascii_whitespace().next(), Some("BO_" | "SG_")) {
        return false;
    }
    let mut quoted = false;
    let mut escaped = false;
    for character in line.chars() {
        if escaped {
            escaped = false;
            continue;
        }
        if quoted && character == '\\' {
            escaped = true;
            continue;
        }
        if character == '"' {
            quoted = !quoted;
        }
        if character == ':' && !quoted {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn comments_do_not_create_multiline_attribute_or_mux_records() {
        let text = "CM_ \"a ; comment\nSG_MUL_VAL_ 1 X Root 9-9;\n\\\"quoted\\\"\";\n\
                    BA_DEF_ BO_ \"VFrameFormat\" ENUM\n \"StandardCAN\", \"StandardCAN_FD\";\n\
                    BA_ \"VFrameFormat\"\n BO_ 1 1;\n\
                    SG_MUL_VAL_ 1 X\n Root 2-3;";
        let records = records(text).collect::<Result<Vec<_>, _>>().unwrap();
        assert_eq!(
            records.iter().map(|r| r.keyword).collect::<Vec<_>>(),
            ["CM_", "BA_DEF_", "BA_", "SG_MUL_VAL_"]
        );
        assert_eq!(records[3].text, "SG_MUL_VAL_ 1 X\n Root 2-3;");
        assert_eq!(
            (records[3].position.line, records[3].position.column),
            (8, 1)
        );
    }
}
