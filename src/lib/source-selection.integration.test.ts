import { afterAll, describe, expect, it, vi } from 'vitest';
import { deflateSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import type { CanTraceClient } from 'cantraceviewer';

const transport = vi.hoisted(() => ({ client: null as CanTraceClient | null }));
// Exercise the app against the published package using its real Node worker transport.
vi.mock('cantraceviewer', async () => {
	const pkg = await import('cantraceviewer/node');
	return {
		...pkg,
		createCanTraceClient: async (limits: Parameters<typeof pkg.createCanTraceClient>[0]) => {
			transport.client = await pkg.createCanTraceClient(limits);
			return transport.client;
		}
	};
});
import { dbcFiles, buildSelectorSearchIndexes } from './stores/dbc-files.svelte.js';
import { traceFile } from './stores/trace-file.svelte.js';
import { plotData } from './stores/plot-data.svelte.js';
import { searchCatalogSignals } from './webmcp-tools.js';
import { closeTrace } from './wasm.js';

const fixture = async (name: string) =>
	new File([await readFile(`wasm/tests/fixtures/${name}`)], name);
afterAll(async () => {
	plotData.clearSelectedSignals();
	await dbcFiles.clear();
	if (traceFile.entry) await closeTrace(traceFile.entry.handle);
	traceFile.entry = null;
	await transport.client?.close();
});

describe('published package app integration', () => {
	it('keeps observed sources separate through selector, public search, decode and deletion', async () => {
		expect(await traceFile.openFile(await fixture('source-selection.asc'))).toBe(true);
		await dbcFiles.addFiles([await fixture('source-selection.dbc')]);
		expect(dbcFiles.error).toBeNull();
		const messages = dbcFiles.selectorFiles[0].messages;
		const badges = (name: string) =>
			messages.filter((m) => m.name === name).map((m) => m.sourceBadges);
		expect(badges('BusOnly')).toEqual([['1'], ['2']]);
		expect(badges('DirectionOnly')).toEqual([['Rx'], ['Tx']]);
		expect(badges('Both')).toEqual([
			['1', 'Rx'],
			['1', 'Tx'],
			['2', 'Rx'],
			['2', 'Tx']
		]);
		expect(badges('Observed')).toEqual([
			['1', 'Rx'],
			['2', 'Tx']
		]);
		expect(badges('Extended')).toEqual([[]]);
		const hits = searchCatalogSignals(
			buildSelectorSearchIndexes(dbcFiles.selectorFiles),
			'Value',
			() => false,
			50
		).results;
		expect(new Set(hits.map((h) => h.key)).size).toBe(13);
		expect(hits.map((h) => h.label)).toContain(
			'UnknownDirection.Value [Channel 1 · unknown direction]'
		);
		expect(hits.map((h) => h.label)).toContain('UnknownChannel.Value [Unknown channel · Rx]');
		const expected = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130];
		for (const [index, hit] of hits.entries()) {
			await plotData.toggleSignal(hit.key);
			const plotted = plotData.signals.find((s) => s.key === hit.key);
			expect(plotted?.label).toBe(hit.label);
			expect(plotted?.series?.values[0]).toBe(expected[index]);
			expect(plotted?.series?.timesMs[0]).toBe(0);
		}
		await plotData.toggleSignal(hits[1].key);
		expect(plotData.signals.map((s) => s.key)).not.toContain(hits[1].key);
		expect(plotData.signals.find((s) => s.key === hits[0].key)?.series?.values[1]).toBe(11);
		plotData.deselectDbcFile(dbcFiles.files[0].id);
		await dbcFiles.removeFile(dbcFiles.files[0].id);
		expect(plotData.signals).toEqual([]);
		expect(dbcFiles.selectorFiles).toEqual([]);
	});
	it('accepts original Windows-1252 bytes at the exact app DBC cap and rejects over-cap before reading', async () => {
		const bytes = await readFile('wasm/tests/fixtures/encoding-windows1252.dbc');
		const padded = new Uint8Array(5 * 1024 * 1024).fill(32);
		padded.set(bytes);
		await dbcFiles.addFiles([new File([padded], 'legacy-exact.dbc')]);
		expect(dbcFiles.error).toBeNull();
		expect(dbcFiles.files[0].catalog.messages[0].signals[0].unit).toBe('°C € – ™');
		const oversized = new File([padded, ' '], 'legacy-over.dbc');
		const reading = vi.spyOn(oversized, 'arrayBuffer');
		await dbcFiles.addFiles([oversized]);
		expect(reading).not.toHaveBeenCalled();
		expect(dbcFiles.error).toBe('DBC file exceeds the 5 MiB limit');
	});
	it('imports exact-cap compressed legacy attachments and skips one byte over', async () => {
		const bytes = new Uint8Array(5 * 1024 * 1024).fill(32);
		bytes.set(await readFile('wasm/tests/fixtures/encoding-windows1252.dbc'));
		for (const accepted of [true, false]) {
			const input = accepted ? bytes : new Uint8Array(bytes.length + 1).fill(32);
			if (!accepted) input.set(bytes);
			expect(
				await traceFile.openFile(new File([await compressedAttachment(input)], 'legacy.mf4'))
			).toBe(true);
			const trace = traceFile.entry!;
			expect(trace.embeddedDbcs.length).toBe(accepted ? 1 : 0);
			if (accepted) {
				expect(Buffer.compare(trace.embeddedDbcs[0].bytes, bytes)).toBe(0);
				await dbcFiles.addTransientDbcs(trace.id, trace.embeddedDbcs);
				expect(dbcFiles.error).toBeNull();
				expect(
					dbcFiles.files.find((file) => file.origin === 'mf4')?.catalog.messages[0].signals[0].unit
				).toBe('°C € – ™');
			} else {
				expect(trace.warnings).toContain(
					'Embedded DBC "sample.dbc" exceeds the 5242880 byte DBC limit.'
				);
			}
		}
	});
});

async function compressedAttachment(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
	const original = await readFile('wasm/tests/fixtures/mf4/hybrid-embedded-dbc.mf4');
	const header = new DataView(original.buffer, original.byteOffset, original.byteLength);
	const attachment = Number(header.getBigUint64(64 + 24 + 3 * 8, true));
	const data = attachment + 24 + Number(header.getBigUint64(attachment + 16, true)) * 8;
	const compressed = deflateSync(bytes);
	const output = new Uint8Array(Math.max(original.length, data + 40 + compressed.length));
	output.set(original);
	const view = new DataView(output.buffer);
	view.setUint16(data, 3, true);
	view.setBigUint64(attachment + 8, BigInt(data + 40 + compressed.length - attachment), true);
	view.setBigUint64(data + 24, BigInt(bytes.length), true);
	view.setBigUint64(data + 32, BigInt(compressed.length), true);
	output.set(compressed, data + 40);
	return output;
}
