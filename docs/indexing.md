# Trace indexing

Signal extraction uses a lazy frame index owned by the Rust `Trace` wasm-bindgen class. ASC, TRC and BLF parsing records normalized frames and payloads without building secondary structures. The first signal decode groups data-frame indices by CAN ID and extended-ID flag. Later decodes on the same trace reuse those buckets.

Each bucket also records whether every frame has the same payload length and CAN or CAN FD shape. A compatible uniform bucket can skip the per-frame compatibility and sample-count passes. Mixed buckets retain the payload-length and CAN/CAN FD checks. Payload bytes remain in the trace's compact side buffer.

Dropping the generated `Trace` class releases the frames, payload bytes, and any initialized index together. The TypeScript adapter keeps that generated class behind an opaque handle and calls `free()` when the trace closes.
