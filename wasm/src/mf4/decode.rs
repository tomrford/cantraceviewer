use crate::trace::{CanId, Frame, FrameKind, Trace, fd_payload_length_from_dlc};

use super::Mf4Error;
use super::block::{Channel, ChannelGroup, DataGroup, FileIndex, collect_data};

#[derive(Clone, Debug)]
pub(super) struct NativeSignal {
    pub(super) id: u32,
    pub(super) data_group_index: usize,
    pub(super) group_index: usize,
    pub(super) channel_address: u64,
    pub(super) group_name: String,
    pub(super) name: String,
    pub(super) unit: String,
}

pub(super) fn native_signals(index: &FileIndex) -> Vec<NativeSignal> {
    let mut signals = Vec::new();
    for (data_group_index, data_group) in index.data_groups.iter().enumerate() {
        for (group_index, group) in data_group.groups.iter().enumerate() {
            if raw_plan(group).is_some() || master_channel(group).is_none() {
                continue;
            }
            for channel in &group.channels {
                if channel.channel_type != 0 || !channel.is_numeric() || channel.name.is_empty() {
                    continue;
                }
                let Ok(id) = u32::try_from(signals.len()) else {
                    break;
                };
                signals.push(NativeSignal {
                    id,
                    data_group_index,
                    group_index,
                    channel_address: channel.address,
                    group_name: group.name.clone(),
                    name: channel.name.clone(),
                    unit: channel.unit.clone(),
                });
            }
        }
    }
    signals
}

pub(super) fn parse_raw_trace(bytes: &[u8], index: &FileIndex) -> Result<Trace, Mf4Error> {
    let mut trace = Trace {
        measurement_start_ms: index.measurement_start_ms,
        ..Trace::default()
    };

    for data_group in &index.data_groups {
        let plans: Vec<_> = data_group.groups.iter().map(raw_plan).collect();
        if plans.iter().all(Option::is_none) {
            continue;
        }
        let data = collect_data(bytes, data_group.data_address)?;
        walk_records(data_group, &data, |group_index, record| {
            let Some(plan) = plans[group_index].as_ref() else {
                return Ok(());
            };
            append_raw_frame(&mut trace, &data_group.groups[group_index], plan, record)
        })?;
    }

    Ok(trace)
}

pub(super) fn decode_native_signal(
    bytes: &[u8],
    index: &FileIndex,
    signals: &[NativeSignal],
    signal_id: u32,
    time_offset_seconds: f64,
) -> Result<Vec<f64>, Mf4Error> {
    let signal = signals
        .iter()
        .find(|signal| signal.id == signal_id)
        .ok_or(Mf4Error::SignalNotFound)?;
    let data_group = index
        .data_groups
        .get(signal.data_group_index)
        .ok_or(Mf4Error::SignalNotFound)?;
    let group = data_group
        .groups
        .get(signal.group_index)
        .ok_or(Mf4Error::SignalNotFound)?;
    let channel = group
        .channels
        .iter()
        .find(|channel| channel.address == signal.channel_address)
        .ok_or(Mf4Error::SignalNotFound)?;
    let master = master_channel(group).ok_or(Mf4Error::SignalNotFound)?;
    let data = collect_data(bytes, data_group.data_address)?;
    let mut times = Vec::new();
    let mut values = Vec::new();
    walk_records(data_group, &data, |group_index, record| {
        if group_index != signal.group_index
            || !channel_is_valid(record, group, master)
            || !channel_is_valid(record, group, channel)
        {
            return Ok(());
        }
        let time_seconds = decode_physical(record, master)? - time_offset_seconds;
        let value = decode_physical(record, channel)?;
        if time_seconds.is_finite() && value.is_finite() {
            times.push(time_seconds * 1_000.0);
            values.push(value);
        }
        Ok(())
    })?;
    times.extend(values);
    Ok(times)
}

pub(super) fn native_time_range(
    bytes: &[u8],
    index: &FileIndex,
) -> Result<Option<(f64, f64)>, Mf4Error> {
    let mut range: Option<(f64, f64)> = None;
    for data_group in &index.data_groups {
        if data_group.groups.iter().all(|group| {
            raw_plan(group).is_some()
                || master_channel(group).is_none()
                || !group
                    .channels
                    .iter()
                    .any(|channel| channel.channel_type == 0 && channel.is_numeric())
        }) {
            continue;
        }
        let data = collect_data(bytes, data_group.data_address)?;
        walk_records(data_group, &data, |group_index, record| {
            let group = &data_group.groups[group_index];
            if raw_plan(group).is_some() {
                return Ok(());
            }
            let Some(master) = master_channel(group) else {
                return Ok(());
            };
            if !channel_is_valid(record, group, master) {
                return Ok(());
            }
            let timestamp = decode_physical(record, master)?;
            if timestamp.is_finite() && timestamp >= 0.0 {
                range = Some(range.map_or((timestamp, timestamp), |(minimum, maximum)| {
                    (minimum.min(timestamp), maximum.max(timestamp))
                }));
            }
            Ok(())
        })?;
    }
    Ok(range)
}

