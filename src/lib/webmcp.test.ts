import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebMcpPlotHost } from './webmcp-plot.js';
import { PlotViewportState } from './plot-viewport-state.svelte.js';
import { plotAxes } from './stores/plot-axes.svelte.js';
import type { LegendCrosshairMode, PlotCrosshair } from './plot-crosshair.js';
import { buildSelectorSearchIndexes, type SelectorDbcFile } from './stores/dbc-files.svelte.js';
import { documentModelContext, mountWebMcp, registerTools } from './webmcp.js';
import {
	INSPECTION_SIGNAL_LIMIT,
	SEARCH_RESULT_LIMIT_MAX,
	createWebMcpTools,
	describeSession,
	resolveSignalRefs,
	searchCatalogSignals,
	type WebMcpHost,
	type WebMcpPlottedSignal,
	type WebMcpSessionSnapshot,
	type WebMcpView
} from './webmcp-tools.js';

const engineKey = '["powertrain","standard:207:8","EngineSpeed"]';
const wheelKey = '["chassis","extended:419361024:8","WheelBasedSpeed"]';
const rpmKey = '["engine","standard:256:8","EngineRpm"]';

describe('WebMCP tool contract', () => {
	it('summarises plain session state without decoded arrays', () => {
		const view = viewState();
		const summary = describeSession(sessionSnapshot(), {
			...view,
			timeDomainMs: new Proxy(view.timeDomainMs!, {}),
			timeWindowMs: new Proxy(view.timeWindowMs!, {})
		});

		expect(summary.trace?.name).toBe('drive');
		expect(summary.plotted[0]).toMatchObject({
			key: engineKey,
			label: 'EEC1.EngineSpeed',
			decodeStatus: 'ready'
		});
		expect(summary.view).toEqual({
			timeDomainMs: { startMs: 0, endMs: 12_000 },
			timeWindowMs: { startMs: 1000, endMs: 2000 },
			isFullTimeRange: false,
			axes: [{ axis: 1, range: { min: 0, max: 8000 } }],
			crosshairs: [],
			readout: 'c1'
		});
		expect(() => structuredClone(summary)).not.toThrow();
		expect(JSON.stringify(summary)).not.toMatch(/Float64Array|values|WASM handle/);
	});
});

describe('WebMCP catalogue operations', () => {
	it('uses the selector matcher and caps search results', () => {
		const selected = new Set([engineKey]);
		const speed = searchCatalogSignals(catalog(), 'engine speed', (key) => selected.has(key), 25);
		expect(speed.results).toEqual([
			expect.objectContaining({
				key: engineKey,
				label: 'EEC1.EngineSpeed',
				arbitrationId: 'cf',
				selected: true,
				source: 'powertrain'
			})
		]);
		expect(
			searchCatalogSignals(catalog(), '0x18fef100', () => false, 25).results.map((hit) => hit.label)
		).toEqual(['Cruise.WheelBasedSpeed']);

		const capped = searchCatalogSignals(catalog(), 'e', () => false, 10_000);
		expect(capped.limit).toBe(SEARCH_RESULT_LIMIT_MAX);
		expect(capped.results.length).toBeLessThanOrEqual(SEARCH_RESULT_LIMIT_MAX);
		expect(searchCatalogSignals(catalog(), 'engine speed', () => false, 1).truncated).toBe(false);
	});

	it('reports missing and ambiguous exact references', () => {
		expect(resolveSignalRefs(catalog(), [engineKey]).resolved[0]?.label).toBe('EEC1.EngineSpeed');
		expect(resolveSignalRefs(catalog(), ['Cruise.WheelBasedSpeed']).resolved[0]?.key).toBe(
			wheelKey
		);

		const duplicate = buildSelectorSearchIndexes([
			file('a', 'Engine', 'Rpm', '["a"]', '101'),
			file('b', 'Engine', 'Rpm', '["b"]', '102')
		]);
		const ambiguous = resolveSignalRefs(duplicate, ['Engine.Rpm']);
		expect(ambiguous.resolved).toEqual([]);
		expect(ambiguous.ambiguous[0]?.matches).toHaveLength(2);
		expect(resolveSignalRefs(catalog(), ['No.Such']).missing).toEqual(['No.Such']);
	});

	it('sets selection explicitly and stops an aborted batch', async () => {
		const selected = new Set<string>();
		const toggleSignal = vi.fn(async (key: string) => {
			if (selected.has(key)) selected.delete(key);
			else selected.add(key);
		});
		const tools = toolsByName(
			fakeHost({ isSignalSelected: (key) => selected.has(key), toggleSignal })
		);

		await expect(
			tools.set_signal_selection.execute({
				signals: ['EEC1.EngineSpeed', 'EEC1.EngineSpeed'],
				selected: true
			})
		).resolves.toMatchObject({ changed: [{ key: engineKey }], unchanged: [] });
		await tools.set_signal_selection.execute({ signals: [engineKey], selected: true });
		expect(toggleSignal).toHaveBeenCalledTimes(1);

		selected.clear();
		const controller = new AbortController();
		toggleSignal.mockImplementation(async () => controller.abort());
		await expect(
			tools.set_signal_selection.execute(
				{ signals: [engineKey, wheelKey], selected: true },
				{ signal: controller.signal }
			)
		).rejects.toBeTruthy();
		expect(toggleSignal).toHaveBeenCalledWith(engineKey);
		expect(toggleSignal).not.toHaveBeenCalledWith(wheelKey);
	});
});

