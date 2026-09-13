//! Dependency-free DBC parsing and signal decoding.
//!
//! The model owns its parsed text, so a `Dbc` can move directly behind a
//! `wasm-bindgen` class without an arena or a separate source-buffer lifetime.

mod catalog;
mod error;
mod message;
mod quotes;
mod signal;
mod source;
mod values;

use std::rc::Rc;

pub use error::DbcError;
pub use message::Message;
pub use signal::Signal;
pub use source::Diagnostic;
pub use values::{
    SignalValueDescriptions, SignalValueType, ValueDescription, ValueDescriptionRef, ValueTable,
    ValueType,
};

// CANdb++ stores unassigned signals in this zero-length pseudo-message.
const INDEPENDENT_SIGNAL_MESSAGE_ID: u32 = 0xc000_0000;

/// Parsed subset of a DBC file used by the viewer.
#[derive(Clone, Debug, PartialEq)]
pub struct Dbc {
    /// Messages in source order, each with its attached signals.
    pub messages: Vec<Message>,

    /// Value tables in source order.
    pub value_tables: Vec<ValueTable>,

    pub warnings: Vec<Diagnostic>,
}

impl Dbc {
    /// UTF-8 (optional BOM), otherwise Windows-1252; undefined bytes become U+FFFD.
    pub fn parse_bytes(bytes: &[u8]) -> Result<Self, DbcError> {
        Self::parse(&source::decode(bytes))
    }

    /// Parses already decoded DBC text without a BOM into an owned model.
    pub fn parse(text: &str) -> Result<Self, DbcError> {
        let mut messages = Vec::new();
        let mut value_tables = Vec::new();
        let mut pending_values = Vec::new();
        let mut pending_value_types = Vec::new();

        let mut current_signals = Vec::new();
        let mut current_message: Option<Message> = None;

        let mut warnings = Vec::new();
        let mut signal_positions = Vec::new();
        for record in source::records(text) {
            let record = record?;
            let line = record.text;
            let mut parse = || -> Result<(), DbcError> {
                if record.keyword == "CM_" {
                    let quote = line.find('"').ok_or(DbcError::InvalidQuotedString)?;
                    let (_, rest) = quotes::parse_quoted(&line[quote..])?;
                    if trim_dbc(rest) != ";" {
                        return Err(DbcError::UnterminatedRecord);
                    }
                }
                match record.keyword {
                    "BO_" => {
                        finish_message(&mut messages, &mut current_message, &mut current_signals);
                        let message = Message::parse(line)?;
                        if message.dbc_id == INDEPENDENT_SIGNAL_MESSAGE_ID {
                            warnings.push(record.position.warning(
                                "omitted-feature",
                                "BO_",
                                "Independent signal container is omitted from the viewer catalogue.",
                            ));
                        }
                        if messages.iter().any(|other: &Message| {
                            other.dbc_id == message.dbc_id && other.size_bytes == message.size_bytes
                        }) {
                            return Err(DbcError::InvalidMessageLine);
                        }
                        current_message = Some(message);
                    }
                    "VAL_TABLE_" => {
                        let table = ValueTable::parse(line)?;
                        if value_tables
                            .iter()
                            .any(|other: &ValueTable| other.name == table.name)
                        {
                            return Err(DbcError::InvalidValueTableLine);
                        }
                        value_tables.push(table);
                    }
                    "VAL_" => pending_values
                        .push((SignalValueDescriptions::parse(line)?, record.position)),
                    "SIG_VALTYPE_" => {
                        pending_value_types.push((SignalValueType::parse(line)?, record.position))
                    }
                    "SG_" => {
                        current_message
                            .as_ref()
                            .ok_or(DbcError::SignalWithoutMessage)?;
                        let signal = Signal::parse(line)?;
                        if current_signals
                            .iter()
                            .any(|other: &Signal| other.name == signal.name)
                        {
                            return Err(DbcError::InvalidSignalLine);
                        }
                        signal_positions.push(record.position);
                        current_signals.push(signal);
                    }
                    "SGTYPE_" | "SGTYPE_VAL_" | "SIG_TYPE_REF_" | "SIGTYPE_VALTYPE_"
                    | "BA_DEF_SGTYPE_" | "BA_SGTYPE_" => {
                        return Err(DbcError::UnsupportedSignalType);
                    }
                    "VERSION" | "NS_" | "BS_" | "BU_" => {}
                    _ => warnings.push(record.position.warning(
                        "unsupported-record",
                        record.keyword,
                        "Record is not used by the viewer.",
                    )),
                }
                Ok(())
            };
            parse().map_err(|error| record.position.error(record.keyword, error))?;
        }

        finish_message(&mut messages, &mut current_message, &mut current_signals);

        for (pending, position) in pending_values {
            if messages
                .iter()
                .filter(|message| message.dbc_id == pending.message_id)
                .count()
                > 1
            {
                return Err(position.error("VAL_", DbcError::InvalidValueDescriptionLine));
            }
            if let Err(message) = attach_value_descriptions(&mut messages, &value_tables, pending) {
                warnings.push(position.warning("dangling-reference", "VAL_", message));
            }
        }
        for (pending, position) in pending_value_types {
            if messages
                .iter()
                .filter(|message| message.dbc_id == pending.message_id)
                .count()
                > 1
            {
                return Err(position.error("SIG_VALTYPE_", DbcError::InvalidSignalValueTypeLine));
            }
            if let Err(message) = attach_value_type(&mut messages, pending) {
                warnings.push(position.warning("dangling-reference", "SIG_VALTYPE_", message));
            }
        }
        for ((message, signal), position) in messages
            .iter()
            .flat_map(|message| message.signals.iter().map(move |signal| (message, signal)))
            .zip(signal_positions)
        {
            if message.dbc_id == INDEPENDENT_SIGNAL_MESSAGE_ID {
                continue;
            }
            if signal.unsupported_mux {
                warnings.push(position.warning(
                    "omitted-feature",
                    "SG_",
                    "Multiplexed signal is omitted from the viewer catalogue.",
                ));
            } else if let Err(error) = signal.plan_decode(message.size_bytes) {
                match error {
                    DbcError::UnsupportedMessageLength(_) => warnings.push(position.warning(
                        "omitted-feature",
                        "SG_",
                        "Signal requires a payload longer than 64 bytes and cannot be decoded.",
                    )),
                    error => return Err(position.error("SG_", error)),
                }
            }
        }
        messages.retain(|message| message.dbc_id != INDEPENDENT_SIGNAL_MESSAGE_ID);
        warnings.sort_by_key(|warning| (warning.line, warning.column));

        Ok(Self {
            messages,
            value_tables,
            warnings,
        })
    }