pub(super) fn duration_ns(seconds: f64) -> Result<u64, Mf4Error> {
    seconds_to_ns(seconds)
}

type RecordVisitor<'a> = &'a mut dyn FnMut(usize, &[u8]) -> Result<(), Mf4Error>;

fn walk_records(
    data_group: &DataGroup,
    data: &[u8],
    mut visit: impl FnMut(usize, &[u8]) -> Result<(), Mf4Error>,
) -> Result<(), Mf4Error> {
    walk_records_dyn(data_group, data, &mut visit)
}

// Monomorphizing the record walk per visitor closure triples its code in the
// wasm bundle; a dynamic visitor keeps one copy.
fn walk_records_dyn(
    data_group: &DataGroup,
    data: &[u8],
    visit: RecordVisitor<'_>,
) -> Result<(), Mf4Error> {
    match data_group.record_id_size {
        0 => {
            if data_group.groups.len() != 1 {
                return Err(Mf4Error::InvalidRecord);
            }
            let group = &data_group.groups[0];
            let size = group.record_size().ok_or(Mf4Error::InvalidRecord)?;
            if size == 0 {
                return Ok(());
            }
            let available = data.len() / size;
            let count = group.cycles.min(available);
            if count < group.cycles {
                return Err(Mf4Error::InvalidRecord);
            }
            for record in data[..count * size].chunks_exact(size) {
                visit(0, record)?;
            }
        }
        id_size @ (1 | 2 | 4 | 8) => {
            let id_size = usize::from(id_size);
            let mut position = 0;
            while position < data.len() {
                let id_bytes = data
                    .get(position..position + id_size)
                    .ok_or(Mf4Error::InvalidRecord)?;
                let record_id = id_bytes
                    .iter()
                    .enumerate()
                    .fold(0u64, |value, (index, byte)| {
                        value | (u64::from(*byte) << (index * 8))
                    });
                position += id_size;
                let (group_index, group) = data_group
                    .groups
                    .iter()
                    .enumerate()
                    .find(|(_, group)| group.record_id == record_id)
                    .ok_or(Mf4Error::InvalidRecord)?;
                let size = group.record_size().ok_or(Mf4Error::InvalidRecord)?;
                let record = data
                    .get(position..position + size)
                    .ok_or(Mf4Error::InvalidRecord)?;
                visit(group_index, record)?;
                position += size;
            }
        }
        size => return Err(Mf4Error::UnsupportedRecordIdSize(size)),
    }
    Ok(())
}

#[derive(Clone)]
struct RawPlan {
    kind: FrameKind,
    time: Channel,
    id: Channel,
    ide: Option<Channel>,
    dlc: Channel,
    data_length: Option<Channel>,
    data_bytes: Option<Channel>,
    edl: Option<Channel>,
}

fn raw_plan(group: &ChannelGroup) -> Option<RawPlan> {
    if group.flags & 0x0002 == 0 && !group.is_can_bus {
        return None;
    }
    let kind = group
        .channels
        .iter()
        .find_map(|channel| match channel.name.as_str() {
            "CAN_DataFrame" => Some(FrameKind::Data),
            "CAN_RemoteFrame" => Some(FrameKind::Remote),
            "CAN_ErrorFrame" => Some(FrameKind::Error),
            _ => None,
        })?;
    let prefix = match kind {
        FrameKind::Data => "CAN_DataFrame.",
        FrameKind::Remote => "CAN_RemoteFrame.",
        FrameKind::Error => "CAN_ErrorFrame.",
        FrameKind::Unknown => return None,
    };
    let member = |name: &str| {
        group
            .channels
            .iter()
            .find(|channel| channel.name == format!("{prefix}{name}"))
            .cloned()
    };
    Some(RawPlan {
        kind,
        time: master_channel(group)?.clone(),
        id: member("ID")?,
        ide: member("IDE"),
        dlc: member("DLC")?,
        data_length: member("DataLength"),
        data_bytes: member("DataBytes"),
        edl: member("EDL"),
    })
}

