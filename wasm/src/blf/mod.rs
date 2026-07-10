#[cfg(test)]
mod test_fixture;

use std::fmt;

use fdeflate::{DecompressionError, Decompressor};

use crate::trace::{CanId, Frame, FrameKind, Trace, days_from_civil};

const FILE_HEADER_PARSED_SIZE: usize = 72;
const OBJECT_HEADER_BASE_SIZE: usize = 16;
const OBJECT_HEADER_V1_SIZE: usize = 16;
const OBJECT_HEADER_V2_SIZE: usize = 24;
const LOG_CONTAINER_SIZE: usize = 16;
const CAN_MESSAGE_SIZE: usize = 16;
const CAN_ERROR_EXT_SIZE: usize = 32;
const CAN_FD_MESSAGE_SIZE: usize = 84;
const CAN_FD_MESSAGE_64_SIZE: usize = 40;

const CAN_MESSAGE: u32 = 1;
const LOG_CONTAINER: u32 = 10;
const CAN_ERROR_EXT: u32 = 73;
const CAN_MESSAGE_2: u32 = 86;
const CAN_FD_MESSAGE: u32 = 100;
const CAN_FD_MESSAGE_64: u32 = 101;

const NO_COMPRESSION: u16 = 0;
const ZLIB_DEFLATE: u16 = 2;

const CAN_MESSAGE_EXTENDED: u32 = 0x8000_0000;
const REMOTE_FLAG: u8 = 0x80;
const FD64_REMOTE_FLAG: u32 = 0x0010;
const FD64_EDL_FLAG: u32 = 0x1000;

const TIME_TEN_MICROSECONDS: u32 = 0x0000_0001;
const TIME_ONE_NANOSECOND: u32 = 0x0000_0002;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BlfError {
    InvalidBlfHeader,
    InvalidBlfSignature,
    InvalidBlfHeaderSize,
    TruncatedBlfObjectHeader,
    InvalidBlfObject,
    InvalidBlfObjectSize,
    TruncatedBlfObject,
    TruncatedBlfObjectPadding,
    InvalidBlfObjectHeader,
    InvalidBlfCanMessage,
    InvalidBlfCanErrorExt,
    InvalidBlfCanFdMessage,
    InvalidBlfCanFdMessage64,
    InvalidBlfContainer,
    InvalidBlfContainerSize,
    OutOfMemory,
    UnsupportedBlfCompression(u16),
    InvalidBlfSystemTime,
    InvalidBlfTimestamp,
    InvalidCanId,
    PayloadOffsetOverflow,
    InvalidZlibHeader,
    UnsupportedZlibDictionary,
    InvalidDeflateStream,
    InvalidZlibChecksum,
}

impl fmt::Display for BlfError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidBlfHeader => formatter.write_str("invalid BLF file header"),
            Self::InvalidBlfSignature => formatter.write_str("invalid BLF file signature"),
            Self::InvalidBlfHeaderSize => formatter.write_str("invalid BLF file header size"),
            Self::TruncatedBlfObjectHeader => formatter.write_str("truncated BLF object header"),
            Self::InvalidBlfObject => formatter.write_str("invalid BLF object"),
            Self::InvalidBlfObjectSize => formatter.write_str("invalid BLF object size"),
            Self::TruncatedBlfObject => formatter.write_str("truncated BLF object"),
            Self::TruncatedBlfObjectPadding => formatter.write_str("truncated BLF object padding"),
            Self::InvalidBlfObjectHeader => formatter.write_str("invalid BLF object header"),
            Self::InvalidBlfCanMessage => formatter.write_str("invalid BLF CAN message"),
            Self::InvalidBlfCanErrorExt => {
                formatter.write_str("invalid BLF extended CAN error frame")
            }
            Self::InvalidBlfCanFdMessage => formatter.write_str("invalid BLF CAN FD message"),
            Self::InvalidBlfCanFdMessage64 => formatter.write_str("invalid BLF CAN FD 64 message"),
            Self::InvalidBlfContainer => formatter.write_str("invalid BLF log container"),
            Self::InvalidBlfContainerSize => {
                formatter.write_str("BLF log container decompressed to an unexpected size")
            }
            Self::OutOfMemory => formatter.write_str("not enough memory to parse the BLF trace"),
            Self::UnsupportedBlfCompression(method) => {
                write!(formatter, "unsupported BLF compression method {method}")
            }
            Self::InvalidBlfSystemTime => formatter.write_str("invalid BLF system time"),
            Self::InvalidBlfTimestamp => formatter.write_str("BLF timestamp overflowed"),
            Self::InvalidCanId => formatter.write_str("invalid CAN identifier in BLF object"),
            Self::PayloadOffsetOverflow => {
                formatter.write_str("BLF payload storage exceeded 4 GiB")
            }
            Self::InvalidZlibHeader => formatter.write_str("invalid zlib header in BLF container"),
            Self::UnsupportedZlibDictionary => {
                formatter.write_str("preset zlib dictionaries are unsupported in BLF containers")
            }
            Self::InvalidDeflateStream => {
                formatter.write_str("invalid DEFLATE stream in BLF container")
            }
            Self::InvalidZlibChecksum => {
                formatter.write_str("invalid zlib checksum in BLF container")
            }
        }
    }
}

