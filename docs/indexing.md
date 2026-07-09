# Trace indexing

Signal extraction uses a lazy frame index owned by the Rust `Trace` wasm-bindgen class. Parsing ASC, TRC, or BLF records normalized frames and payloads without building secondary structures. The first signal decode builds a `HashMap<(u32, bool), Vec<u32>>` from CAN ID and extended-ID flag to data-frame indices; later decodes on the same trace reuse it.

The index contains data frames only. Each index entry points into the trace-owned frame vector, while payload bytes remain in the trace's compact side buffer. Signal extraction looks up the selected message identity and then applies payload-length and CAN/CAN FD checks before decoding values.

Dropping the generated `Trace` class releases the frames, payload bytes, and any initialized index together. The TypeScript adapter keeps that generated class behind an opaque handle and calls `free()` when the trace closes.
