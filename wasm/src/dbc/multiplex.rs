use super::{
    DbcError, Message, Signal, ValueType,
    signal::DecodePlan,
    source::{Position, Record},
};
use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq)]
pub struct MultiplexCondition {
    pub selector: String,
    pub ranges: Vec<(u64, u64)>,
    selector_index: usize,
}

fn error(position: Position, detail: &'static str) -> DbcError {
    position.error("SG_", DbcError::InvalidDefinition(detail))
}

pub(super) fn resolve(messages: &mut [Message], records: &[Record]) -> Result<(), DbcError> {
    for record in records {
        let invalid = || {
            record.position.error(
                "SG_MUL_VAL_",
                DbcError::InvalidDefinition("invalid multiplex range or reference"),
            )
        };
        let mut tokens = record.text.split_whitespace();
        tokens.next();
        let id: u32 = tokens
            .next()
            .ok_or_else(invalid)?
            .parse()
            .map_err(|_| invalid())?;
        let name = tokens.next().ok_or_else(invalid)?;
        let selector = tokens.next().ok_or_else(invalid)?;
        let tail = tokens.collect::<String>();
        let tail = tail.strip_suffix(';').ok_or_else(invalid)?;
        let mut ranges = Vec::new();
        for range in tail.split(',') {
            let (first, last) = range.split_once('-').ok_or_else(invalid)?;
            let first: u64 = first.parse().map_err(|_| invalid())?;
            let last: u64 = last.parse().map_err(|_| invalid())?;
            if first > last {
                return Err(invalid());
            }
            ranges.push((first, last));
        }
        let mut matches = messages.iter_mut().filter(|m| m.dbc_id == id);
        let message = matches.next().ok_or_else(invalid)?;
        if matches.next().is_some() {
            return Err(invalid());
        }
        let signal = message
            .signals
            .iter_mut()
            .find(|s| s.name == name)
            .ok_or_else(invalid)?;
        if let Some(condition) = &mut signal.multiplex {
            if condition.selector != selector {
                return Err(invalid());
            }
            condition.ranges.extend(ranges);
        } else {
            signal.multiplex = Some(MultiplexCondition {
                selector: selector.into(),
                selector_index: 0,
                ranges,
            });
        }
    }
    for message in messages {
        let roots: Vec<_> = message
            .signals
            .iter()
            .filter(|s| s.is_multiplexer && s.simple_mux_value.is_none() && s.multiplex.is_none())
            .map(|s| s.name.clone())
            .collect();
        for signal in &mut message.signals {
            if let Some(value) = signal.simple_mux_value {
                if let Some(condition) = &signal.multiplex {
                    if !condition
                        .ranges
                        .iter()
                        .any(|&(a, b)| a <= value && value <= b)
                    {
                        return Err(error(
                            signal.position,
                            "simple multiplex value is outside extended ranges",
                        ));
                    }
                } else {
                    if roots.len() != 1 {
                        return Err(error(signal.position, "signal needs an explicit selector"));
                    }
                    signal.multiplex = Some(MultiplexCondition {
                        selector: roots[0].clone(),
                        selector_index: 0,
                        ranges: vec![(value, value)],
                    });
                }
            }
        }
        if message
            .signals
            .iter()
            .any(|s| s.is_multiplexer || s.multiplex.is_some())
        {
            resolve_graph(message)?;
        }
    }
    Ok(())
}

fn resolve_graph(message: &mut Message) -> Result<(), DbcError> {
    // Duplicate names and signal layouts have already been checked by the parser.
    let indices: HashMap<_, _> = message
        .signals
        .iter()
        .enumerate()
        .map(|(i, s)| (s.name.clone(), i))
        .collect();
    for signal in &message.signals {
        if signal.is_multiplexer && signal.value_type != ValueType::Integer {
            return Err(error(signal.position, "invalid integer selector"));
        }
    }
    for index in 0..message.signals.len() {
        let signal = &message.signals[index];
        let Some(condition) = &signal.multiplex else {
            continue;
        };
        let &selector_index = indices
            .get(&condition.selector)
            .ok_or_else(|| error(signal.position, "missing selector"))?;
        let selector = &message.signals[selector_index];
        if !selector.is_multiplexer {
            return Err(error(signal.position, "invalid integer selector"));
        }
        let max = u64::MAX >> (64 - selector.bit_length);
        if condition.ranges.iter().any(|&(_, last)| last > max) {
            return Err(error(
                signal.position,
                "selector range exceeds its bit width",
            ));
        }
        message.signals[index]
            .multiplex
            .as_mut()
            .unwrap()
            .selector_index = selector_index;
    }
    // Each edge is visited once, with no recursive stack growth on deep graphs.
    let mut states = vec![0; message.signals.len()];
    for start in 0..states.len() {
        let mut current = Some(start);
        while let Some(index) = current {
            match states[index] {
                2 => break,
                1 => {
                    return Err(error(message.signals[index].position, "selector cycle"));
                }
                _ => states[index] = 1,
            }
            current = message.signals[index]
                .multiplex
                .as_ref()
                .map(|c| c.selector_index);
        }
        current = Some(start);
        while let Some(index) = current {
            if states[index] == 2 {
                break;
            }
            states[index] = 2;
            current = message.signals[index]
                .multiplex
                .as_ref()
                .map(|c| c.selector_index);
        }
    }
    Ok(())
}

