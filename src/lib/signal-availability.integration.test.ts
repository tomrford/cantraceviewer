import { readFile } from 'node:fs/promises';
import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { addDbcFiles, dbcFiles, resetDbcLibrary } from './stores/dbc-files.js';
import { openTraceFile, traceFile } from './stores/trace-file.js';
import {
	clearSelectedSignals,
	isSignalSelected,
	plotData,
	toggleSignal
} from './stores/plot-data.js';
import { buildSelectorSearchIndexes, selectorRows, type SelectorListRow } from './selector-list.js';
import { onTraceOpened } from './stores/session.js';
import { mountWebMcp } from './webmcp.js';
import type { WebMcpTool } from './webmcp-tools.js';
import type { CanTraceClient } from 'cantraceviewer';
import { closeTrace } from './wasm.js';

// Replace only the browser Worker transport; exercise the published package and app stores.
const transport = vi.hoisted(() => ({ client: null as CanTraceClient | null }));
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
vi.mock('./stores/dbc-library.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('./stores/dbc-library.js')>()),
	putStoredDbcs: vi.fn(async () => {}),
	listStoredDbcs: vi.fn(async () => []),
	deleteStoredDbc: vi.fn(async () => {}),
	resetStoredDbcs: vi.fn(async () => {})
}));

const tools = new Map<string, WebMcpTool>();
const unmount = mountWebMcp({
	registerTool: async (tool) => {
		tools.set(tool.name, tool);
	}
});
afterAll(async () => {
	unmount();
	const { entry } = traceFile.getState();
	if (entry) await closeTrace(entry.handle);
	traceFile.setState(traceFile.getInitialState());
	await transport.client?.close();
});
afterEach(async () => {
	clearSelectedSignals();
	await resetDbcLibrary();
});

async function loadTrace(name: string, text?: string) {
	const bytes = text ?? (await readFile(`wasm/tests/fixtures/${name}`));
	expect(await openTraceFile(new File([bytes], name))).toBe(true);
	await onTraceOpened();
}

async function search(query = '') {
	return (await tools.get('search_signals')!.execute({ query, limit: 50 })) as {
		results: Array<{
			key: string;
			signalName: string;
			available: boolean;
			unavailableReason: string | null;
		}>;
	};
}

it('keeps absent and transported definitions searchable, rejects additions, and updates after trace replacement', async () => {
	traceFile.setState(traceFile.getInitialState());
	await addDbcFiles([
		new File([await readFile('wasm/tests/fixtures/signal-availability.dbc')], 'availability.dbc')
	]);
	expect(dbcFiles.getState().error).toBeNull();
	expect(
		(await search()).results.filter((hit) => hit.available).map((hit) => hit.signalName)
	).toEqual(['Value', 'ExtendedValue', 'MissingValue']);
	await loadTrace('signal-availability.asc');
	const hits = (await search()).results;
	expect(
		hits.map(({ signalName, available, unavailableReason }) => ({
			signalName,
			available,
			unavailableReason
		}))
	).toEqual([
		{ signalName: 'Value', available: true, unavailableReason: null },
		{
			signalName: 'ExtendedValue',
			available: false,
			unavailableReason: 'Not present in this trace'
		},
		{
			signalName: 'MissingValue',
			available: false,
			unavailableReason: 'Not present in this trace'
		},
		{
			signalName: 'TransportValue',
			available: false,
			unavailableReason: 'Plotting not yet supported'
		}
	]);
	const rejected = await tools
		.get('set_signal_selection')!
		.execute({ signals: hits.slice(1).map((hit) => hit.key), selected: true });
	expect(rejected).toMatchObject({
		changed: [],
		missing: [],
		unavailable: hits.slice(1).map((hit) => ({ key: hit.key, reason: hit.unavailableReason }))
	});
	for (const hit of hits.slice(1)) await toggleSignal(hit.key);
	expect(plotData.getState().signals).toEqual([]);
	await toggleSignal(hits[0].key);
	expect(isSignalSelected(hits[0].key)).toBe(true);
	expect(plotData.getState().signals[0].series?.values.length).toBe(0); // ID present, payload too short.
	const indexes = buildSelectorSearchIndexes(dbcFiles.getState().selectorFiles);
	const dbcIds = dbcFiles.getState().files.map((file) => file.id);
	const filter = {
		query: '',
		activeOnly: false,
		hideUnavailable: true,
		isSignalSelected,
		expanded: new Set([...dbcIds, ...indexes[0].dbc.messages.map((message) => message.key)])
	};
	const rows = (overrides: Partial<typeof filter> = {}) =>
		selectorRows(dbcFiles.getState().selectorSearchIndexes, { ...filter, ...overrides });
	const ofKind = <K extends SelectorListRow['kind']>(list: SelectorListRow[], kind: K) =>
		list.filter((row): row is Extract<SelectorListRow, { kind: K }> => row.kind === kind);
	expect(ofKind(rows(), 'message').map((row) => row.message.name)).toEqual(['Present']);
	expect(rows({ query: 'Missing' })).toEqual([]);
	expect(ofKind(rows({ activeOnly: true }), 'signal')).toHaveLength(1);
	const collapsed = rows({ expanded: new Set(dbcIds) });
	expect(ofKind(collapsed, 'message')[0]).toMatchObject({ expanded: false });
	expect(ofKind(collapsed, 'signal')).toEqual([]);
	expect((await search()).results).toHaveLength(4);
	await loadTrace('signal-availability-extended.asc');
	expect(plotData.getState().signals).toEqual([]);
	expect(
		(await search()).results.filter((hit) => hit.available).map((hit) => hit.signalName)
	).toEqual(['ExtendedValue']);
	await loadTrace('mf4/decoded-channels.mf4');
	expect((await search('Value')).results.filter((hit) => hit.available)).toEqual([]);
	const native = (await search()).results.find((hit) => hit.available)!;
	expect(native).toBeDefined();
	await toggleSignal(native.key);
	expect(plotData.getState().signals[0].series?.values.length).toBeGreaterThan(0);
	await loadTrace('mf4/hybrid-embedded-dbc.mf4');
	expect((await search()).results.some((hit) => hit.available)).toBe(true);
});

it('decodes extended ranges, nested selectors and declared classical/FD formats through application selection', async () => {
	await loadTrace('signal-acceptance.asc');
	await addDbcFiles(
		await Promise.all(
			['extended-multiplex.dbc', 'signal-acceptance-classical.dbc', 'signal-acceptance-fd.dbc'].map(
				async (name) => new File([await readFile(`wasm/tests/fixtures/${name}`)], name)
			)
		)
	);
	expect(dbcFiles.getState().error).toBeNull();
	const cases = [
		['ext_MUX_multiplexors.muxed_B_5', [5, 7], [20, 22]],
		['ext_MUX_multiplexors.muxed_D_1', [5], [30]],
		['ext_MUX_multiplexors.muxed_D_0', [7], [32]],
		['Nested.Data', [2, 3], [40, -60]],
		['NestedFD.Data', [4], [50]]
	] as const;
	for (const [label, times, values] of cases) {
		await tools
			.get('set_signal_selection')!
			.execute({ signals: [`${label} [Channel 1 · Rx]`], selected: true });
		const plotted = plotData
			.getState()
			.signals.find((signal) => signal.label === `${label} [Channel 1 · Rx]`)!;
		expect(plotted).toBeDefined();
		expect(Array.from(plotted.series!.timesMs)).toEqual(times);
		expect(Array.from(plotted.series!.values)).toEqual(values);
	}
});