fn append_raw_frame(
    trace: &mut Trace,
    group: &ChannelGroup,
    plan: &RawPlan,
    record: &[u8],
) -> Result<(), Mf4Error> {
    if !channel_is_valid(record, group, &plan.time) {
        return Ok(());
    }
    let timestamp_ns = seconds_to_ns(decode_physical(record, &plan.time)?)?;
    let raw_id = decode_raw(record, &plan.id)?;
    let id_value = u32::try_from(raw_id & 0x1fff_ffff).map_err(|_| Mf4Error::InvalidCanId)?;
    let is_extended = plan
        .ide
        .as_ref()
        .map(|channel| decode_raw(record, channel).map(|value| value != 0))
        .transpose()?
        .unwrap_or(id_value > 0x7ff);
    let id = if is_extended {
        CanId::extended(id_value)
    } else {
        CanId::standard(id_value)
    }
    .map_err(|_| Mf4Error::InvalidCanId)?;
    let dlc = decode_raw(record, &plan.dlc)?.min(u64::from(u8::MAX)) as u8;
    let data_length = if matches!(plan.kind, FrameKind::Data | FrameKind::Error) {
        plan.data_length
            .as_ref()
            .map(|channel| decode_raw(record, channel))
            .transpose()?
    } else {
        None
    };
    let explicit_edl = plan
        .edl
        .as_ref()
        .map(|channel| decode_raw(record, channel))
        .transpose()?;
    let mut frame = Frame {
        timestamp_ns,
        kind: plan.kind,
        id: Some(id),
        dlc,
        is_fd: frame_is_fd(plan.kind, explicit_edl, dlc, data_length),
        ..Frame::default()
    };

    if matches!(plan.kind, FrameKind::Data | FrameKind::Error) {
        let payload_len = payload_length(data_length, dlc, frame.is_fd)?;
        if payload_len > 0 {
            let channel = plan.data_bytes.as_ref().ok_or(Mf4Error::InvalidRecord)?;
            let payload = decode_bytes(record, channel, payload_len)?;
            frame.payload_offset = u32::try_from(trace.payloads.len())
                .map_err(|_| Mf4Error::PayloadStorageTooLarge)?;
            frame.payload_len = payload_len as u8;
            trace.payloads.extend_from_slice(payload);
        }
    }

    if plan.kind == FrameKind::Data {
        trace.data_frame_count += 1;
        trace.last_data_timestamp_ns = Some(
            trace
                .last_data_timestamp_ns
                .map_or(timestamp_ns, |previous| previous.max(timestamp_ns)),
        );
    }
    trace.frames.push(frame);
    Ok(())
}

fn frame_is_fd(
    kind: FrameKind,
    explicit_edl: Option<u64>,
    dlc: u8,
    data_length: Option<u64>,
) -> bool {
    explicit_edl.map_or_else(
        || kind == FrameKind::Data && (dlc > 8 || data_length.is_some_and(|length| length > 8)),
        |edl| edl != 0,
    )
}

fn payload_length(explicit: Option<u64>, dlc: u8, is_fd: bool) -> Result<usize, Mf4Error> {
    if let Some(length) = explicit {
        return Ok(length.min(64) as usize);
    }
    if is_fd {
        return fd_payload_length_from_dlc(dlc)
            .map(usize::from)
            .map_err(|_| Mf4Error::InvalidRecord);
    }
    Ok(usize::from(dlc.min(8)))
}

fn master_channel(group: &ChannelGroup) -> Option<&Channel> {
    group
        .channels
        .iter()
        .find(|channel| channel.channel_type == 2 && channel.sync_type == 1 && channel.is_numeric())
}

fn channel_is_valid(record: &[u8], group: &ChannelGroup, channel: &Channel) -> bool {
    if channel.flags & 0x01 != 0 {
        return false;
    }
    if channel.flags & 0x02 == 0 {
        return true;
    }
    let byte_index = group.sample_size + (channel.invalidation_bit >> 3) as usize;
    let bit_index = channel.invalidation_bit & 0x07;
    record
        .get(byte_index)
        .is_none_or(|byte| byte & (1 << bit_index) == 0)
}

