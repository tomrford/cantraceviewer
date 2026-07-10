use std::rc::Rc;

use super::quotes::parse_quoted;
use super::{
    DbcError, ValueDescription, ValueType, find_dbc_whitespace, is_dbc_whitespace, trim_dbc,
};

/// DBC bit-numbering mode for a signal payload.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DbcEndian {
    Intel,
    Motorola,
}

impl DbcEndian {
    pub(crate) const fn as_catalog_str(self) -> &'static str {
        match self {
            Self::Intel => "intel",
            Self::Motorola => "motorola",
        }
    }
}

/// Signedness of an integer DBC signal.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Signedness {
    Signed,
    Unsigned,
}

impl Signedness {
    pub(crate) const fn as_catalog_str(self) -> &'static str {
        match self {
            Self::Signed => "signed",
            Self::Unsigned => "unsigned",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PackedEndian {
    Little,
    Big,
}

/// Prepared raw-payload decoder for repeatedly decoding the same signal.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DecodePlan {
    bit_offset: usize,
    bit_count: usize,
    endian: PackedEndian,
    signedness: Signedness,
    value_type: ValueType,
    required_payload_len: usize,
    factor: f64,
    offset: f64,
}

impl DecodePlan {
    /// Decodes one raw CAN payload into the signal's physical value.
    #[inline(always)]
    pub fn decode(self, payload: &[u8]) -> Result<f64, DbcError> {
        if payload.len() != self.required_payload_len {
            return Err(DbcError::InvalidPayloadLength {
                expected: self.required_payload_len,
                actual: payload.len(),
            });
        }

        let bits = read_packed_bits(payload, self.bit_offset, self.bit_count, self.endian);
        let raw = match self.value_type {
            ValueType::Integer => match self.signedness {
                Signedness::Signed => sign_extend(bits, self.bit_count) as f64,
                Signedness::Unsigned => bits as f64,
            },
            ValueType::Float32 => f32::from_bits(bits as u32) as f64,
            ValueType::Float64 => f64::from_bits(bits),
        };

        Ok(raw * self.factor + self.offset)
    }
}

/// Parsed `SG_` signal definition.
#[derive(Clone, Debug, PartialEq)]
pub struct Signal {
    pub name: String,

    /// Start bit in DBC numbering.
    pub start_bit: u16,

    pub bit_length: u16,
    pub endianness: DbcEndian,
    pub signedness: Signedness,
    pub factor: f64,
    pub offset: f64,
    pub minimum: Option<f64>,
    pub maximum: Option<f64>,
    pub unit: String,
    pub receivers: Vec<String>,
    pub value_descriptions: Option<Rc<[ValueDescription]>>,
    pub value_type: ValueType,

