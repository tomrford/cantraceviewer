import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCanTraceClient, type CanTraceClient } from '../dist/node.js';

const fixturesDir = resolve('wasm/tests/fixtures');
const identity = { canId: 288, isExtended: false, sizeBytes: 8 };
let client: CanTraceClient;
let dbcText: string;
let ascBytes: Buffer;

beforeAll(async () => {
	dbcText = await readFile(resolve(fixturesDir, 'agentic-demo.dbc'), 'utf8');
	ascBytes = await readFile(resolve(fixturesDir, 'agentic-demo.asc'));
	client = await createCanTraceClient();
});

afterAll(async () => {
	await client.close();
});

describe('cantraceviewer/node', () => {
	it('parses and decodes through a real worker thread that loads WASM from disk', async () => {
		const { handle: dbc, catalog } = await client.openDbc(dbcText);
		// One exact ArrayBuffer copy: Node file reads come out of a shared pool.
		const buffer = new Uint8Array(ascBytes).buffer;
		const trace = await client.openTrace('asc', buffer);
		try {
			expect(buffer.byteLength).toBe(0); // transferred into the worker thread
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
			expect(trace.hasRawFrames).toBe(true);
			expect(trace.mf4Catalog).toBeNull();

			const speed = await client.getSignalValues(dbc, trace.handle, identity, 'vehicle_speed');
			expect(Array.from(speed.timesMs).slice(0, 3)).toEqual([10, 110, 210]);
			expect(Array.from(speed.values).slice(0, 3)).toEqual([100, 123.4, 150]);
			expect(speed.timesMs.length).toBe(251);
			// One buffer transferred out of the worker, two views over it.
			expect(speed.timesMs.buffer).toBe(speed.values.buffer);
		} finally {
			await client.closeTrace(trace.handle);
			await client.closeDbc(dbc);
		}
	}, 30_000);

	it('reports parse failures without poisoning the worker thread', async () => {
		await expect(client.openDbc('BO_ broken')).rejects.toThrow('invalid DBC message record');
		const { handle } = await client.openDbc(dbcText);
		await client.closeDbc(handle);
	});

	it('terminates its worker thread on close and rejects later operations', async () => {
		const other = await createCanTraceClient();
		const { handle } = await other.openDbc(dbcText);
		await other.close();
		await other.close(); // idempotent
		await other.closeDbc(handle); // invalidated handle closes silently
		await expect(other.openDbc(dbcText)).rejects.toThrow('client is closed');
	}, 30_000);
});
