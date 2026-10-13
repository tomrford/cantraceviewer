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
import { loadDemoFiles } from './demo-session.js';
import { dbcFiles, buildSelectorSearchIndexes } from './stores/dbc-files.svelte.js';
import { traceFile } from './stores/trace-file.svelte.js';
import { plotData } from './stores/plot-data.svelte.js';
import { onTraceOpened } from './stores/session.js';
import { searchCatalogSignals } from './webmcp-tools.js';
import { closeTrace } from './wasm.js';
import * as library from './stores/dbc-library.js';

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
	it('retains positioned diagnostics through upload, reload and embedded imports while decoding usable signals', async () => {
		plotData.clearSelectedSignals();
		await dbcFiles.clear();
		expect(await traceFile.openFile(await fixture('source-selection.asc'))).toBe(true);
		const input = await fixture('partial-load.dbc');
		const bytes = new Uint8Array(await input.arrayBuffer());
		const expectedWarnings = [
			{
				category: 'omitted-feature',
				keyword: 'SG_',
				line: 16,
				column: 2,
				message: expect.stringMatching(/\S/)
			},
			{
				category: 'dangling-reference',
				keyword: 'VAL_',
				line: 18,
				column: 3,
				message: expect.stringMatching(/\S/)
			}
		];
		const checkEntry = () => {
			const entry = dbcFiles.files[0];
			expect(entry.name).toBe('partial-load.dbc');
			expect(entry.warnings).toEqual(expectedWarnings);
			expect(entry.catalog.messages).toHaveLength(8);
			expect(entry.catalog.messages.flatMap((m) => m.signals)).toHaveLength(8);
			expect(dbcFiles.selectorFiles[0].messages).toHaveLength(14);
			expect(dbcFiles.error).toBeNull();
		};
		await dbcFiles.addFiles([input]);
		checkEntry();
		const uploadedWarnings = structuredClone(dbcFiles.files[0].warnings);
		const key = dbcFiles.selectorFiles[0].messages[0].signals[0].key;
		await plotData.toggleSignal(key);
		expect(plotData.signals[0].series?.values[0]).toBe(10);
		plotData.clearSelectedSignals();
		await dbcFiles.clear();
		// Node has no IndexedDB: substitute only the storage read, retaining real parsing.
		const stored = vi
			.spyOn(library, 'listStoredDbcs')
			.mockResolvedValueOnce([{ id: 'saved-partial', name: input.name, bytes }]);
		dbcFiles.hasLoadedLibrary = false;
		await dbcFiles.loadLibrary();
		stored.mockRestore();
		checkEntry();
		expect(dbcFiles.files[0].warnings).toEqual(uploadedWarnings);
		await dbcFiles.clear();
		expect(
			await traceFile.openFile(new File([await compressedAttachment(bytes)], 'partial.mf4'))
		).toBe(true);
		await dbcFiles.addTransientDbcs(traceFile.entry!.id, traceFile.entry!.embeddedDbcs);
		expect(dbcFiles.files[0].warnings).toEqual(uploadedWarnings);
		expect(dbcFiles.files[0].catalog.messages).toHaveLength(8);
		expect(dbcFiles.files[0].origin).toBe('mf4');
		await dbcFiles.clear();
		await dbcFiles.addFiles([await fixture('malformed-source.dbc')]);
		expect(dbcFiles.files).toEqual([]);
		expect(dbcFiles.error).toContain('malformed-source.dbc');
		expect(dbcFiles.error).toContain('2:3: SG_');
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

	it('plots the example speed and rpm without saving the example DBC, then drops it on the next trace', async () => {
		plotData.clearSelectedSignals();
		await dbcFiles.clear();
		await dbcFiles.addFiles([await fixture('source-selection.dbc')]);
		const savedId = dbcFiles.files[0].id;
		const persist = vi.spyOn(library, 'putStoredDbcs');
		try {
			const trace = new File([await readFile('static/example.asc')], 'example.asc');
			const dbc = new File([await readFile('static/example.dbc')], 'example.dbc');
			expect(await loadDemoFiles(trace, dbc)).toBe(true);

			expect(persist).not.toHaveBeenCalled();
			expect(await library.listStoredDbcs()).toEqual([]);
			expect(dbcFiles.files.find((file) => file.id === savedId)?.origin).toBe('library');
			const demo = dbcFiles.files.find((file) => file.origin === 'demo');
			expect(demo?.name).toBe('example.dbc');
			expect(dbcFiles.selectorFiles.find((file) => file.id === demo?.id)).toMatchObject({
				name: 'example',
				transient: true,
				badge: 'Example'
			});

			const speed = plotData.signals.find((signal) => signal.signalName === 'vehicle_speed');
			const rpm = plotData.signals.find((signal) => signal.signalName === 'engine_rpm');
			expect(Array.from(speed?.series?.timesMs.slice(0, 2) ?? [])).toEqual([10, 110]);
			expect(Array.from(speed?.series?.values.slice(0, 2) ?? [])).toEqual([100, 123.4]);
			expect(Array.from(rpm?.series?.timesMs.slice(0, 2) ?? [])).toEqual([10, 110]);
			expect(Array.from(rpm?.series?.values.slice(0, 2) ?? [])).toEqual([4488, 5379]);

			expect(await traceFile.openFile(await fixture('source-selection.asc'))).toBe(true);
			await onTraceOpened();
			expect(dbcFiles.files.map((file) => file.id)).toEqual([savedId]);
			expect(dbcFiles.files.every((file) => file.origin === 'library')).toBe(true);
			expect(persist).not.toHaveBeenCalled();
		} finally {
			persist.mockRestore();
		}
	});

	it('keeps a saved example DBC instead of adding a second session copy', async () => {
		plotData.clearSelectedSignals();
		await dbcFiles.clear();
		const bytes = await readFile('static/example.dbc');
		await dbcFiles.addFiles([new File([bytes], 'saved-example.dbc')]);
		const persist = vi.spyOn(library, 'putStoredDbcs');
		persist.mockClear();
		try {
			expect(
				await loadDemoFiles(
					new File([await readFile('static/example.asc')], 'example.asc'),
					new File([bytes], 'example.dbc')
				)
			).toBe(true);
			expect(persist).not.toHaveBeenCalled();
			expect(dbcFiles.files).toHaveLength(1);
			expect(dbcFiles.files[0]).toMatchObject({ name: 'saved-example.dbc', origin: 'library' });
			expect(plotData.signals.map((signal) => signal.signalName).sort()).toEqual([
				'engine_rpm',
				'vehicle_speed'
			]);
		} finally {
			persist.mockRestore();
		}
	});

	it('saves the example DBC when that file is added, and keeps it after the next trace', async () => {
		plotData.clearSelectedSignals();
		await dbcFiles.clear();
		const bytes = await readFile('static/example.dbc');
		expect(
			await loadDemoFiles(
				new File([await readFile('static/example.asc')], 'example.asc'),
				new File([bytes], 'example.dbc')
			)
		).toBe(true);
		const persist = vi.spyOn(library, 'putStoredDbcs');
		try {
			await dbcFiles.addFiles([new File([bytes], 'kept.dbc')]);
			expect(persist).toHaveBeenCalledTimes(1);
			expect(dbcFiles.files).toHaveLength(1);
			expect(dbcFiles.files[0]).toMatchObject({ name: 'kept.dbc', origin: 'library' });
			expect(dbcFiles.selectorFiles[0]?.transient).toBe(false);
			expect(dbcFiles.selectorFiles[0]?.badge).toBeUndefined();

			expect(await traceFile.openFile(await fixture('source-selection.asc'))).toBe(true);
			await onTraceOpened();
			expect(dbcFiles.files).toHaveLength(1);
			expect(dbcFiles.files[0]).toMatchObject({ name: 'kept.dbc', origin: 'library' });
		} finally {
			persist.mockRestore();
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
