Your phase order is the right one. A DBC viewer/editor is a much smaller and more controllable first product than “open arbitrary BLF/ASC and graph everything.” It also gives you the core model you will need later: messages, signals, frame matching, bit extraction, scaling, value descriptions, and diagnostics. I would write the first parser in Zig rather than bind a C/C++ library, but I would absolutely use the mature Python/C++ implementations as oracles.

The most important research finding is this: for DBC, there does not appear to be a public, official Vector grammar/specification that you can cleanly implement against. Vector’s own public CANdb++ material describes DBC as the CAN database/network file format used by Vector tools and calls the Vector DBC format a “de facto standard,” but the public material is product documentation, not a line-by-line grammar. CSS Electronics says the quiet part explicitly: DBC was developed by Vector, is proprietary, and “no official public documentation” is available, so most syntax information online is third-party or reverse-engineered.  ￼

So the sane implementation stance is: do not try to be “DBC-complete.” Build a strict, well-diagnosed subset that is compatible with common Vector-style DBCs, compare your behavior against cantools/canmatrix/dbcppp, and preserve or report unknown constructs. That is enough for a useful viewer/editor.

For your first useful version, the supported core should be: BO_ messages, non-multiplexed SG_ signals, basic signed/unsigned integer decoding, little/big endian bit extraction, scale/offset, min/max/unit metadata, VAL_ value descriptions, VAL_TABLE_ global value tables, and maybe SIG_VALTYPE_ for float/double if you want to be slightly nicer. I would also parse just enough attributes to detect extended IDs, CAN FD, and maybe J1939 later, but not enough to become an attribute engine.

A minimal parser target looks like this:

VERSION "..."
NS_ :
    ... ignored namespace keywords ...
BS_:
BU_: NodeA NodeB Vector__XXX
BO_ <message_id> <message_name>: <message_size_bytes> <sender>
SG_ <signal_name> : <start_bit>|<bit_length>@<byte_order><sign>
                   (<factor>,<offset>) [<min>|<max>] "<unit>" <receivers>
VAL_TABLE_ <table_name> <raw_value> "<label>" ... ;
VAL_ <message_id> <signal_name> <raw_value> "<label>" ... ;
SIG_VALTYPE_ <message_id> <signal_name> : <type> ;

The BO_ and SG_ grammar above is the real center. CSS Electronics and CANpy both document the same basic shape: BO_ defines a message, with decimal CAN ID, message name, byte length, and transmitter; SG_ defines a signal with start bit, length, byte order, signedness, scale, offset, min/max, unit, and receivers.  ￼

For the first version, make VERSION, NS_, BS_, and BU_ optional. Many useful DBCs contain them, but you do not need them for decoding. Parse BU_ if you want to show nodes/transmitters/receivers in the UI, but decoding does not depend on it.

The message model I would use in Zig is roughly:

const Dbc = struct {
    messages: []Message,
    value_tables: []ValueTable,
    diagnostics: []Diagnostic,
};
const Message = struct {
    dbc_id: u32,
    can_id: u32,
    is_extended: bool,
    is_fd: bool,
    name: []const u8,
    size_bytes: u8,
    transmitter: []const u8,
    signals: []Signal,
};
const Signal = struct {
    name: []const u8,
    start_bit: u16,
    bit_length: u16,
    endian: Endian,
    signedness: Signedness,
    factor: f64,
    offset: f64,
    minimum: ?f64,
    maximum: ?f64,
    unit: []const u8,
    receivers: [][]const u8,
    choices: ?ValueTableRef,
    value_type: ValueType,
    unsupported_mux: bool,
};
const Endian = enum { little_intel, big_motorola };
const Signedness = enum { unsigned, signed };
const ValueType = enum { integer, float32, float64 };

The message_id deserves special handling. Standard 11-bit IDs are normally stored directly as decimal integers. Extended 29-bit IDs are commonly represented in DBC by setting bit 31: dbc_id = can_id | 0x80000000, and the actual 29-bit CAN ID is recovered with dbc_id & 0x1fffffff. CSS gives exactly this rule for 29-bit IDs.  ￼

So for message import:

const EXTENDED_FLAG: u32 = 0x8000_0000;
const EXTENDED_MASK: u32 = 0x1fff_ffff;
fn normalizeDbcId(dbc_id: u32) struct { can_id: u32, is_extended: bool } {
    if ((dbc_id & EXTENDED_FLAG) != 0) {
        return .{ .can_id = dbc_id & EXTENDED_MASK, .is_extended = true };
    } else {
        return .{ .can_id = dbc_id, .is_extended = false };
    }
}

For matching traces later, do not match raw DBC ID against raw CAN ID. Normalize first, then match (can_id, is_extended). That single choice avoids a huge amount of confusion.

