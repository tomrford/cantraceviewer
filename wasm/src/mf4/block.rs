use std::collections::BTreeSet;

use super::{Mf4Error, inflate_zlib};

const COMMON_HEADER_SIZE: usize = 24;
const MAX_DECOMPRESSED_BYTES: usize = 500 * 1024 * 1024;
pub(super) const MAX_EMBEDDED_DBC_BYTES: usize = 1024 * 1024;

#[derive(Clone, Debug)]
pub(super) struct Channel {
    pub(super) address: u64,
    pub(super) name: String,
    pub(super) channel_type: u8,
    pub(super) sync_type: u8,
    pub(super) data_type: u8,
    pub(super) bit_offset: u8,
    pub(super) byte_offset: u32,
    pub(super) bit_count: u32,
    pub(super) flags: u32,
    pub(super) invalidation_bit: u32,
    pub(super) conversion: Conversion,
    pub(super) unit: String,
}

impl Channel {
    pub(super) fn is_numeric(&self) -> bool {
        self.data_type <= 5
            && self.bit_count > 0
            && self.bit_count <= 64
            && self.conversion.is_supported()
    }
}

#[derive(Clone, Debug, Default)]
pub(super) struct Conversion {
    kind: u8,
    values: Vec<f64>,
}

impl Conversion {
    fn is_supported(&self) -> bool {
        matches!(self.kind, 0..=2 | 4 | 5)
    }

    pub(super) fn apply(&self, raw: f64) -> Option<f64> {
        match self.kind {
            0 => Some(raw),
            1 if self.values.len() >= 2 => Some(self.values[0] + self.values[1] * raw),
            1 => Some(raw),
            2 if self.values.len() >= 6 => {
                let numerator = self.values[0] * raw * raw + self.values[1] * raw + self.values[2];
                let denominator =
                    self.values[3] * raw * raw + self.values[4] * raw + self.values[5];
                (denominator.abs() > f64::EPSILON).then_some(numerator / denominator)
            }
            4 => interpolate_table(&self.values, raw),
            5 => lookup_table(&self.values, raw),
            _ => None,
        }
    }
}

#[derive(Clone, Debug)]
pub(super) struct ChannelGroup {
    pub(super) name: String,
    pub(super) record_id: u64,
    pub(super) cycles: usize,
    pub(super) flags: u16,
    pub(super) sample_size: usize,
    pub(super) invalidation_size: usize,
    pub(super) is_can_bus: bool,
    pub(super) channels: Vec<Channel>,
}

impl ChannelGroup {
    pub(super) fn record_size(&self) -> Option<usize> {
        self.sample_size.checked_add(self.invalidation_size)
    }
}

#[derive(Clone, Debug)]
pub(super) struct DataGroup {
    pub(super) data_address: u64,
    pub(super) record_id_size: u8,
    pub(super) groups: Vec<ChannelGroup>,
}

#[derive(Clone, Debug)]
pub(super) struct Attachment {
    pub(super) name: String,
    pub(super) mime: String,
    pub(super) is_embedded: bool,
    pub(super) original_size: usize,
    pub(super) data: Option<Vec<u8>>,
}

pub(super) fn is_dbc_attachment(name: &str, mime: &str) -> bool {
    name.to_ascii_lowercase().ends_with(".dbc") || mime.to_ascii_lowercase().contains("dbc")
}

pub(super) fn is_arxml_attachment(name: &str, mime: &str) -> bool {
    name.to_ascii_lowercase().ends_with(".arxml") || mime.to_ascii_lowercase().contains("arxml")
}

fn should_materialize_attachment(
    name: &str,
    mime: &str,
    is_embedded: bool,
    original_size: usize,
) -> bool {
    is_embedded && is_dbc_attachment(name, mime) && original_size <= MAX_EMBEDDED_DBC_BYTES
}

#[derive(Debug)]
pub(super) struct FileIndex {
    pub(super) measurement_start_ms: Option<i64>,
    pub(super) data_groups: Vec<DataGroup>,
    pub(super) attachments: Vec<Attachment>,
}

#[derive(Clone, Copy)]
struct Block<'a> {
    bytes: &'a [u8],
    offset: usize,
    length: usize,
    link_count: usize,
    data_offset: usize,
}