impl std::error::Error for BlfError {}

fn inflate_zlib(input: &[u8], expected_len: usize) -> Result<Vec<u8>, BlfError> {
    if input.len() < 6 {
        return Err(BlfError::InvalidZlibHeader);
    }

    let compression_method = input[0] & 0x0f;
    let window_size = input[0] >> 4;
    let header_check = u16::from_be_bytes([input[0], input[1]]);
    if compression_method != 8 || window_size > 7 || !header_check.is_multiple_of(31) {
        return Err(BlfError::InvalidZlibHeader);
    }
    if input[1] & 0x20 != 0 {
        return Err(BlfError::UnsupportedZlibDictionary);
    }

    let mut output = Vec::new();
    output
        .try_reserve_exact(expected_len)
        .map_err(|_| BlfError::OutOfMemory)?;
    output.resize(expected_len, 0);

    let mut decoder = Decompressor::new();
    let (consumed, produced) = decoder
        .read(input, &mut output, 0, true)
        .map_err(map_decompression_error)?;
    if decoder.is_done() {
        return (consumed == input.len() && produced == expected_len)
            .then_some(output)
            .ok_or(BlfError::InvalidBlfContainerSize);
    }
    if produced != expected_len {
        return Err(BlfError::InvalidBlfContainerSize);
    }

    // A full output buffer can hide a truncated checksum. Give the decoder one
    // byte of temporary headroom to distinguish truncation from excess output.
    output
        .try_reserve_exact(1)
        .map_err(|_| BlfError::OutOfMemory)?;
    output.push(0);
    let (additional_consumed, additional_produced) = decoder
        .read(&input[consumed..], &mut output, produced, true)
        .map_err(map_decompression_error)?;
    output.truncate(expected_len);

    (decoder.is_done() && consumed + additional_consumed == input.len() && additional_produced == 0)
        .then_some(output)
        .ok_or(BlfError::InvalidBlfContainerSize)
}

fn map_decompression_error(error: DecompressionError) -> BlfError {
    match error {
        DecompressionError::WrongChecksum => BlfError::InvalidZlibChecksum,
        _ => BlfError::InvalidDeflateStream,
    }
}

pub(crate) fn from_bytes(bytes: &[u8]) -> Result<Trace, BlfError> {
    if bytes.len() < FILE_HEADER_PARSED_SIZE {
        return Err(BlfError::InvalidBlfHeader);
    }
    if bytes.get(..4) != Some(b"LOGG") {
        return Err(BlfError::InvalidBlfSignature);
    }

    let header_size = usize::try_from(read_u32(bytes, 4).ok_or(BlfError::InvalidBlfHeader)?)
        .map_err(|_| BlfError::InvalidBlfHeaderSize)?;
    if !(FILE_HEADER_PARSED_SIZE..=bytes.len()).contains(&header_size) {
        return Err(BlfError::InvalidBlfHeaderSize);
    }

    let measurement_start_ms = bytes
        .get(40..56)
        .and_then(|system_time| parse_system_time_to_unix_ms(system_time).ok());
    let mut parser = Parser::new(measurement_start_ms);

    let mut position = header_size;
    while position < bytes.len() {
        let header_end = position
            .checked_add(OBJECT_HEADER_BASE_SIZE)
            .ok_or(BlfError::TruncatedBlfObjectHeader)?;
        if header_end > bytes.len() {
            return Err(BlfError::TruncatedBlfObjectHeader);
        }
        if bytes.get(position..position + 4) != Some(b"LOBJ") {
            return Err(BlfError::InvalidBlfObject);
        }

        let object_size = usize::try_from(
            read_u32(bytes, position + 8).ok_or(BlfError::TruncatedBlfObjectHeader)?,
        )
        .map_err(|_| BlfError::InvalidBlfObjectSize)?;
        let object_type =
            read_u32(bytes, position + 12).ok_or(BlfError::TruncatedBlfObjectHeader)?;
        if object_size < OBJECT_HEADER_BASE_SIZE {
            return Err(BlfError::InvalidBlfObjectSize);
        }
        let object_end = position
            .checked_add(object_size)
            .filter(|&end| end <= bytes.len())
            .ok_or(BlfError::TruncatedBlfObject)?;

        if object_type == LOG_CONTAINER {
            let object_body = &bytes[header_end..object_end];
            parser.parse_log_container(object_body)?;
        }

        position = object_end
            .checked_add(padding_size(object_size))
            .filter(|&end| end <= bytes.len())
            .ok_or(BlfError::TruncatedBlfObjectPadding)?;
    }

    if !parser.tail.is_empty() {
        return Err(BlfError::TruncatedBlfObject);
    }
    Ok(parser.finish())
}