For CAN FD, the good news is that the DBC message and signal lines do not radically change for ordinary signal decoding. A CAN FD message is still a message with signals packed into bytes; it just permits payload lengths beyond 8 bytes, up to 64. The annoying part is metadata. canmatrix’s DBC writer uses attributes such as BusType = CAN FD and VFrameFormat enum values like StandardCAN_FD and ExtendedCAN_FD; CSS also shows VFrameFormat as the common frame-format attribute family.  ￼

My recommendation: support payload lengths 0..64 from day one, even if you do not fully label things as FD. Then add best-effort FD detection by parsing BA_DEF_, BA_DEF_DEF_, and BA_ only for BusType and VFrameFormat. That gives you a practical “FD nice path” without requiring full attribute support.

The signal parser is where most bugs happen. The common syntax is:

SG_ Name : start|length@endian+or- (factor,offset) [min|max] "unit" receivers

@1 means Intel/little-endian and @0 means Motorola/big-endian. + means unsigned and - means signed. Factor and offset are used for the physical value formula:

physical = raw * factor + offset

CSS documents the byte order, sign, scale, offset, and physical-value formula; Kvaser’s DBC documentation is especially useful for bit numbering because it explains the DBC “sawtooth” numbering convention and the key Intel/Motorola difference.  ￼

This part is important enough to be explicit. DBC bit numbering is not simple linear “bit 0, bit 1, bit 2” as humans often imagine it. Kvaser describes the DBC convention as sawtooth numbering: within each byte, bit numbers decrease visually from left to right, like 7 6 5 4 3 2 1 0, then 15 14 ... 8, and so on. For Intel/little-endian signals, the DBC start bit is the least significant bit of the signal. For Motorola/big-endian signals, the DBC start bit is the most significant bit of the signal.  ￼

For Zig, I would not start with clever mask math. Start with a correct bit-walking extractor and optimize later. Something like this is easier to validate:

fn getPayloadBit(data: []const u8, bit_index: u16) u1 {
    const byte_index = bit_index / 8;
    const bit_in_byte = bit_index % 8;
    return @intCast((data[byte_index] >> bit_in_byte) & 1);
}
fn nextMotorolaBit(bit_index: u16) u16 {
    // DBC Motorola sawtooth traversal.
    // If we are at bit 0 of a byte, the next less-significant signal bit
    // is bit 7 of the next byte, whose global index is current + 15.
    if ((bit_index % 8) == 0) return bit_index + 15;
    return bit_index - 1;
}
fn extractUnsigned(
    data: []const u8,
    start_bit: u16,
    bit_length: u16,
    endian: Endian,
) u64 {
    var raw: u64 = 0;
    switch (endian) {
        .little_intel => {
            var i: u16 = 0;
            while (i < bit_length) : (i += 1) {
                const b = getPayloadBit(data, start_bit + i);
                raw |= (@as(u64, b) << @intCast(i));
            }
        },
        .big_motorola => {
            var src = start_bit;
            var i: u16 = 0;
            while (i < bit_length) : (i += 1) {
                const b = getPayloadBit(data, src);
                const dst = bit_length - 1 - i; // first DBC bit is signal MSB
                raw |= (@as(u64, b) << @intCast(dst));
                src = nextMotorolaBit(src);
            }
        },
    }
    return raw;
}

Then signed conversion is independent:

fn signExtend(raw: u64, bit_length: u16) i64 {
    if (bit_length == 0) return 0;
    if (bit_length >= 64) return @bitCast(raw);
    const sign_bit: u64 = @as(u64, 1) << @intCast(bit_length - 1);
    const mask: u64 = (@as(u64, 1) << @intCast(bit_length)) - 1;
    const value = raw & mask;
    if ((value & sign_bit) == 0) return @intCast(value);
    const extended = value | ~mask;
    return @bitCast(extended);
}

I would build a test corpus around this before doing much UI. Big-endian/Motorola extraction is the place where a DBC viewer can look correct on simple files and be wrong on real OEM files.

For VAL_ and VAL_TABLE_, support both, but treat inline VAL_ as the primary source of choices. CANpy documents VAL_TABLE_ <ValueTableName> <IntValue> "<StringValue>" ... ; and VAL_ <CAN-ID> <SignalName> ... ;. The mireo parser documentation gives practical examples of VAL_TABLE_ and signal-level VAL_, and cantools exposes the user-facing behavior you probably want: decoded choices can be returned as strings when choice decoding is enabled.  ￼

For plotting, do not replace the numeric signal value with the choice string. Store both. Use the numeric value for the y-axis and use the choice label in tooltips, legends, and maybe a stepped “state” display. For example, if Gear = 3 and VAL_ says 3 "Drive", plot 3 but label it Drive.