impl Block<'_> {
    fn id(&self) -> &[u8] {
        &self.bytes[self.offset..self.offset + 4]
    }

    fn link(&self, index: usize) -> Result<u64, Mf4Error> {
        if index >= self.link_count {
            return Err(Mf4Error::InvalidBlock("link"));
        }
        read_u64(self.bytes, self.offset + COMMON_HEADER_SIZE + index * 8)
    }

    fn data(&self) -> &[u8] {
        &self.bytes[self.data_offset..self.offset + self.length]
    }
}

pub(super) fn parse_index(bytes: &[u8]) -> Result<FileIndex, Mf4Error> {
    let signature = bytes.get(..8);
    if signature == Some(b"UnFinMF ") {
        return Err(Mf4Error::UnsupportedUnfinalized);
    }
    if bytes.len() < 64 + COMMON_HEADER_SIZE || signature != Some(b"MDF     ") {
        return Err(Mf4Error::InvalidHeader);
    }
    let version = std::str::from_utf8(bytes.get(8..16).ok_or(Mf4Error::InvalidHeader)?)
        .unwrap_or("")
        .trim_matches([' ', '\0']);
    if !version.starts_with('4') {
        return Err(Mf4Error::UnsupportedVersion(version.to_owned()));
    }

    let header = read_block(bytes, 64)?;
    if header.id() != b"##HD" || header.link_count < 6 {
        return Err(Mf4Error::InvalidHeader);
    }
    let start_ns = read_u64(header.data(), 0)?;
    let measurement_start_ms = (start_ns != 0)
        .then(|| i64::try_from(start_ns / 1_000_000).ok())
        .flatten();

    Ok(FileIndex {
        measurement_start_ms,
        data_groups: parse_data_groups(bytes, header.link(0)?)?,
        attachments: parse_attachments(bytes, header.link(3)?)?,
    })
}

fn parse_data_groups(bytes: &[u8], first_address: u64) -> Result<Vec<DataGroup>, Mf4Error> {
    let mut output = Vec::new();
    let mut address = first_address;
    let mut seen = BTreeSet::new();
    while address != 0 {
        if !seen.insert(address) {
            return Err(Mf4Error::LinkCycle);
        }
        let block = read_block(bytes, address)?;
        if block.id() != b"##DG" || block.link_count < 4 || block.data().is_empty() {
            return Err(Mf4Error::InvalidBlock("data group"));
        }
        let mut groups = Vec::new();
        let mut group_address = block.link(1)?;
        let mut group_seen = BTreeSet::new();
        while group_address != 0 {
            if !group_seen.insert(group_address) {
                return Err(Mf4Error::LinkCycle);
            }
            let group_block = read_block(bytes, group_address)?;
            groups.push(parse_channel_group(bytes, group_block, groups.len())?);
            group_address = group_block.link(0)?;
        }
        output.push(DataGroup {
            data_address: block.link(2)?,
            record_id_size: block.data()[0],
            groups,
        });
        address = block.link(0)?;
    }
    Ok(output)
}

fn parse_channel_group(
    bytes: &[u8],
    block: Block<'_>,
    fallback_index: usize,
) -> Result<ChannelGroup, Mf4Error> {
    if block.id() != b"##CG" || block.link_count < 6 || block.data().len() < 32 {
        return Err(Mf4Error::InvalidBlock("channel group"));
    }
    let name = read_text(bytes, block.link(2)?)?
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| format!("Group {}", fallback_index + 1));
    let is_can_bus = is_can_source(bytes, block.link(3)?)?;
    let data = block.data();
    let mut channels = Vec::new();
    let mut seen = BTreeSet::new();
    parse_channel_chain(bytes, block.link(1)?, &mut seen, &mut channels)?;

    Ok(ChannelGroup {
        name,
        record_id: read_u64(data, 0)?,
        cycles: usize::try_from(read_u64(data, 8)?)
            .map_err(|_| Mf4Error::InvalidBlock("channel group"))?,
        flags: read_u16(data, 16)?,
        sample_size: usize::try_from(read_u32(data, 24)?)
            .map_err(|_| Mf4Error::InvalidBlock("channel group"))?,
        invalidation_size: usize::try_from(read_u32(data, 28)?)
            .map_err(|_| Mf4Error::InvalidBlock("channel group"))?,
        is_can_bus,
        channels,
    })
}

