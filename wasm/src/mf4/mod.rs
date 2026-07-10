mod block;
mod decode;
mod error;

use std::collections::BTreeMap;
use std::fmt::Write;

use fdeflate::{DecompressionError, Decompressor};

use crate::trace::Trace;

use block::{
    FileIndex, MAX_EMBEDDED_DBC_BYTES, is_arxml_attachment, is_dbc_attachment, parse_index,
};
use decode::{
    NativeSignal, decode_native_signal, duration_ns, native_signals, native_time_range,
    parse_raw_trace,
};
pub(crate) use error::Mf4Error;

const ABSOLUTE_TIME_THRESHOLD_SECONDS: f64 = 100_000_000.0;
const ABSOLUTE_TIME_THRESHOLD_NS: u64 = 100_000_000_000_000_000;

#[derive(Debug)]
pub(crate) struct Document {
    bytes: Vec<u8>,
    index: FileIndex,
    signals: Vec<NativeSignal>,
    embedded_dbcs: Vec<EmbeddedDbc>,
    warnings: Vec<String>,
    time_offset_seconds: f64,
}

#[derive(Debug)]
struct EmbeddedDbc {
    name: String,
    text: String,
}

impl Document {
    pub(crate) fn parse(bytes: Vec<u8>) -> Result<(Trace, Self), Mf4Error> {
        let index = parse_index(&bytes)?;
        let mut trace = parse_raw_trace(&bytes, &index)?;
        let signals = native_signals(&index);
        if trace.data_frame_count == 0 && signals.is_empty() {
            return Err(Mf4Error::NoPlottableData);
        }

        let native_range = native_time_range(&bytes, &index)?;
        let raw_minimum = trace.frames.iter().map(|frame| frame.timestamp_ns).min();
        let (raw_time_offset_ns, time_offset_seconds) =
            time_offsets(raw_minimum, native_range.map(|(minimum, _)| minimum))?;
        normalize_raw_timestamps(&mut trace, raw_time_offset_ns)?;
        if let Some((_, maximum)) = native_range {
            let duration = duration_ns(maximum - time_offset_seconds)?;
            trace.last_data_timestamp_ns = Some(
                trace
                    .last_data_timestamp_ns
                    .map_or(duration, |raw_duration| raw_duration.max(duration)),
            );
        }
        let (embedded_dbcs, warnings) = classify_attachments(&index);
        Ok((
            trace,
            Self {
                bytes,
                index,
                signals,
                embedded_dbcs,
                warnings,
                time_offset_seconds,
            },
        ))
    }

    pub(crate) fn catalog_json(&self) -> String {
        let mut grouped: BTreeMap<(usize, usize), Vec<&NativeSignal>> = BTreeMap::new();
        for signal in &self.signals {
            grouped
                .entry((signal.data_group_index, signal.group_index))
                .or_default()
                .push(signal);
        }
        let mut output = String::from("{\"groups\":[");
        for (group_position, ((_data_group, _group), signals)) in grouped.iter().enumerate() {
            if group_position != 0 {
                output.push(',');
            }
            output.push('{');
            write_string_field(&mut output, "name", &signals[0].group_name);
            output.push_str(",\"signals\":[");
            for (signal_position, signal) in signals.iter().enumerate() {
                if signal_position != 0 {
                    output.push(',');
                }
                output.push('{');
                write!(output, "\"id\":{}", signal.id).expect("writing to String cannot fail");
                output.push(',');
                write_string_field(&mut output, "name", &signal.name);
                output.push(',');
                write_string_field(&mut output, "unit", &signal.unit);
                output.push('}');
            }
            output.push_str("]}");
        }
        output.push_str("]}");
        output
    }

    pub(crate) fn embedded_dbcs_json(&self) -> String {
        let mut output = String::from("[");
        for (index, dbc) in self.embedded_dbcs.iter().enumerate() {
            if index != 0 {
                output.push(',');
            }
            output.push('{');
            write_string_field(&mut output, "name", &dbc.name);
            output.push(',');
            write_string_field(&mut output, "text", &dbc.text);
            output.push('}');
        }
        output.push(']');
        output
    }

    pub(crate) fn warnings_json(&self) -> String {
        let mut output = String::from("[");
        for (index, warning) in self.warnings.iter().enumerate() {
            if index != 0 {
                output.push(',');
            }
            write_json_string(&mut output, warning);
        }
        output.push(']');
        output
    }

    pub(crate) fn decode_signal(&self, signal_id: u32) -> Result<Vec<f64>, Mf4Error> {
        decode_native_signal(
            &self.bytes,
            &self.index,
            &self.signals,
            signal_id,
            self.time_offset_seconds,
        )
    }
}

