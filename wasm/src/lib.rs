#![forbid(unsafe_code)]

use serde::Serialize;
use wasm_bindgen::prelude::*;

mod asc;
mod blf;
mod dbc;
mod mf4;
mod series;
mod trace;
mod trc;

use dbc::Dbc;
use trace::{FrameIndex, Trace as ParsedTrace};

#[wasm_bindgen(js_name = Dbc)]
pub struct WasmDbc {
    inner: Dbc,
}

#[wasm_bindgen]
impl WasmDbc {
    pub fn parse(input: &[u8]) -> Result<WasmDbc, JsError> {
        Ok(Self {
            inner: Dbc::parse_bytes(input)?,
        })
    }

    #[wasm_bindgen(js_name = warnings)]
    pub fn warnings(&self) -> Result<JsValue, JsError> {
        to_js(&self.inner.warnings)
    }

    #[wasm_bindgen(js_name = catalog)]
    pub fn catalog(&self) -> Result<JsValue, JsError> {
        to_js(&self.inner)
    }

    #[wasm_bindgen(js_name = decodeSignal)]
    #[allow(clippy::too_many_arguments)]
    pub fn decode_signal(
        &self,
        trace: &WasmTrace,
        can_id: u32,
        is_extended: bool,
        size_bytes: u16,
        signal_name: &str,
        channel: Option<u16>,
        direction: Option<String>,
    ) -> Result<Box<[f64]>, JsError> {
        let source = match direction.as_deref() {
            None => None,
            Some(name) => Some(trace::RawSource {
                channel: channel.and_then(std::num::NonZeroU16::new),
                direction: trace::Direction::from_name(name).map_err(JsError::new)?,
            }),
        };
        Ok(series::selected_signal_values(
            &self.inner,
            &trace.inner,
            &trace.index,
            can_id,
            is_extended,
            size_bytes,
            signal_name,
            source,
        )?
        .into_boxed_slice())
    }
}

#[wasm_bindgen(js_name = Trace)]
pub struct WasmTrace {
    inner: ParsedTrace,
    index: FrameIndex,
    mf4: Option<mf4::Document>,
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
    pub fn parse_blf(input: &[u8], max_data_bytes: u32) -> Result<WasmTrace, JsError> {
        Ok(Self::from_trace(blf::from_bytes(
            input,
            max_data_bytes as usize,
        )?))
    }

    #[wasm_bindgen(js_name = parseMf4)]
    pub fn parse_mf4(
        input: Vec<u8>,
        max_dbc_bytes: u32,
        max_data_bytes: u32,
    ) -> Result<WasmTrace, JsError> {
        let (inner, document) =
            mf4::Document::parse(input, max_dbc_bytes as usize, max_data_bytes as usize)?;
        Ok(Self {
            index: FrameIndex::build(&inner.frames),
            inner,
            mf4: Some(document),
        })
    }

    #[wasm_bindgen(js_name = rawMessages)]
    pub fn raw_messages(&self) -> Result<JsValue, JsError> {
        to_js(&self.index.raw_messages())
    }

    #[wasm_bindgen(getter, js_name = hasRawFrames)]
    pub fn has_raw_frames(&self) -> bool {
        self.inner.data_frame_count > 0
    }

    #[wasm_bindgen(js_name = mf4Catalog)]
    pub fn mf4_catalog(&self) -> Result<JsValue, JsError> {
        let catalog = match &self.mf4 {
            Some(document) => document.signal_catalog(),
            None => mf4::empty_signal_catalog(),
        };
        to_js(&catalog)
    }

    #[wasm_bindgen(js_name = mf4EmbeddedDbcs)]
    pub fn mf4_embedded_dbcs(&self) -> Result<JsValue, JsError> {
        match &self.mf4 {
            Some(document) => to_js(document.embedded_dbcs()),
            None => to_js(&[] as &[mf4::EmbeddedDbc]),
        }
    }

    #[wasm_bindgen(js_name = mf4EmbeddedDbcBytes)]
    pub fn mf4_embedded_dbc_bytes(&self, index: u32) -> Result<Box<[u8]>, JsError> {
        self.mf4
            .as_ref()
            .and_then(|document| document.embedded_dbc_bytes(index as usize))
            .map(Into::into)
            .ok_or_else(|| JsError::new("Embedded DBC not found"))
    }

    #[wasm_bindgen(js_name = mf4Warnings)]
    pub fn mf4_warnings(&self) -> Result<JsValue, JsError> {
        to_js(
            self.mf4
                .as_ref()
                .map(mf4::Document::warnings)
                .unwrap_or(&[]),
        )
    }

    #[wasm_bindgen(js_name = decodeMf4Signal)]
    pub fn decode_mf4_signal(&self, signal_id: u32) -> Result<Box<[f64]>, JsError> {
        Ok(self
            .mf4
            .as_ref()
            .ok_or(mf4::Mf4Error::SignalNotFound)?
            .decode_signal(signal_id)?
            .into_boxed_slice())
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

fn to_js<T: Serialize + ?Sized>(value: &T) -> Result<JsValue, JsError> {
    #[cfg(target_arch = "wasm32")]
    {
        let serializer = serde_wasm_bindgen::Serializer::json_compatible();
        return value
            .serialize(&serializer)
            .map_err(|error| JsError::new(&error.to_string()));
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = value;
        Err(JsError::new(
            "catalog objects are returned from WebAssembly",
        ))
    }
}

impl WasmTrace {
    fn from_trace(inner: ParsedTrace) -> Self {
        Self {
            index: FrameIndex::build(&inner.frames),
            inner,
            mf4: None,
        }
    }
}
