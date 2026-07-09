use std::collections::HashMap;

use super::{Frame, FrameKind};

#[derive(Debug, Default)]
pub(crate) struct FrameIndex {
    buckets: HashMap<(u32, bool), Vec<u32>>,
}

impl FrameIndex {
    pub(crate) fn build(frames: &[Frame]) -> Self {
        let mut buckets: HashMap<(u32, bool), Vec<u32>> = HashMap::new();

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
                .push(index);
        }

        Self { buckets }
    }

    pub(crate) fn lookup(&self, can_id: u32, is_extended: bool) -> &[u32] {
        self.buckets
            .get(&(can_id, is_extended))
            .map_or(&[], Vec::as_slice)
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
                ..Frame::default()
            },
            Frame {
                kind: FrameKind::Data,
                id: Some(CanId::standard(0x123).unwrap()),
                ..Frame::default()
            },
        ];

        let index = FrameIndex::build(&frames);
        assert_eq!(index.lookup(0x123, false), &[0, 3]);
        assert_eq!(index.lookup(0x123, true), &[2]);
        assert!(index.lookup(0x456, false).is_empty());
    }
}
