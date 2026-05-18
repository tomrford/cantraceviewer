# J1939 Support Research

J1939 support in cantraceviewer should be treated as two layers:

1. PGN-aware DBC matching for single-frame J1939 payloads.
2. J1939 Transport Protocol reassembly and long-payload decode.

The first layer fits the current app shape. The second layer changes the trace
row and payload-length model because J1939 logical messages can exceed one CAN
frame.

## External Model

J1939 runs on 29-bit extended CAN identifiers. The identifier carries priority,
reserved/data-page bits, PDU format, PDU specific, and source address. The
18-bit PGN is derived from the middle identifier fields, but PDU1 and PDU2
frames differ: for PDU1 (`PF < 240`), the PDU specific byte is a destination
address and the PGN low byte is zero; for PDU2 (`PF >= 240`), the PDU specific
byte is a group extension and is part of the PGN. The Linux kernel J1939 docs
are the clearest public reference for this bit layout:
https://docs.kernel.org/networking/j1939.html.

DBC files encode 29-bit CAN IDs by setting the DBC extended-frame flag above
the raw 29-bit identifier. CSS Electronics documents the common J1939 DBC
metadata shape: `VFrameFormat` is an enum that can mark a message as `J1939PG`,
and `SPN` can be attached as a signal attribute. Their DBC intro also notes
that DBC message length can be 0-1785 bytes, which matters for J1939 transport
payloads: https://www.csselectronics.com/pages/can-dbc-file-database-intro.
Their decoder docs show `BusType = CAN` and `ProtocolType = J1939` as DBC-level
attributes:
https://canlogger.csselectronics.com/tools-docs/decoders_txt/decoders/dbc/attribute_bus_protocol_type_example.html.

PEAK TRC 2.1 explicitly includes J1939 in the `DT` data-frame record type, uses
8 hex digits for 29-bit CAN IDs, and permits data length / DLC values up to
1785 for J1939. The `R` column is reserved for J1939 and can carry the
destination address for a transport-protocol PDU2 large message. The public TRC
spec is here:
https://www.peak-system.com/produktcd/Pdf/English/PEAK_CAN_TRC_File_Format.pdf.

Vendor DBCs may be source-address-specific. Sea Land Tech's ANROT J1939
tutorial shows a DBC `BO_` ID with the extended flag set, a raw 29-bit ID whose
low byte is the source address, and an explicit note that changing the source
address changes the final byte of the CAN ID:
https://www.sealandtech.com.tw/en/resources/anrot/tutorial/j1939/.

## Current App Fit

Basic single-frame J1939 is close to working for all trace formats when the DBC
uses exact source-address-specific 29-bit IDs:

- `wasm/src/dbc/message.zig` strips the DBC extended-frame flag and stores both
  `dbc_id` and the raw 29-bit `can_id`.
- `wasm/src/trace/frame.zig` stores `Id.value` plus `is_extended`.
- ASC parsing treats `x`-suffixed IDs or IDs above `0x7ff` as extended.
- TRC parsing treats 8-digit IDs as extended.
- BLF parsing strips Vector's extended-frame bit and stores the low 29-bit ID.
- `wasm/src/series.zig` decodes selected signals by matching data frames on CAN
  ID, extended flag, and payload length.

That means an 8-byte J1939 frame such as EEC1 can already pass through the
shared `trace.Trace` shape if the DBC `BO_` resolves to the same full 29-bit
identifier seen in the trace.

Full J1939 support is not present because identity is still exact CAN-ID
matching, not PGN matching. The app also ignores DBC attributes such as
`ProtocolType`, `VFrameFormat`, and `SPN`, so it cannot tell whether an
extended DBC message should match by full CAN ID or by J1939 PGN. The UI catalog
does not expose PGNs, SPNs, source address, destination address, or J1939 match
mode.

Long J1939 payloads are outside the current data model. `message.Message`
stores `size_bytes` as `u8`; `trace.Frame.payload_len` is `u8`; TRC line
parsers use a 64-byte temporary payload buffer; TRC 2.x parsing rejects classic
`DT` payload lengths above 8; and selected-signal decode requires the frame
payload length to equal the DBC message size. That model handles CAN and CAN FD,
but not J1939 TP/ETP logical payloads up to 1785 bytes.

## DBC Work

Add a small DBC attribute layer rather than a general DBC interchange model.
The minimum useful parse set is:

- `BA_DEF_` / `BA_DEF_DEF_` / `BA_` for `ProtocolType`, `BusType`,
  `VFrameFormat`, `SPN`, and optionally `J1939PGDest` if encountered.
- `CM_ BO_` and `CM_ SG_` are useful for hover/details, but not required for
  plotting.
- Keep the existing `BO_`, `SG_`, `VAL_`, `VAL_TABLE_`, and `SIG_VALTYPE_`
  behavior intact.

Attribute enum values must be resolved through the file's own `BA_DEF_` order.
For example, `BA_ "VFrameFormat" BO_ ... 3;` only means `J1939PG` if that
file's `BA_DEF_` defines `"StandardCAN","ExtendedCAN","reserved","J1939PG"`.
Do not hard-code numeric enum values without reading the definition.

The parsed message model needs a protocol identity beside the existing raw CAN
identity:

```zig
const MessageIdentity = union(enum) {
    exact_can: struct {
        can_id: u32,
        is_extended: bool,
    },
    j1939_pgn: struct {
        pgn: u32,
        source_address: ?u8,
        destination_address: ?u8,
        priority: ?u8,
    },
};
```

