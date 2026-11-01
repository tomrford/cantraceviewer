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
import {
	addDbcFiles,
	addTransientDbcs,
	clearDbcFiles,
	loadDbcLibrary,
	removeDbcFile,
	resetDbcLibrary
} from './stores/dbc-files.js';
import { openTraceFile } from './stores/trace-file.js';
import {
	clearSelectedSignals,
	deselectDbcFile,
	signalDecodeStatus,
	toggleSignal
} from './stores/plot-data.js';
import { buildSelectorSearchIndexes } from './selector-list.js';
import { onTraceOpened } from './stores/session.js';
import { searchCatalogSignals } from './webmcp-tools.js';
import { closeTrace } from './wasm.js';
import * as library from './stores/dbc-library.js';
import { appStore, update } from './stores/store.js';

const fixture = async (name: string) =>
	new File([await readFile(`wasm/tests/fixtures/${name}`)], name);
afterAll(async () => {
	clearSelectedSignals();
	await clearDbcFiles();
	const { trace } = appStore.getState();
	if (trace) await closeTrace(trace.handle);
	update({ trace: null, traceLoading: false, traceError: null });
	await transport.client?.close();
});

describe('published package app integration', () => {
	it('keeps observed sources separate through selector, public search, decode and deletion', async () => {
		expect(await openTraceFile(await fixture('source-selection.asc'))).toBe(true);
		await addDbcFiles([await fixture('source-selection.dbc')]);
		expect(appStore.getState().dbcError).toBeNull();
		const messages = appStore.getState().selectorFiles[0].messages;
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
			buildSelectorSearchIndexes(appStore.getState().selectorFiles),
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
			await toggleSignal(hit.key);
			const plotted = appStore.getState().signals.find((s) => s.key === hit.key);
			expect(plotted?.label).toBe(hit.label);
			expect(plotted?.series?.values[0]).toBe(expected[index]);
			expect(plotted?.series?.timesMs[0]).toBe(0);
		}
		await toggleSignal(hits[1].key);
		expect(appStore.getState().signals.map((s) => s.key)).not.toContain(hits[1].key);
		expect(appStore.getState().signals.find((s) => s.key === hits[0].key)?.series?.values[1]).toBe(
			11
		);
		deselectDbcFile(appStore.getState().dbcFiles[0].id);
		await removeDbcFile(appStore.getState().dbcFiles[0].id);
		expect(appStore.getState().signals).toEqual([]);
		expect(appStore.getState().selectorFiles).toEqual([]);
	});
	it('retains positioned diagnostics through upload, reload and embedded imports while decoding usable signals', async () => {
		clearSelectedSignals();
		await clearDbcFiles();
		const trace = (await (await fixture('source-selection.asc')).text()).replace(
			'End TriggerBlock',
			'0.200000 1 100 Rx d 2 0a\nEnd TriggerBlock'
		);
		expect(await openTraceFile(new File([trace], 'skipped-line.asc'))).toBe(true);
		expect(appStore.getState().traceWarning).toBe('Parsed with 1 malformed line skipped.');
		expect(await openTraceFile(new File(['invalid replacement'], 'trace.txt'))).toBe(false);
		expect(appStore.getState().traceError).toContain('Unsupported trace file type');
		expect(appStore.getState().trace?.file.name).toBe('skipped-line.asc');
		expect(appStore.getState().traceWarning).toBe('Parsed with 1 malformed line skipped.');
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
			const entry = appStore.getState().dbcFiles[0];
			expect(entry.name).toBe('partial-load.dbc');
			expect(entry.warnings).toEqual(expectedWarnings);
			expect(entry.catalog.messages).toHaveLength(8);
			expect(entry.catalog.messages.flatMap((m) => m.signals)).toHaveLength(8);
			expect(appStore.getState().selectorFiles[0].messages).toHaveLength(14);
			expect(appStore.getState().dbcError).toBeNull();
		};
		await addDbcFiles([input]);
		checkEntry();
		const uploadedWarnings = structuredClone(appStore.getState().dbcFiles[0].warnings);
		const key = appStore.getState().selectorFiles[0].messages[0].signals[0].key;
		await toggleSignal(key);
		expect(appStore.getState().signals[0].series?.values[0]).toBe(10);
		clearSelectedSignals();
		await clearDbcFiles();
		// Node has no IndexedDB: substitute only the storage read, retaining real parsing.
		const stored = vi
			.spyOn(library, 'listStoredDbcs')
			.mockResolvedValueOnce([{ id: 'saved-partial', name: input.name, bytes }]);
		update({ hasLoadedLibrary: false });
		await loadDbcLibrary();
		stored.mockRestore();
		checkEntry();
		expect(appStore.getState().dbcFiles[0].warnings).toEqual(uploadedWarnings);
		await clearDbcFiles();
		expect(await openTraceFile(new File([await compressedAttachment(bytes)], 'partial.mf4'))).toBe(
			true
		);
		await addTransientDbcs(appStore.getState().trace!.id, appStore.getState().trace!.embeddedDbcs);
		expect(appStore.getState().dbcFiles[0].warnings).toEqual(uploadedWarnings);
		expect(appStore.getState().dbcFiles[0].catalog.messages).toHaveLength(8);
		expect(appStore.getState().dbcFiles[0].origin).toBe('mf4');
		await clearDbcFiles();
		await addDbcFiles([await fixture('malformed-source.dbc')]);
		expect(appStore.getState().dbcFiles).toEqual([]);
		expect(appStore.getState().dbcError).toContain('malformed-source.dbc');
		expect(appStore.getState().dbcError).toContain('2:3: SG_');
	});
	it('recovers readable saved DBCs after a storage failure without erasing corrupt records', async () => {
		clearSelectedSignals();
		await clearDbcFiles();
		expect(await openTraceFile(await fixture('source-selection.asc'))).toBe(true);
		await onTraceOpened();
		const names = ['source-selection.dbc', 'malformed-source.dbc', 'partial-load.dbc'];
		let stored = await Promise.all(
			names.map(async (name) => ({
				id: name,
				name,
				bytes: new Uint8Array(await (await fixture(name)).arrayBuffer())
			}))
		);
		const read = vi
			.spyOn(library, 'listStoredDbcs')
			.mockImplementation(async () => structuredClone(stored))
			.mockRejectedValueOnce(new Error('storage temporarily unreadable'));
		const reset = vi.spyOn(library, 'resetStoredDbcs').mockImplementation(async () => {
			stored = [];
		});
		const remove = vi.spyOn(library, 'deleteStoredDbc').mockImplementation(async (id) => {
			stored = stored.filter((file) => file.id !== id);
		});
		try {
			update({ hasLoadedLibrary: false });
			await loadDbcLibrary();
			expect(appStore.getState().dbcError).toBe('Saved DBC library could not be read.');
			expect(appStore.getState().dbcLoading).toBe(false);
			expect(appStore.getState().dbcFiles).toEqual([]);
			// A new session retries the same saved records, including the unreadable one.
			update({ hasLoadedLibrary: false });
			await loadDbcLibrary();
			expect(appStore.getState().dbcFiles.map((file) => file.name)).toEqual([names[0], names[2]]);
			expect(appStore.getState().dbcError).toContain('malformed-source.dbc');
			expect(appStore.getState().dbcError).toContain('2:3: SG_');
			expect(appStore.getState().dbcLoading).toBe(false);
			for (const file of appStore.getState().selectorFiles) {
				const key = file.messages[0].signals[0].key;
				await toggleSignal(key);
				expect(
					Array.from(
						appStore.getState().signals.find((signal) => signal.key === key)!.series!.values
					)
				).toEqual([10, 11]);
			}
			expect(stored.map((file) => file.name)).toEqual(names);
			clearSelectedSignals();
			await removeDbcFile(names[0]);
			await clearDbcFiles();
			update({ hasLoadedLibrary: false });
			await loadDbcLibrary();
			expect(appStore.getState().dbcFiles.map((file) => file.name)).toEqual([names[2]]);
			expect(stored.map((file) => file.name)).toEqual(names.slice(1));
		} finally {
			read.mockRestore();
			reset.mockRestore();
			remove.mockRestore();
			await clearDbcFiles();
		}
	});

	it('accepts original Windows-1252 bytes at the exact app DBC cap and rejects over-cap before reading', async () => {
		const bytes = await readFile('wasm/tests/fixtures/encoding-windows1252.dbc');
		const padded = new Uint8Array(5 * 1024 * 1024).fill(32);
		padded.set(bytes);
		await addDbcFiles([new File([padded], 'legacy-exact.dbc')]);
		expect(appStore.getState().dbcError).toBeNull();
		expect(appStore.getState().dbcFiles[0].catalog.messages[0].signals[0].unit).toBe('°C € – ™');
		const oversized = new File([padded, ' '], 'legacy-over.dbc');
		const reading = vi.spyOn(oversized, 'arrayBuffer');
		await addDbcFiles([oversized]);
		expect(reading).not.toHaveBeenCalled();
		expect(appStore.getState().dbcError).toBe('DBC file exceeds the 5 MiB limit');
	});
	it('imports exact-cap compressed legacy attachments and skips one byte over', async () => {
		const bytes = new Uint8Array(5 * 1024 * 1024).fill(32);
		bytes.set(await readFile('wasm/tests/fixtures/encoding-windows1252.dbc'));
		for (const accepted of [true, false]) {
			const input = accepted ? bytes : new Uint8Array(bytes.length + 1).fill(32);
			if (!accepted) input.set(bytes);
			expect(await openTraceFile(new File([await compressedAttachment(input)], 'legacy.mf4'))).toBe(
				true
			);
			const trace = appStore.getState().trace!;
			expect(trace.embeddedDbcs.length).toBe(accepted ? 1 : 0);
			if (accepted) {
				expect(Buffer.compare(trace.embeddedDbcs[0].bytes, bytes)).toBe(0);
				await addTransientDbcs(trace.id, trace.embeddedDbcs);
				expect(appStore.getState().dbcError).toBeNull();
				expect(
					appStore.getState().dbcFiles.find((file) => file.origin === 'mf4')?.catalog.messages[0]
						.signals[0].unit
				).toBe('°C € – ™');
			} else {
				expect(trace.warnings).toContain(
					'Embedded DBC "sample.dbc" exceeds the 5242880 byte DBC limit.'
				);
			}
		}
	});
	it('opens the native demo and preserves the saved DBC through trace replacement', async () => {
		clearSelectedSignals();
		await clearDbcFiles();
		await addDbcFiles([await fixture('source-selection.dbc')]);
		const saved = appStore.getState().dbcFiles[0];
		const catalog = structuredClone(saved.catalog);
		const persist = vi.spyOn(library, 'putStoredDbcs');
		try {
			expect(
				await openTraceFile(new File([await readFile('static/example.mf4')], 'example.mf4'))
			).toBe(true);
			await onTraceOpened();
			expect(appStore.getState().trace?.hasRawFrames).toBe(false);
			expect(appStore.getState().trace?.embeddedDbcs).toEqual([]);
			expect(appStore.getState().trace?.metadata.durationNs).toBe(90_000_000_000);
			expect(appStore.getState().trace?.mf4Catalog?.groups).toHaveLength(1);
			const group = appStore.getState().trace!.mf4Catalog!.groups[0];
			expect(group.name).toBe('Decoded powertrain');
			expect(group.signals.map(({ name, unit }) => ({ name, unit }))).toEqual([
				{ name: 'VehicleSpeed', unit: 'km/h' },
				{ name: 'EngineSpeed', unit: 'rpm' }
			]);
			const expected = [
				['VehicleSpeed', [0, 50, 80, 100, 30, 0]],
				['EngineSpeed', [800, 2600, 2400, 2300, 1400, 800]]
			] as const;
			for (const [name, values] of expected) {
				const [key] = [...appStore.getState().mf4SignalTargetByKey].find(
					([, target]) => target.signal.name === name
				)!;
				await toggleSignal(key);
				const series = appStore.getState().signals.find((signal) => signal.key === key)!.series!;
				expect(series.timesMs).toHaveLength(901);
				expect([0, 100, 200, 400, 600, 900].map((index) => series.timesMs[index])).toEqual([
					0, 10_000, 20_000, 40_000, 60_000, 90_000
				]);
				expect([0, 100, 200, 400, 600, 900].map((index) => series.values[index])).toEqual(values);
			}
			expect(appStore.getState().dbcFiles).toEqual([saved]);
			expect(saved.catalog).toEqual(catalog);
			expect(await openTraceFile(await fixture('source-selection.asc'))).toBe(true);
			await onTraceOpened();
			expect(appStore.getState().signals).toEqual([]);
			expect(appStore.getState().mf4SignalTargetByKey.size).toBe(0);
			expect(appStore.getState().dbcFiles).toEqual([saved]);
			expect(saved.catalog).toEqual(catalog);
			expect(persist).not.toHaveBeenCalled();
			const key = appStore.getState().selectorFiles[0].messages[0].signals[0].key;
			await toggleSignal(key);
			expect(appStore.getState().signals[0].series?.values[0]).toBe(10);
		} finally {
			persist.mockRestore();
		}
	});
	it.each(['replacement', 'reselection'] as const)(
		'ignores late success and failure after %s while the new selection is decoding',
		async (change) => {
			for (const outcome of ['success', 'failure']) {
				clearSelectedSignals();
				await clearDbcFiles();
				expect(await openTraceFile(await fixture('source-selection.asc'))).toBe(true);
				await onTraceOpened();
				await addDbcFiles([await fixture('source-selection.dbc')]);
				const key = appStore.getState().selectorFiles[0].messages[0].signals[0].key;
				const oldDecoded = Promise.withResolvers<void>();
				const newDecoded = Promise.withResolvers<void>();
				const releaseOld = Promise.withResolvers<void>();
				const releaseNew = Promise.withResolvers<void>();
				const client = transport.client!;
				const decode = client.getSignalValues.bind(client);
				// Hold only delivery: both responses come from the real package Worker/WASM.
				const responses = vi
					.spyOn(client, 'getSignalValues')
					.mockImplementationOnce(async (...args) => {
						const series = await decode(...args);
						oldDecoded.resolve();
						await releaseOld.promise;
						if (outcome === 'failure') throw new Error('late worker response failed');
						return series;
					})
					.mockImplementationOnce(async (...args) => {
						const series = await decode(...args);
						newDecoded.resolve();
						await releaseNew.promise;
						return series;
					});
				try {
					const oldSelection = toggleSignal(key);
					await oldDecoded.promise;
					const replacement = (await (await fixture('source-selection.asc')).text())
						.replace('d 1 0a', 'd 1 63')
						.replace('d 1 0b', 'd 1 64');
					if (change === 'replacement') {
						expect(await openTraceFile(new File([replacement], 'replacement.asc'))).toBe(true);
						await onTraceOpened();
					} else {
						await toggleSignal(key);
					}
					expect(appStore.getState().signals).toEqual([]);
					const newSelection = toggleSignal(key);
					await newDecoded.promise;
					releaseOld.resolve();
					await oldSelection;
					expect(signalDecodeStatus(key)).toEqual({ isDecoding: true, decodeError: null });
					expect(appStore.getState().signals[0].series).toBeNull();
					releaseNew.resolve();
					await newSelection;
					expect(signalDecodeStatus(key)).toEqual({ isDecoding: false, decodeError: null });
					expect(Array.from(appStore.getState().signals[0].series!.timesMs)).toEqual([0, 100]);
					expect(Array.from(appStore.getState().signals[0].series!.values)).toEqual(
						change === 'replacement' ? [99, 100] : [10, 11]
					);
				} finally {
					releaseOld.resolve();
					releaseNew.resolve();
					responses.mockRestore();
				}
			}
		}
	);
	it('finishes an import write before a queued reset and can persist and reload a later import', async () => {
		clearSelectedSignals();
		await clearDbcFiles();
		expect(await openTraceFile(await fixture('source-selection.asc'))).toBe(true);
		await onTraceOpened();
		const writeStarted = Promise.withResolvers<void>();
		const releaseWrite = Promise.withResolvers<void>();
		let stored: library.StoredDbc[] = [];
		// Node has no IndexedDB. Substitute storage only, retaining real hashing and parsing.
		const write = vi.spyOn(library, 'putStoredDbcs').mockImplementation(async (dbcs) => {
			writeStarted.resolve();
			await releaseWrite.promise;
			stored.push(...structuredClone(dbcs));
		});
		const reset = vi.spyOn(library, 'resetStoredDbcs').mockImplementation(async () => {
			stored = [];
		});
		const read = vi
			.spyOn(library, 'listStoredDbcs')
			.mockImplementation(async () => structuredClone(stored));
		try {
			const input = await fixture('source-selection.dbc');
			const importing = addDbcFiles([input]);
			await writeStarted.promise;
			const resetting = resetDbcLibrary();
			expect(appStore.getState().dbcLoading).toBe(true);
			releaseWrite.resolve();
			await Promise.all([importing, resetting]);
			expect(appStore.getState().dbcLoading).toBe(false);
			expect(appStore.getState().dbcFiles).toEqual([]);
			update({ hasLoadedLibrary: false });
			await loadDbcLibrary();
			expect(appStore.getState().selectorFiles).toEqual([]);
			await addDbcFiles([input, new File([await input.arrayBuffer()], 'copy.dbc')]);
			await addDbcFiles([new File([await input.arrayBuffer()], 'again.dbc')]);
			expect(appStore.getState().dbcFiles.map((file) => file.name)).toEqual([input.name]);
			expect(stored.map((file) => file.name)).toEqual([input.name]);
			const released = appStore.getState().dbcFiles[0].handle;
			await resetDbcLibrary();
			await expect(
				transport.client!.getSignalValues(
					released,
					appStore.getState().trace!.handle,
					{ canId: 256, isExtended: false, sizeBytes: 1 },
					'Value'
				)
			).rejects.toThrow('dbc handle is closed');
			await addDbcFiles([input]);
			await clearDbcFiles();
			update({ hasLoadedLibrary: false });
			await loadDbcLibrary();
			expect(appStore.getState().dbcError).toBeNull();
			expect(appStore.getState().dbcFiles.map((file) => file.name)).toEqual([input.name]);
			expect(await openTraceFile(await fixture('source-selection.asc'))).toBe(true);
			await onTraceOpened();
			await toggleSignal(appStore.getState().selectorFiles[0].messages[0].signals[0].key);
			expect(Array.from(appStore.getState().signals[0].series!.values)).toEqual([10, 11]);
		} finally {
			releaseWrite.resolve();
			write.mockRestore();
			reset.mockRestore();
			read.mockRestore();
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