struct Parser {
    measurement_start_ms: Option<i64>,
    frames: Vec<Frame>,
    payloads: Vec<u8>,
    tail: Vec<u8>,
    data_frame_count: usize,
    last_data_timestamp_ns: Option<u64>,
}

impl Parser {
    const fn new(measurement_start_ms: Option<i64>) -> Self {
        Self {
            measurement_start_ms,
            frames: Vec::new(),
            payloads: Vec::new(),
            tail: Vec::new(),
            data_frame_count: 0,
            last_data_timestamp_ns: None,
        }
    }

    fn finish(self) -> Trace {
        Trace {
            measurement_start_ms: self.measurement_start_ms,
            frames: self.frames,
            payloads: self.payloads,
            data_frame_count: self.data_frame_count,
            skipped_line_count: 0,
            last_data_timestamp_ns: self.last_data_timestamp_ns,
        }
    }

    fn parse_log_container(&mut self, body: &[u8]) -> Result<(), BlfError> {
        if body.len() < LOG_CONTAINER_SIZE {
            return Err(BlfError::InvalidBlfContainer);
        }
        let method = read_u16(body, 0).ok_or(BlfError::InvalidBlfContainer)?;
        let uncompressed_size =
            usize::try_from(read_u32(body, 8).ok_or(BlfError::InvalidBlfContainer)?)
                .map_err(|_| BlfError::InvalidBlfContainerSize)?;
        let payload = &body[LOG_CONTAINER_SIZE..];

        match method {
            NO_COMPRESSION => self.parse_container(payload),
            ZLIB_DEFLATE => {
                let decompressed = inflate_zlib(payload, uncompressed_size)?;
                self.parse_container(&decompressed)
            }
            method => Err(BlfError::UnsupportedBlfCompression(method)),
        }
    }

    fn parse_container(&mut self, container: &[u8]) -> Result<(), BlfError> {
        let stitched;
        let data = if self.tail.is_empty() {
            container
        } else {
            let mut combined = std::mem::take(&mut self.tail);
            combined
                .try_reserve(container.len())
                .map_err(|_| BlfError::OutOfMemory)?;
            combined.extend_from_slice(container);
            stitched = combined;
            stitched.as_slice()
        };

        let mut position = 0_usize;
        while position < data.len() {
            let search_start = position;
            let Some(object_start) = find_next_object(data, position) else {
                if position.checked_add(8).is_none_or(|end| end > data.len()) {
                    self.keep_tail(&data[search_start..])?;
                    return Ok(());
                }
                return Err(BlfError::InvalidBlfObject);
            };

            let Some(base_header_end) = object_start.checked_add(OBJECT_HEADER_BASE_SIZE) else {
                return Err(BlfError::InvalidBlfObjectSize);
            };
            if base_header_end > data.len() {
                self.keep_tail(&data[search_start..])?;
                return Ok(());
            }

            let header_size = usize::from(
                read_u16(data, object_start + 4).ok_or(BlfError::InvalidBlfObjectHeader)?,
            );
            let header_version =
                read_u16(data, object_start + 6).ok_or(BlfError::InvalidBlfObjectHeader)?;
            let object_size = usize::try_from(
                read_u32(data, object_start + 8).ok_or(BlfError::InvalidBlfObjectHeader)?,
            )
            .map_err(|_| BlfError::InvalidBlfObjectSize)?;
            let object_type =
                read_u32(data, object_start + 12).ok_or(BlfError::InvalidBlfObjectHeader)?;
            if object_size < OBJECT_HEADER_BASE_SIZE || header_size < OBJECT_HEADER_BASE_SIZE {
                return Err(BlfError::InvalidBlfObjectSize);
            }

            let Some(object_end) = object_start.checked_add(object_size) else {
                self.keep_tail(&data[search_start..])?;
                return Ok(());
            };
            if object_end > data.len() {
                self.keep_tail(&data[search_start..])?;
                return Ok(());
            }
            let Some(padded_object_end) =
                object_end.checked_add(object_padding_size(object_size, object_type))
            else {
                self.keep_tail(&data[search_start..])?;
                return Ok(());
            };
            if padded_object_end > data.len() {
                self.keep_tail(&data[search_start..])?;
                return Ok(());
            }

            let mut cursor = base_header_end;
            let timestamp_ns = match header_version {
                1 => {
                    if cursor
                        .checked_add(OBJECT_HEADER_V1_SIZE)
                        .is_none_or(|end| end > object_end)
                    {
                        return Err(BlfError::InvalidBlfObjectHeader);
                    }
                    let flags = read_u32(data, cursor).ok_or(BlfError::InvalidBlfObjectHeader)?;
                    let raw_timestamp =
                        read_u64(data, cursor + 8).ok_or(BlfError::InvalidBlfObjectHeader)?;
                    cursor += OBJECT_HEADER_V1_SIZE;
                    timestamp_to_ns(flags, raw_timestamp)?
                }
                2 => {
                    if cursor
                        .checked_add(OBJECT_HEADER_V2_SIZE)
                        .is_none_or(|end| end > object_end)
                    {
                        return Err(BlfError::InvalidBlfObjectHeader);
                    }
                    let flags = read_u32(data, cursor).ok_or(BlfError::InvalidBlfObjectHeader)?;
                    let raw_timestamp =
                        read_u64(data, cursor + 8).ok_or(BlfError::InvalidBlfObjectHeader)?;
                    cursor += OBJECT_HEADER_V2_SIZE;
                    timestamp_to_ns(flags, raw_timestamp)?
                }
                _ => {
                    position = padded_object_end;
                    continue;
                }
            };

            let object_body = &data[cursor..object_end];
            match object_type {
                CAN_MESSAGE | CAN_MESSAGE_2 => {
                    self.parse_can_message(object_body, timestamp_ns)?;
                }
                CAN_ERROR_EXT => self.parse_can_error_ext(object_body, timestamp_ns)?,
                CAN_FD_MESSAGE => self.parse_can_fd_message(object_body, timestamp_ns)?,
                CAN_FD_MESSAGE_64 => self.parse_can_fd_message_64(
                    object_body,
                    header_size,
                    object_size,
                    timestamp_ns,
                )?,
                _ => {}
            }
            position = padded_object_end;
        }
        Ok(())
    }