fn classify_attachments(index: &FileIndex) -> (Vec<EmbeddedDbc>, Vec<String>) {
    let mut dbcs = Vec::new();
    let mut warnings = Vec::new();
    for attachment in &index.attachments {
        if is_arxml_attachment(&attachment.name, &attachment.mime) {
            warnings.push(format!(
                "Embedded ARXML attachment \"{}\" is not supported yet; see issue #115.",
                display_attachment_name(&attachment.name, "ARXML")
            ));
            continue;
        }
        if !is_dbc_attachment(&attachment.name, &attachment.mime) {
            continue;
        }
        if !attachment.is_embedded {
            warnings.push(format!(
                "DBC attachment \"{}\" is external and cannot be opened from this MF4 file.",
                display_attachment_name(&attachment.name, "DBC")
            ));
            continue;
        }
        if attachment.original_size > MAX_EMBEDDED_DBC_BYTES {
            warnings.push(format!(
                "Embedded DBC \"{}\" exceeds the 1 MiB DBC limit.",
                display_attachment_name(&attachment.name, "DBC")
            ));
            continue;
        }
        let Some(data) = attachment.data.as_deref() else {
            continue;
        };
        match std::str::from_utf8(data) {
            Ok(text) => dbcs.push(EmbeddedDbc {
                name: display_attachment_name(&attachment.name, "embedded.dbc").to_owned(),
                text: text.to_owned(),
            }),
            Err(_) => warnings.push(format!(
                "Embedded DBC \"{}\" is not valid UTF-8 text.",
                display_attachment_name(&attachment.name, "DBC")
            )),
        }
    }
    (dbcs, warnings)
}

fn time_offsets(
    raw_minimum_ns: Option<u64>,
    native_minimum: Option<f64>,
) -> Result<(u64, f64), Mf4Error> {
    let raw_absolute = raw_minimum_ns.filter(|minimum| *minimum >= ABSOLUTE_TIME_THRESHOLD_NS);
    let native_absolute =
        native_minimum.filter(|minimum| *minimum >= ABSOLUTE_TIME_THRESHOLD_SECONDS);
    Ok(match (raw_absolute, native_absolute) {
        (Some(raw), Some(native)) => {
            let shared_ns = raw.min(duration_ns(native)?);
            (shared_ns, shared_ns as f64 / 1_000_000_000.0)
        }
        (Some(raw), None) => (raw, 0.0),
        (None, Some(native)) => (0, native),
        (None, None) => (0, 0.0),
    })
}

fn normalize_raw_timestamps(trace: &mut Trace, offset_ns: u64) -> Result<(), Mf4Error> {
    if offset_ns == 0 {
        return Ok(());
    }
    for frame in &mut trace.frames {
        frame.timestamp_ns = frame
            .timestamp_ns
            .checked_sub(offset_ns)
            .ok_or(Mf4Error::InvalidTimestamp)?;
    }
    trace.last_data_timestamp_ns = trace
        .last_data_timestamp_ns
        .map(|timestamp| {
            timestamp
                .checked_sub(offset_ns)
                .ok_or(Mf4Error::InvalidTimestamp)
        })
        .transpose()?;
    Ok(())
}

fn display_attachment_name<'a>(name: &'a str, fallback: &'a str) -> &'a str {
    if name.trim().is_empty() {
        fallback
    } else {
        name
    }
}

pub(super) fn inflate_zlib(input: &[u8], expected_len: usize) -> Result<Vec<u8>, Mf4Error> {
    if input.len() < 6 {
        return Err(Mf4Error::InvalidCompressedData);
    }
    let compression_method = input[0] & 0x0f;
    let window_size = input[0] >> 4;
    let header_check = u16::from_be_bytes([input[0], input[1]]);
    if compression_method != 8 || window_size > 7 || !header_check.is_multiple_of(31) {
        return Err(Mf4Error::InvalidCompressedData);
    }
    if input[1] & 0x20 != 0 {
        return Err(Mf4Error::InvalidCompressedData);
    }

    let mut output = Vec::new();
    output
        .try_reserve_exact(expected_len)
        .map_err(|_| Mf4Error::DecompressedBlockTooLarge)?;
    output.resize(expected_len, 0);
    let mut decoder = Decompressor::new();
    let (consumed, produced) = decoder
        .read(input, &mut output, 0, true)
        .map_err(map_decompression_error)?;
    if decoder.is_done() {
        return (consumed == input.len() && produced == expected_len)
            .then_some(output)
            .ok_or(Mf4Error::InvalidCompressedData);
    }
    if produced != expected_len {
        return Err(Mf4Error::InvalidCompressedData);
    }
    output
        .try_reserve_exact(1)
        .map_err(|_| Mf4Error::DecompressedBlockTooLarge)?;
    output.push(0);
    let (additional_consumed, additional_produced) = decoder
        .read(&input[consumed..], &mut output, produced, true)
        .map_err(map_decompression_error)?;
    output.truncate(expected_len);
    (decoder.is_done() && consumed + additional_consumed == input.len() && additional_produced == 0)
        .then_some(output)
        .ok_or(Mf4Error::InvalidCompressedData)
}

fn map_decompression_error(_error: DecompressionError) -> Mf4Error {
    Mf4Error::InvalidCompressedData
}

