use std::collections::HashMap;
use std::fmt::Write;

use super::{Frame, FrameKind, RawSource};

#[derive(Debug, Default)]
pub(crate) struct FrameIndex {
    buckets: HashMap<u64, Bucket>,
    sources: HashMap<(u32, bool), Vec<RawSource>>,
}

#[derive(Debug, Default)]
struct Bucket {
    frame_indices: Vec<u32>,
    payload_len: u8,
    is_fd: bool,
    is_uniform: bool,
}

impl Bucket {
    fn push(&mut self, frame: &Frame, frame_index: u32) {
        // Every parser caps classic frames at 8 payload bytes; the uniform-bucket
        // fast path in series.rs needs this to agree with frame_can_carry_message.
        debug_assert!(frame.is_fd || frame.payload_len <= 8);
        if self.frame_indices.is_empty() {
            self.payload_len = frame.payload_len;
            self.is_fd = frame.is_fd;
            self.is_uniform = true;
        } else if self.payload_len != frame.payload_len || self.is_fd != frame.is_fd {
            self.is_uniform = false;
        }
        self.frame_indices.push(frame_index);
    }

    fn all_frames_carry(&self, message_size_bytes: u16) -> bool {
        self.is_uniform
            && if self.is_fd {
                u16::from(self.payload_len) == message_size_bytes
            } else {
                u16::from(self.payload_len) >= message_size_bytes
            }
    }
}

pub(crate) struct Lookup<'a> {
    pub(crate) frame_indices: &'a [u32],
    pub(crate) all_frames_carry: bool,
}

impl FrameIndex {
    pub(crate) fn build(frames: &[Frame]) -> Self {
        let mut buckets: HashMap<u64, Bucket> = HashMap::new();
        let mut sources: HashMap<(u32, bool), Vec<RawSource>> = HashMap::new();

        let mut end = 0;
        for run in frames.chunk_by(|a, b| a.kind == b.kind && a.id == b.id && a.source == b.source)
        {
            let start = end;
            end += run.len();
            let frame = &run[0];
            if frame.kind != FrameKind::Data {
                continue;
            }
            let Some(id) = frame.id else {
                continue;
            };
            let bucket = buckets
                .entry(key(id.value(), id.is_extended(), frame.source))
                .or_insert_with(|| {
                    sources
                        .entry((id.value(), id.is_extended()))
                        .or_default()
                        .push(frame.source);
                    Bucket::default()
                });
            for (offset, frame) in run.iter().enumerate() {
                bucket.push(
                    frame,
                    u32::try_from(start + offset).expect("more frames than wasm memory can hold"),
                );
            }
        }

        // Order each CAN source once, when the index is built. The frame
        // index breaks timestamp ties without discarding or swapping equal-time frames.
        for bucket in buckets.values_mut() {
            if !bucket
                .frame_indices
                .is_sorted_by_key(|&index| frames[index as usize].timestamp_ns)
            {
                bucket
                    .frame_indices
                    .sort_unstable_by_key(|&index| (frames[index as usize].timestamp_ns, index));
            }
        }

        Self { buckets, sources }
    }

    pub(crate) fn lookup(
        &self,
        can_id: u32,
        is_extended: bool,
        message_size_bytes: u16,
        source: Option<RawSource>,
    ) -> Result<Lookup<'_>, &'static str> {
        let empty = || Lookup {
            frame_indices: &[],
            all_frames_carry: true,
        };
        let Some(sources) = self.sources.get(&(can_id, is_extended)) else {
            return Ok(empty());
        };
        let source = match source {
            Some(source) => source,
            None if sources.len() > 1 => {
                return Err(
                    "Multiple raw sources match this message; select a channel and direction",
                );
            }
            None => sources[0],
        };
        let Some(bucket) = self.buckets.get(&key(can_id, is_extended, source)) else {
            return Ok(empty());
        };

        Ok(Lookup {
            frame_indices: &bucket.frame_indices,
            all_frames_carry: bucket.all_frames_carry(message_size_bytes),
        })
    }

    pub(crate) fn catalog_json(&self) -> String {
        let mut entries: Vec<_> = self
            .sources
            .iter()
            .flat_map(|(&(id, extended), sources)| {
                sources.iter().map(move |&source| (id, extended, source))
            })
            .collect();
        entries.sort_unstable();
        let mut output = String::from("[");
        for (index, (id, extended, source)) in entries.into_iter().enumerate() {
            if index != 0 {
                output.push(',');
            }
            write!(
                output,
                "{{\"canId\":{id},\"isExtended\":{extended},\"source\":{{\"channel\":"
            )
            .unwrap();
            match source.channel {
                Some(channel) => write!(output, "{channel}").unwrap(),
                None => output.push_str("null"),
            }
            write!(output, ",\"direction\":\"{}\"}}}}", source.direction.name()).unwrap();
        }
        output.push(']');
        output
    }
}

fn key(id: u32, extended: bool, source: RawSource) -> u64 {
    // CAN ID: bits 0–28; extended: 29; channel: 30–45; direction: 46–47.
    u64::from(id)
        | (u64::from(extended) << 29)
        | (u64::from(source.channel.map_or(0, |channel| channel.get())) << 30)
        | ((source.direction as u64) << 46)
}