    fn parse_can_message(&mut self, body: &[u8], timestamp_ns: u64) -> Result<(), BlfError> {
        if body.len() < CAN_MESSAGE_SIZE {
            return Err(BlfError::InvalidBlfCanMessage);
        }
        let flags = body[2];
        let dlc = body[3];
        let payload_len = dlc.min(8);
        let raw_id = read_u32(body, 4).ok_or(BlfError::InvalidBlfCanMessage)?;
        let kind = if flags & REMOTE_FLAG != 0 {
            FrameKind::Remote
        } else {
            FrameKind::Data
        };
        let mut frame = self.new_frame(
            timestamp_ns,
            kind,
            id_from_raw(raw_id)?,
            false,
            dlc,
            payload_len,
        );

        if kind == FrameKind::Data {
            self.copy_payload(&mut frame, &body[8..8 + usize::from(payload_len)])?;
            self.record_data_frame(timestamp_ns);
        }
        self.push_frame(frame)?;
        Ok(())
    }

    fn parse_can_error_ext(&mut self, body: &[u8], timestamp_ns: u64) -> Result<(), BlfError> {
        if body.len() < CAN_ERROR_EXT_SIZE {
            return Err(BlfError::InvalidBlfCanErrorExt);
        }
        let dlc = body[10];
        let payload_len = dlc.min(8);
        let raw_id = read_u32(body, 16).ok_or(BlfError::InvalidBlfCanErrorExt)?;
        let mut frame = self.new_frame(
            timestamp_ns,
            FrameKind::Error,
            id_from_raw(raw_id)?,
            false,
            dlc,
            payload_len,
        );
        self.copy_payload(&mut frame, &body[24..24 + usize::from(payload_len)])?;
        self.push_frame(frame)?;
        Ok(())
    }

    fn parse_can_fd_message(&mut self, body: &[u8], timestamp_ns: u64) -> Result<(), BlfError> {
        if body.len() < CAN_FD_MESSAGE_SIZE {
            return Err(BlfError::InvalidBlfCanFdMessage);
        }
        let flags = body[2];
        let dlc = body[3];
        let raw_id = read_u32(body, 4).ok_or(BlfError::InvalidBlfCanFdMessage)?;
        let valid_bytes = body[14].min(64);
        let kind = if flags & REMOTE_FLAG != 0 {
            FrameKind::Remote
        } else {
            FrameKind::Data
        };
        let mut frame = self.new_frame(
            timestamp_ns,
            kind,
            id_from_raw(raw_id)?,
            true,
            dlc,
            valid_bytes,
        );

        if kind == FrameKind::Data {
            self.copy_payload(&mut frame, &body[20..20 + usize::from(valid_bytes)])?;
            self.record_data_frame(timestamp_ns);
        }
        self.push_frame(frame)?;
        Ok(())
    }

