const EXTENDED_FLAG: u32 = 0x8000_0000;
const EXTENDED_MASK: u32 = 0x1FFF_FFFF;

const Endianness = enum { little_intel, big_motorola };
const Signedness = enum { unsigned, signed };
const ValueType = enum { integer, float32, float64 };

const Signal = struct {
    name: []const u8,
    start_bit: u16,
    bit_length: u16,
    endianness: Endianness,
    signedness: Signedness,
    factor: f64,
    offset: f64,
    minimum: ?f64,
    maximum: ?f64,
    unit: []const u8,
    receivers: [][]const u8,
    // choices: ?ValueTableRef,
    value_type: ValueType,
    // unsupported_mux: bool,
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

    fn decodeDbcId(self: *Message) void {
        if ((self.dbc_id & EXTENDED_FLAG) != 0) {
            self.can_id = self.dbc_id & EXTENDED_MASK;
            self.is_extended = true;
        } else {
            self.can_id = self.dbc_id;
            self.is_extended = false;
        }
    }
};

const Dbc = struct {
    messages: []Message,
    // value_tables: []ValueTable,
    // diagnostics: []Diagnostic,
};
