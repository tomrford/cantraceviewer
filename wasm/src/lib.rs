#![forbid(unsafe_code)]

use wasm_bindgen::prelude::*;

mod asc;
mod blf;
mod dbc;
mod series;
mod trace;
mod trc;

use dbc::Dbc;
use trace::{FrameIndex, Trace as ParsedTrace};

/// Parsed DBC model owned by WebAssembly.
#[wasm_bindgen(js_name = Dbc)]
pub struct WasmDbc {
    inner: Dbc,
}

#[wasm_bindgen]
impl WasmDbc {
    /// Parse DBC text and retain the decoded model for subsequent signal work.
    pub fn parse(input: &str) -> Result<WasmDbc, JsError> {
        Ok(Self {
            inner: Dbc::parse(input)?,
        })
    }

    /// Return the browser catalog projection as JSON.
    #[wasm_bindgen(js_name = catalogJson)]
    pub fn catalog_json(&self) -> String {
        self.inner.to_catalog_json()
    }

    /// Decode one selected signal as packed parallel time/value arrays.
    #[wasm_bindgen(js_name = decodeSignal)]
    pub fn decode_signal(
        &self,
        trace: &mut WasmTrace,
        can_id: u32,
        is_extended: bool,
        size_bytes: u16,
        signal_name: &str,
    ) -> Result<Box<[f64]>, JsError> {
        let index = trace
            .index
            .get_or_insert_with(|| FrameIndex::build(&trace.inner.frames));
        Ok(series::selected_signal_values(
            &self.inner,
            &trace.inner,
            index,
            can_id,
            is_extended,
            size_bytes,
            signal_name,
        )?
        .into_boxed_slice())
    }
}

/// Parsed trace model owned by WebAssembly.
#[wasm_bindgen(js_name = Trace)]
pub struct WasmTrace {
    inner: ParsedTrace,
    index: Option<FrameIndex>,
}

#[wasm_bindgen]
impl WasmTrace {
    #[wasm_bindgen(js_name = parseAsc)]
    pub fn parse_asc(input: &[u8]) -> Result<WasmTrace, JsError> {
        Ok(Self::from_trace(asc::parse_bytes(input)?))
    }

    #[wasm_bindgen(js_name = parseTrc)]
    pub fn parse_trc(input: &[u8]) -> Result<WasmTrace, JsError> {
        Ok(Self::from_trace(trc::parse_bytes(input)?))
    }

    #[wasm_bindgen(js_name = parseBlf)]
    pub fn parse_blf(input: &[u8]) -> Result<WasmTrace, JsError> {
        Ok(Self::from_trace(blf::from_bytes(input)?))
    }

    #[wasm_bindgen(getter, js_name = measurementStartMs)]
    pub fn measurement_start_ms(&self) -> Option<f64> {
        self.inner.measurement_start_ms.map(|value| value as f64)
    }

    #[wasm_bindgen(getter, js_name = validMessageCount)]
    pub fn valid_message_count(&self) -> u32 {
        self.inner.data_frame_count.try_into().unwrap_or(u32::MAX)
    }

    #[wasm_bindgen(getter, js_name = skippedLineCount)]
    pub fn skipped_line_count(&self) -> u32 {
        self.inner.skipped_line_count.try_into().unwrap_or(u32::MAX)
    }

    #[wasm_bindgen(getter, js_name = durationNs)]
    pub fn duration_ns(&self) -> Option<f64> {
        self.inner.last_data_timestamp_ns.map(|value| value as f64)
    }
}

impl WasmTrace {
    fn from_trace(inner: ParsedTrace) -> Self {
        Self { inner, index: None }
    }
}
