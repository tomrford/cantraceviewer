use std::rc::Rc;

use super::quotes::parse_quoted;
use super::{DbcError, find_dbc_whitespace, trim_dbc, trim_space_tab};

/// Largest exact integer representable by JavaScript `number`.
const JS_SAFE_INTEGER_MAX: i64 = 9_007_199_254_740_991;

/// Numeric representation requested by `SIG_VALTYPE_`.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum ValueType {
    #[default]
    Integer,
    Float32,
    Float64,
}

impl ValueType {
    pub(crate) const fn as_catalog_str(self) -> &'static str {
        match self {
            Self::Integer => "integer",
            Self::Float32 => "float32",
            Self::Float64 => "float64",
        }
    }
}

/// One raw numeric value and its display label.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValueDescription {
    pub raw_value: i64,
    pub label: String,
}

/// Named set of value descriptions from a `VAL_TABLE_` record.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValueTable {
    pub name: String,
    pub values: Rc<[ValueDescription]>,
}

impl ValueTable {
    /// Parses a named table and its raw-value/label pairs.
    pub fn parse(line: &str) -> Result<Self, DbcError> {
        let mut cursor = trim_dbc(line);
        let Some(rest) = cursor.strip_prefix("VAL_TABLE_ ") else {
            return Err(DbcError::InvalidValueTableLine);
        };
        cursor = trim_space_tab(rest);

        let Some(name_end) = find_dbc_whitespace(cursor) else {
            return Err(DbcError::InvalidValueTableLine);
        };
        let name = cursor[..name_end].to_owned();
        cursor = trim_space_tab(&cursor[name_end..]);

        Ok(Self {
            name,
            values: parse_value_description_pairs(cursor)?.into(),
        })
    }
}

/// A `VAL_` record's value source before it is attached to a signal.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ValueDescriptionRef {
    TableName(String),
    InlineValues(Rc<[ValueDescription]>),
}

/// Signal-specific value descriptions from a `VAL_` record.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SignalValueDescriptions {
    pub message_id: u32,
    pub signal_name: String,
    pub value_descriptions: ValueDescriptionRef,
}

impl SignalValueDescriptions {
    /// Parses either inline descriptions or a named value-table reference.
    pub fn parse(line: &str) -> Result<Self, DbcError> {
        let mut cursor = trim_dbc(line);
        let Some(rest) = cursor.strip_prefix("VAL_ ") else {
            return Err(DbcError::InvalidValueDescriptionLine);
        };
        cursor = trim_space_tab(rest);

        let Some(message_id_end) = find_dbc_whitespace(cursor) else {
            return Err(DbcError::InvalidValueDescriptionLine);
        };
        let message_id_text = &cursor[..message_id_end];
        let message_id = message_id_text.parse().map_err(|error| {
            DbcError::invalid_integer("value-description message ID", message_id_text, error)
        })?;
        cursor = trim_space_tab(&cursor[message_id_end..]);

        let Some(signal_name_end) = find_dbc_whitespace(cursor) else {
            return Err(DbcError::InvalidValueDescriptionLine);
        };
        let signal_name = cursor[..signal_name_end].to_owned();
        cursor = trim_space_tab(&cursor[signal_name_end..]);

        if cursor.is_empty() {
            return Err(DbcError::InvalidValueDescriptionLine);
        }
        cursor = strip_record_semicolon(cursor);
        if cursor.is_empty() {
            return Err(DbcError::InvalidValueDescriptionLine);
        }

        let value_descriptions = match cursor.as_bytes()[0] {
            b'-' | b'0'..=b'9' => {
                ValueDescriptionRef::InlineValues(parse_value_description_pairs(cursor)?.into())
            }
            b'"' => return Err(DbcError::InvalidValueDescriptionLine),
            _ => ValueDescriptionRef::TableName(cursor.to_owned()),
        };

        Ok(Self {
            message_id,
            signal_name,
            value_descriptions,
        })
    }
}

/// Signal numeric type metadata from a `SIG_VALTYPE_` record.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SignalValueType {
    pub message_id: u32,
    pub signal_name: String,
    pub value_type: ValueType,
}

