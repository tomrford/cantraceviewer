import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
	closeDbc,
	closeTrace,
	getDbcCatalog,
	getSignalValues,
	openDbc,
	openTrace,
	type DbcHandle,
	type TraceHandle
} from '$lib/wasm.js';

const fixturesDir = resolve('wasm/test/fixtures');
const wasmAssetPath = resolve('src/lib/assets/cantraceviewer.wasm');

beforeAll(() => {
	globalThis.fetch = async (input: string | URL | Request) => {
		const url =
			typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
		if (url !== '/src/lib/assets/cantraceviewer.wasm') {
			throw new Error(`Unexpected fetch URL: ${url}`);
		}

		return new Response(await readFile(wasmAssetPath), {
			headers: { 'Content-Type': 'application/wasm' }
		});
	};
});

describe('WASM adapter integration', () => {
	it('parses a DBC and exports the typed catalog', async () => {
		const handle = await openFixtureDbc();
		try {
			const catalog = await getDbcCatalog(handle);
			const powertrain = catalog.messages.find((message) => message.name === 'PowertrainStatus');
			const vehicleSpeed = powertrain?.signals.find((signal) => signal.name === 'vehicle_speed');

			expect(catalog.messages).toHaveLength(3);
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
				validMessageCount: 9,
				durationNs: 220_000_000
			});
		} finally {
			await closeTrace(trace);
		}
	});

	it('decodes selected signal values through the TypeScript boundary', async () => {
		const dbc = await openFixtureDbc();
		const trace = await openFixtureTrace();
		try {
			const speed = await getSignalValues(dbc, trace, 'PowertrainStatus', 'vehicle_speed');
			const coolant = await getSignalValues(dbc, trace, 'PowertrainStatus', 'coolant_temp');

			expect(Array.from(speed.timesMs)).toEqual([10, 110, 210]);
			expect(Array.from(speed.values)).toEqual([100, 123.4, 150]);
			expect(Array.from(coolant.timesMs)).toEqual([10, 110, 210]);
			expect(Array.from(coolant.values)).toEqual([80, 90, 100]);
		} finally {
			await closeTrace(trace);
			await closeDbc(dbc);
		}
	});

	it('normalizes parse and decode failures', async () => {
		const trace = await openFixtureTrace();
		const dbc = await openFixtureDbc();
		try {
			await expect(openDbc('BO_ broken')).rejects.toThrow('DBC parse failed');
			await expect(
				openTrace('asc', new TextEncoder().encode('0.000000 1 100 Rx d 2 00'))
			).rejects.toThrow('ASC parse failed');
			await expect(getSignalValues(dbc, trace, 'PowertrainStatus', 'missing')).rejects.toThrow(
				'Signal decode failed'
			);
		} finally {
			await closeTrace(trace);
			await closeDbc(dbc);
		}
	});
});

async function openFixtureDbc(): Promise<DbcHandle> {
	const text = await readFile(resolve(fixturesDir, 'agentic-demo.dbc'), 'utf8');
	return openDbc(text);
}

async function openFixtureTrace(): Promise<TraceHandle> {
	const bytes = await readFile(resolve(fixturesDir, 'agentic-demo.asc'));
	return openTrace('asc', bytes);
}