`exact_can` remains the default for normal CAN and plain extended CAN. Use
`j1939_pgn` when the DBC declares `ProtocolType = J1939` or message
`VFrameFormat = J1939PG`. If both are absent, keep exact matching even for
29-bit IDs; plenty of proprietary extended-CAN DBCs are not J1939.

DBC files that use `J1939PG` often encode a placeholder source address in the
raw `BO_` ID. The matcher should allow a source-address policy rather than
assuming every J1939 DBC wants exact source address matching. A conservative
initial rule is:

- Match all source addresses by PGN for `J1939PG` messages.
- Preserve the DBC raw source address in metadata for display and future
  filtering.
- Add an optional strict-source-address mode only when the DBC contains an
  explicit source-specific attribute or the UI grows a source filter.

Signal metadata should carry `spn: ?u32`. The sidebar can keep displaying
`message.signal`, while details/legend rows can show `PGN 0xF004 / SPN 190`
when present.

## Trace Work

ASC, TRC, and BLF should continue to parse into one shared trace handle. J1939
should be a semantic layer over normalized frames, not three unrelated decode
paths.

For single-frame J1939:

- Keep each parser's existing 29-bit-ID normalization.
- Add a shared `j1939.zig` helper for `decodeId(can_id)` and `pgnFromId(can_id)`.
- Update `series.matchesMessage` to dispatch through `MessageIdentity`.
- Keep payload-length gating for 8-byte messages.
- Add one fixture each for ASC, TRC, and BLF using the same J1939 DBC and the
  same PGN with different source addresses.

For long J1939 payloads:

- Widen message and frame payload lengths from `u8` to at least `u16`.
- Replace parser-local `[64]u8` payload buffers with append-style payload
  builders.
- Decide whether `trace.Frame` represents physical CAN frames only, logical
  J1939 reassembled messages only, or both. The least disruptive option is to
  keep raw physical frames and add logical rows for reassembled J1939 messages
  with `kind = data` and `identity = j1939_pgn`.
- Implement TP.BAM / TP.RTS-CTS reassembly over ASC and BLF raw frame streams.
  The Linux docs describe TP and ETP payload size classes; the initial app
  likely only needs the 1785-byte TP range that common DBC/TRC tooling exposes.
- For TRC 2.1, accept logical J1939 `DT` rows with `l` or `L` up to 1785 and
  copy the payload directly rather than forcing CAN/CAN FD DLC semantics.
- Keep ETP out of the first implementation unless a real trace requires it.

TRC needs special care because its 2.1 format can already present a long J1939
payload as one logical line. ASC and BLF usually expose raw CAN frames, so long
J1939 support there requires reassembly from transport-protocol control and
data-transfer frames.

## Decode And Plot Semantics

Selected-signal decode can still return parallel `f64` arrays. The decode plan
already uses `usize` internally for required payload length, but the public
message size and trace row length types need widening first.

J1939 invalid/not-available values are a real plotting issue. Standard J1939
SPNs often use all-ones byte patterns such as `0xFF` to mean unavailable. The
current decoder treats every raw value as a physical value. A useful J1939
implementation should support dropping invalid samples or returning `NaN` so
the plot does not show flat maximum-value lines for unavailable signals.

Multiplexed and variable diagnostic messages remain separate work. The current
DBC catalog omits unsupported multiplexed signals. J1939 DM1/DM2 and other DTC
payloads are better handled by a protocol-specific diagnostic view than by
pretending they are ordinary scalar series.

## UI And Store Work

The DBC overlap guard in `src/lib/stores/dbc-files.svelte.ts` keys by exact CAN
ID and extended flag. J1939 changes that key. The store should key by the parsed
message identity:

- exact CAN: `can:extended:0x18fee900`
- J1939 PGN: `j1939:pgn:0xf004`
- J1939 PGN with strict source: `j1939:pgn:0xf004:sa:0x00`

This keeps normal overlap rejection while allowing source-agnostic J1939 DBCs
to behave like PGN databases.

The plot signal model in `src/lib/stores/plot-data.svelte.ts` should carry
`protocol`, `pgn`, `spn`, `sourceAddress`, and `destinationAddress` when
available. The first UI pass can keep the existing signal picker layout and add
metadata to details/legend affordances instead of adding a new protocol panel.

## Implementation Slices

1. Add shared J1939 ID helpers and tests.
2. Parse the small DBC attribute subset for `ProtocolType`, `VFrameFormat`, and
   `SPN`.
3. Add `MessageIdentity` to the DBC model and JSON catalog.
4. Update selected-signal matching and DBC overlap keys to use that identity.
5. Add single-frame J1939 fixtures across ASC, TRC, and BLF.
6. Add optional source-address filtering only if fixture/user traces need it.
7. Widen payload length types and TRC payload buffering.
8. Add TRC 2.1 logical J1939 long-message rows.
9. Add TP.BAM / TP.RTS-CTS reassembly over raw ASC and BLF frames.
10. Add invalid-value filtering/NaN behavior for J1939 SPNs.

The smallest useful product increment is slices 1-5. That enables standard
J1939 PGN DBCs for ordinary 8-byte frames across every trace format already in
the app. Slices 7-9 are the larger architectural step for "complete" J1939
payload support.