There is one gotcha with VAL_TABLE_: support is inconsistent across tools. canmatrix’s issue tracker has an example showing ambiguity around using a global value table and then referring to it from VAL_; canmatrix historically parsed the table itself but did not necessarily associate a table-name reference with the signal in that example. So I would implement both inline value descriptions and table-name references, but be diagnostic-friendly: if a table exists but no signal references it, show it as an unassigned value table instead of silently discarding it.  ￼

A practical parser rule for values:

VAL_TABLE_ TableName 0 "Off" 1 "On" 2 "Error" ;
VAL_ 123 SignalName 0 "Off" 1 "On" 2 "Error" ;
VAL_ 123 SignalName TableName ;

Allow signed integer keys, not just unsigned. Allow escaped quotes inside labels. Do not try to interpret labels during import; store them exactly after unescaping.

SIG_VALTYPE_ is worth parsing but not worth obsessing over. mireo documents the value-type meanings as 0 = integer, 1 = 32-bit IEEE float, and 2 = 64-bit IEEE double. canmatrix also parses SIG_VALTYPE_ and marks the signal as float. The syntax varies slightly in examples and implementations; I would accept both with and without a colon before the type.  ￼

For floats, I would initially support only obvious cases: SIG_VALTYPE_ type 1 with length 32, and type 2 with length 64. Extract the raw bits, reinterpret as IEEE float/double, then apply factor/offset only if you choose to match your selected oracle. I would put this behind tests against cantools before claiming it is correct. Integer signals will cover the bulk of useful DBC viewer cases.

Multiplexing: parse enough to avoid lying. Do not decode multiplexed signals incorrectly. Basic multiplexing appears in SG_ lines via a multiplex marker; extended multiplexing uses SG_MUL_VAL_. CSS describes ordinary and extended multiplexing as advanced DBC features, and canmatrix/mireo both have explicit support for SG_MUL_VAL_.  ￼

For MVP behavior, I would do this: if an SG_ line contains M, m0, m1, etc. between the signal name and colon, parse the signal metadata but mark it unsupported_mux = true. In the UI, show the signal but do not include it in normal decode output unless the user explicitly enables “experimental multiplexing.” Ignore SG_MUL_VAL_ except for a diagnostic. This prevents the worst failure mode: graphing muxed signals as if they are always active.

Comments are another place to avoid getting trapped. CM_ comments can be useful for a viewer, but they are not necessary for decoding. They can also become annoying because multi-line quoted strings and escaping complicate a line-oriented parser. canmatrix has quite a bit of code just to handle follow-up comment lines. For your first version, skip comments semantically but preserve the raw lines if you want round-trip export later.  ￼

Encoding is worth deciding early. cantools defaults to cp1252 for DBC files. That is a strong hint because many DBCs come from Windows tooling and contain non-UTF-8 characters in units, comments, and labels. In a browser, I would decode the file bytes with TextDecoder("windows-1252") by default, with UTF-8/BOM detection if present, then pass UTF-8 text into WASM. For exact round-trip export, preserve the original bytes or raw record text for unknown sections.  ￼

For attributes, do not build a general system at first. But parse these if easy:

BA_DEF_ BO_ "VFrameFormat" ENUM ...
BA_ "VFrameFormat" BO_ <message_id> <enum_index>;
BA_DEF_ "BusType" STRING ;
BA_ "BusType" "CAN FD";
BA_ "GenMsgCycleTime" BO_ <message_id> <integer>;

VFrameFormat is useful for distinguishing standard CAN, extended CAN, CAN FD, and sometimes J1939-style messages. CSS shows VFrameFormat as a common way to mark StandardCAN, ExtendedCAN, and J1939PG, while canmatrix extends that enum for StandardCAN_FD and ExtendedCAN_FD.  ￼

J1939 is a later feature. If a DBC uses J1939 PGNs, exact 29-bit CAN ID matching is not always enough because parts of the 29-bit ID can vary by source/destination address. CSS notes that J1939 DBC decoding may use PGN masks for PDU1/PDU2 matching. I would not include J1939 in your first viewer, but I would detect VFrameFormat = J1939PG and show “J1939 matching not yet supported” rather than silently failing.  ￼

The best external implementations to use as references are cantools, canmatrix, dbcppp, and mireo/can-utils. cantools is probably the best behavioral oracle because it is widely used and exposes load/decode behavior clearly; its docs show strict validation, extended/FD flags, scaling, and choice decoding. canmatrix is valuable because its DBC importer/writer source is full of battle-tested regexes and edge-case handling for BO_, SG_, VAL_, VAL_TABLE_, SIG_VALTYPE_, and SG_MUL_VAL_.  ￼

