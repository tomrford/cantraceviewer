import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	createDirectClient,
	type DbcHandle,
	type DirectClient,
	type ParsedDbc,
	type TraceHandle
} from '@cantraceviewer/core/direct';

const fixturesDir = resolve('wasm/tests/fixtures');
const identity = { canId: 288, isExtended: false, sizeBytes: 8 };
let client: DirectClient;
let wasmBytes: Uint8Array<ArrayBuffer>;

beforeAll(async () => {
	wasmBytes = new Uint8Array(
		await readFile(resolve('packages/core/src/wasm-bindgen/cantraceviewer_bg.wasm'))
	);
	client = await createDirectClient(wasmBytes);
});

afterAll(async () => {
	await client.close();
});

describe('@cantraceviewer/core/direct', () => {
	it('preserves DBC, ASC, metadata, and decode behavior across the package boundary', async () => {
		const { handle: dbc, catalog } = await openFixtureDbc();
		const trace = await openFixtureTrace();
		try {
			expect(catalog.messages.find((message) => message.name === 'PowertrainStatus')).toMatchObject(
				{
					canId: 288,
					isExtended: false,
					sizeBytes: 8
				}
			);
			expect(trace.metadata).toEqual({
				measurementStartMs: 1777550400000,
				validMessageCount: 1506,
				skippedLineCount: 0,
				durationNs: 25_050_000_000
			});

			const speed = await client.getSignalValues(dbc, trace, identity, 'vehicle_speed');
			expect(Array.from(speed.timesMs).slice(0, 3)).toEqual([10, 110, 210]);
			expect(Array.from(speed.values).slice(0, 3)).toEqual([100, 123.4, 150]);
			expect(speed.timesMs.length).toBe(251);
			expect(speed.timesMs.buffer).toBe(speed.values.buffer);

			// The worker transport depends on one exactly-sized transferable decode buffer.
			const seriesBuffer = speed.timesMs.buffer as ArrayBuffer;
			expect(seriesBuffer.byteLength).toBe(speed.timesMs.byteLength + speed.values.byteLength);
			structuredClone(seriesBuffer, { transfer: [seriesBuffer] });
			expect(seriesBuffer.byteLength).toBe(0);
		} finally {
			await client.closeTrace(trace);
			await client.closeDbc(dbc);
		}
	});

	it('parses and decodes a PCAN TRC trace', async () => {
		const { handle: dbc } = await openFixtureDbc();
		const trace = await client.openTrace(
			'trc',
			new TextEncoder().encode(
				[
					';$FILEVERSION=2.1',
					';$COLUMNS=N,O,T,B,I,d,R,L,D',
					'1 10.000 DT 1 0120 Rx - 8 E8 03 00 00 00 78 00 00',
					'2 20.000 DT 1 0120 Rx - 8 D2 04 00 00 00 82 00 00'
				].join('\n')
			)
		);
		try {
			expect(trace.metadata).toMatchObject({
				validMessageCount: 2,
				skippedLineCount: 0,
				durationNs: 20_000_000
			});
			const speed = await client.getSignalValues(dbc, trace, identity, 'vehicle_speed');
			expect(Array.from(speed.timesMs)).toEqual([10, 20]);
			expect(Array.from(speed.values)).toEqual([100, 123.4]);
		} finally {
			await client.closeTrace(trace);
			await client.closeDbc(dbc);
		}
	});

	it('opens uncompressed and dynamically compressed BLF traces', async () => {
		const { handle: dbc } = await openFixtureDbc();
		const trace = await client.openTrace('blf', generatedBlfTrace());
		const compressed = await client.openTrace('blf', generatedCompressedBlfTrace());
		try {
			expect(trace.metadata).toEqual({
				measurementStartMs: 1778494830400,
				validMessageCount: 2,
				skippedLineCount: 0,
				durationNs: 20_000_000
			});
			const speed = await client.getSignalValues(dbc, trace, identity, 'vehicle_speed');
			expect(Array.from(speed.timesMs)).toEqual([10, 20]);
			expect(Array.from(speed.values)).toEqual([100, 123.4]);
			expect(compressed.metadata).toMatchObject({
				validMessageCount: 257,
				skippedLineCount: 0,
				durationNs: 257_000_000
			});
		} finally {
			await client.closeTrace(compressed);
			await client.closeTrace(trace);
			await client.closeDbc(dbc);
		}
	});

	it('opens decoded MF4 channels and reads a native series', async () => {
		const trace = await openMf4Fixture('decoded-channels.mf4');
		try {
			expect(trace.hasRawFrames).toBe(false);
			expect(trace.metadata).toMatchObject({ validMessageCount: 0, durationNs: 300_000_000 });
			expect(trace.mf4Catalog?.groups).toMatchObject([
				{
					name: 'Decoded powertrain',
					signals: [
						{ id: 0, name: 'VehicleSpeed', unit: 'km/h' },
						{ id: 1, name: 'EngineSpeed', unit: 'rpm' }
					]
				}
			]);

			const speed = await client.getMf4SignalValues(trace, 0);
			expect(Array.from(speed.timesMs)).toEqual([100, 200, 300]);
			expect(Array.from(speed.values)).toEqual([12.5, 25, 37.5]);
		} finally {
			await client.closeTrace(trace);
		}
	});

	it('keeps raw, native, and embedded DBC sources in one hybrid MF4 handle', async () => {
		const trace = await openMf4Fixture('hybrid-embedded-dbc.mf4');
		let dbc: DbcHandle | null = null;
		try {
			expect(trace.hasRawFrames).toBe(true);
			expect(trace.metadata.validMessageCount).toBe(2);
			expect(trace.mf4Catalog?.groups[0]?.signals).toHaveLength(2);
			expect(trace.embeddedDbcs).toHaveLength(1);
			expect(trace.embeddedDbcs[0]).toMatchObject({ name: 'sample.dbc' });

			const openedDbc = await client.openDbc(trace.embeddedDbcs[0]!.text);
			dbc = openedDbc.handle;
			const rawMessage = openedDbc.catalog.messages.find(
				(message) => message.name === 'WebData_2000'
			);
			expect(rawMessage).toMatchObject({ canId: 0x123, isExtended: false, sizeBytes: 4 });

			const raw = await client.getSignalValues(
				dbc,
				trace,
				{
					canId: rawMessage!.canId,
					isExtended: rawMessage!.isExtended,
					sizeBytes: rawMessage!.sizeBytes
				},
				'Signal_8'
			);
			expect(Array.from(raw.values)).toEqual([4]);
			expect(Array.from((await client.getMf4SignalValues(trace, 1)).values)).toEqual([
				900, 1200, 1500
			]);
		} finally {
			if (dbc) await client.closeDbc(dbc);
			await client.closeTrace(trace);
		}
	});

	it('preserves parse and decode errors without poisoning later requests', async () => {
		const { handle: dbc } = await openFixtureDbc();
		const trace = await openFixtureTrace();
		try {
			await expect(client.openDbc('BO_ broken')).rejects.toThrow('invalid DBC message record');
			await expect(
				client.openTrace('asc', new TextEncoder().encode('base nope timestamps absolute'))
			).rejects.toThrow('invalid ASC base declaration');
			const invalidBlf = new Uint8Array(144);
			invalidBlf.set(new TextEncoder().encode('NOPE'));
			await expect(client.openTrace('blf', invalidBlf)).rejects.toThrow(
				'invalid BLF file signature'
			);
			await expect(client.getSignalValues(dbc, trace, identity, 'missing')).rejects.toThrow(
				'Signal not found in DBC'
			);

			const speed = await client.getSignalValues(dbc, trace, identity, 'vehicle_speed');
			expect(speed.timesMs.length).toBe(251);
		} finally {
			await client.closeTrace(trace);
			await client.closeDbc(dbc);
		}
	});

	it('preserves non-UTF-8 timing and reports skipped malformed lines', async () => {
		const prefix = new TextEncoder().encode(
			'base hex timestamps relative\n0.100 1 123 Rx d 1 aa\n0.200 unknown '
		);
		const suffix = new TextEncoder().encode(' event\n0.300 1 123 Rx d 1 bb');
		const nonUtfTrace = await client.openTrace(
			'asc',
			concatBytes(prefix, new Uint8Array([0xff]), suffix)
		);
		const skippedTrace = await client.openTrace(
			'asc',
			new TextEncoder().encode(
				[
					'base hex timestamps absolute',
					'0.001 1 123 Rx d 1 aa',
					'0.0015 1 123 Rx d 2 aa',
					'0.002 1 123 Rx d 1 bb'
				].join('\n')
			)
		);
		try {
			expect(nonUtfTrace.metadata).toMatchObject({
				validMessageCount: 2,
				skippedLineCount: 0,
				durationNs: 600_000_000
			});
			expect(skippedTrace.metadata).toMatchObject({
				validMessageCount: 2,
				skippedLineCount: 1
			});
		} finally {
			await client.closeTrace(skippedTrace);
			await client.closeTrace(nonUtfTrace);
		}
	});

	it('enforces direct-client ownership and idempotent spread-safe handle closure', async () => {
		const otherClient = await createDirectClient(wasmBytes);
		const { handle: dbc } = await openFixtureDbc();
		const trace = await openFixtureTrace();
		try {
			await expect(otherClient.closeTrace(trace)).rejects.toThrow(
				'trace handle does not belong to this client'
			);

			const spreadTrace = { ...trace };
			await client.closeTrace(spreadTrace);
			await client.closeTrace(trace);
			await expect(client.getSignalValues(dbc, trace, identity, 'vehicle_speed')).rejects.toThrow(
				'trace handle is closed'
			);
			await client.closeDbc(dbc);
			await client.closeDbc(dbc);
		} finally {
			await client.closeTrace(trace);
			await client.closeDbc(dbc);
			await otherClient.close();
		}
	});
});

