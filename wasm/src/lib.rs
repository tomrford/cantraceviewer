#![forbid(unsafe_code)]

use wasm_bindgen::prelude::*;

mod asc;
mod blf;
mod dbc;
mod series;
mod trace;
mod trc;

use dbc::DbcHandle;
use trace::{FrameIndex, Trace as ParsedTrace, TraceError};

/// Stable error object thrown by fallible generated JavaScript bindings.
#[wasm_bindgen]
pub struct DecoderError {
    code: String,
    message: String,
}

#[wasm_bindgen]
impl DecoderError {
    #[wasm_bindgen(getter)]
    pub fn code(&self) -> String {
        self.code.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn message(&self) -> String {
        self.message.clone()
    }
}

impl DecoderError {
    fn new(code: &str, message: impl ToString) -> Self {
        Self {
            code: code.to_owned(),
            message: message.to_string(),
        }
    }

    fn from_dbc(error: dbc::DbcError) -> Self {
        Self::new(error.code(), error)
    }

    fn from_trace(error: TraceError) -> Self {
        Self::new(error.code(), error)
    }

    fn from_blf(error: blf::BlfError) -> Self {
        Self::new(error.code(), error)
    }

    fn from_series(error: series::SeriesError) -> Self {
        Self::new(error.code(), error)
    }
}

/// Parsed DBC model owned by WebAssembly.
#[wasm_bindgen(js_name = Dbc)]
pub struct WasmDbc {
    inner: DbcHandle,
}

#[wasm_bindgen]
impl WasmDbc {
    /// Parse DBC text and retain the decoded model for subsequent signal work.
    pub fn parse(input: &str) -> Result<WasmDbc, DecoderError> {
        Ok(Self {
            inner: DbcHandle::parse(input).map_err(DecoderError::from_dbc)?,
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
    ) -> Result<Box<[f64]>, DecoderError> {
        trace.ensure_frame_index()?;
        let index = trace.index.as_ref().expect("frame index was initialized");
        series::selected_signal_values(
            &self.inner.dbc,
            &trace.inner,
            index,
            can_id,
            is_extended,
            size_bytes,
            signal_name,
        )
        .map(Vec::into_boxed_slice)
        .map_err(DecoderError::from_series)
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
    pub fn parse_asc(input: &[u8]) -> Result<WasmTrace, DecoderError> {
        Ok(Self::from_trace(
            asc::parse_bytes(input).map_err(DecoderError::from_trace)?,
        ))
    }

    #[wasm_bindgen(js_name = parseTrc)]
    pub fn parse_trc(input: &[u8]) -> Result<WasmTrace, DecoderError> {
        Ok(Self::from_trace(
            trc::parse_bytes(input).map_err(DecoderError::from_trace)?,
        ))
    }

    #[wasm_bindgen(js_name = parseBlf)]
    pub fn parse_blf(input: &[u8]) -> Result<WasmTrace, DecoderError> {
        Ok(Self::from_trace(
            blf::from_bytes(input).map_err(DecoderError::from_blf)?,
        ))
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

    fn ensure_frame_index(&mut self) -> Result<(), DecoderError> {
        if self.index.is_none() {
            self.index =
                Some(FrameIndex::build(&self.inner.frames).map_err(DecoderError::from_trace)?);
        }

        Ok(())
    }
}
