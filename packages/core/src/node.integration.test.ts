import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCanTraceClient, DEFAULT_PARSING_LIMITS, type CanTraceClient } from '../dist/node.js';

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
	it('passes configured limits through a real worker and recovers after limit failures', async () => {
		const limits = { ...DEFAULT_PARSING_LIMITS, maxDbcBytes: 1360, maxTraceDataBytes: 71 };
		const configured = await createCanTraceClient(limits);
		try {
			const native = Uint8Array.from(
				await readFile(resolve(fixturesDir, 'mf4/decoded-channels.mf4'))
			);
			await expect(configured.openTrace('mf4', native.buffer)).rejects.toThrow('71 byte limit');
			const hybrid = Uint8Array.from(
				await readFile(resolve(fixturesDir, 'mf4/hybrid-embedded-dbc.mf4'))
			);
			const other = await createCanTraceClient({ ...limits, maxTraceDataBytes: 168 });
			try {
				const opened = await other.openTrace('mf4', hybrid.buffer);
				expect(opened.embeddedDbcs).toEqual([]);
				expect(opened.warnings[0]).toContain('1360 byte DBC limit');
			} finally {
				await other.close();
			}
			const accepted = await createCanTraceClient({
				...limits,
				maxDbcBytes: 1361,
				maxTraceDataBytes: 168
			});
			try {
				const opened = await accepted.openTrace(
					'mf4',
					Uint8Array.from(await readFile(resolve(fixturesDir, 'mf4/hybrid-embedded-dbc.mf4')))
						.buffer
				);
				await accepted.closeTrace(opened.handle);
				expect(opened.embeddedDbcs[0].bytes.byteLength).toBe(1361);
				const imported = await accepted.openDbc(opened.embeddedDbcs[0].bytes);
				expect(imported.catalog.messages.some((message) => message.canId === 291)).toBe(true);
			} finally {
				await accepted.close();
			}
			const dbc = await configured.openDbc('VERSION ""');
			await configured.closeDbc(dbc.handle);
		} finally {
			await configured.close();
		}
	}, 30_000);

	it('transports explicit source selection and ambiguity errors through the worker', async () => {
		const dbc = await client.openDbc(
			'BO_ 291 Example: 1 ECU\n SG_ Value : 0|8@1+ (1,0) [0|255] "" ECU'
		);
		const trace = await client.openTrace(
			'trc',
			new TextEncoder().encode(
				';$FILEVERSION=2.1\n;$COLUMNS=N,O,T,B,I,d,L,D\n1 1.000 DT 1 0123 Rx 1 11\n2 2.000 DT 2 0123 Rx 1 22\n3 3.000 DT 1 0123 Tx 1 33'
			).buffer
		);
		const message = { canId: 291, isExtended: false, sizeBytes: 1 };
		try {
			expect(trace.metadata.rawMessages).toHaveLength(3);
			await expect(
				client.getSignalValues(dbc.handle, trace.handle, message, 'Value')
			).rejects.toThrow('Multiple raw sources');
			const tx = await client.getSignalValues(dbc.handle, trace.handle, message, 'Value', {
				channel: 1,
				direction: 'tx'
			});
			expect(Array.from(tx.values)).toEqual([51]);
			expect(Array.from(tx.timesMs)).toEqual([3]);
		} finally {
			await client.closeTrace(trace.handle);
			await client.closeDbc(dbc.handle);
		}
	});

	it('parses and decodes through a real worker thread that loads WASM from disk', async () => {
		const { handle: dbc, catalog } = await client.openDbc(dbcText);
		const buffer = new Uint8Array(ascBytes).buffer;
		const trace = await client.openTrace('asc', buffer);
		try {
			expect(buffer.byteLength).toBe(0);
			expect(catalog.messages.find((message) => message.name === 'PowertrainStatus')).toMatchObject(
				{
					canId: 288,
					isExtended: false,
					sizeBytes: 8
				}
			);
			expect(trace.metadata).toMatchObject({
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
		await other.close();
		await other.closeDbc(handle);
		await expect(other.openDbc(dbcText)).rejects.toThrow('client is closed');
	}, 30_000);
});