async function openFixtureDbc(): Promise<{ handle: DbcHandle; catalog: ParsedDbc }> {
	return client.openDbc(await readFile(resolve(fixturesDir, 'agentic-demo.dbc'), 'utf8'));
}

async function openFixtureTrace(): Promise<TraceHandle> {
	return client.openTrace(
		'asc',
		new Uint8Array(await readFile(resolve(fixturesDir, 'agentic-demo.asc')))
	);
}

async function openMf4Fixture(name: string): Promise<TraceHandle> {
	return client.openTrace('mf4', new Uint8Array(await readFile(resolve(fixturesDir, 'mf4', name))));
}

function generatedBlfTrace(): Uint8Array {
	const inner = concatBytes(
		blfCanMessage(10_000_000, 0x120, [0xe8, 0x03, 0, 0, 0, 120, 0, 0]),
		blfCanMessage(20_000_000, 0x120, [0xd2, 0x04, 0, 0, 0, 130, 0, 0])
	);
	return concatBytes(blfFileHeader(), blfContainer(inner));
}

function generatedCompressedBlfTrace(): Uint8Array {
	const frames = Array.from({ length: 257 }, (_, index) => {
		const rawSpeed = index % 2500;
		return blfCanMessage((index + 1) * 1_000_000, 0x120, [
			rawSpeed & 0xff,
			rawSpeed >>> 8,
			index & 0xff,
			index >>> 8,
			0,
			120,
			0,
			0
		]);
	});
	const inner = concatBytes(...frames);
	return concatBytes(blfFileHeader(), blfContainer(inner, true));
}

