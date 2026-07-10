use std::collections::HashMap;

use super::{Frame, FrameKind};

#[derive(Debug, Default)]
pub(crate) struct FrameIndex {
    buckets: HashMap<(u32, bool), Bucket>,
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
        let mut buckets: HashMap<(u32, bool), Bucket> = HashMap::new();

        for (index, frame) in frames.iter().enumerate() {
            if frame.kind != FrameKind::Data {
                continue;
            }
            let Some(id) = frame.id else {
                continue;
            };
            let index = u32::try_from(index).expect("more frames than wasm memory can hold");
            buckets
                .entry((id.value, id.is_extended))
                .or_default()
                .push(frame, index);
        }

        Self { buckets }
    }

    pub(crate) fn lookup(
        &self,
        can_id: u32,
        is_extended: bool,
        message_size_bytes: u16,
    ) -> Lookup<'_> {
        let Some(bucket) = self.buckets.get(&(can_id, is_extended)) else {
            return Lookup {
                frame_indices: &[],
                all_frames_carry: true,
            };
        };

        Lookup {
            frame_indices: &bucket.frame_indices,
            all_frames_carry: bucket.all_frames_carry(message_size_bytes),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::trace::CanId;

    #[test]
    fn indexes_only_data_frames_by_full_can_identity() {
        let frames = [
            Frame {
                kind: FrameKind::Data,
                id: Some(CanId::standard(0x123).unwrap()),
                payload_len: 8,
                ..Frame::default()
            },
            Frame {
                kind: FrameKind::Remote,
                id: Some(CanId::standard(0x123).unwrap()),
                ..Frame::default()
            },
            Frame {
                kind: FrameKind::Data,
                id: Some(CanId::extended(0x123).unwrap()),
                payload_len: 8,
                ..Frame::default()
            },
            Frame {
                kind: FrameKind::Data,
                id: Some(CanId::standard(0x123).unwrap()),
                payload_len: 8,
                ..Frame::default()
            },
        ];

        let index = FrameIndex::build(&frames);
        let standard = index.lookup(0x123, false, 8);
        assert_eq!(standard.frame_indices, &[0, 3]);
        assert!(standard.all_frames_carry);
        assert_eq!(index.lookup(0x123, true, 8).frame_indices, &[2]);
        assert!(index.lookup(0x456, false, 8).frame_indices.is_empty());
    }
}