For C/C++, dbcppp looks like the strongest “serious parser/decoder” candidate. It describes itself as a C++ DBC parser focused on decoding performance, has a C API, supports reading/editing/writing, and lists broad DBC support including value tables, messages, comments, attributes, value descriptions, extended value types, and multiplexing. It is MIT licensed, but it is C++/Boost-based, so pulling it into a Zig/WASM build may be more effort than writing your own MVP parser.  ￼

mireo/can-utils is interesting for a different reason: it is a lightweight callback-style C++ DBC parser. It avoids a full AST and calls callbacks for records such as VERSION, BU_, VAL_TABLE_, BO_, SG_, SIG_VALTYPE_, CM_, BA_, VAL_, and SG_MUL_VAL_. That design is close to what I would write in Zig: line-oriented, record-prefixed, and only materialize the subset you care about.  ￼

My recommendation is still: do not bind a C/C++ parser for the first Zig/WASM version. DBC parsing is text-heavy and not huge; the interop and build complexity will dominate. Write a clean Zig parser, then use cantools/canmatrix/dbcppp in tests to compare behavior. dbcppp or mireo are better as implementation references than as dependencies for this specific browser-first experiment.

For validation, set up a corpus-driven test loop immediately. Use tiny hand-written DBCs first, then real public/sample DBCs, then generated random DBCs. For each test, compare your decoded values against cantools. cantools supports strict database loading and message decoding with scaling and choices, which makes it very useful as an oracle.  ￼

Your first test matrix should include:

1. Standard 11-bit message ID
2. Extended 29-bit message ID using 0x80000000 DBC flag
3. Little-endian unsigned signal
4. Little-endian signed signal
5. Big-endian unsigned signal crossing byte boundaries
6. Big-endian signed signal crossing byte boundaries
7. factor/offset conversion
8. min/max metadata import
9. unit string import
10. inline VAL_ choices
11. VAL_TABLE_ choices
12. CP-1252 label/unit strings
13. payload length > 8 marked as FD-capable
14. multiplexed signal detected but not decoded

For the web architecture, DBC parsing itself does not need WASM for performance. JS can parse DBCs fast enough. The reason to use Zig/WASM is consistency with your later ASC/BLF parser and signal decoder, not raw speed on DBC import. Keep the boundary coarse: pass one file into WASM, get one parsed model plus diagnostics back. Do not call WASM once per line or once per signal from JS.

For the viewer/editor, I would return the parsed DBC model to JS as JSON at first. DBCs are not usually so huge that JSON is your bottleneck, and editor UI code wants strings and nested objects anyway. Later, for trace decoding, return typed arrays: timestamps, raw values, physical values, validity flags, and choice indices.

For export/editing, choose one of two modes early. The simplest is “normalized export”: regenerate only the subset you understand, and warn that unsupported constructs are dropped. The more user-friendly but harder mode is “preserving export”: keep unknown raw records attached to the file/message/signal context and rewrite only the records the user changed. For a first product, I would start with normalized export and a very visible unsupported-feature report. Once the viewer is trusted, add preserving export.

The concrete MVP I would build is:

Phase 1: Import and inspect
- Read DBC as cp1252/UTF-8 text
- Parse BO_, SG_, VAL_, VAL_TABLE_
- Normalize IDs
- Show messages and signals
- Show diagnostics for unsupported records
Phase 2: Decode single frame manually
- Let user paste CAN ID + payload
- Match message
- Decode non-mux integer signals
- Show raw, physical, unit, and VAL_ label
Phase 3: Editor
- Edit message name, ID, length
- Edit signal name/start/length/endian/sign/factor/offset/unit
- Edit value descriptions
- Export normalized DBC subset
Phase 4: FD niceties
- Allow message length up to 64
- Parse BusType/VFrameFormat enough to label CAN FD
- Add float/double SIG_VALTYPE_ if tests pass
Phase 5: Trace readiness
- Precompute decode plans per signal
- Add batch decode API returning typed arrays
- Then add ASC parser
- Then BLF

The one implementation detail I would be strict about from day one is diagnostics. Every ignored line should either be silently known-safe boilerplate (NS_, BS_, maybe BU_) or produce a structured warning like unsupported_multiplexing, unsupported_j1939, unsupported_attribute, unsupported_signal_type, or parse_recovery. That turns “half complete parser” into “honest subset parser,” which is a much better foundation for an engineering tool.

So the short practical answer is: rely on Vector only for “DBC is the de facto Vector CAN database format,” rely on CSS/CANpy/Kvaser for human-readable syntax and bit numbering guidance, rely on cantools/canmatrix/dbcppp/mireo as executable references, and keep your Zig MVP intentionally small. The valuable first product is not “complete DBC editor”; it is “fast, local, honest DBC viewer/editor that decodes the common 80% correctly and tells you exactly what it skipped.”