    fn parse_can_fd_message_64(
        &mut self,
        body: &[u8],
        header_size: usize,
        object_size: usize,
        timestamp_ns: u64,
    ) -> Result<(), BlfError> {
        if body.len() < CAN_FD_MESSAGE_64_SIZE {
            return Err(BlfError::InvalidBlfCanFdMessage64);
        }
        let dlc = body[1];
        let valid_bytes = body[2].min(64);
        let raw_id = read_u32(body, 4).ok_or(BlfError::InvalidBlfCanFdMessage64)?;
        let flags = read_u32(body, 12).ok_or(BlfError::InvalidBlfCanFdMessage64)?;
        let extended_data_offset = usize::from(body[35]);
        let data_field_end = if extended_data_offset == 0 {
            object_size
        } else {
            extended_data_offset
        };
        let available_payload_len =
            data_field_end.saturating_sub(header_size + CAN_FD_MESSAGE_64_SIZE);
        let copied_payload_len = usize::from(valid_bytes)
            .min(available_payload_len)
            .min(body.len() - CAN_FD_MESSAGE_64_SIZE);
        let kind = if flags & FD64_REMOTE_FLAG != 0 {
            FrameKind::Remote
        } else {
            FrameKind::Data
        };
        let mut frame = self.new_frame(
            timestamp_ns,
            kind,
            id_from_raw(raw_id)?,
            flags & FD64_EDL_FLAG != 0,
            dlc,
            valid_bytes,
        );

        if kind == FrameKind::Data {
            let payload_len = usize::from(valid_bytes);
            self.payloads
                .try_reserve(payload_len)
                .map_err(|_| BlfError::OutOfMemory)?;
            frame.payload_offset = self.payload_offset()?;
            self.payloads.extend_from_slice(
                &body[CAN_FD_MESSAGE_64_SIZE..CAN_FD_MESSAGE_64_SIZE + copied_payload_len],
            );
            self.payloads
                .resize(frame.payload_offset as usize + payload_len, 0);
            self.record_data_frame(timestamp_ns);
        }
        self.push_frame(frame)?;
        Ok(())
    }

    fn new_frame(
        &self,
        timestamp_ns: u64,
        kind: FrameKind,
        id: CanId,
        is_fd: bool,
        dlc: u8,
        payload_len: u8,
    ) -> Frame {
        Frame {
            timestamp_ns,
            kind,
            id: Some(id),
            is_fd,
            dlc,
            payload_offset: 0,
            payload_len,
        }
    }

    fn copy_payload(&mut self, frame: &mut Frame, payload: &[u8]) -> Result<(), BlfError> {
        self.payloads
            .try_reserve(payload.len())
            .map_err(|_| BlfError::OutOfMemory)?;
        frame.payload_offset = self.payload_offset()?;
        self.payloads.extend_from_slice(payload);
        Ok(())
    }

    fn push_frame(&mut self, frame: Frame) -> Result<(), BlfError> {
        self.frames
            .try_reserve(1)
            .map_err(|_| BlfError::OutOfMemory)?;
        self.frames.push(frame);
        Ok(())
    }

    fn keep_tail(&mut self, bytes: &[u8]) -> Result<(), BlfError> {
        self.tail
            .try_reserve(bytes.len())
            .map_err(|_| BlfError::OutOfMemory)?;
        self.tail.extend_from_slice(bytes);
        Ok(())
    }

    fn payload_offset(&self) -> Result<u32, BlfError> {
        u32::try_from(self.payloads.len()).map_err(|_| BlfError::PayloadOffsetOverflow)
    }

    fn record_data_frame(&mut self, timestamp_ns: u64) {
        self.data_frame_count += 1;
        self.last_data_timestamp_ns = Some(timestamp_ns);
    }
}

fn id_from_raw(raw_id: u32) -> Result<CanId, BlfError> {
    let value = raw_id & 0x1fff_ffff;
    if raw_id & CAN_MESSAGE_EXTENDED != 0 {
        CanId::extended(value).map_err(|_| BlfError::InvalidCanId)
    } else {
        CanId::standard(value).map_err(|_| BlfError::InvalidCanId)
    }
}

fn timestamp_to_ns(flags: u32, raw_timestamp: u64) -> Result<u64, BlfError> {
    if flags & TIME_ONE_NANOSECOND != 0 {
        return Ok(raw_timestamp);
    }
    if flags & TIME_TEN_MICROSECONDS != 0 {
        return raw_timestamp
            .checked_mul(10_000)
            .ok_or(BlfError::InvalidBlfTimestamp);
    }
    // Vector's object header defaults to nanoseconds. Keep flagless and unknown
    // units as nanoseconds instead of silently changing their scale.
    Ok(raw_timestamp)
}