impl SignalValueType {
    /// Parses the integer type code used by DBC value-type metadata.
    pub fn parse(line: &str) -> Result<Self, DbcError> {
        let mut cursor = trim_dbc(line);
        let Some(rest) = cursor.strip_prefix("SIG_VALTYPE_ ") else {
            return Err(DbcError::InvalidSignalValueTypeLine);
        };
        cursor = trim_space_tab(rest);

        let Some(message_id_end) = find_dbc_whitespace(cursor) else {
            return Err(DbcError::InvalidSignalValueTypeLine);
        };
        let message_id_text = &cursor[..message_id_end];
        let message_id = message_id_text.parse().map_err(|error| {
            DbcError::invalid_integer("signal value-type message ID", message_id_text, error)
        })?;
        cursor = trim_space_tab(&cursor[message_id_end..]);

        let Some(signal_name_end) = cursor
            .as_bytes()
            .iter()
            .position(|byte| matches!(byte, b' ' | b'\t' | b'\r' | b':'))
        else {
            return Err(DbcError::InvalidSignalValueTypeLine);
        };
        let signal_name = cursor[..signal_name_end].to_owned();
        cursor = trim_space_tab(&cursor[signal_name_end..]);
        if let Some(rest) = cursor.strip_prefix(':') {
            cursor = trim_space_tab(rest);
        }
        cursor = strip_record_semicolon(cursor);

        let value_type_code: u8 = cursor
            .parse()
            .map_err(|error| DbcError::invalid_integer("signal value type", cursor, error))?;
        let value_type = match value_type_code {
            0 => ValueType::Integer,
            1 => ValueType::Float32,
            2 => ValueType::Float64,
            _ => return Err(DbcError::InvalidSignalValueTypeLine),
        };

        Ok(Self {
            message_id,
            signal_name,
            value_type,
        })
    }
}

fn strip_record_semicolon(cursor: &str) -> &str {
    cursor
        .strip_suffix(';')
        .map_or(cursor, |without_semicolon| trim_dbc(without_semicolon))
}

/// Parses repeated `<raw> "<label>"` pairs.
fn parse_value_description_pairs(text: &str) -> Result<Vec<ValueDescription>, DbcError> {
    let mut cursor = strip_record_semicolon(trim_dbc(text));
    let mut descriptions = Vec::new();

    while !cursor.is_empty() {
        let Some(raw_end) = find_dbc_whitespace(cursor) else {
            return Err(DbcError::InvalidValueDescriptionLine);
        };
        let raw_text = &cursor[..raw_end];
        let raw_value: i64 = raw_text.parse().map_err(|error| {
            DbcError::invalid_integer("value-description raw value", raw_text, error)
        })?;
        ensure_js_safe_integer(raw_value)?;
        cursor = trim_space_tab(&cursor[raw_end..]);

        let (label, rest) = parse_quoted(cursor).map_err(|error| match error {
            DbcError::InvalidQuotedString => DbcError::InvalidValueDescriptionLine,
            other => other,
        })?;
        descriptions.push(ValueDescription { raw_value, label });
        cursor = trim_space_tab(rest);
    }

    Ok(descriptions)
}