describe('WebMCP numerical analysis', () => {
	it('clamps and applies an exact time window', async () => {
		const setTimeWindow = vi.fn((range) => range);
		const tool = toolsByName(fakeHost({ setTimeWindow })).set_time_window;

		await expect(tool.execute({ startMs: -50, endMs: 500 })).resolves.toMatchObject({
			ok: true,
			requested: { startMs: -50, endMs: 500 },
			domain: { startMs: 0, endMs: 12_000 },
			applied: { startMs: 0, endMs: 500 },
			clamped: true
		});
		expect(setTimeWindow).toHaveBeenCalledWith({ startMs: 0, endMs: 500 });
		await expect(tool.execute({ startMs: 2, endMs: 2 })).rejects.toThrow(
			'startMs must be less than endMs'
		);
	});

	it('returns nearest numerical samples, formatted values, and deltas', async () => {
		const tool = toolsByName(fakeHost()).inspect_at_times;
		const result = (await tool.execute({
			timesMs: [4, 16],
			signals: [engineKey, 'Status.EngineRpm']
		})) as {
			results: Array<{ key: string; samples: Array<Record<string, unknown>> }>;
		};

		expect(result.results[0]).toMatchObject({
			key: engineKey,
			sourcePoints: 3,
			sampleRangeMs: { startMs: 0, endMs: 20 },
			samples: [
				{
					requestedTimeMs: 4,
					sampleTimeMs: 0,
					distanceMs: 4,
					outsideSampleRange: false,
					value: 1000,
					formattedValue: '1000 rpm',
					deltaFromPrevious: null
				},
				{
					requestedTimeMs: 16,
					sampleTimeMs: 20,
					distanceMs: 4,
					value: 1400,
					deltaFromPrevious: 400
				}
			]
		});
		expect(result.results[1]?.samples[1]).toMatchObject({
			value: 2,
			formattedValue: 'Running',
			deltaFromPrevious: null
		});
	});

	it('caps the default plotted-signal set', async () => {
		const signals = Array.from({ length: INSPECTION_SIGNAL_LIMIT + 1 }, (_, index) =>
			plottedSignal(`key-${index}`, `Signal.${index}`)
		);
		const result = (await toolsByName(
			fakeHost({ plottedSignals: () => signals })
		).inspect_at_times.execute({ timesMs: [0] })) as {
			truncated: boolean;
			results: unknown[];
		};

		expect(result.truncated).toBe(true);
		expect(result.results).toHaveLength(INSPECTION_SIGNAL_LIMIT);
	});
});

