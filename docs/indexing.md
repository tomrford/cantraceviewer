# Trace Indexing

Signal extraction currently scans the parsed frame list for the loaded trace and
filters by the selected DBC message ID, extended-ID flag, and payload length.
This keeps the ASC, TRC, BLF, and MF4 parsers simple while the UI is exercised
against real traces.

If signal extraction becomes a measured bottleneck, add a parse-time frame index
owned by the shared trace model:

```zig
pub const FrameIndexEntry = struct {
    key: frame.FrameKey,
    frame_indices: []const u32,
};

pub const Trace = struct {
    frames: []const frame.Frame = &.{},
    by_id: []const FrameIndexEntry = &.{},
};
```

`by_id` groups frame indices by `frame.FrameKey`, with each `frame_indices` entry
pointing into the parser-owned `frames` slice. `selectedSignalValues` can then
find the selected message key and iterate only matching frames. Each trace handle
must free every `frame_indices` slice and then the `by_id` slice.
