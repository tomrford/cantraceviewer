import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import {
	closeDbc,
	closeTrace,
	getSignalValues,
	openDbc,
	openTrace,
	type DbcHandle,
	type ParsedDbc,
	type TraceHandle
} from '$lib/wasm.js';

const fixturesDir = resolve('wasm/tests/fixtures');
const wasmAssetPath = resolve('src/lib/wasm-bindgen/cantraceviewer_bg.wasm');

beforeAll(() => {
	globalThis.fetch = async (input: string | URL | Request) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		if (!url.includes('cantraceviewer_bg.wasm')) {
			throw new Error(`Unexpected fetch URL: ${url}`);
		}

		return new Response(await readFile(wasmAssetPath), {
			headers: { 'Content-Type': 'application/wasm' }
		});
	};
});

describe('WASM adapter integration', () => {
	it('parses a DBC and exports the typed catalog', async () => {
		const { handle, catalog } = await openFixtureDbc();
		try {
			const powertrain = catalog.messages.find((message) => message.name === 'PowertrainStatus');
			const vehicleSpeed = powertrain?.signals.find((signal) => signal.name === 'vehicle_speed');

			expect(catalog.messages).toHaveLength(6);
			expect(powertrain).toMatchObject({
				dbcId: 288,
				canId: 288,
				isExtended: false,
				isFd: false,
				sizeBytes: 8,
				transmitter: 'Agent'
			});
			expect(vehicleSpeed).toMatchObject({
				startBit: 0,
				bitLength: 16,
				endianness: 'intel',
				signedness: 'unsigned',
				factor: 0.1,
				offset: 0,
				unit: 'km/h',
				receivers: ['Dashboard']
			});
		} finally {
			await closeDbc(handle);
		}
	});

	it('parses an ASC trace and exports metadata', async () => {
		const trace = await openFixtureTrace();
		try {
			expect(trace.metadata).toEqual({
				measurementStartMs: 1777550400000,
				validMessageCount: 1506,
				skippedLineCount: 0,
				durationNs: 25_050_000_000
			});
		} finally {
			await closeTrace(trace);
		}
	});

	it('parses and decodes a PCAN TRC trace', async () => {
		const { handle: dbc } = await openFixtureDbc();
		const trace = await openTrace(
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
			const speed = await getSignalValues(
				dbc,
				trace,
				{ canId: 288, isExtended: false, sizeBytes: 8 },
				'vehicle_speed'
			);
			expect(Array.from(speed.timesMs)).toEqual([10, 20]);
			expect(Array.from(speed.values)).toEqual([100, 123.4]);
		} finally {
			await closeTrace(trace);
			await closeDbc(dbc);
		}
	});

	it('decodes selected signal values through the TypeScript boundary', async () => {
		const { handle: dbc } = await openFixtureDbc();
		const trace = await openFixtureTrace();
		try {
			const powertrainIdentity = {
				canId: 288,
				isExtended: false,
				sizeBytes: 8
			};
			const batteryIdentity = { canId: 512, isExtended: false, sizeBytes: 8 };
			const speed = await getSignalValues(dbc, trace, powertrainIdentity, 'vehicle_speed');
			const coolant = await getSignalValues(dbc, trace, powertrainIdentity, 'coolant_temp');
			const soc = await getSignalValues(dbc, trace, batteryIdentity, 'soc');

			expect(Array.from(speed.timesMs).slice(0, 3)).toEqual([10, 110, 210]);
			expect(Array.from(speed.values).slice(0, 3)).toEqual([100, 123.4, 150]);
			expect(Array.from(coolant.timesMs).slice(0, 3)).toEqual([10, 110, 210]);
			expect(Array.from(coolant.values).slice(0, 3)).toEqual([80, 90, 100]);
			expect(speed.timesMs.length).toBe(251);
			expect(soc.timesMs.length).toBe(251);
			expect(soc.values[0]).toBeCloseTo(82, 1);
		} finally {
			await closeTrace(trace);
			await closeDbc(dbc);
		}
	});

	it('keeps a started decode safe when the trace is closed', async () => {
		const { handle: dbc } = await openFixtureDbc();
		const trace = await openFixtureTrace();
		const powertrainIdentity = {
			canId: 288,
			isExtended: false,
			sizeBytes: 8
		};

		try {
			const decode = getSignalValues(dbc, trace, powertrainIdentity, 'vehicle_speed');
			await closeTrace(trace);

			try {
				const speed = await decode;
				expect(Array.from(speed.timesMs).slice(0, 3)).toEqual([10, 110, 210]);
				expect(Array.from(speed.values).slice(0, 3)).toEqual([100, 123.4, 150]);
			} catch (error) {
				expect(error).toBeInstanceOf(Error);
				expect((error as Error).message).toBe('trace handle is closed');
			}

			await closeTrace(trace);

			const unrelatedTrace = await openFixtureTrace();
			try {
				const speed = await getSignalValues(
					dbc,
					unrelatedTrace,
					powertrainIdentity,
					'vehicle_speed'
				);
				expect(speed.timesMs.length).toBe(251);
			} finally {
				await closeTrace(unrelatedTrace);
			}
		} finally {
			await closeDbc(dbc);
		}
	});

	it('rejects decode attempts on an already-closed handle', async () => {
		const { handle: dbc } = await openFixtureDbc();
		const trace = await openFixtureTrace();
		try {
			await closeTrace(trace);
			await expect(
				getSignalValues(
					dbc,
					trace,
					{ canId: 288, isExtended: false, sizeBytes: 8 },
					'vehicle_speed'
				)
			).rejects.toThrow('trace handle is closed');
		} finally {
			await closeTrace(trace);
			await closeDbc(dbc);
		}
	});

	it('opens a generated BLF trace through the TypeScript boundary', async () => {
		const { handle: dbc } = await openFixtureDbc();
		const trace = await openTrace('blf', generatedBlfTrace());
		try {
			expect(trace.metadata).toEqual({
				measurementStartMs: 1778494830400,
				validMessageCount: 2,
				skippedLineCount: 0,
				durationNs: 20_000_000
			});

			const speed = await getSignalValues(
				dbc,
				trace,
				{ canId: 288, isExtended: false, sizeBytes: 8 },
				'vehicle_speed'
			);
			expect(Array.from(speed.timesMs)).toEqual([10, 20]);
			expect(Array.from(speed.values)).toEqual([100, 123.4]);
		} finally {
			await closeTrace(trace);
			await closeDbc(dbc);
		}
	});

	it('opens a dynamically compressed BLF trace through the TypeScript boundary', async () => {
		const trace = await openTrace('blf', generatedCompressedBlfTrace());
		try {
			expect(trace.metadata).toMatchObject({
				validMessageCount: 257,
				skippedLineCount: 0,
				durationNs: 257_000_000
			});
		} finally {
			await closeTrace(trace);
		}
	});

	it('normalizes parse and decode failures', async () => {
		const trace = await openFixtureTrace();
		const { handle: dbc } = await openFixtureDbc();
		try {
			await expect(openDbc('BO_ broken')).rejects.toThrow('invalid DBC message record');
			await expect(
				openTrace('asc', new TextEncoder().encode('base nope timestamps absolute'))
			).rejects.toThrow('invalid ASC base declaration');
			const invalidBlf = new Uint8Array(144);
			invalidBlf.set(new TextEncoder().encode('NOPE'));
			await expect(openTrace('blf', invalidBlf)).rejects.toThrow('invalid BLF file signature');
			await expect(
				getSignalValues(dbc, trace, { canId: 288, isExtended: false, sizeBytes: 8 }, 'missing')
			).rejects.toThrow('Signal not found in DBC');
		} finally {
			await closeTrace(trace);
			await closeDbc(dbc);
		}
	});

	it('preserves relative timing around non-UTF-8 text', async () => {
		const prefix = new TextEncoder().encode(
			'base hex timestamps relative\n0.100 1 123 Rx d 1 aa\n0.200 unknown '
		);
		const suffix = new TextEncoder().encode(' event\n0.300 1 123 Rx d 1 bb');
		const bytes = concatBytes(prefix, new Uint8Array([0xff]), suffix);
		const trace = await openTrace('asc', bytes);
		try {
			expect(trace.metadata).toMatchObject({
				validMessageCount: 2,
				skippedLineCount: 0,
				durationNs: 600_000_000
			});
		} finally {
			await closeTrace(trace);
		}
	});

	it('reports skipped malformed trace lines in metadata', async () => {
		const trace = await openTrace(
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
			expect(trace.metadata.skippedLineCount).toBe(1);
			expect(trace.metadata.validMessageCount).toBe(2);
		} finally {
			await closeTrace(trace);
		}
	});
});

async function openFixtureDbc(): Promise<{
	handle: DbcHandle;
	catalog: ParsedDbc;
}> {
	const text = await readFile(resolve(fixturesDir, 'agentic-demo.dbc'), 'utf8');
	return openDbc(text);
}

async function openFixtureTrace(): Promise<TraceHandle> {
	const bytes = await readFile(resolve(fixturesDir, 'agentic-demo.asc'));
	return openTrace('asc', bytes);
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