describe('WebMCP shared plot', () => {
	afterEach(() => plotAxes.reset());

	function plot() {
		const viewport = new PlotViewportState();
		viewport.domainSource = () => ({ xMin: 0, xMax: 20, yMin: 0, yMax: 8000 });
		const state: { crosshairs: PlotCrosshair[]; readout: LegendCrosshairMode } = {
			crosshairs: [],
			readout: 'c1'
		};
		const host = fakeHost({
			...createWebMcpPlotHost(viewport, state),
			session: () => ({
				...sessionSnapshot(),
				plotted: sessionSnapshot().plotted.map((signal) => ({
					...signal,
					axis: plotAxes.ids.indexOf(plotAxes.assignment.get(signal.key) ?? 'y') + 1
				}))
			})
		});
		return { viewport, state, tools: toolsByName(host) };
	}

	it('places exact markers and reads their nearest samples without moving the shared plot', async () => {
		const { viewport, state, tools } = plot();
		await tools.set_time_window.execute({ startMs: 2, endMs: 18 });
		const result = await tools.set_crosshairs.execute({
			crosshairs: [
				{ id: 2, timeMs: 16 },
				{ id: 1, timeMs: 4, value: 1000 }
			],
			readout: 'delta'
		});
		expect(state).toEqual({
			crosshairs: [
				{ id: 1, x: 4, y: 1000 },
				{ id: 2, x: 16, y: 4000 }
			],
			readout: 'delta'
		});
		expect(() => structuredClone(result)).not.toThrow();
		expect(await tools.inspect_at_times.execute({ signals: [engineKey] })).toMatchObject({
			timesMs: [4, 16],
			deltaTimesMs: [null, 12],
			results: [
				{
					samples: [
						{ sampleTimeMs: 0, value: 1000, distanceMs: 4 },
						{ sampleTimeMs: 20, value: 1400, distanceMs: 4, deltaFromPrevious: 400 }
					]
				}
			]
		});
		const before = structuredClone(state);
		await tools.inspect_at_times.execute({ timesMs: [-5, 10, 25] });
		expect(state).toEqual(before);
		expect(viewport.activeViewport).toEqual({ xMin: 2, xMax: 18, yMin: 0, yMax: 8000 });
	});

	it('reports clamping, keeps marker heights on moves and normalises the readout on removal', async () => {
		const { state, tools } = plot();
		await tools.set_crosshairs.execute({
			crosshairs: [
				{ id: 1, timeMs: 5, value: 1200 },
				{ id: 2, timeMs: 10 }
			],
			readout: 'delta'
		});
		expect(
			await tools.set_crosshairs.execute({ crosshairs: [{ id: 1, timeMs: -10 }] })
		).toMatchObject({
			clamped: true,
			view: { crosshairs: [{ id: 1, timeMs: 0, value: 1200 }], readout: 'c1' }
		});
		await tools.set_crosshairs.execute({ crosshairs: [{ id: 2, timeMs: 50 }] });
		expect(state.readout).toBe('c2');
		expect(state.crosshairs[0].x).toBe(20);
		await tools.set_crosshairs.execute({ crosshairs: [] });
		expect(state).toEqual({ crosshairs: [], readout: 'c1' });
		await expect(tools.inspect_at_times.execute({})).rejects.toThrow('Place crosshairs');
	});

	it('rejects invalid marker batches without altering existing markers', async () => {
		const { state, tools } = plot();
		await tools.set_crosshairs.execute({ crosshairs: [{ id: 1, timeMs: 5 }] });
		const before = structuredClone(state);
		for (const input of [
			{
				crosshairs: [
					{ id: 1, timeMs: 2 },
					{ id: 1, timeMs: 3 }
				]
			},
			{ crosshairs: [{ id: 2, timeMs: Number.NaN }] },
			{ crosshairs: [{ id: 2, timeMs: 5, value: Infinity }] },
			{ crosshairs: [{ id: 2, timeMs: 5 }], readout: 'delta' }
		])
			await expect(tools.set_crosshairs.execute(input)).rejects.toThrow();
		expect(state).toEqual(before);
	});

	it('preserves Y zoom on time changes and resets all ranges on an empty request', async () => {
		const { viewport, tools } = plot();
		viewport.setManual({ xMin: 5, xMax: 15, yMin: 2000, yMax: 6000 });
		expect(await tools.set_time_window.execute({ startMs: -10, endMs: 40 })).toMatchObject({
			clamped: true,
			view: { isFullTimeRange: true, axes: [{ axis: 1, range: { min: 2000, max: 6000 } }] }
		});
		await expect(tools.set_time_window.execute({ startMs: 10 })).rejects.toThrow();
		await tools.set_time_window.execute({});
		expect(viewport.isFitAll).toBe(true);
		expect(viewport.activeViewport).toEqual({ xMin: 0, xMax: 20, yMin: 0, yMax: 8000 });
	});

	it('uses real legend axis assignments, repeats without creating extra axes and preserves empty axes', async () => {
		const { tools } = plot();
		const input = { assignments: [{ signal: engineKey, axis: 2 }] };
		expect(await tools.set_signal_axes.execute(input)).toMatchObject({
			plotted: [{ key: engineKey, axis: 2 }]
		});
		await tools.set_signal_axes.execute(input);
		expect(plotAxes.ids).toHaveLength(2);
		expect(plotAxes.assignment.get(engineKey)).toBe(plotAxes.ids[1]);
		await tools.set_signal_axes.execute({ assignments: [{ signal: 'EEC1.EngineSpeed', axis: 1 }] });
		expect(plotAxes.assignment.has(engineKey)).toBe(false);
		expect(plotAxes.ids).toHaveLength(2);
		// Removing an intermediate axis via the UI changes ordinal Y numbers, not tool identity.
		plotAxes.addAxis();
		plotAxes.removeAxis(plotAxes.ids[1]);
		await tools.set_signal_axes.execute(input);
		expect(plotAxes.assignment.get(engineKey)).toBe(plotAxes.ids[1]);
		expect(plotAxes.ids).toHaveLength(2);
	});

	it('validates the entire axis batch before changing the layout', async () => {
		const { tools } = plot();
		for (const assignments of [
			[
				{ signal: engineKey, axis: 2 },
				{ signal: wheelKey, axis: 3 }
			],
			[{ signal: engineKey, axis: 6 }],
			[
				{ signal: engineKey, axis: 2 },
				{ signal: 'EEC1.EngineSpeed', axis: 3 }
			]
		])
			await expect(tools.set_signal_axes.execute({ assignments })).rejects.toThrow();
		expect(plotAxes.ids).toEqual(['y']);
		expect(plotAxes.assignment.size).toBe(0);
	});

	it('enforces inspection limits for explicitly requested signals as well as defaults', async () => {
		const { tools } = plot();
		await expect(
			tools.inspect_at_times.execute({ timesMs: [0], signals: Array(21).fill(engineKey) })
		).rejects.toThrow();
		await expect(tools.inspect_at_times.execute({ timesMs: Array(21).fill(0) })).rejects.toThrow();
		expect(
			await tools.inspect_at_times.execute({ timesMs: [-5, 25], signals: [engineKey] })
		).toMatchObject({
			results: [
				{
					samples: [
						{ outsideSampleRange: true, sampleTimeMs: 0, distanceMs: 5 },
						{ outsideSampleRange: true, sampleTimeMs: 20, distanceMs: 5 }
					]
				}
			]
		});
	});
});