    /// Projects the parsed model into the browser signal-picker catalog.
    pub fn to_catalog_json(&self) -> String {
        catalog::to_json(self)
    }

    /// Finds a signal using the same identity tuple as trace-series decoding.
    pub fn find_signal(
        &self,
        can_id: u32,
        is_extended: bool,
        size_bytes: u16,
        signal_name: &str,
    ) -> Option<(&Message, &Signal)> {
        self.messages.iter().find_map(|message| {
            (message.can_id == can_id
                && message.is_extended == is_extended
                && message.size_bytes == size_bytes)
                .then(|| {
                    message
                        .signals
                        .iter()
                        .find(|signal| signal.name == signal_name)
                        .map(|signal| (message, signal))
                })
                .flatten()
        })
    }
}

fn finish_message(
    messages: &mut Vec<Message>,
    current_message: &mut Option<Message>,
    current_signals: &mut Vec<Signal>,
) {
    if let Some(mut message) = current_message.take() {
        message.signals = std::mem::take(current_signals);
        messages.push(message);
    }
}

fn attach_value_descriptions(
    messages: &mut [Message],
    value_tables: &[ValueTable],
    pending: SignalValueDescriptions,
) -> Result<(), &'static str> {
    let signal = attachment_signal(messages, pending.message_id, &pending.signal_name)?;
    signal.value_descriptions = Some(match pending.value_descriptions {
        ValueDescriptionRef::InlineValues(descriptions) => descriptions,
        ValueDescriptionRef::TableName(name) => {
            let table = value_tables
                .iter()
                .find(|table| table.name == name)
                .ok_or("Unknown value table; attachment was ignored.")?;
            Rc::clone(&table.values)
        }
    });
    Ok(())
}

fn attach_value_type(
    messages: &mut [Message],
    pending: SignalValueType,
) -> Result<(), &'static str> {
    attachment_signal(messages, pending.message_id, &pending.signal_name)?.value_type =
        pending.value_type;
    Ok(())
}

