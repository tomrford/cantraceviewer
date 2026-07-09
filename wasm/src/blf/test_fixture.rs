const MIN_FILE_HEADER_SIZE: usize = 144;

const OBJECT_HEADER_BASE_SIZE: usize = 16;
const OBJECT_HEADER_V1_SIZE: usize = 16;
const LOG_CONTAINER_SIZE: usize = 16;
const CAN_MESSAGE_SIZE: usize = 16;
const CAN_ERROR_EXT_SIZE: usize = 32;
const CAN_FD_MESSAGE_SIZE: usize = 84;
const CAN_FD_MESSAGE_64_SIZE: usize = 40;

const CAN_MESSAGE: u32 = 1;
const LOG_CONTAINER: u32 = 10;
const CAN_ERROR_EXT: u32 = 73;
const CAN_FD_MESSAGE: u32 = 100;
const CAN_FD_MESSAGE_64: u32 = 101;

const NO_COMPRESSION: u16 = 0;
const ZLIB_DEFLATE: u16 = 2;
const FD64_EDL_FLAG: u32 = 0x1000;
const TIME_ONE_NANOSECOND: u32 = 0x0000_0002;

pub(super) fn append_file_header(bytes: &mut Vec<u8>) {
    bytes.extend_from_slice(b"LOGG");
    append_u32(bytes, MIN_FILE_HEADER_SIZE as u32);
    bytes.resize(bytes.len() + 32, 0);
    append_system_time(bytes, 2026, 5, 11, 10, 20, 30, 400);
    bytes.resize(MIN_FILE_HEADER_SIZE, 0);
}

#[allow(clippy::too_many_arguments)]
fn append_system_time(
    bytes: &mut Vec<u8>,
    year: u16,
    month: u16,
    day: u16,
    hour: u16,
    minute: u16,
    second: u16,
    millisecond: u16,
) {
    append_u16(bytes, year);
    append_u16(bytes, month);
    append_u16(bytes, 0);
    append_u16(bytes, day);
    append_u16(bytes, hour);
    append_u16(bytes, minute);
    append_u16(bytes, second);
    append_u16(bytes, millisecond);
}

pub(super) fn append_outer_container(bytes: &mut Vec<u8>, payload: &[u8]) {
    append_outer_container_with_payload(bytes, NO_COMPRESSION, payload.len(), payload);
}

pub(super) fn append_outer_zlib_stored_container(bytes: &mut Vec<u8>, payload: &[u8]) {
    assert!(payload.len() <= u16::MAX as usize);
    let len = payload.len() as u16;
    let mut compressed = Vec::with_capacity(payload.len() + 11);
    compressed.extend_from_slice(&[0x78, 0x01]);
    compressed.push(0x01); // Final, uncompressed DEFLATE block.
    compressed.extend_from_slice(&len.to_le_bytes());
    compressed.extend_from_slice(&(!len).to_le_bytes());
    compressed.extend_from_slice(payload);
    compressed.extend_from_slice(&adler32(payload).to_be_bytes());
    append_outer_container_with_payload(bytes, ZLIB_DEFLATE, payload.len(), &compressed);
}

fn append_outer_container_with_payload(
    bytes: &mut Vec<u8>,
    method: u16,
    uncompressed_size: usize,
    payload: &[u8],
) {
    let object_size = OBJECT_HEADER_BASE_SIZE + LOG_CONTAINER_SIZE + payload.len();
    append_object_base(bytes, object_size, LOG_CONTAINER, OBJECT_HEADER_BASE_SIZE);
    append_u16(bytes, method);
    bytes.resize(bytes.len() + 6, 0);
    append_u32(bytes, uncompressed_size as u32);
    bytes.resize(bytes.len() + 4, 0);
    bytes.extend_from_slice(payload);
    bytes.resize(bytes.len() + padding_size(object_size), 0);
}

pub(super) fn append_classic_can_object(
    bytes: &mut Vec<u8>,
    timestamp_ns: u64,
    can_id: u32,
    payload: &[u8],
) {
    append_classic_can_object_with_timestamp_flags(
        bytes,
        TIME_ONE_NANOSECOND,
        timestamp_ns,
        can_id,
        payload,
    );
}

pub(super) fn append_classic_can_object_with_timestamp_flags(
    bytes: &mut Vec<u8>,
    timestamp_flags: u32,
    raw_timestamp: u64,
    can_id: u32,
    payload: &[u8],
) {
    assert!(payload.len() <= 8);
    let header_size = OBJECT_HEADER_BASE_SIZE + OBJECT_HEADER_V1_SIZE;
    let object_size = header_size + CAN_MESSAGE_SIZE;
    append_object_base(bytes, object_size, CAN_MESSAGE, header_size);
    append_u32(bytes, timestamp_flags);
    append_u16(bytes, 0);
    append_u16(bytes, 0);
    append_u64(bytes, raw_timestamp);
    append_u16(bytes, 1);
    bytes.push(0);
    bytes.push(payload.len() as u8);
    append_u32(bytes, can_id);
    bytes.extend_from_slice(payload);
    bytes.resize(bytes.len() + 8 - payload.len(), 0);
}