fn find_next_object(bytes: &[u8], start: usize) -> Option<usize> {
    let end = start.saturating_add(8).min(bytes.len());
    if end < 4 || start > end - 4 {
        return None;
    }
    (start..=end - 4).find(|&position| bytes.get(position..position + 4) == Some(b"LOBJ"))
}

const fn padding_size(size: usize) -> usize {
    size % 4
}

const fn object_padding_size(size: usize, object_type: u32) -> usize {
    if object_type == CAN_FD_MESSAGE_64 {
        0
    } else {
        padding_size(size)
    }
}

fn read_u16(bytes: &[u8], offset: usize) -> Option<u16> {
    Some(u16::from_le_bytes(
        bytes.get(offset..offset + 2)?.try_into().ok()?,
    ))
}

fn read_u32(bytes: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_le_bytes(
        bytes.get(offset..offset + 4)?.try_into().ok()?,
    ))
}

fn read_u64(bytes: &[u8], offset: usize) -> Option<u64> {
    Some(u64::from_le_bytes(
        bytes.get(offset..offset + 8)?.try_into().ok()?,
    ))
}

fn parse_system_time_to_unix_ms(bytes: &[u8]) -> Result<i64, BlfError> {
    let year = read_u16(bytes, 0).ok_or(BlfError::InvalidBlfSystemTime)?;
    let month = read_u16(bytes, 2).ok_or(BlfError::InvalidBlfSystemTime)?;
    let day = read_u16(bytes, 6).ok_or(BlfError::InvalidBlfSystemTime)?;
    let hour = read_u16(bytes, 8).ok_or(BlfError::InvalidBlfSystemTime)?;
    let minute = read_u16(bytes, 10).ok_or(BlfError::InvalidBlfSystemTime)?;
    let second = read_u16(bytes, 12).ok_or(BlfError::InvalidBlfSystemTime)?;
    let millisecond = read_u16(bytes, 14).ok_or(BlfError::InvalidBlfSystemTime)?;
    if year == 0 || month == 0 || day == 0 {
        return Err(BlfError::InvalidBlfSystemTime);
    }
    if month > 12 || day > 31 || hour > 23 || minute > 59 || second > 59 || millisecond > 999 {
        return Err(BlfError::InvalidBlfSystemTime);
    }

    let days = days_from_civil(i32::from(year), month as u8, day as u8);
    let seconds = days
        .checked_mul(86_400)
        .and_then(|value| {
            value.checked_add(i64::from(hour) * 3_600 + i64::from(minute) * 60 + i64::from(second))
        })
        .ok_or(BlfError::InvalidBlfSystemTime)?;
    seconds
        .checked_mul(1_000)
        .and_then(|value| value.checked_add(i64::from(millisecond)))
        .ok_or(BlfError::InvalidBlfSystemTime)
}

#[cfg(test)]
mod tests {
    use super::*;
    use test_fixture as fixture;

    #[test]
    fn inflates_fixed_huffman_zlib_stream() {
        let compressed = [
            0x78, 0x9c, 0xcb, 0x48, 0xcd, 0xc9, 0xc9, 0x07, 0x00, 0x06, 0x2c, 0x02, 0x15,
        ];
        assert_eq!(inflate_zlib(&compressed, 5).unwrap(), b"hello");
    }

    #[test]
    fn maps_zlib_checksum_failures() {
        let compressed = [
            0x78, 0x9c, 0xcb, 0x48, 0xcd, 0xc9, 0xc9, 0x07, 0x00, 0x06, 0x2c, 0x02, 0x14,
        ];
        assert_eq!(
            inflate_zlib(&compressed, 5),
            Err(BlfError::InvalidZlibChecksum)
        );
    }

    #[test]
    fn maps_malformed_deflate_streams() {
        let compressed = [0x78, 0x9c, 0x07, 0x00, 0x00, 0x00, 0x01];
        assert_eq!(
            inflate_zlib(&compressed, 0),
            Err(BlfError::InvalidDeflateStream)
        );
    }

    #[test]
    fn maps_truncated_deflate_streams() {
        let compressed = [0x78, 0x9c, 0xcb, 0x48, 0xcd, 0xc9, 0xc9, 0x07];
        assert_eq!(
            inflate_zlib(&compressed, 5),
            Err(BlfError::InvalidDeflateStream)
        );
    }