    /// True when the signal uses multiplexing that the viewer cannot decode.
    pub unsupported_mux: bool,
}

impl Signal {
    /// Parses one `SG_` signal line.
    pub fn parse(line: &str) -> Result<Self, DbcError> {
        let cursor = trim_dbc(line);
        let Some(rest) = cursor.strip_prefix("SG_") else {
            return Err(DbcError::InvalidSignalLine);
        };
        if !rest
            .as_bytes()
            .first()
            .copied()
            .is_some_and(is_dbc_whitespace)
        {
            return Err(DbcError::InvalidSignalLine);
        }
        let mut cursor = trim_dbc(rest);

        let Some(name_end) = find_dbc_whitespace(cursor) else {
            return Err(DbcError::InvalidSignalLine);
        };
        let name = cursor[..name_end].to_owned();
        cursor = trim_dbc(&cursor[name_end..]);

        let mut unsupported_mux = false;
        if !cursor.starts_with(':') {
            let Some(marker_end) = find_dbc_whitespace(cursor) else {
                return Err(DbcError::InvalidSignalLine);
            };
            unsupported_mux = true;
            cursor = trim_dbc(&cursor[marker_end..]);
        }
        let Some(rest) = cursor.strip_prefix(':') else {
            return Err(DbcError::InvalidSignalLine);
        };
        cursor = trim_dbc(rest);

        let Some(start_separator) = cursor.find('|') else {
            return Err(DbcError::InvalidSignalLine);
        };
        let start_bit_text = &cursor[..start_separator];
        let start_bit = start_bit_text.parse().map_err(|error| {
            DbcError::invalid_integer("signal start bit", start_bit_text, error)
        })?;
        cursor = &cursor[start_separator + 1..];

        let Some(length_separator) = cursor.find('@') else {
            return Err(DbcError::InvalidSignalLine);
        };
        let bit_length_text = &cursor[..length_separator];
        let bit_length = bit_length_text.parse().map_err(|error| {
            DbcError::invalid_integer("signal bit length", bit_length_text, error)
        })?;
        cursor = &cursor[length_separator + 1..];
        if cursor.len() < 2 {
            return Err(DbcError::InvalidSignalLine);
        }

        let endianness = match cursor.as_bytes()[0] {
            b'1' => DbcEndian::Intel,
            b'0' => DbcEndian::Motorola,
            _ => return Err(DbcError::InvalidSignalLine),
        };
        let signedness = match cursor.as_bytes()[1] {
            b'+' => Signedness::Unsigned,
            b'-' => Signedness::Signed,
            _ => return Err(DbcError::InvalidSignalLine),
        };
        cursor = trim_dbc(&cursor[2..]);

        let Some(rest) = cursor.strip_prefix('(') else {
            return Err(DbcError::InvalidSignalLine);
        };
        cursor = rest;
        let Some(factor_separator) = cursor.find(',') else {
            return Err(DbcError::InvalidSignalLine);
        };
        let factor = parse_finite_float("signal factor", &cursor[..factor_separator])?;
        cursor = &cursor[factor_separator + 1..];
        let Some(offset_separator) = cursor.find(')') else {
            return Err(DbcError::InvalidSignalLine);
        };
        let offset = parse_finite_float("signal offset", &cursor[..offset_separator])?;
        cursor = trim_dbc(&cursor[offset_separator + 1..]);

        let Some(rest) = cursor.strip_prefix('[') else {
            return Err(DbcError::InvalidSignalLine);
        };
        cursor = rest;
        let Some(minimum_separator) = cursor.find('|') else {
            return Err(DbcError::InvalidSignalLine);
        };
        let minimum = parse_finite_float("signal minimum", &cursor[..minimum_separator])?;
        cursor = &cursor[minimum_separator + 1..];
        let Some(maximum_separator) = cursor.find(']') else {
            return Err(DbcError::InvalidSignalLine);
        };
        let maximum = parse_finite_float("signal maximum", &cursor[..maximum_separator])?;
        cursor = trim_dbc(&cursor[maximum_separator + 1..]);

        let (unit, rest) = parse_quoted(cursor).map_err(|error| match error {
            DbcError::InvalidQuotedString => DbcError::InvalidSignalLine,
            other => other,
        })?;
        cursor = trim_dbc(rest);

        let receivers = if cursor.is_empty() {
            Vec::new()
        } else {
            cursor
                .split(',')
                .filter(|receiver| !receiver.is_empty())
                .map(|receiver| trim_dbc(receiver).to_owned())
                .collect()
        };

        Ok(Self {
            name,
            start_bit,
            bit_length,
            endianness,
            signedness,
            factor,
            offset,
            minimum: Some(minimum),
            maximum: Some(maximum),
            unit,
            receivers,
            value_descriptions: None,
            value_type: ValueType::Integer,
            unsupported_mux,
        })
    }