describe('WebMCP registration', () => {
	it('feature-detects absence and registers with a single-input execute contract', async () => {
		expect(documentModelContext()).toBeNull();
		mountWebMcp(fakePageHost(), null)();

		const registered = new Map<string, ReturnType<typeof createWebMcpTools>[number]>();
		const context = {
			registerTool: vi.fn(async (tool, options?: { signal?: AbortSignal }) => {
				registered.set(tool.name, tool);
				options?.signal?.addEventListener('abort', () => registered.delete(tool.name));
			})
		};
		const unmount = mountWebMcp(fakePageHost(), context);
		await vi.waitFor(() => expect(registered.has('set_signal_axes')).toBe(true));
		await expect(registered.get('describe_session')?.execute({})).resolves.toMatchObject({
			traceLoading: false
		});

		unmount();
		expect(registered.size).toBe(0);
	});

	it('stops registration after abort', async () => {
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

function toolsByName(
	host: WebMcpHost
): Record<string, ReturnType<typeof createWebMcpTools>[number]> {
	return Object.fromEntries(createWebMcpTools(host).map((tool) => [tool.name, tool]));
}

function fakeHost(overrides: Partial<WebMcpHost> = {}): WebMcpHost {
	const selected = new Set<string>([engineKey]);
	return {
		view: () => viewState(),
		setTimeWindow: (range) => range,
		setCrosshairs: () => {},
		setSignalAxes: async () => {},
		signalCatalog: () => catalog(),
		plottedSignals: () => [
			plottedSignal(engineKey, 'EEC1.EngineSpeed'),
			plottedSignal(rpmKey, 'Status.EngineRpm', {
				unit: '',
				values: [1, 1, 2],
				valueDescriptions: [
					{ rawValue: 1, label: 'Stopped' },
					{ rawValue: 2, label: 'Running' }
				]
			})
		],
		isSignalSelected: (key) => selected.has(key),
		toggleSignal: vi.fn(async (key: string) => {
			if (selected.has(key)) selected.delete(key);
			else selected.add(key);
		}),
		session: () => sessionSnapshot(),
		dbcLibrary: () => ({ loaded: true, loading: false }),
		...overrides
	};
}

function fakePageHost() {
	return {
		view: () => viewState(),
		setTimeWindow: (range: { startMs: number; endMs: number } | null) => range,
		setCrosshairs: () => {},
		setSignalAxes: async () => {}
	};
}

function plottedSignal(
	key: string,
	label: string,
	overrides: {
		unit?: string;
		values?: number[];
		valueDescriptions?: Array<{ rawValue: number; label: string }>;
	} = {}
): WebMcpPlottedSignal {
	return {
		key,
		label,
		unit: overrides.unit ?? 'rpm',
		factor: 1,
		offset: 0,
		minimum: 0,
		maximum: 8000,
		valueDescriptions: overrides.valueDescriptions ?? [],
		series: {
			timesMs: new Float64Array([0, 10, 20]),
			values: new Float64Array(overrides.values ?? [1000, 1200, 1400])
		}
	};
}

function viewState(): WebMcpView {
	return {
		timeDomainMs: { startMs: 0, endMs: 12_000 },
		timeWindowMs: { startMs: 1000, endMs: 2000 },
		isFullTimeRange: false,
		axes: [{ axis: 1, range: { min: 0, max: 8000 } }],
		crosshairs: [],
		readout: 'c1'
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
		dbcLibrary: { loaded: true, loading: false },
		dbcs: [{ name: 'powertrain', origin: 'library', messageCount: 1, signalCount: 1 }],
		plotted: [
			{
				key: engineKey,
				label: 'EEC1.EngineSpeed',
				unit: 'rpm',
				axis: 1,
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