    #[test]
    fn rejects_declared_container_size_mismatches() {
        let compressed = [
            0x78, 0x9c, 0xcb, 0x48, 0xcd, 0xc9, 0xc9, 0x07, 0x00, 0x06, 0x2c, 0x02, 0x15,
        ];
        assert_eq!(
            inflate_zlib(&compressed, 4),
            Err(BlfError::InvalidBlfContainerSize)
        );
        assert_eq!(
            inflate_zlib(&compressed, 6),
            Err(BlfError::InvalidBlfContainerSize)
        );
    }

    #[test]
    fn rejects_impossible_container_allocations() {
        let compressed = [
            0x78, 0x9c, 0xcb, 0x48, 0xcd, 0xc9, 0xc9, 0x07, 0x00, 0x06, 0x2c, 0x02, 0x15,
        ];
        assert_eq!(
            inflate_zlib(&compressed, usize::MAX),
            Err(BlfError::OutOfMemory)
        );
    }

    #[test]
    fn parses_uncompressed_classic_can_blf_container() {
        let mut inner = Vec::new();
        fixture::append_classic_can_object(&mut inner, 123_456_789, 0x123, &[0xaa, 0xbb]);

        let mut file = Vec::new();
        fixture::append_file_header(&mut file);
        fixture::append_outer_container(&mut file, &inner);

        let parsed = from_bytes(&file).unwrap();
        assert_eq!(parsed.measurement_start_ms, Some(1_778_494_830_400));
        assert_eq!(parsed.frames.len(), 1);
        assert_eq!(parsed.data_frame_count, 1);
        assert_eq!(parsed.frames[0].timestamp_ns, 123_456_789);
        assert_eq!(parsed.frames[0].id, Some(CanId::standard(0x123).unwrap()));
        assert_eq!(parsed.payloads, [0xaa, 0xbb]);
    }

    #[test]
    fn parses_zlib_compressed_classic_can_blf_container() {
        let mut inner = Vec::new();
        fixture::append_classic_can_object(&mut inner, 123_456_789, 0x123, &[0xaa, 0xbb]);

        let mut file = Vec::new();
        fixture::append_file_header(&mut file);
        fixture::append_outer_zlib_stored_container(&mut file, &inner);

        let parsed = from_bytes(&file).unwrap();
        assert_eq!(parsed.frames.len(), 1);
        assert_eq!(parsed.payloads, [0xaa, 0xbb]);
    }

    #[test]
    fn treats_flagless_blf_timestamps_as_nanoseconds() {
        let mut inner = Vec::new();
        fixture::append_classic_can_object_with_timestamp_flags(&mut inner, 0, 123, 0x123, &[0xaa]);

        let mut file = Vec::new();
        fixture::append_file_header(&mut file);
        fixture::append_outer_container(&mut file, &inner);

        let parsed = from_bytes(&file).unwrap();
        assert_eq!(parsed.frames.len(), 1);
        assert_eq!(parsed.frames[0].timestamp_ns, 123);
    }

    #[test]
    fn carries_an_inner_object_split_across_containers() {
        let mut inner = Vec::new();
        fixture::append_classic_can_object(
            &mut inner,
            10_000,
            CAN_MESSAGE_EXTENDED | 0x18fe_e900,
            &[0xcc],
        );

        let mut file = Vec::new();
        fixture::append_file_header(&mut file);
        fixture::append_outer_container(&mut file, &inner[..20]);
        fixture::append_outer_container(&mut file, &inner[20..]);

        let parsed = from_bytes(&file).unwrap();
        assert_eq!(parsed.frames.len(), 1);
        assert_eq!(
            parsed.frames[0].id,
            Some(CanId::extended(0x18fe_e900).unwrap())
        );
        assert_eq!(parsed.payloads[0], 0xcc);
    }

    #[test]
    fn carries_inner_object_padding_split_across_containers() {
        let mut inner = Vec::new();
        fixture::append_unknown_timed_object(&mut inner, 72, 10_000, 66);
        fixture::append_classic_can_object(&mut inner, 20_000, 0x123, &[0xdd]);

        let mut file = Vec::new();
        fixture::append_file_header(&mut file);
        fixture::append_outer_container(&mut file, &inner[..98]);
        fixture::append_outer_container(&mut file, &inner[98..]);

        let parsed = from_bytes(&file).unwrap();
        assert_eq!(parsed.frames.len(), 1);
        assert_eq!(parsed.frames[0].id, Some(CanId::standard(0x123).unwrap()));
        assert_eq!(parsed.payloads[0], 0xdd);
    }

    #[test]
    fn rejects_top_level_object_size_that_would_wrap_position_arithmetic() {
        let mut file = Vec::new();
        fixture::append_file_header(&mut file);
        fixture::append_object_base(&mut file, 0xffff_fff0, CAN_MESSAGE, OBJECT_HEADER_BASE_SIZE);
        assert!(matches!(
            from_bytes(&file),
            Err(BlfError::TruncatedBlfObject)
        ));
    }