fn parse_channel_chain(
    bytes: &[u8],
    mut address: u64,
    seen: &mut BTreeSet<u64>,
    output: &mut Vec<Channel>,
) -> Result<(), Mf4Error> {
    while address != 0 {
        if !seen.insert(address) {
            return Err(Mf4Error::LinkCycle);
        }
        let block = read_block(bytes, address)?;
        if block.id() != b"##CN" || block.link_count < 8 || block.data().len() < 24 {
            return Err(Mf4Error::InvalidBlock("channel"));
        }
        output.push(parse_channel(bytes, address, block)?);
        let component = block.link(1)?;
        if component != 0 && read_block(bytes, component)?.id() == b"##CN" {
            parse_channel_chain(bytes, component, seen, output)?;
        }
        address = block.link(0)?;
    }
    Ok(())
}

fn parse_channel(bytes: &[u8], address: u64, block: Block<'_>) -> Result<Channel, Mf4Error> {
    let data = block.data();
    let conversion_address = block.link(4)?;
    let (conversion, conversion_unit) = parse_conversion(bytes, conversion_address)?;
    let unit = read_text(bytes, block.link(6)?)?
        .filter(|unit| !unit.is_empty())
        .or(conversion_unit)
        .unwrap_or_default();
    Ok(Channel {
        address,
        name: read_text(bytes, block.link(2)?)?.unwrap_or_default(),
        channel_type: data[0],
        sync_type: data[1],
        data_type: data[2],
        bit_offset: data[3],
        byte_offset: read_u32(data, 4)?,
        bit_count: read_u32(data, 8)?,
        flags: read_u32(data, 12)?,
        invalidation_bit: read_u32(data, 16)?,
        conversion,
        unit,
    })
}

fn parse_conversion(bytes: &[u8], address: u64) -> Result<(Conversion, Option<String>), Mf4Error> {
    if address == 0 {
        return Ok((Conversion::default(), None));
    }
    let block = read_block(bytes, address)?;
    if block.id() != b"##CC" || block.link_count < 4 || block.data().len() < 8 {
        return Err(Mf4Error::InvalidBlock("conversion"));
    }
    let data = block.data();
    let value_count = usize::from(read_u16(data, 6)?);
    let has_ranges = data.len() >= 8 + 16 + value_count * 8;
    let values_offset = 8 + usize::from(has_ranges) * 16;
    let mut values = Vec::with_capacity(value_count);
    for index in 0..value_count {
        values.push(f64::from_bits(read_u64(data, values_offset + index * 8)?));
    }
    Ok((
        Conversion {
            kind: data[0],
            values,
        },
        read_text(bytes, block.link(1)?)?,
    ))
}

fn parse_attachments(bytes: &[u8], first_address: u64) -> Result<Vec<Attachment>, Mf4Error> {
    let mut output = Vec::new();
    let mut address = first_address;
    let mut seen = BTreeSet::new();
    while address != 0 {
        if !seen.insert(address) {
            return Err(Mf4Error::LinkCycle);
        }
        let block = read_block(bytes, address)?;
        if block.id() != b"##AT" || block.link_count < 4 || block.data().len() < 40 {
            return Err(Mf4Error::InvalidBlock("attachment"));
        }
        let name = read_text(bytes, block.link(1)?)?.unwrap_or_default();
        let mime = read_text(bytes, block.link(2)?)?.unwrap_or_default();
        let data = block.data();
        let flags = read_u16(data, 0)?;
        let original_size = usize::try_from(read_u64(data, 24)?)
            .map_err(|_| Mf4Error::InvalidBlock("attachment"))?;
        let embedded_size = usize::try_from(read_u64(data, 32)?)
            .map_err(|_| Mf4Error::InvalidBlock("attachment"))?;
        let embedded = data.get(40..40usize.saturating_add(embedded_size));
        let is_embedded = flags & 1 != 0;
        let should_materialize =
            should_materialize_attachment(&name, &mime, is_embedded, original_size);
        let attachment_data = if !should_materialize {
            None
        } else if flags & 2 != 0 {
            let compressed = embedded.ok_or(Mf4Error::Truncated("attachment"))?;
            Some(inflate_zlib(compressed, original_size)?)
        } else {
            let value = embedded.ok_or(Mf4Error::Truncated("attachment"))?;
            if value.len() != original_size {
                return Err(Mf4Error::InvalidBlock("attachment"));
            }
            Some(value.to_vec())
        };
        output.push(Attachment {
            name,
            mime,
            is_embedded,
            original_size,
            data: attachment_data,
        });
        address = block.link(0)?;
    }
    Ok(output)
}

