# Trace Indexing

Signal extraction currently scans `Asc.frames` and filters by the selected DBC
message ID. This keeps the ASC parser simple while the first UI is exercised
against real traces.

If signal extraction becomes a measured bottleneck, add a parse-time frame index
owned by `Asc`:

```zig
pub const FrameIndexEntry = struct {
    key: frame.FrameKey,
    frame_indices: []const u32,
};

pub const Asc = struct {
    frames: []const frame.Frame = &.{},
    by_id: []const FrameIndexEntry = &.{},
};
```

`by_id` groups frame indices by `frame.FrameKey`, with each `frame_indices` entry
pointing into `Asc.frames`. `selectedSignalValues` can then find the selected
message key and iterate only matching frames. `Asc.deinit` must free every
`frame_indices` slice and then the `by_id` slice.
