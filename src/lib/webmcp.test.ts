import { describe, expect, it, vi } from 'vitest';
import { SHORTCUTS, type ShortcutAction, type ShortcutState } from './keyboard-shortcuts.js';
import { buildSelectorSearchIndexes, type SelectorDbcFile } from './stores/dbc-files.svelte.js';
import { documentModelContext, mountWebMcp, registerTools } from './webmcp.js';
import {
	SEARCH_RESULT_LIMIT_MAX,
	WEBMCP_SHORTCUT_TOOLS,
	WEBMCP_TOOL_NAMES,
	createWebMcpTools,
	describeSession,
	resolveSignalRefs,
	runGatedShortcut,
	searchCatalogSignals,
	type WebMcpHost,
	type WebMcpSessionSnapshot,
	type WebMcpView
} from './webmcp-tools.js';

const engineKey = '["powertrain","standard:207:8","EngineSpeed"]';
const wheelKey = '["chassis","extended:419361024:8","WheelBasedSpeed"]';
const rpmKey = '["engine","standard:256:8","EngineRpm"]';

describe('WebMCP tool catalog', () => {
	it('keeps a stable tool name set and covers every shortcut except the palette', () => {
		expect([...WEBMCP_TOOL_NAMES]).toEqual([
			'describe_session',
			'search_signals',
			'select_signals',
			'open_trace',
			'add_dbc',
			'open_signal_selector',
			'zoom_in',
			'zoom_out',
			'reset_zoom',
			'toggle_box_zoom',
			'toggle_legend',
			'place_c1',
			'place_c2',
			'clear_crosshairs',
			'export_plot',
			'open_settings',
			'show_help'
		]);

		const covered = new Set<ShortcutAction>(Object.values(WEBMCP_SHORTCUT_TOOLS));
		const shortcutActions = Object.keys(SHORTCUTS) as ShortcutAction[];
		expect(shortcutActions.filter((action) => !covered.has(action))).toEqual(['showPalette']);
		expect(covered.has('showPalette')).toBe(false);
	});

	it('marks session and search read-only and keeps JSON Schema objects closed', () => {
		const tools = createWebMcpTools(fakeHost());
		const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));

		expect(byName.describe_session.annotations).toEqual({ readOnlyHint: true });
		expect(byName.search_signals.annotations).toEqual({ readOnlyHint: true });
		expect(byName.select_signals.annotations).toBeUndefined();
		expect(byName.describe_session.inputSchema).toMatchObject({
			type: 'object',
			additionalProperties: false
		});
		expect(byName.search_signals.inputSchema).toMatchObject({
			type: 'object',
			required: ['query'],
			additionalProperties: false
		});
		expect(byName.open_trace.description).toMatch(/does not accept a filesystem path/i);
		expect(byName.add_dbc.description).toMatch(/does not accept a filesystem path/i);
		expect(byName.export_plot.description).toMatch(/does not return image bytes/i);
		expect(byName.describe_session.description).toMatch(/does not return decoded sample arrays/i);
	});
});

describe('WebMCP session and search', () => {
	it('summarises labels and view state without series arrays', () => {
		const summary = describeSession(sessionSnapshot(), viewState());
		expect(summary.trace?.name).toBe('drive');
		expect(summary.trace?.durationMs).toBe(12_000);
		expect(summary.dbcs).toEqual([
			{ name: 'powertrain', origin: 'library', messageCount: 1, signalCount: 1 }
		]);
		expect(summary.plotted).toEqual([
			{
				key: engineKey,
				label: 'EEC1.EngineSpeed',
				unit: 'rpm',
				decodeStatus: 'ready',
				decodeError: null
			}
		]);
		expect(summary.view.crosshairs).toEqual([{ id: 1, x: 100, y: 0 }]);
		expect(JSON.stringify(summary)).not.toMatch(/timesMs|Float64Array|BO_/);
	});

	it('searches with the selector matcher and caps the result list', () => {
		const selected = new Set([engineKey]);
		const speed = searchCatalogSignals(catalog(), 'engine speed', (key) => selected.has(key), 25);
		expect(speed.results.map((hit) => hit.label)).toEqual(['EEC1.EngineSpeed']);
		expect(speed.results[0]).toMatchObject({
			key: engineKey,
			arbitrationId: 'cf',
			selected: true,
			source: 'powertrain'
		});

		const byId = searchCatalogSignals(catalog(), '0x18fef100', () => false, 25);
		expect(byId.results.map((hit) => hit.label)).toEqual(['Cruise.WheelBasedSpeed']);

		const capped = searchCatalogSignals(catalog(), 'e', () => false, 1);
		expect(capped.results).toHaveLength(1);
		expect(capped.truncated).toBe(true);
		expect(capped.limit).toBe(1);
	});

	it('clamps an oversized search limit to the hard cap', () => {
		const result = searchCatalogSignals(catalog(), 'e', () => false, 10_000);
		expect(result.limit).toBe(SEARCH_RESULT_LIMIT_MAX);
		expect(result.results.length).toBeLessThanOrEqual(SEARCH_RESULT_LIMIT_MAX);
	});

	it('resolves keys and labels, and reports ambiguous labels', () => {
		const indexes = catalog();
		expect(resolveSignalRefs(indexes, [engineKey]).resolved.map((item) => item.label)).toEqual([
			'EEC1.EngineSpeed'
		]);
		expect(
			resolveSignalRefs(indexes, ['Cruise.WheelBasedSpeed']).resolved.map((item) => item.key)
		).toEqual([wheelKey]);

		const duplicate = buildSelectorSearchIndexes([
			file('a', 'Engine', 'Rpm', '["a"]', '101'),
			file('b', 'Engine', 'Rpm', '["b"]', '102')
		]);
		const ambiguous = resolveSignalRefs(duplicate, ['Engine.Rpm']);
		expect(ambiguous.resolved).toEqual([]);
		expect(ambiguous.ambiguous).toHaveLength(1);
		expect(ambiguous.ambiguous[0]?.matches).toHaveLength(2);
		expect(resolveSignalRefs(indexes, ['No.Such']).missing).toEqual(['No.Such']);
	});
});