    /// Prepares fixed bit-unpack arguments for repeated payload decoding.
    ///
    /// Motorola signals are planned against `message_size_bytes`; callers must
    /// pass payload slices of that exact length to [`DecodePlan::decode`].
    pub fn plan_decode(&self, message_size_bytes: u16) -> Result<DecodePlan, DbcError> {
        if message_size_bytes > 64 {
            return Err(DbcError::UnsupportedMessageLength(message_size_bytes));
        }
        if self.unsupported_mux {
            return Err(DbcError::UnsupportedMultiplexing);
        }
        match self.value_type {
            ValueType::Integer if self.bit_length == 0 || self.bit_length > 64 => {
                return Err(DbcError::InvalidSignalBitLength(self.bit_length));
            }
            ValueType::Float32 if self.bit_length != 32 => {
                return Err(DbcError::InvalidSignalBitLength(self.bit_length));
            }
            ValueType::Float64 if self.bit_length != 64 => {
                return Err(DbcError::InvalidSignalBitLength(self.bit_length));
            }
            _ => {}
        }

        let message_bits = usize::from(message_size_bytes) * 8;
        let bit_count = usize::from(self.bit_length);
        let (bit_offset, endian) = match self.endianness {
            DbcEndian::Intel => (usize::from(self.start_bit), PackedEndian::Little),
            DbcEndian::Motorola => {
                let byte = usize::from(self.start_bit / 8);
                let bit = usize::from(self.start_bit % 8);
                let most_significant_bit_offset = byte * 8 + (7 - bit);
                if most_significant_bit_offset + bit_count > message_bits {
                    return Err(DbcError::SignalOutsideMessage);
                }
                (
                    message_bits - most_significant_bit_offset - bit_count,
                    PackedEndian::Big,
                )
            }
        };
        if bit_offset + bit_count > message_bits {
            return Err(DbcError::SignalOutsideMessage);
        }

        Ok(DecodePlan {
            bit_offset,
            bit_count,
            endian,
            signedness: self.signedness,
            value_type: self.value_type,
            required_payload_len: usize::from(message_size_bytes),
            factor: self.factor,
            offset: self.offset,
        })
    }