pub(super) fn append_can_error_ext_object(
    bytes: &mut Vec<u8>,
    timestamp_ns: u64,
    can_id: u32,
    payload: &[u8],
) {
    assert!(payload.len() <= 8);
    let header_size = OBJECT_HEADER_BASE_SIZE + OBJECT_HEADER_V1_SIZE;
    let object_size = header_size + CAN_ERROR_EXT_SIZE;
    append_object_base(bytes, object_size, CAN_ERROR_EXT, header_size);
    append_object_timestamp_v1(bytes, timestamp_ns);
    append_u16(bytes, 1);
    append_u16(bytes, 0);
    append_u32(bytes, 0);
    bytes.push(0);
    bytes.push(0);
    bytes.push(payload.len() as u8);
    bytes.push(0);
    append_u32(bytes, 0);
    append_u32(bytes, can_id);
    append_u16(bytes, 0);
    bytes.resize(bytes.len() + 2, 0);
    bytes.extend_from_slice(payload);
    bytes.resize(bytes.len() + 8 - payload.len(), 0);
}

pub(super) fn append_can_fd_message_object(
    bytes: &mut Vec<u8>,
    timestamp_ns: u64,
    can_id: u32,
    dlc: u8,
    payload: &[u8],
) {
    assert!(payload.len() <= 64);
    let header_size = OBJECT_HEADER_BASE_SIZE + OBJECT_HEADER_V1_SIZE;
    let object_size = header_size + CAN_FD_MESSAGE_SIZE;
    append_object_base(bytes, object_size, CAN_FD_MESSAGE, header_size);
    append_object_timestamp_v1(bytes, timestamp_ns);
    append_u16(bytes, 1);
    bytes.push(0);
    bytes.push(dlc);
    append_u32(bytes, can_id);
    append_u32(bytes, 0);
    bytes.push(0);
    bytes.push(0x07);
    bytes.push(payload.len() as u8);
    bytes.resize(bytes.len() + 5, 0);
    bytes.extend_from_slice(payload);
    bytes.resize(bytes.len() + 64 - payload.len(), 0);
}

pub(super) fn append_can_fd_message_64_object(
    bytes: &mut Vec<u8>,
    timestamp_ns: u64,
    can_id: u32,
    dlc: u8,
    valid_bytes: u8,
    payload: &[u8],
) {
    let header_size = OBJECT_HEADER_BASE_SIZE + OBJECT_HEADER_V1_SIZE;
    let object_size = header_size + CAN_FD_MESSAGE_64_SIZE + payload.len();
    append_object_base(bytes, object_size, CAN_FD_MESSAGE_64, header_size);
    append_object_timestamp_v1(bytes, timestamp_ns);
    bytes.push(1);
    bytes.push(dlc);
    bytes.push(valid_bytes);
    bytes.push(0);
    append_u32(bytes, can_id);
    append_u32(bytes, 0);
    append_u32(bytes, FD64_EDL_FLAG);
    append_u32(bytes, 0);
    append_u32(bytes, 0);
    append_u32(bytes, 0);
    append_u32(bytes, 0);
    append_u16(bytes, 0);
    bytes.push(0);
    bytes.push(0);
    append_u32(bytes, 0);
    bytes.extend_from_slice(payload);
}

pub(super) fn append_unknown_timed_object(
    bytes: &mut Vec<u8>,
    object_type: u32,
    timestamp_ns: u64,
    body_len: usize,
) {
    let header_size = OBJECT_HEADER_BASE_SIZE + OBJECT_HEADER_V1_SIZE;
    let object_size = header_size + body_len;
    append_object_base(bytes, object_size, object_type, header_size);
    append_object_timestamp_v1(bytes, timestamp_ns);
    bytes.resize(bytes.len() + body_len, 0);
    bytes.resize(bytes.len() + padding_size(object_size), 0);
}

fn append_object_timestamp_v1(bytes: &mut Vec<u8>, timestamp_ns: u64) {
    append_u32(bytes, TIME_ONE_NANOSECOND);
    append_u16(bytes, 0);
    append_u16(bytes, 0);
    append_u64(bytes, timestamp_ns);
}

pub(super) fn append_object_base(
    bytes: &mut Vec<u8>,
    object_size: usize,
    object_type: u32,
    header_size: usize,
) {
    bytes.extend_from_slice(b"LOBJ");
    append_u16(bytes, header_size as u16);
    append_u16(bytes, 1);
    append_u32(bytes, object_size as u32);
    append_u32(bytes, object_type);
}

pub(super) fn append_u16(bytes: &mut Vec<u8>, value: u16) {
    bytes.extend_from_slice(&value.to_le_bytes());
}

fn append_u32(bytes: &mut Vec<u8>, value: u32) {
    bytes.extend_from_slice(&value.to_le_bytes());
}

fn append_u64(bytes: &mut Vec<u8>, value: u64) {
    bytes.extend_from_slice(&value.to_le_bytes());
}

const fn padding_size(size: usize) -> usize {
    size % 4
}

fn adler32(bytes: &[u8]) -> u32 {
    const MODULUS: u32 = 65_521;
    let mut a = 1_u32;
    let mut b = 0_u32;
    for chunk in bytes.chunks(5_552) {
        for &byte in chunk {
            a += u32::from(byte);
            b += a;
        }
        a %= MODULUS;
        b %= MODULUS;
    }
    (b << 16) | a
}