describe('WebMCP execute wrappers', () => {
	it('refuses gated shortcuts without calling through', async () => {
		const runShortcut = vi.fn();
		const host = fakeHost({
			runShortcut,
			shortcutState: () =>
				enabledState({ plotControlsDisabled: true, canResetZoom: false, canPlaceCrosshair: false })
		});

		expect(runGatedShortcut(host, 'zoomIn')).toEqual({
			ok: false,
			action: 'zoomIn',
			error: 'Open a trace and plot at least one signal first.'
		});
		expect(runShortcut).not.toHaveBeenCalled();

		const tools = toolsByName(host);
		await expect(tools.zoom_in.execute({}, abort())).resolves.toMatchObject({ ok: false });
		await expect(tools.reset_zoom.execute({}, abort())).resolves.toMatchObject({
			error: 'Open a trace and plot at least one signal first.'
		});
	});

	it('selects, skips already-selected, and stops a batch when aborted', async () => {
		const selected = new Set<string>();
		const toggleSignal = vi.fn(async (key: string) => {
			if (selected.has(key)) selected.delete(key);
			else selected.add(key);
		});
		const host = fakeHost({
			isSignalSelected: (key) => selected.has(key),
			toggleSignal
		});
		const tools = toolsByName(host);

		await tools.select_signals.execute(
			{ signals: ['EEC1.EngineSpeed', 'EEC1.EngineSpeed'], action: 'select' },
			abort()
		);
		expect(toggleSignal).toHaveBeenCalledTimes(1);

		await tools.select_signals.execute({ signals: [engineKey], action: 'select' }, abort());
		expect(toggleSignal).toHaveBeenCalledTimes(1);

		selected.clear();
		const controller = new AbortController();
		toggleSignal.mockImplementation(async () => {
			controller.abort();
		});
		await expect(
			tools.select_signals.execute(
				{ signals: [engineKey, wheelKey], action: 'select' },
				{ signal: controller.signal }
			)
		).rejects.toBeTruthy();
		expect(toggleSignal).toHaveBeenCalledTimes(2);
		expect(toggleSignal).toHaveBeenCalledWith(engineKey);
		expect(toggleSignal).not.toHaveBeenCalledWith(wheelKey);
	});

	it('places C1 at timeMs and otherwise wraps the shortcut', async () => {
		const runShortcut = vi.fn();
		const placeCrosshair = vi.fn(() => ({ x: 250, y: 1 }));
		const host = fakeHost({ runShortcut, placeCrosshair });
		const tools = toolsByName(host);

		await expect(tools.place_c1.execute({ timeMs: 250 }, abort())).resolves.toMatchObject({
			ok: true,
			placement: 'timeMs',
			crosshair: { id: 1, x: 250, y: 1 }
		});
		expect(placeCrosshair).toHaveBeenCalledWith(1, 250);
		expect(runShortcut).not.toHaveBeenCalled();

		await expect(tools.place_c1.execute({}, abort())).resolves.toMatchObject({
			ok: true,
			placement: 'pointer-or-centre'
		});
		expect(runShortcut).toHaveBeenCalledWith('placeC1');
	});

	it('opens the DBC picker without taking a path', async () => {
		const openDbcPicker = vi.fn();
		const tools = toolsByName(fakeHost({ openDbcPicker }));
		await expect(tools.add_dbc.execute({}, abort())).resolves.toMatchObject({ ok: true });
		expect(openDbcPicker).toHaveBeenCalledTimes(1);
	});
});

