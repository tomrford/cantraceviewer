use std::fmt::Write;

use super::{Dbc, Message, Signal};

/// Serializes the parsed DBC catalog consumed by the signal picker.
///
/// This is intentionally a UI catalog rather than a full DBC interchange
/// format. Unsupported multiplexed signals remain in the parsed model but are
/// omitted from this browser-facing projection.
pub fn to_json(parsed: &Dbc) -> String {
    let mut output = String::new();
    output.push_str("{\"messages\":[");
    for (index, message) in parsed.messages.iter().enumerate() {
        if index != 0 {
            output.push(',');
        }
        write_message(&mut output, message);
    }
    output.push_str("]}");
    output
}

fn write_message(output: &mut String, message: &Message) {
    output.push('{');
    write_string_field(output, "name", &message.name);
    write!(output, ",\"dbcId\":{}", message.dbc_id).expect("writing to String cannot fail");
    write!(output, ",\"canId\":{}", message.can_id).expect("writing to String cannot fail");
    write!(output, ",\"isExtended\":{}", message.is_extended)
        .expect("writing to String cannot fail");
    write!(output, ",\"isFd\":{}", message.is_fd).expect("writing to String cannot fail");
    write!(output, ",\"sizeBytes\":{}", message.size_bytes).expect("writing to String cannot fail");
    output.push_str(",\"transmitter\":");
    write_json_string(output, &message.transmitter);

    output.push_str(",\"signals\":[");
    let mut first = true;
    for signal in message
        .signals
        .iter()
        .filter(|signal| !signal.unsupported_mux)
    {
        if !first {
            output.push(',');
        }
        first = false;
        write_signal(output, signal);
    }
    output.push_str("]}");
}

fn write_signal(output: &mut String, signal: &Signal) {
    output.push('{');
    write_string_field(output, "name", &signal.name);
    write!(output, ",\"startBit\":{}", signal.start_bit).expect("writing to String cannot fail");
    write!(output, ",\"bitLength\":{}", signal.bit_length).expect("writing to String cannot fail");
    write_string_value_field(output, "endianness", signal.endianness.as_catalog_str());
    write_string_value_field(output, "signedness", signal.signedness.as_catalog_str());
    write!(output, ",\"factor\":{}", signal.factor).expect("writing to String cannot fail");
    write!(output, ",\"offset\":{}", signal.offset).expect("writing to String cannot fail");
    write_optional_number_field(output, "minimum", signal.minimum);
    write_optional_number_field(output, "maximum", signal.maximum);
    output.push_str(",\"unit\":");
    write_json_string(output, &signal.unit);
    write_string_value_field(output, "valueType", signal.value_type.as_catalog_str());
    write!(output, ",\"unsupportedMux\":{}", signal.unsupported_mux)
        .expect("writing to String cannot fail");

    output.push_str(",\"receivers\":[");
    for (index, receiver) in signal.receivers.iter().enumerate() {
        if index != 0 {
            output.push(',');
        }
        write_json_string(output, receiver);
    }
    output.push(']');

    output.push_str(",\"valueDescriptions\":[");
    if let Some(descriptions) = signal.value_descriptions() {
        for (index, description) in descriptions.iter().enumerate() {
            if index != 0 {
                output.push(',');
            }
            write!(
                output,
                "{{\"rawValue\":{},\"label\":",
                description.raw_value
            )
            .expect("writing to String cannot fail");
            write_json_string(output, &description.label);
            output.push('}');
        }
    }
    output.push_str("]}");
}

fn write_string_field(output: &mut String, field: &str, value: &str) {
    output.push('"');
    output.push_str(field);
    output.push_str("\":");
    write_json_string(output, value);
}

fn write_string_value_field(output: &mut String, field: &str, value: &str) {
    output.push_str(",\"");
    output.push_str(field);
    output.push_str("\":");
    write_json_string(output, value);
}

fn write_optional_number_field(output: &mut String, field: &str, value: Option<f64>) {
    output.push_str(",\"");
    output.push_str(field);
    output.push_str("\":");
    if let Some(value) = value {
        write!(output, "{value}").expect("writing to String cannot fail");
    } else {
        output.push_str("null");
    }
}

fn write_json_string(output: &mut String, value: &str) {
    output.push('"');
    for character in value.chars() {
        match character {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\u{08}' => output.push_str("\\b"),
            '\u{0c}' => output.push_str("\\f"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            control if control <= '\u{1f}' => {
                write!(output, "\\u{:04x}", u32::from(control))
                    .expect("writing to String cannot fail");
            }
            character => output.push(character),
        }
    }
    output.push('"');
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_parsed_catalog() {
        let parsed = Dbc::parse(
            r#"
BO_ 100 Example: 8 ECU
 SG_ State : 0|8@1+ (1,0) [0|255] "" DASH
VAL_ 100 State 0 "Off" 1 "On";
"#,
        )
        .unwrap();

        let json = to_json(&parsed);

        assert_eq!(
            json,
            r#"{"messages":[{"name":"Example","dbcId":100,"canId":100,"isExtended":false,"isFd":false,"sizeBytes":8,"transmitter":"ECU","signals":[{"name":"State","startBit":0,"bitLength":8,"endianness":"intel","signedness":"unsigned","factor":1,"offset":0,"minimum":0,"maximum":255,"unit":"","valueType":"integer","unsupportedMux":false,"receivers":["DASH"],"valueDescriptions":[{"rawValue":0,"label":"Off"},{"rawValue":1,"label":"On"}]}]}]}"#
        );
    }

    #[test]
    fn omits_unsupported_multiplexed_signals() {
        let parsed = Dbc::parse(
            r#"
BO_ 100 Example: 8 ECU
 SG_ Visible : 0|8@1+ (1,0) [0|255] "" DASH
 SG_ Hidden m1 : 8|8@1+ (1,0) [0|255] "" DASH
"#,
        )
        .unwrap();

        assert_eq!(parsed.messages[0].signals.len(), 2);
        assert!(parsed.messages[0].signals[1].unsupported_mux);

        let json = to_json(&parsed);
        assert!(json.contains("\"Visible\""));
        assert!(!json.contains("\"Hidden\""));
        assert!(json.contains("\"unsupportedMux\":false"));
    }

    #[test]
    fn escapes_catalog_strings_as_json() {
        let parsed = Dbc::parse(
            "BO_ 100 Example: 8 ECU\n SG_ State : 0|8@1+ (1,0) [0|255] \"line\\n\\\"quoted\\\"\" DASH",
        )
        .unwrap();

        let json = to_json(&parsed);
        assert!(json.contains(r#""unit":"linen\"quoted\"""#));
    }
}