fn write_string_field(output: &mut String, field: &str, value: &str) {
    output.push('"');
    output.push_str(field);
    output.push_str("\":");
    write_json_string(output, value);
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
    use crate::mf4::block::Attachment;
    use crate::trace::Frame;

    #[test]
    fn parses_raw_can_event_groups() {
        let (trace, document) =
            Document::parse(include_bytes!("../../tests/fixtures/mf4/raw-can.mf4").to_vec())
                .unwrap();

        assert_eq!(trace.data_frame_count, 2);
        assert_eq!(trace.frames.len(), 4);
        assert_eq!(
            trace.payloads,
            [1, 2, 3, 4, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0xaa, 0xbb]
        );
        assert!(document.signals.is_empty());
    }

    #[test]
    fn parses_unsorted_and_transposed_compressed_records() {
        let (unsorted, _) =
            Document::parse(include_bytes!("../../tests/fixtures/mf4/raw-unsorted.mf4").to_vec())
                .unwrap();
        let (compressed, _) = Document::parse(
            include_bytes!("../../tests/fixtures/mf4/raw-transposed-dz.mf4").to_vec(),
        )
        .unwrap();

        assert_eq!(unsorted.data_frame_count, 2);
        assert_eq!(unsorted.frames.len(), 4);
        assert_eq!(compressed.data_frame_count, 1);
        assert_eq!(compressed.payloads, [1, 2, 3, 4]);
    }

    #[test]
    fn catalogs_and_decodes_native_channels() {
        let (trace, document) = Document::parse(
            include_bytes!("../../tests/fixtures/mf4/decoded-channels.mf4").to_vec(),
        )
        .unwrap();

        assert_eq!(trace.data_frame_count, 0);
        assert_eq!(trace.last_data_timestamp_ns, Some(300_000_000));
        assert!(document.catalog_json().contains("Decoded powertrain"));
        assert!(document.catalog_json().contains("VehicleSpeed"));
        assert_eq!(
            document.decode_signal(0).unwrap(),
            [100.0, 200.0, 300.0, 12.5, 25.0, 37.5]
        );
    }

    #[test]
    fn keeps_raw_native_and_embedded_dbc_sources_together() {
        let (trace, document) = Document::parse(
            include_bytes!("../../tests/fixtures/mf4/hybrid-embedded-dbc.mf4").to_vec(),
        )
        .unwrap();

        assert_eq!(trace.data_frame_count, 2);
        assert_eq!(document.signals.len(), 2);
        assert_eq!(document.embedded_dbcs.len(), 1);
        assert_eq!(document.embedded_dbcs[0].name, "sample.dbc");
        assert!(
            document.embedded_dbcs[0]
                .text
                .contains("BO_ 291 WebData_2000")
        );
        assert!(document.warnings.is_empty());
    }

    #[test]
    fn reports_embedded_arxml_as_separate_unsupported_work() {
        let index = FileIndex {
            measurement_start_ms: None,
            data_groups: Vec::new(),
            attachments: vec![Attachment {
                name: "network.arxml".to_owned(),
                mime: "application/x-arxml".to_owned(),
                is_embedded: true,
                original_size: 10,
                data: None,
            }],
        };

        let (dbcs, warnings) = classify_attachments(&index);

        assert!(dbcs.is_empty());
        assert_eq!(
            warnings,
            ["Embedded ARXML attachment \"network.arxml\" is not supported yet; see issue #115."]
        );
    }

    #[test]
    fn reports_oversized_embedded_dbcs_without_materializing_them() {
        let index = FileIndex {
            measurement_start_ms: None,
            data_groups: Vec::new(),
            attachments: vec![Attachment {
                name: "large.dbc".to_owned(),
                mime: "application/x-dbc".to_owned(),
                is_embedded: true,
                original_size: MAX_EMBEDDED_DBC_BYTES + 1,
                data: None,
            }],
        };

        let (dbcs, warnings) = classify_attachments(&index);

        assert!(dbcs.is_empty());
        assert_eq!(
            warnings,
            ["Embedded DBC \"large.dbc\" exceeds the 1 MiB DBC limit."]
        );
    }

    #[test]
    fn aligns_absolute_raw_and_native_timestamps_to_a_shared_origin() {
        let raw_minimum_ns = 134_217_728_250_000_000;
        let native_minimum = 134_217_728.5;
        let (raw_offset_ns, native_offset) =
            time_offsets(Some(raw_minimum_ns), Some(native_minimum)).unwrap();
        assert_eq!(raw_offset_ns, raw_minimum_ns);
        assert_eq!(native_offset, 134_217_728.25);

        let mut trace = Trace {
            frames: vec![
                Frame {
                    timestamp_ns: raw_minimum_ns,
                    ..Frame::default()
                },
                Frame {
                    timestamp_ns: raw_minimum_ns + 250_000_000,
                    ..Frame::default()
                },
            ],
            last_data_timestamp_ns: Some(raw_minimum_ns + 250_000_000),
            ..Trace::default()
        };
        normalize_raw_timestamps(&mut trace, raw_offset_ns).unwrap();

        assert_eq!(trace.frames[0].timestamp_ns, 0);
        assert_eq!(trace.frames[1].timestamp_ns, 250_000_000);
        assert_eq!(trace.last_data_timestamp_ns, Some(250_000_000));
        assert_eq!(
            time_offsets(Some(100_000_000), Some(native_minimum)).unwrap(),
            (0, native_minimum)
        );
    }
}