pub(super) fn collect_data(bytes: &[u8], address: u64) -> Result<Vec<u8>, Mf4Error> {
    let mut output = Vec::new();
    let mut seen = BTreeSet::new();
    collect_data_at(bytes, address, &mut seen, &mut output)?;
    Ok(output)
}

fn collect_data_at(
    bytes: &[u8],
    address: u64,
    seen: &mut BTreeSet<u64>,
    output: &mut Vec<u8>,
) -> Result<(), Mf4Error> {
    if address == 0 {
        return Ok(());
    }
    if !seen.insert(address) {
        return Err(Mf4Error::LinkCycle);
    }
    let block = read_block(bytes, address)?;
    match block.id() {
        b"##DT" | b"##DV" => output.extend_from_slice(block.data()),
        b"##DZ" => {
            let data = block.data();
            if data.len() < 24 {
                return Err(Mf4Error::InvalidBlock("compressed data"));
            }
            let method = data[2];
            let row_size = usize::try_from(read_u32(data, 4)?)
                .map_err(|_| Mf4Error::InvalidBlock("compressed data"))?;
            let original_size = usize::try_from(read_u64(data, 8)?)
                .map_err(|_| Mf4Error::DecompressedBlockTooLarge)?;
            let compressed_size = usize::try_from(read_u64(data, 16)?)
                .map_err(|_| Mf4Error::InvalidBlock("compressed data"))?;
            if original_size > MAX_DECOMPRESSED_BYTES {
                return Err(Mf4Error::DecompressedBlockTooLarge);
            }
            let compressed = data
                .get(24..24usize.saturating_add(compressed_size))
                .ok_or(Mf4Error::Truncated("compressed data"))?;
            let inflated = inflate_zlib(compressed, original_size)?;
            match method {
                0 => output.extend_from_slice(&inflated),
                1 if row_size != 0 => output.extend_from_slice(&untranspose(inflated, row_size)?),
                method => return Err(Mf4Error::UnsupportedCompression(method)),
            }
        }
        b"##DL" => {
            for index in 1..block.link_count {
                let fragment = block.link(index)?;
                if fragment != 0 {
                    collect_data_at(bytes, fragment, seen, output)?;
                }
            }
            let next = block.link(0)?;
            if next != 0 {
                collect_data_at(bytes, next, seen, output)?;
            }
        }
        b"##HL" => {
            let next = (0..block.link_count)
                .find_map(|index| block.link(index).ok().filter(|address| *address != 0))
                .or_else(|| {
                    read_u64(block.data(), 0)
                        .ok()
                        .filter(|address| *address != 0)
                })
                .ok_or(Mf4Error::InvalidBlock("header list"))?;
            collect_data_at(bytes, next, seen, output)?;
        }
        other => {
            return Err(Mf4Error::UnsupportedDataBlock(
                String::from_utf8_lossy(other).into_owned(),
            ));
        }
    }
    Ok(())
}

fn untranspose(data: Vec<u8>, row_size: usize) -> Result<Vec<u8>, Mf4Error> {
    if row_size == 0 {
        return Err(Mf4Error::InvalidCompressedData);
    }
    let mut output = vec![0; data.len()];
    let matrix_size = data.len() - data.len() % row_size;
    let row_count = matrix_size / row_size;
    for column in 0..row_size {
        for row in 0..row_count {
            output[row * row_size + column] = data[column * row_count + row];
        }
    }
    output[matrix_size..].copy_from_slice(&data[matrix_size..]);
    Ok(output)
}

fn is_can_source(bytes: &[u8], address: u64) -> Result<bool, Mf4Error> {
    if address == 0 {
        return Ok(false);
    }
    let block = read_block(bytes, address)?;
    Ok(block.id() == b"##SI"
        && block.data().len() >= 2
        && block.data()[0] == 2
        && block.data()[1] == 2)
}