describe('WebMCP registration', () => {
	it('feature-detects a missing modelContext', () => {
		expect(documentModelContext()).toBeNull();
		expect(mountWebMcp(fakePageHost(), null)).toEqual(expect.any(Function));
		mountWebMcp(fakePageHost(), null)();
	});

	it('registers tools and unregisters them when the mount signal aborts', async () => {
		const registered = new Map<string, unknown>();
		const context = {
			registerTool: vi.fn(async (tool: { name: string }, options?: { signal?: AbortSignal }) => {
				if (options?.signal?.aborted) throw options.signal.reason ?? new Error('aborted');
				registered.set(tool.name, tool);
				options?.signal?.addEventListener('abort', () => registered.delete(tool.name));
			})
		};

		const unmount = mountWebMcp(fakePageHost(), context);
		await vi.waitFor(() => {
			expect(registered.size).toBe(WEBMCP_TOOL_NAMES.length);
		});
		expect(context.registerTool.mock.calls.map((call) => call[0].name)).toEqual([
			...WEBMCP_TOOL_NAMES
		]);

		unmount();
		expect(registered.size).toBe(0);
	});

	it('stops registering after abort', async () => {
		const controller = new AbortController();
		const registerTool = vi.fn(async (tool: { name: string }) => {
			if (tool.name === 'search_signals') controller.abort();
		});
		await registerTools({ registerTool }, createWebMcpTools(fakeHost()), controller.signal);
		expect(registerTool.mock.calls.map((call) => call[0].name)).toEqual([
			'describe_session',
			'search_signals'
		]);
	});
});

function toolsByName(host: WebMcpHost) {
	return Object.fromEntries(createWebMcpTools(host).map((tool) => [tool.name, tool]));
}

function abort(): { signal: AbortSignal } {
	return { signal: new AbortController().signal };
}

function fakeHost(overrides: Partial<WebMcpHost> = {}): WebMcpHost {
	const selected = new Set<string>([engineKey]);
	return {
		shortcutState: () => enabledState(),
		runShortcut: vi.fn(),
		openDbcPicker: vi.fn(),
		placeCrosshair: vi.fn(() => ({ x: 0, y: 0 })),
		view: () => viewState(),
		signalCatalog: () => catalog(),
		isSignalSelected: (key) => selected.has(key),
		toggleSignal: vi.fn(async (key: string) => {
			if (selected.has(key)) selected.delete(key);
			else selected.add(key);
		}),
		session: () => sessionSnapshot(),
		exportPlot: vi.fn(async () => ({ ok: true })),
		...overrides
	};
}

function fakePageHost() {
	return {
		shortcutState: () => enabledState(),
		runShortcut: vi.fn(),
		openDbcPicker: vi.fn(),
		placeCrosshair: vi.fn(() => ({ x: 0, y: 0 })),
		view: () => viewState()
	};
}

function enabledState(overrides: Partial<ShortcutState> = {}): ShortcutState {
	return {
		traceLoading: false,
		plotControlsDisabled: false,
		canResetZoom: true,
		canPlaceCrosshair: true,
		hasCrosshairs: true,
		...overrides
	};
}

function viewState(): WebMcpView {
	return {
		legendVisible: true,
		boxZoomEnabled: false,
		viewport: { xMin: 0, xMax: 1000, yMin: 0, yMax: 1 },
		isFitAll: false,
		crosshairs: [{ id: 1, x: 100, y: 0 }]
	};
}

function sessionSnapshot(): WebMcpSessionSnapshot {
	return {
		trace: {
			name: 'drive',
			fileName: 'drive.asc',
			hasRawFrames: true,
			validMessageCount: 12,
			skippedLineCount: 0,
			durationNs: 12_000_000_000,
			durationMs: 12_000,
			measurementStartMs: null,
			mf4NativeSignalCount: 0,
			warning: null
		},
		traceLoading: false,
		dbcs: [{ name: 'powertrain', origin: 'library', messageCount: 1, signalCount: 1 }],
		plotted: [
			{
				key: engineKey,
				label: 'EEC1.EngineSpeed',
				unit: 'rpm',
				decodeStatus: 'ready',
				decodeError: null
			}
		]
	};
}

function catalog() {
	return buildSelectorSearchIndexes([
		file('powertrain', 'EEC1', 'EngineSpeed', engineKey, 'cf'),
		file('chassis', 'Cruise', 'WheelBasedSpeed', wheelKey, '18fef100'),
		file('engine', 'Status', 'EngineRpm', rpmKey, '101')
	]);
}

function file(
	name: string,
	messageName: string,
	signalName: string,
	key: string,
	arbitrationId: string
): SelectorDbcFile {
	return {
		id: name,
		name,
		kind: 'dbc',
		transient: false,
		messages: [
			{
				key: `${name}:${messageName}`,
				name: messageName,
				signals: [
					{
						key,
						label: `${messageName}.${signalName}`,
						messageName,
						signalName,
						arbitrationId
					}
				]
			}
		]
	};
}