    #[test]
    fn rejects_in_container_object_size_that_would_wrap_position_arithmetic() {
        let mut inner = Vec::new();
        fixture::append_object_base(
            &mut inner,
            0xffff_fff0,
            CAN_MESSAGE,
            OBJECT_HEADER_BASE_SIZE,
        );

        let mut file = Vec::new();
        fixture::append_file_header(&mut file);
        fixture::append_outer_container(&mut file, &inner);
        assert!(matches!(
            from_bytes(&file),
            Err(BlfError::TruncatedBlfObject)
        ));
    }

    #[test]
    fn rejects_unsupported_container_compression() {
        let mut file = Vec::new();
        fixture::append_file_header(&mut file);
        fixture::append_object_base(
            &mut file,
            OBJECT_HEADER_BASE_SIZE + LOG_CONTAINER_SIZE,
            LOG_CONTAINER,
            OBJECT_HEADER_BASE_SIZE,
        );
        fixture::append_u16(&mut file, 99);
        file.resize(file.len() + 14, 0);

        assert!(matches!(
            from_bytes(&file),
            Err(BlfError::UnsupportedBlfCompression(99))
        ));
    }

    #[test]
    fn parses_remaining_blf_can_frame_object_types() {
        let mut inner = Vec::new();
        fixture::append_can_error_ext_object(
            &mut inner,
            1_000,
            CAN_MESSAGE_EXTENDED | 0x1999_9999,
            &[0xcc, 0xdd],
        );
        fixture::append_can_fd_message_object(
            &mut inner,
            2_000,
            0x123,
            9,
            &[0x10, 0x20, 0x30, 0x40],
        );
        fixture::append_can_fd_message_64_object(&mut inner, 3_000, 0x456, 15, 64, &[0xaa, 0xbb]);

        let mut file = Vec::new();
        fixture::append_file_header(&mut file);
        fixture::append_outer_container(&mut file, &inner);

        let parsed = from_bytes(&file).unwrap();
        assert_eq!(parsed.frames.len(), 3);
        assert_eq!(parsed.data_frame_count, 2);
        assert_eq!(parsed.frames[0].kind, FrameKind::Error);
        assert_eq!(
            parsed.frames[0].id,
            Some(CanId::extended(0x1999_9999).unwrap())
        );
        assert_eq!(parsed.frames[0].payload_len, 2);

        assert!(parsed.frames[1].is_fd);
        assert_eq!(parsed.frames[1].dlc, 9);
        assert_eq!(parsed.frames[1].payload_len, 4);

        assert!(parsed.frames[2].is_fd);
        assert_eq!(parsed.frames[2].dlc, 15);
        assert_eq!(parsed.frames[2].payload_len, 64);
        let offset = parsed.frames[2].payload_offset as usize;
        let fd64_payload = &parsed.payloads[offset..offset + 64];
        assert_eq!(fd64_payload[0], 0xaa);
        assert_eq!(fd64_payload[1], 0xbb);
        assert_eq!(fd64_payload[63], 0);
    }

    #[test]
    fn parses_unpadded_can_fd_64_object_before_another_object() {
        let mut inner = Vec::new();
        fixture::append_can_fd_message_64_object(
            &mut inner,
            4_000,
            0x456,
            9,
            9,
            &[0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x11, 0x22, 0x33],
        );
        fixture::append_classic_can_object(&mut inner, 5_000, 0x123, &[0xdd]);

        let mut file = Vec::new();
        fixture::append_file_header(&mut file);
        fixture::append_outer_container(&mut file, &inner);

        let parsed = from_bytes(&file).unwrap();
        assert_eq!(parsed.frames.len(), 2);
        assert_eq!(parsed.frames[0].id, Some(CanId::standard(0x456).unwrap()));
        assert_eq!(parsed.frames[1].id, Some(CanId::standard(0x123).unwrap()));
    }

    #[test]
    fn pads_short_can_fd_64_payloads_to_valid_byte_length() {
        let mut inner = Vec::new();
        fixture::append_can_fd_message_64_object(&mut inner, 4_000, 0x456, 9, 12, &[0xaa, 0xbb]);

        let mut file = Vec::new();
        fixture::append_file_header(&mut file);
        fixture::append_outer_container(&mut file, &inner);

        let parsed = from_bytes(&file).unwrap();
        assert_eq!(parsed.frames.len(), 1);
        assert_eq!(parsed.frames[0].payload_len, 12);
        let offset = parsed.frames[0].payload_offset as usize;
        let payload = &parsed.payloads[offset..offset + 12];
        assert_eq!(payload[0], 0xaa);
        assert_eq!(payload[11], 0);
    }
}