fn ensure_js_safe_integer(value: i64) -> Result<(), DbcError> {
    if !(-JS_SAFE_INTEGER_MAX..=JS_SAFE_INTEGER_MAX).contains(&value) {
        return Err(DbcError::RawValueOutsideJsSafeIntegerRange(value));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_inline_value_descriptions() {
        let signal_values =
            SignalValueDescriptions::parse("VAL_ 100 State 0 \"Off\" 1 \"On\";").unwrap();
        let ValueDescriptionRef::InlineValues(descriptions) = signal_values.value_descriptions
        else {
            panic!("expected inline values");
        };

        assert_eq!(signal_values.message_id, 100);
        assert_eq!(signal_values.signal_name, "State");
        assert_eq!(descriptions.len(), 2);
        assert_eq!(descriptions[0].raw_value, 0);
        assert_eq!(descriptions[0].label, "Off");
        assert_eq!(descriptions[1].raw_value, 1);
        assert_eq!(descriptions[1].label, "On");
    }

    #[test]
    fn parses_value_table_reference() {
        let signal_values = SignalValueDescriptions::parse("VAL_ 100 State GearStates;").unwrap();

        assert_eq!(signal_values.message_id, 100);
        assert_eq!(signal_values.signal_name, "State");
        assert!(matches!(
            signal_values.value_descriptions,
            ValueDescriptionRef::TableName(ref name) if name == "GearStates"
        ));
    }

    #[test]
    fn parses_value_table() {
        let table =
            ValueTable::parse("VAL_TABLE_ GearStates 0 \"Park\" 1 \"Drive\" 2 \"Reverse\";")
                .unwrap();

        assert_eq!(table.name, "GearStates");
        assert_eq!(table.values.len(), 3);
        assert_eq!(table.values[2].raw_value, 2);
        assert_eq!(table.values[2].label, "Reverse");
    }

    #[test]
    fn parses_signed_value_descriptions() {
        let table = ValueTable::parse("VAL_TABLE_ SignedStates -1 \"Unknown\" 0 \"Off\";").unwrap();

        assert_eq!(table.values[0].raw_value, -1);
        assert_eq!(table.values[0].label, "Unknown");
    }

    #[test]
    fn rejects_wrong_value_description_prefix() {
        assert!(matches!(
            SignalValueDescriptions::parse("VAL_TABLE_ State 0 \"Off\";"),
            Err(DbcError::InvalidValueDescriptionLine)
        ));
    }

    #[test]
    fn rejects_missing_value_label_quote() {
        assert!(matches!(
            SignalValueDescriptions::parse("VAL_ 100 State 0 Off;"),
            Err(DbcError::InvalidValueDescriptionLine)
        ));
    }

    #[test]
    fn rejects_non_numeric_raw_value() {
        assert!(matches!(
            SignalValueDescriptions::parse("VAL_ 100 State 0x1 \"Off\";"),
            Err(DbcError::InvalidInteger { .. })
        ));
    }

    #[test]
    fn rejects_raw_value_outside_javascript_safe_range() {
        assert!(matches!(
            SignalValueDescriptions::parse("VAL_ 100 State 9007199254740992 \"Too Big\";"),
            Err(DbcError::RawValueOutsideJsSafeIntegerRange(
                9_007_199_254_740_992
            ))
        ));
    }

    #[test]
    fn parses_escaped_value_label() {
        let signal_values =
            SignalValueDescriptions::parse("VAL_ 100 State 1 \"State \\\"On\\\"\";").unwrap();
        let ValueDescriptionRef::InlineValues(descriptions) = signal_values.value_descriptions
        else {
            panic!("expected inline values");
        };

        assert_eq!(descriptions[0].label, "State \"On\"");
    }

    #[test]
    fn rejects_value_table_without_name() {
        assert!(matches!(
            ValueTable::parse("VAL_TABLE_"),
            Err(DbcError::InvalidValueTableLine)
        ));
    }

    #[test]
    fn rejects_unterminated_table_label() {
        assert!(matches!(
            ValueTable::parse("VAL_TABLE_ State 0 \"Off;"),
            Err(DbcError::InvalidValueDescriptionLine)
        ));
    }

    #[test]
    fn parses_signal_value_type_with_colon() {
        let value_type = SignalValueType::parse("SIG_VALTYPE_ 100 Temperature : 1;").unwrap();

        assert_eq!(value_type.message_id, 100);
        assert_eq!(value_type.signal_name, "Temperature");
        assert_eq!(value_type.value_type, ValueType::Float32);
    }

    #[test]
    fn parses_signal_value_type_without_colon() {
        let value_type = SignalValueType::parse("SIG_VALTYPE_ 100 Temperature 2;").unwrap();

        assert_eq!(value_type.value_type, ValueType::Float64);
    }

    #[test]
    fn rejects_unsupported_signal_value_type() {
        assert!(matches!(
            SignalValueType::parse("SIG_VALTYPE_ 100 Temperature : 3;"),
            Err(DbcError::InvalidSignalValueTypeLine)
        ));
    }
}
