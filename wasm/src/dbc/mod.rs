//! Dependency-free DBC parsing and signal decoding.
//!
//! The model owns its parsed text, so a `Dbc` can move directly behind a
//! `wasm-bindgen` class without an arena or a separate source-buffer lifetime.

mod catalog;
mod error;
mod message;
mod quotes;
mod signal;
mod values;

use std::rc::Rc;

pub use error::DbcError;
pub use message::Message;
pub use signal::Signal;
pub use values::{
    SignalValueDescriptions, SignalValueType, ValueDescription, ValueDescriptionRef, ValueTable,
    ValueType,
};

/// Parsed subset of a DBC file used by the viewer.
#[derive(Clone, Debug, PartialEq)]
pub struct Dbc {
    /// Messages in source order, each with its attached signals.
    pub messages: Vec<Message>,

    /// Value tables in source order.
    pub value_tables: Vec<ValueTable>,
}

impl Dbc {
    /// Parses DBC text into an owned model.
    pub fn parse(text: &str) -> Result<Self, DbcError> {
        let mut messages = Vec::new();
        let mut value_tables = Vec::new();
        let mut pending_values = Vec::new();
        let mut pending_value_types = Vec::new();

        let mut current_signals = Vec::new();
        let mut current_message: Option<Message> = None;

        for raw_line in text.split('\n') {
            let line = trim_dbc(raw_line);
            if line.is_empty() {
                continue;
            }

            if starts_with_record(line, "BO_") {
                finish_message(&mut messages, &mut current_message, &mut current_signals);
                current_message = Some(Message::parse(line)?);
                continue;
            }

            if line.starts_with("VAL_TABLE_ ") {
                value_tables.push(ValueTable::parse(line)?);
                continue;
            }

            if line.starts_with("VAL_ ") {
                pending_values.push(SignalValueDescriptions::parse(line)?);
                continue;
            }

            if line.starts_with("SIG_VALTYPE_ ") {
                pending_value_types.push(SignalValueType::parse(line)?);
                continue;
            }

            if starts_with_record(line, "SG_") {
                if current_message.is_none() {
                    return Err(DbcError::SignalWithoutMessage);
                }
                current_signals.push(Signal::parse(line)?);
            }
        }

        finish_message(&mut messages, &mut current_message, &mut current_signals);

        for pending in pending_values {
            attach_value_descriptions(&mut messages, &value_tables, pending);
        }
        for pending in pending_value_types {
            attach_value_type(&mut messages, pending);
        }

        Ok(Self {
            messages,
            value_tables,
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
) {
    let descriptions = match pending.value_descriptions {
        ValueDescriptionRef::InlineValues(descriptions) => descriptions,
        ValueDescriptionRef::TableName(name) => {
            let Some(table) = value_tables.iter().find(|table| table.name == name) else {
                return;
            };
            Rc::clone(&table.values)
        }
    };

    if let Some(signal) = messages
        .iter_mut()
        .find(|message| message.dbc_id == pending.message_id)
        .and_then(|message| {
            message
                .signals
                .iter_mut()
                .find(|signal| signal.name == pending.signal_name)
        })
    {
        signal.value_descriptions = Some(descriptions);
    }
}

fn attach_value_type(messages: &mut [Message], pending: SignalValueType) {
    if let Some(signal) = messages
        .iter_mut()
        .find(|message| message.dbc_id == pending.message_id)
        .and_then(|message| {
            message
                .signals
                .iter_mut()
                .find(|signal| signal.name == pending.signal_name)
        })
    {
        signal.value_type = pending.value_type;
    }
}

fn starts_with_record(line: &str, keyword: &str) -> bool {
    line.strip_prefix(keyword)
        .and_then(|rest| rest.as_bytes().first())
        .is_some_and(|byte| is_dbc_whitespace(*byte))
}

pub(crate) fn trim_dbc(text: &str) -> &str {
    text.trim_matches(|character| matches!(character, ' ' | '\t' | '\r'))
}

pub(crate) fn trim_space_tab(text: &str) -> &str {
    text.trim_matches(|character| matches!(character, ' ' | '\t'))
}

pub(crate) fn find_dbc_whitespace(text: &str) -> Option<usize> {
    text.as_bytes()
        .iter()
        .position(|byte| is_dbc_whitespace(*byte))
}

pub(crate) const fn is_dbc_whitespace(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t' | b'\r')
}

#[cfg(test)]
mod tests {
    use super::*;

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
            Err(DbcError::SignalWithoutMessage)
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