fn decode_physical(record: &[u8], channel: &Channel) -> Result<f64, Mf4Error> {
    let raw = match channel.data_type {
        0 | 1 => decode_raw(record, channel)? as f64,
        2 | 3 => decode_signed(record, channel)? as f64,
        4 | 5 => decode_float(record, channel)?,
        _ => return Err(Mf4Error::UnsupportedChannel(channel.name.clone())),
    };
    channel
        .conversion
        .apply(raw)
        .ok_or_else(|| Mf4Error::UnsupportedChannel(channel.name.clone()))
}

fn decode_raw(record: &[u8], channel: &Channel) -> Result<u64, Mf4Error> {
    let bytes = numeric_bytes(record, channel)?;
    let raw = if matches!(channel.data_type, 0 | 2 | 4) {
        bytes
            .iter()
            .rev()
            .fold(0u64, |value, byte| (value << 8) | u64::from(*byte))
    } else {
        bytes
            .iter()
            .fold(0u64, |value, byte| (value << 8) | u64::from(*byte))
    };
    let shifted = raw >> channel.bit_offset;
    let mask = if channel.bit_count == 64 {
        u64::MAX
    } else {
        (1u64 << channel.bit_count) - 1
    };
    Ok(shifted & mask)
}

fn decode_signed(record: &[u8], channel: &Channel) -> Result<i64, Mf4Error> {
    let unsigned = decode_raw(record, channel)?;
    let sign = 1u64 << (channel.bit_count - 1);
    if unsigned & sign == 0 {
        return Ok(unsigned as i64);
    }
    let mask = if channel.bit_count == 64 {
        u64::MAX
    } else {
        (1u64 << channel.bit_count) - 1
    };
    Ok((unsigned as i64) | !(mask as i64))
}

fn decode_float(record: &[u8], channel: &Channel) -> Result<f64, Mf4Error> {
    let raw = decode_raw(record, channel)?;
    match channel.bit_count {
        32 => Ok(f32::from_bits(raw as u32) as f64),
        64 => Ok(f64::from_bits(raw)),
        _ => Err(Mf4Error::UnsupportedChannel(channel.name.clone())),
    }
}

fn numeric_bytes<'a>(record: &'a [u8], channel: &Channel) -> Result<&'a [u8], Mf4Error> {
    let size = (usize::from(channel.bit_offset) + channel.bit_count as usize).div_ceil(8);
    let start = channel.byte_offset as usize;
    record
        .get(start..start.saturating_add(size))
        .ok_or(Mf4Error::InvalidRecord)
}

fn decode_bytes<'a>(
    record: &'a [u8],
    channel: &Channel,
    length: usize,
) -> Result<&'a [u8], Mf4Error> {
    if channel.data_type != 10 || channel.bit_offset != 0 || length > channel.bit_count as usize / 8
    {
        return Err(Mf4Error::UnsupportedChannel(channel.name.clone()));
    }
    let start = channel.byte_offset as usize;
    record
        .get(start..start.saturating_add(length))
        .ok_or(Mf4Error::InvalidRecord)
}

fn seconds_to_ns(seconds: f64) -> Result<u64, Mf4Error> {
    if !seconds.is_finite() || seconds < 0.0 {
        return Err(Mf4Error::InvalidTimestamp);
    }
    let value = (seconds * 1_000_000_000.0).round();
    if value > u64::MAX as f64 {
        return Err(Mf4Error::InvalidTimestamp);
    }
    Ok(value as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn infers_can_fd_from_long_payloads_when_edl_is_absent() {
        assert!(frame_is_fd(FrameKind::Data, None, 9, None));
        assert_eq!(
            payload_length(None, 9, frame_is_fd(FrameKind::Data, None, 9, None)).unwrap(),
            12
        );
        assert!(frame_is_fd(FrameKind::Data, None, 8, Some(12)));
        assert!(!frame_is_fd(FrameKind::Data, None, 8, Some(8)));
        assert!(!frame_is_fd(FrameKind::Remote, None, 9, Some(12)));
    }

    #[test]
    fn treats_an_explicit_edl_as_authoritative() {
        assert!(!frame_is_fd(FrameKind::Data, Some(0), 9, Some(12)));
        assert!(frame_is_fd(FrameKind::Data, Some(1), 8, Some(8)));
    }

    #[test]
    fn derives_payload_length_from_dlc_when_data_length_is_absent() {
        assert_eq!(payload_length(None, 4, false).unwrap(), 4);
        assert_eq!(payload_length(None, 9, true).unwrap(), 12);
        assert_eq!(payload_length(Some(3), 8, false).unwrap(), 3);
        assert!(payload_length(None, 16, true).is_err());
    }
}