function blfFileHeader(): Uint8Array {
	const bytes = new Uint8Array(144);
	const view = new DataView(bytes.buffer);
	bytes.set(new TextEncoder().encode('LOGG'), 0);
	view.setUint32(4, 144, true);
	writeSystemTime(view, 40, 2026, 5, 11, 10, 20, 30, 400);
	return bytes;
}

function blfContainer(payload: Uint8Array, compressed = false): Uint8Array {
	const containerPayload = compressed ? deflateSync(payload) : payload;
	if (compressed && ((containerPayload[2] >> 1) & 0x03) !== 2) {
		throw new Error('Expected the BLF fixture to use dynamic Huffman compression');
	}
	const objectSize = 16 + 16 + containerPayload.byteLength;
	const bytes = new Uint8Array(objectSize + paddingSize(objectSize));
	const view = new DataView(bytes.buffer);
	writeObjectBase(bytes, view, 0, 16, objectSize, 10);
	view.setUint16(16, compressed ? 2 : 0, true);
	view.setUint32(24, payload.byteLength, true);
	bytes.set(containerPayload, 32);
	return bytes;
}

function blfCanMessage(timestampNs: number, canId: number, payload: number[]): Uint8Array {
	const objectSize = 16 + 16 + 16;
	const bytes = new Uint8Array(objectSize);
	const view = new DataView(bytes.buffer);
	writeObjectBase(bytes, view, 0, 32, objectSize, 1);
	view.setUint32(16, 2, true);
	view.setBigUint64(24, BigInt(timestampNs), true);
	view.setUint16(32, 1, true);
	view.setUint8(35, payload.length);
	view.setUint32(36, canId, true);
	bytes.set(payload, 40);
	return bytes;
}

function writeObjectBase(
	bytes: Uint8Array,
	view: DataView,
	offset: number,
	headerSize: number,
	objectSize: number,
	objectType: number
): void {
	bytes.set(new TextEncoder().encode('LOBJ'), offset);
	view.setUint16(offset + 4, headerSize, true);
	view.setUint16(offset + 6, 1, true);
	view.setUint32(offset + 8, objectSize, true);
	view.setUint32(offset + 12, objectType, true);
}

function writeSystemTime(
	view: DataView,
	offset: number,
	year: number,
	month: number,
	day: number,
	hour: number,
	minute: number,
	second: number,
	millisecond: number
): void {
	const values = [year, month, 0, day, hour, minute, second, millisecond];
	for (const [index, value] of values.entries()) {
		view.setUint16(offset + index * 2, value, true);
	}
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
	const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		bytes.set(part, offset);
		offset += part.byteLength;
	}
	return bytes;
}

function paddingSize(size: number): number {
	return size % 4;
}