fn read_text(bytes: &[u8], address: u64) -> Result<Option<String>, Mf4Error> {
    if address == 0 {
        return Ok(None);
    }
    let block = read_block(bytes, address)?;
    if block.id() != b"##TX" && block.id() != b"##MD" {
        return Ok(None);
    }
    let text = block.data();
    let end = text
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(text.len());
    Ok(Some(String::from_utf8_lossy(&text[..end]).into_owned()))
}

fn read_block(bytes: &[u8], address: u64) -> Result<Block<'_>, Mf4Error> {
    let offset = usize::try_from(address).map_err(|_| Mf4Error::Truncated("block"))?;
    let header = bytes
        .get(offset..offset.saturating_add(COMMON_HEADER_SIZE))
        .ok_or(Mf4Error::Truncated("block"))?;
    let length =
        usize::try_from(read_u64(header, 8)?).map_err(|_| Mf4Error::InvalidBlock("length"))?;
    let link_count =
        usize::try_from(read_u64(header, 16)?).map_err(|_| Mf4Error::InvalidBlock("link count"))?;
    let link_bytes = link_count
        .checked_mul(8)
        .ok_or(Mf4Error::InvalidBlock("link count"))?;
    let data_offset = offset
        .checked_add(COMMON_HEADER_SIZE)
        .and_then(|value| value.checked_add(link_bytes))
        .ok_or(Mf4Error::InvalidBlock("length"))?;
    let end = offset
        .checked_add(length)
        .ok_or(Mf4Error::InvalidBlock("length"))?;
    if length < COMMON_HEADER_SIZE || data_offset > end || end > bytes.len() {
        return Err(Mf4Error::InvalidBlock("length"));
    }
    Ok(Block {
        bytes,
        offset,
        length,
        link_count,
        data_offset,
    })
}

fn read_u16(bytes: &[u8], offset: usize) -> Result<u16, Mf4Error> {
    let value = bytes
        .get(offset..offset.saturating_add(2))
        .ok_or(Mf4Error::Truncated("integer"))?;
    Ok(u16::from_le_bytes([value[0], value[1]]))
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, Mf4Error> {
    let value = bytes
        .get(offset..offset.saturating_add(4))
        .ok_or(Mf4Error::Truncated("integer"))?;
    Ok(u32::from_le_bytes(
        value.try_into().expect("four-byte slice"),
    ))
}

fn read_u64(bytes: &[u8], offset: usize) -> Result<u64, Mf4Error> {
    let value = bytes
        .get(offset..offset.saturating_add(8))
        .ok_or(Mf4Error::Truncated("integer"))?;
    Ok(u64::from_le_bytes(
        value.try_into().expect("eight-byte slice"),
    ))
}

fn lookup_table(values: &[f64], raw: f64) -> Option<f64> {
    values
        .chunks_exact(2)
        .min_by(|left, right| (left[0] - raw).abs().total_cmp(&(right[0] - raw).abs()))
        .map(|pair| pair[1])
}

fn interpolate_table(values: &[f64], raw: f64) -> Option<f64> {
    let pairs: Vec<_> = values.chunks_exact(2).collect();
    let first = pairs.first()?;
    if raw <= first[0] {
        return Some(first[1]);
    }
    for window in pairs.windows(2) {
        let (left, right) = (window[0], window[1]);
        if raw <= right[0] {
            let span = right[0] - left[0];
            return (span.abs() > f64::EPSILON)
                .then_some(left[1] + (raw - left[0]) / span * (right[1] - left[1]));
        }
    }
    pairs.last().map(|pair| pair[1])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn materializes_only_embedded_dbcs_within_the_dbc_limit() {
        assert!(should_materialize_attachment(
            "network.dbc",
            "application/octet-stream",
            true,
            MAX_EMBEDDED_DBC_BYTES,
        ));
        assert!(!should_materialize_attachment(
            "photo.bin",
            "application/octet-stream",
            true,
            8,
        ));
        assert!(!should_materialize_attachment(
            "network.dbc",
            "application/x-dbc",
            true,
            MAX_EMBEDDED_DBC_BYTES + 1,
        ));
        assert!(!should_materialize_attachment(
            "network.dbc",
            "application/x-dbc",
            false,
            8,
        ));
    }
}