    /// Returns attached `VAL_` or `VAL_TABLE_` descriptions, if any.
    pub fn value_descriptions(&self) -> Option<&[ValueDescription]> {
        self.value_descriptions.as_deref()
    }
}

fn parse_finite_float(field: &'static str, text: &str) -> Result<f64, DbcError> {
    let value = text
        .parse()
        .map_err(|error| DbcError::invalid_float(field, text, error))?;
    if !f64::is_finite(value) {
        return Err(DbcError::NonFiniteSignalNumber {
            field,
            value: text.to_owned(),
        });
    }
    Ok(value)
}

#[inline(always)]
fn read_packed_bits(
    payload: &[u8],
    bit_offset: usize,
    bit_count: usize,
    endian: PackedEndian,
) -> u64 {
    if bit_offset.is_multiple_of(8) {
        let byte_offset = bit_offset / 8;
        return match (endian, bit_count) {
            (PackedEndian::Little, 8) => u64::from(payload[byte_offset]),
            (PackedEndian::Little, 16) => u64::from(u16::from_le_bytes(
                payload[byte_offset..byte_offset + 2].try_into().unwrap(),
            )),
            (PackedEndian::Little, 32) => u64::from(u32::from_le_bytes(
                payload[byte_offset..byte_offset + 4].try_into().unwrap(),
            )),
            (PackedEndian::Little, 64) => {
                u64::from_le_bytes(payload[byte_offset..byte_offset + 8].try_into().unwrap())
            }
            (PackedEndian::Big, 8) => u64::from(payload[payload.len() - 1 - byte_offset]),
            (PackedEndian::Big, 16) => {
                let end = payload.len() - byte_offset;
                u64::from(u16::from_be_bytes(
                    payload[end - 2..end].try_into().unwrap(),
                ))
            }
            (PackedEndian::Big, 32) => {
                let end = payload.len() - byte_offset;
                u64::from(u32::from_be_bytes(
                    payload[end - 4..end].try_into().unwrap(),
                ))
            }
            (PackedEndian::Big, 64) => {
                let end = payload.len() - byte_offset;
                u64::from_be_bytes(payload[end - 8..end].try_into().unwrap())
            }
            _ => read_unaligned_packed_bits(payload, bit_offset, bit_count, endian),
        };
    }

    read_unaligned_packed_bits(payload, bit_offset, bit_count, endian)
}

#[inline]
fn read_unaligned_packed_bits(
    payload: &[u8],
    bit_offset: usize,
    bit_count: usize,
    endian: PackedEndian,
) -> u64 {
    let first_byte_offset = bit_offset / 8;
    let shift = bit_offset % 8;
    let byte_count = (shift + bit_count).div_ceil(8);
    let byte_at = |index: usize| match endian {
        PackedEndian::Little => payload[first_byte_offset + index],
        PackedEndian::Big => payload[payload.len() - 1 - first_byte_offset - index],
    };

    let mut packed = 0_u64;
    for index in 0..byte_count.min(8) {
        packed |= u64::from(byte_at(index)) << (index * 8);
    }

    let mut value = packed >> shift;
    if byte_count == 9 {
        value |= u64::from(byte_at(8)) << (64 - shift);
    }
    if bit_count < 64 {
        value &= (1_u64 << bit_count) - 1;
    }
    value
}

fn sign_extend(value: u64, bit_count: usize) -> i64 {
    if bit_count == 64 {
        return value as i64;
    }
    let sign_bit = 1_u64 << (bit_count - 1);
    if value & sign_bit == 0 {
        value as i64
    } else {
        (value | (!0_u64 << bit_count)) as i64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_signal_line() {
        let signal =
            Signal::parse(" SG_ vehicle_speed : 0|16@1+ (0.1,0) [0|250] \"km/h\" Dashboard")
                .unwrap();

        assert_eq!(signal.name, "vehicle_speed");
        assert_eq!(signal.start_bit, 0);
        assert_eq!(signal.bit_length, 16);
        assert_eq!(signal.endianness, DbcEndian::Intel);
        assert_eq!(signal.signedness, Signedness::Unsigned);
        assert_eq!(signal.factor, 0.1);
        assert_eq!(signal.offset, 0.0);
        assert_eq!(signal.minimum, Some(0.0));
        assert_eq!(signal.maximum, Some(250.0));
        assert_eq!(signal.unit, "km/h");
        assert_eq!(signal.receivers, ["Dashboard"]);
        assert!(!signal.unsupported_mux);
    }

    #[test]
    fn parses_negative_offset() {
        let signal =
            Signal::parse(" SG_ coolant_temp : 40|8@1+ (1,-40) [-40|215] \"degC\" Dashboard")
                .unwrap();

        assert_eq!(signal.name, "coolant_temp");
        assert_eq!(signal.start_bit, 40);
        assert_eq!(signal.bit_length, 8);
        assert_eq!(signal.offset, -40.0);
        assert_eq!(signal.minimum, Some(-40.0));
        assert_eq!(signal.maximum, Some(215.0));
        assert_eq!(signal.unit, "degC");
    }

    #[test]
    fn marks_multiplexed_signal_as_unsupported() {
        let signal =
            Signal::parse(" SG_ muxed_D_1 m1 : 48|8@1- (1,0) [0|0] \"\" Vector__XXX").unwrap();

        assert_eq!(signal.name, "muxed_D_1");
        assert_eq!(signal.signedness, Signedness::Signed);
        assert!(signal.unsupported_mux);
    }

    #[test]
    fn rejects_line_without_signal_prefix() {
        assert!(matches!(
            Signal::parse("BO_ 288 PowertrainStatus: 8 Agent"),
            Err(DbcError::InvalidSignalLine)
        ));
    }

    #[test]
    fn rejects_invalid_endian_marker() {
        assert!(matches!(
            Signal::parse(" SG_ vehicle_speed : 0|16@2+ (0.1,0) [0|250] \"km/h\" Dashboard"),
            Err(DbcError::InvalidSignalLine)
        ));
    }

    #[test]
    fn rejects_missing_unit_quotes() {
        assert!(matches!(
            Signal::parse(" SG_ vehicle_speed : 0|16@1+ (0.1,0) [0|250] km/h Dashboard"),
            Err(DbcError::InvalidSignalLine)
        ));
    }

    #[test]
    fn rejects_non_numeric_factor_with_context() {
        assert!(matches!(
            Signal::parse(" SG_ vehicle_speed : 0|16@1+ (fast,0) [0|250] \"km/h\" Dashboard"),
            Err(DbcError::InvalidFloat {
                field: "signal factor",
                ..
            })
        ));
    }

    #[test]
    fn rejects_non_finite_signal_numbers() {
        assert!(matches!(
            Signal::parse(" SG_ vehicle_speed : 0|16@1+ (nan,0) [0|250] \"km/h\" Dashboard"),
            Err(DbcError::NonFiniteSignalNumber { .. })
        ));
        assert!(matches!(
            Signal::parse(" SG_ vehicle_speed : 0|16@1+ (1,0) [0|1e9999] \"km/h\" Dashboard"),
            Err(DbcError::NonFiniteSignalNumber { .. })
        ));
    }

    #[test]
    fn parses_escaped_unit() {
        let signal =
            Signal::parse(" SG_ status : 0|8@1+ (1,0) [0|1] \"State \\\"On\\\"\" Dashboard")
                .unwrap();

        assert_eq!(signal.unit, "State \"On\"");
        assert_eq!(signal.receivers, ["Dashboard"]);
    }

    #[test]
    fn parses_tab_separated_signal_line() {
        let signal = Signal::parse(
            "\tSG_\tvehicle_speed\t:\t0|16@1+\t(0.1,0)\t[0|250]\t\"km/h\"\tDashboard",
        )
        .unwrap();

        assert_eq!(signal.name, "vehicle_speed");
        assert_eq!(signal.bit_length, 16);
        assert_eq!(signal.unit, "km/h");
        assert_eq!(signal.receivers, ["Dashboard"]);
    }

    #[test]
    fn decodes_little_endian_integer_with_scale() {
        let signal = Signal::parse(" SG_ Speed : 0|16@1+ (0.1,0) [0|250] \"km/h\" DASH").unwrap();
        let plan = signal.plan_decode(2).unwrap();

        assert_eq!(plan.decode(&[0x10, 0x27]).unwrap(), 1000.0);
    }

    #[test]
    fn decodes_signed_integer() {
        let signal = Signal::parse(" SG_ Temp : 0|8@1- (1,-40) [-168|87] \"C\" DASH").unwrap();
        let plan = signal.plan_decode(1).unwrap();

        assert_eq!(plan.decode(&[0xff]).unwrap(), -41.0);
    }

    #[test]
    fn decodes_unaligned_little_endian_integer() {
        let signal = Signal::parse(" SG_ Value : 4|12@1+ (1,0) [0|4095] \"\" DASH").unwrap();
        let plan = signal.plan_decode(2).unwrap();

        assert_eq!(plan.decode(&[0xf0, 0xab]).unwrap(), 0x0abf as f64);
    }

    #[test]
    fn decodes_unaligned_motorola_integer() {
        let signal = Signal::parse(" SG_ Value : 3|8@0+ (1,0) [0|255] \"\" DASH").unwrap();
        let plan = signal.plan_decode(2).unwrap();

        assert_eq!(plan.decode(&[0xda, 0xbc]).unwrap(), 0xab as f64);
    }

    #[test]
    fn decodes_unaligned_64_bit_integer_across_nine_bytes() {
        let signal = Signal::parse(" SG_ Value : 4|64@1+ (1,0) [0|0] \"\" DASH").unwrap();
        let plan = signal.plan_decode(9).unwrap();

        assert_eq!(
            plan.decode(&[0xf0, 0xde, 0xbc, 0x9a, 0x78, 0x56, 0x34, 0x12, 0x0f])
                .unwrap(),
            0xf123_4567_89ab_cdef_u64 as f64
        );
    }

    #[test]
    fn decodes_float32_signal() {
        let mut signal =
            Signal::parse(" SG_ temperature : 0|32@1+ (1,0) [-100|100] \"degC\" Dashboard")
                .unwrap();
        signal.value_type = ValueType::Float32;

        let plan = signal.plan_decode(4).unwrap();
        assert_eq!(plan.decode(&[0x00, 0x00, 0xc0, 0x3f]).unwrap(), 1.5);
    }

    #[test]
    fn decodes_motorola_float32_signal() {
        let mut signal =
            Signal::parse(" SG_ temperature : 7|32@0+ (1,0) [-100|100] \"degC\" Dashboard")
                .unwrap();
        signal.value_type = ValueType::Float32;

        let plan = signal.plan_decode(4).unwrap();
        assert_eq!(plan.decode(&[0x3f, 0xc0, 0x00, 0x00]).unwrap(), 1.5);
    }

    #[test]
    fn decodes_float64_signal() {
        let mut signal =
            Signal::parse(" SG_ temperature : 0|64@1+ (1,0) [-100|100] \"degC\" Dashboard")
                .unwrap();
        signal.value_type = ValueType::Float64;

        let plan = signal.plan_decode(8).unwrap();
        assert_eq!(
            plan.decode(&[0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf8, 0x3f])
                .unwrap(),
            1.5
        );
    }

    #[test]
    fn decodes_motorola_float64_signal() {
        let mut signal =
            Signal::parse(" SG_ temperature : 7|64@0+ (1,0) [-100|100] \"degC\" Dashboard")
                .unwrap();
        signal.value_type = ValueType::Float64;

        let plan = signal.plan_decode(8).unwrap();
        assert_eq!(
            plan.decode(&[0x3f, 0xf8, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
                .unwrap(),
            1.5
        );
    }

    #[test]
    fn applies_scale_and_offset_to_float() {
        let mut signal =
            Signal::parse(" SG_ temperature : 0|32@1+ (2,1) [-100|100] \"degC\" Dashboard")
                .unwrap();
        signal.value_type = ValueType::Float32;

        let plan = signal.plan_decode(4).unwrap();
        assert_eq!(plan.decode(&[0x00, 0x00, 0xc0, 0x3f]).unwrap(), 4.0);
    }

    #[test]
    fn rejects_float_signals_with_wrong_bit_length() {
        let mut float32_signal =
            Signal::parse(" SG_ temperature : 0|16@1+ (1,0) [-100|100] \"degC\" Dashboard")
                .unwrap();
        float32_signal.value_type = ValueType::Float32;

        let mut float64_signal =
            Signal::parse(" SG_ precise_temperature : 0|32@1+ (1,0) [-100|100] \"degC\" Dashboard")
                .unwrap();
        float64_signal.value_type = ValueType::Float64;

        assert!(matches!(
            float32_signal.plan_decode(2),
            Err(DbcError::InvalidSignalBitLength(16))
        ));
        assert!(matches!(
            float64_signal.plan_decode(4),
            Err(DbcError::InvalidSignalBitLength(32))
        ));
    }

    #[test]
    fn rejects_decode_plans_above_trace_payload_limit() {
        let signal =
            Signal::parse(" SG_ trouble_code : 0|16@1+ (1,0) [0|65535] \"\" Tester").unwrap();

        assert!(matches!(
            signal.plan_decode(1785),
            Err(DbcError::UnsupportedMessageLength(1785))
        ));
    }

    #[test]
    fn rejects_payload_with_wrong_length() {
        let signal = Signal::parse(" SG_ Value : 0|8@1+ (1,0) [0|255] \"\" DASH").unwrap();
        let plan = signal.plan_decode(1).unwrap();

        assert!(matches!(
            plan.decode(&[]),
            Err(DbcError::InvalidPayloadLength {
                expected: 1,
                actual: 0
            })
        ));
    }
}