fn attachment_signal<'a>(
    messages: &'a mut [Message],
    id: u32,
    name: &str,
) -> Result<&'a mut Signal, &'static str> {
    let message = messages
        .iter_mut()
        .find(|message| message.dbc_id == id)
        .ok_or("Unknown message; attachment was ignored.")?;
    message
        .signals
        .iter_mut()
        .find(|signal| signal.name == name)
        .ok_or("Unknown signal; attachment was ignored.")
}

pub(crate) fn trim_dbc(text: &str) -> &str {
    text.trim_matches(|character| matches!(character, ' ' | '\t' | '\r' | '\n'))
}

pub(crate) fn find_dbc_whitespace(text: &str) -> Option<usize> {
    text.as_bytes()
        .iter()
        .position(|byte| is_dbc_whitespace(*byte))
}

pub(crate) const fn is_dbc_whitespace(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t' | b'\r' | b'\n')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignored_records_cannot_swallow_value_types_or_named_signal_types() {
        let body = "BO_ 1 M: 4 ECU\n SG_ X : 0|32@1+ (1,0) [0|255] \"\" ECU\n";
        for record in [
            "SIG_VALTYPE_ 1 X : 1;",
            "VAL_ 1 X 0 \"Off\";",
            "VAL_TABLE_ State 0 \"Off\";",
        ] {
            for separator in ["\n", " "] {
                assert!(Dbc::parse(&format!("{body}CM_ \"comment\"{separator}{record}")).is_err());
            }
        }
        let typed = Dbc::parse(&format!("{body}SIG_VALTYPE_ 1 X : 1;")).unwrap();
        assert_eq!(typed.messages[0].signals[0].value_type, ValueType::Float32);
        let error = Dbc::parse(&format!("{body}SIG_TYPE_REF_ 1 X : Custom;"))
            .unwrap_err()
            .to_string();
        assert!(error.contains("3:1: SIG_TYPE_REF_"));
        assert!(error.contains("named signal types"));
    }

    #[test]
    fn multiline_values_preserve_quoted_whitespace() {
        let dbc = Dbc::parse(
            "BO_ 1 M: 4 ECU\n SG_ X : 0|32@1+ (1,0) [0|255] \"\" ECU\n\
             VAL_TABLE_\n States\n 0\n \"Off\r\n\tline\"\n 1 \"On\";\n\
             VAL_\n 1\n X\n States;\n\
             SIG_VALTYPE_\n 1\n X\n :\n 1;",
        )
        .unwrap();
        let signal = &dbc.messages[0].signals[0];
        assert_eq!(signal.value_type, ValueType::Float32);
        assert_eq!(
            signal.value_descriptions().unwrap()[0].label,
            "Off\r\n\tline"
        );
    }

    #[test]
    fn positions_count_unicode_scalars_and_legacy_undefined_bytes_are_explicit() {
        let dbc = Dbc::parse("CM_ \"😀\";  VAL_ 1 X 0 \"Off\";").unwrap();
        assert_eq!((dbc.warnings[1].line, dbc.warnings[1].column), (1, 11));
        let mut bytes = b"BO_ 1 M: 1 ECU\n SG_ X : 0|8@1+ (1,0) [0|255] \"".to_vec();
        bytes.extend_from_slice(&[0x81, 0x8d, 0x8f, 0x90, 0x9d]);
        bytes.extend_from_slice(b"\" ECU");
        assert_eq!(
            Dbc::parse_bytes(&bytes).unwrap().messages[0].signals[0].unit,
            "\u{fffd}".repeat(5)
        );
    }

    #[test]
    fn namespace_whitespace_does_not_swallow_definitions() {
        let body = "BS_:\nBU_: ECU\nBO_ 1 M: 1 ECU\n SG_ X : 0|8@1+ (1,0) [0|255] \"\" ECU\nVAL_ 1 X 0 \"Off\";";
        let expected = Dbc::parse(body).unwrap();
        for declarations in [" CM_ \r\n VAL_\t\n", "CM_ VAL_ SIG_VALTYPE_\n"] {
            assert_eq!(
                Dbc::parse(&format!("NS_ :\n{declarations}{body}")).unwrap(),
                expected
            );
        }
        let malformed = format!("CM_ \"comment\"\n{body}");
        assert!(
            Dbc::parse(&malformed)
                .unwrap_err()
                .to_string()
                .contains("1:1: CM_")
        );
        let attribute = format!("BA_ \"comment\"\n BO_ 1 \"quoted : colon\";\n{body}");
        let parsed = Dbc::parse(&attribute).unwrap();
        assert_eq!(parsed.messages, expected.messages);
        assert_eq!(parsed.warnings.len(), 1);
    }

    #[test]
    fn decodes_utf8_bom_and_windows1252_identically() {
        let utf8 =
            Dbc::parse_bytes(include_bytes!("../../tests/fixtures/encoding-utf8-bom.dbc")).unwrap();
        let legacy = Dbc::parse_bytes(include_bytes!(
            "../../tests/fixtures/encoding-windows1252.dbc"
        ))
        .unwrap();
        assert_eq!(utf8, legacy);
        assert_eq!(utf8.messages[0].signals[0].unit, "°C € – ™");
        assert_eq!(
            utf8.messages[0].signals[0].value_descriptions().unwrap()[0].label,
            "Arrêt"
        );
        assert!(utf8.warnings.is_empty());
    }

    #[test]
    fn warns_at_record_positions_and_does_not_parse_comment_contents() {
        let dbc = Dbc::parse(include_str!("../../tests/fixtures/diagnostics.dbc")).unwrap();
        assert_eq!(dbc.messages.len(), 1);
        assert_eq!(dbc.messages[0].signals.len(), 1);
        assert_eq!(
            dbc.messages[0].signals[0].value_descriptions().unwrap()[1].label,
            "On"
        );
        let positions: Vec<_> = dbc
            .warnings
            .iter()
            .map(|w| (w.category, w.keyword, w.line, w.column))
            .collect();
        assert_eq!(
            positions,
            vec![
                ("dangling-reference", "VAL_", 8, 3),
                ("dangling-reference", "VAL_", 9, 2),
                ("dangling-reference", "VAL_", 10, 1),
                ("dangling-reference", "SIG_VALTYPE_", 11, 1),
                ("unsupported-record", "CM_", 12, 1),
            ]
        );
        assert_eq!(
            dbc.warnings
                .iter()
                .take(3)
                .map(|w| w.message)
                .collect::<Vec<_>>(),
            vec![
                "Unknown message; attachment was ignored.",
                "Unknown signal; attachment was ignored.",
                "Unknown value table; attachment was ignored.",
            ]
        );
        assert!(!dbc.warnings_json().contains("private"));
    }

    #[test]
    fn rejects_unsafe_records_with_context_without_echoing_source() {
        for (text, location) in [
            ("BO_ private Bad: 8 ECU", "1:1: BO_"),
            (
                "BO_ 1 Good: 1 ECU\n  SG_ X : 8|8@1+ (1,0) [0|255] \"\" ECU",
                "2:3: SG_",
            ),
            ("BO_ 1 Good: 1 ECU\nVAL_ 1 X 0 \"private", "2:1: VAL_"),
            ("BO_ 1 A: 1 ECU\nBO_ 1 B: 1 ECU", "2:1: BO_"),
        ] {
            let error = Dbc::parse(text).unwrap_err().to_string();
            assert!(error.contains(location), "{error}");
            assert!(!error.contains("private"));
        }
    }

    #[test]
    fn omits_independent_signals_without_rejecting_usable_messages() {
        let dbc = Dbc::parse(
            "BO_ 3221225472 VECTOR__INDEPENDENT_SIG_MSG: 0 Vector__XXX\n\
             SG_ Orphan : 0|8@1+ (1,0) [0|255] \"\" Vector__XXX\n\
             BO_ 42 Status: 1 ECU\n\
             SG_ State : 0|8@1+ (1,0) [0|255] \"\" ECU",
        )
        .unwrap();
        assert_eq!(dbc.messages.len(), 1);
        assert_eq!(dbc.messages[0].name, "Status");
        assert_eq!(dbc.messages[0].signals[0].name, "State");
        assert_eq!(dbc.warnings.len(), 1);
        let warning = &dbc.warnings[0];
        assert_eq!(warning.category, "omitted-feature");
        assert_eq!(
            (warning.keyword, warning.line, warning.column),
            ("BO_", 1, 1)
        );
    }

    #[test]
    fn extended_mux_omissions_are_visible() {
        let dbc = Dbc::parse(include_str!("../../tests/fixtures/extended-multiplex.dbc")).unwrap();
        assert!(dbc.to_catalog_json().contains("\"signals\":[]"));
        assert_eq!(
            dbc.warnings
                .iter()
                .filter(|w| w.category == "omitted-feature")
                .count(),
            12
        );
        assert!(dbc.warnings.iter().any(|w| w.keyword == "SG_MUL_VAL_"));
    }

    #[test]
    fn parses_messages_and_signals() {
        let text = r#"
VERSION ""
BO_ 256 Heartbeat: 2 Agent
 SG_ counter : 0|8@1+ (1,0) [0|255] "" Dashboard
 SG_ mode : 8|8@1+ (1,0) [0|4] "" Dashboard
BO_ 288 PowertrainStatus: 8 Agent
 SG_ vehicle_speed : 0|16@1+ (0.1,0) [0|250] "km/h" Dashboard
 SG_ engine_rpm : 16|16@1+ (1,0) [0|8000] "rpm" Dashboard
 SG_ throttle : 32|8@1+ (0.5,0) [0|100] "%" Dashboard
 SG_ coolant_temp : 40|8@1+ (1,-40) [-40|215] "degC" Dashboard
BO_ 304 BodyStatus: 3 Agent
 SG_ left_signal : 0|8@1+ (1,0) [0|1] "" Dashboard
 SG_ right_signal : 8|8@1+ (1,0) [0|1] "" Dashboard
 SG_ battery_voltage : 16|8@1+ (0.1,0) [0|25.5] "V" Dashboard
"#;
        let dbc = Dbc::parse(text).unwrap();

        assert_eq!(dbc.messages.len(), 3);
        assert_eq!(dbc.messages[0].name, "Heartbeat");
        assert_eq!(dbc.messages[0].signals.len(), 2);
        assert_eq!(dbc.messages[1].signals[0].name, "vehicle_speed");
        assert_eq!(dbc.messages[1].signals[0].factor, 0.1);
        assert_eq!(dbc.messages[2].name, "BodyStatus");
        assert_eq!(dbc.messages[2].signals[2].name, "battery_voltage");
    }

    #[test]
    fn parses_tab_separated_records() {
        let text = "BO_\t288\tPowertrainStatus:\t8\tAgent\n\tSG_\tvehicle_speed\t:\t0|16@1+\t(0.1,0)\t[0|250]\t\"km/h\"\tDashboard";
        let dbc = Dbc::parse(text).unwrap();

        assert_eq!(dbc.messages.len(), 1);
        assert_eq!(dbc.messages[0].name, "PowertrainStatus");
        assert_eq!(dbc.messages[0].signals.len(), 1);
        assert_eq!(dbc.messages[0].signals[0].name, "vehicle_speed");
    }

    #[test]
    fn parses_extended_multiplexed_signals() {
        let text = r#"
BO_ 2147483650 ext_MUX_multiplexors: 7 Vector__XXX
 SG_ muxed_D_1 m1 : 48|8@1- (1,0) [0|0] "" Vector__XXX
 SG_ muxed_D_0 m0 : 48|8@1- (1,0) [0|0] "" Vector__XXX
 SG_ muxed_C_1_MUX_D m1M : 40|8@1- (1,0) [0|0] "" Vector__XXX
 SG_ muxed_C_0 m0 : 40|16@1- (1,0) [0|0] "" Vector__XXX
 SG_ MUX_C M : 32|8@1- (1,0) [0|0] "" Vector__XXX
 SG_ muxed_B_5 m5 : 24|8@1- (1,0) [0|0] "" Vector__XXX
 SG_ muxed_B_1 m1 : 24|8@1- (1,0) [0|0] "" Vector__XXX
 SG_ muxed_B_2 m2 : 24|8@1- (1,0) [0|0] "" Vector__XXX
 SG_ MUX_B M : 16|8@1- (1,0) [0|0] "" Vector__XXX
 SG_ muxed_A_0 m0 : 8|8@1- (1,0) [0|0] "" Vector__XXX
 SG_ muxed_A_1 m1 : 8|8@1- (1,0) [0|0] "" Vector__XXX
 SG_ MUX_A M : 0|8@1- (1,0) [0|0] "" Vector__XXX
"#;
        let dbc = Dbc::parse(text).unwrap();

        assert_eq!(dbc.messages.len(), 1);
        assert_eq!(dbc.messages[0].dbc_id, 2_147_483_650);
        assert_eq!(dbc.messages[0].can_id, 2);
        assert!(dbc.messages[0].is_extended);
        assert_eq!(dbc.messages[0].signals.len(), 12);
        assert_eq!(dbc.messages[0].signals[0].name, "muxed_D_1");
        assert!(dbc.messages[0].signals[0].unsupported_mux);
    }

    #[test]
    fn attaches_inline_value_descriptions() {
        let dbc = Dbc::parse(
            r#"
VERSION "1.0"
BO_ 100 Example: 8 ECU
 SG_ State : 0|8@1+ (1,0) [0|255] "" DASH
VAL_ 100 State 0 "Off" 1 "On";
"#,
        )
        .unwrap();

        let descriptions = dbc.messages[0].signals[0].value_descriptions().unwrap();
        assert_eq!(descriptions.len(), 2);
        assert_eq!(descriptions[0].raw_value, 0);
        assert_eq!(descriptions[0].label, "Off");
        assert_eq!(descriptions[1].raw_value, 1);
        assert_eq!(descriptions[1].label, "On");
    }

    #[test]
    fn shares_named_value_table_descriptions() {
        let dbc = Dbc::parse(
            r#"
VAL_TABLE_ GearStates 0 "Park" 1 "Drive";
BO_ 100 Example: 8 ECU
 SG_ Gear : 0|8@1+ (1,0) [0|255] "" DASH
 SG_ RequestedGear : 8|8@1+ (1,0) [0|255] "" DASH
VAL_ 100 Gear GearStates;
VAL_ 100 RequestedGear GearStates;
"#,
        )
        .unwrap();

        let gear = dbc.messages[0].signals[0]
            .value_descriptions
            .as_ref()
            .unwrap();
        let requested = dbc.messages[0].signals[1]
            .value_descriptions
            .as_ref()
            .unwrap();
        assert_eq!(dbc.value_tables.len(), 1);
        assert!(Rc::ptr_eq(&dbc.value_tables[0].values, gear));
        assert!(Rc::ptr_eq(gear, requested));
        assert_eq!(gear[1].label, "Drive");
    }

    #[test]
    fn attaches_signal_value_type() {
        let dbc = Dbc::parse(
            r#"
BO_ 100 Example: 8 ECU
 SG_ Temperature : 0|32@1+ (1,0) [0|0] "" DASH
SIG_VALTYPE_ 100 Temperature : 1;
"#,
        )
        .unwrap();

        assert_eq!(dbc.messages[0].signals[0].value_type, ValueType::Float32);
    }

    #[test]
    fn rejects_signal_before_message() {
        assert!(matches!(
            Dbc::parse("SG_ Value : 0|8@1+ (1,0) [0|255] \"\" DASH"),
            Err(DbcError::AtRecord { .. })
        ));
    }

    #[test]
    fn finds_signal_by_complete_message_identity() {
        let dbc = Dbc::parse(
            r#"
BO_ 256 Status: 1 ECU
 SG_ Value : 0|8@1+ (1,0) [0|255] "" DASH
BO_ 512 Status: 1 ECU
 SG_ Value : 0|8@1+ (1,0) [0|255] "" DASH
"#,
        )
        .unwrap();

        let (message, signal) = dbc.find_signal(512, false, 1, "Value").unwrap();
        assert_eq!(message.dbc_id, 512);
        assert_eq!(signal.name, "Value");
        assert!(dbc.find_signal(512, false, 2, "Value").is_none());
    }

    #[test]
    fn parses_repository_dbc_fixtures() {
        let fixtures = [
            include_str!("../../tests/fixtures/agentic-demo.dbc"),
            include_str!("../../tests/fixtures/extended-multiplex.dbc"),
            include_str!("../../tests/fixtures/sample.dbc"),
            include_str!("../../tests/fixtures/value-descriptions.dbc"),
        ];

        for fixture in fixtures {
            let dbc = Dbc::parse(fixture).unwrap();
            assert!(!dbc.messages.is_empty());
        }
    }
}