pub(crate) struct ActivityPlan<'a>(Vec<(DecodePlan, &'a [(u64, u64)])>);

impl<'a> ActivityPlan<'a> {
    pub(crate) fn new(message: &'a Message, signal: &'a Signal) -> Result<Self, DbcError> {
        let mut plans = Vec::new();
        let mut current = signal;
        while let Some(condition) = &current.multiplex {
            let selector = &message.signals[condition.selector_index];
            plans.push((
                selector.plan_decode(message.size_bytes)?,
                condition.ranges.as_slice(),
            ));
            current = selector;
        }
        plans.reverse();
        Ok(Self(plans))
    }
    pub(crate) fn active(&self, payload: &[u8]) -> bool {
        self.0.iter().all(|(plan, ranges)| {
            let value = plan.raw_bits(payload);
            ranges
                .iter()
                .any(|&(first, last)| first <= value && value <= last)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dbc::Dbc;

    #[test]
    fn resolves_repository_extended_fixture() {
        let dbc = Dbc::parse(include_str!("../../tests/fixtures/extended-multiplex.dbc")).unwrap();
        let message = &dbc.messages[0];
        assert_eq!(message.signals.len(), 12);
        let data = message
            .signals
            .iter()
            .find(|s| s.name == "muxed_D_1")
            .unwrap();
        let activity = ActivityPlan::new(message, data).unwrap();
        assert!(activity.active(&[0, 0, 0, 0, 1, 1, 42]));
        assert!(!activity.active(&[0, 0, 0, 0, 0, 1, 42]));
        assert!(!activity.active(&[0, 0, 0, 0, 1, 0, 42]));
    }

    #[test]
    fn keeps_full_width_selector_bits() {
        let dbc = Dbc::parse("BO_ 1 Wide: 9 ECU\n SG_ Root M : 0|64@1- (2,3) [0|0] \"\" ECU\n SG_ Data m18446744073709551615 : 64|8@1+ (1,0) [0|0] \"\" ECU").unwrap();
        let message = &dbc.messages[0];
        let plan = ActivityPlan::new(message, &message.signals[1]).unwrap();
        assert!(plan.active(&[255, 255, 255, 255, 255, 255, 255, 255, 7]));
        assert!(!plan.active(&[254, 255, 255, 255, 255, 255, 255, 255, 7]));
        assert!(
            dbc.to_catalog_json()
                .contains("\"first\":\"18446744073709551615\"")
        );
    }

    #[test]
    fn validates_selector_placement_without_capping_catalogue_payloads() {
        let invalid = "BO_ 1 Mux: 2 ECU\n SG_ Root M : 24|8@1+ (1,0) [0|0] \"\" ECU\n SG_ Value m1 : 0|16@1+ (1,0) [0|0] \"\" ECU";
        let error = Dbc::parse(invalid).unwrap_err().to_string();
        assert!(error.contains("DBC input:2:2: SG_"), "{error}");
        assert!(error.contains("outside its message"));
        let long = "BO_ 2566834942 Long: 1785 ECU\n SG_ Root M : 800|8@1+ (1,0) [0|0] \"\" ECU\n SG_ Value m1 : 808|16@1+ (1,0) [0|0] \"\" ECU\nBA_ \"ProtocolType\" \"J1939\";";
        let dbc = Dbc::parse(long).unwrap();
        assert_eq!(
            dbc.messages[0].signals[1]
                .multiplex
                .as_ref()
                .unwrap()
                .selector,
            "Root"
        );
        assert!(ActivityPlan::new(&dbc.messages[0], &dbc.messages[0].signals[1]).is_err());
    }

    #[test]
    fn rejects_invalid_selector_graphs_with_source_context() {
        let base = "BO_ 1 Mux: 3 ECU\n SG_ Root M : 0|8@1+ (1,0) [0|0] \"\" ECU\n SG_ Child m1M : 8|8@1+ (1,0) [0|0] \"\" ECU\n SG_ Data m2 : 16|8@1+ (1,0) [0|0] \"\" ECU\n";
        for (tail, expected) in [
            ("SG_MUL_VAL_ 1 Data Missing 2-2;", "missing selector"),
            (
                "SG_MUL_VAL_ 1 Root Child 1-1;\nSG_MUL_VAL_ 1 Child Root 1-1;\nSG_MUL_VAL_ 1 Data Root 2-2;",
                "cycle",
            ),
            ("SG_MUL_VAL_ 1 Data Data 2-2;", "invalid integer selector"),
            ("SG_MUL_VAL_ 1 Data Root 2-256;", "exceeds its bit width"),
            ("SG_MUL_VAL_ 1 Data Root 3-4;", "outside extended ranges"),
            ("SG_MUL_VAL_ 1 Data Root 4-2;", "invalid multiplex range"),
            ("SIG_VALTYPE_ 1 Root : 1;", "invalid signal bit length"),
        ] {
            let error = Dbc::parse(&format!("{base}{tail}"))
                .unwrap_err()
                .to_string();
            assert!(error.contains(expected), "{error}");
            assert!(error.contains("DBC input:"));
        }
        let error = Dbc::parse("BO_ 1 Missing: 1 ECU\n SG_ Data m1 : 0|8@1+ (1,0) [0|0] \"\" ECU")
            .unwrap_err()
            .to_string();
        assert!(error.contains("explicit selector"));
    }
}
