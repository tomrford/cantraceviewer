import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildSelectorSearchIndexes, type SelectorDbcFile } from '@/lib/selector-list';
import type { DecodedPlotSignal, SignalFormat } from '@/lib/signal';
import { mountWebMcp, storeHost, type ModelContext } from '@/lib/webmcp';
import { createWebMcpTools, type WebMcpHost } from '@/lib/webmcp-tools';
import type { TraceFileEntry } from '@/store/derive';
import { addAxis, removeAxis, resetAxes } from '@/store/plot-axes';
import { setViewport } from '@/store/plot-view';
import { appStore, update } from '@/store/store';

const engineKey = '["powertrain","standard",207,8,"EngineSpeed"]';
const wheelKey = '["chassis","extended",419361024,8,"WheelBasedSpeed"]';
const rpmKey = '["engine","standard",256,8,"EngineRpm"]';

const PLOT_TRACE = {
	id: 1,
	file: new File([], 'drive.mf4'),
	metadata: { skippedLineCount: 0 },
	mf4Catalog: {
		groups: [
			{
				name: 'Engine',
				signals: [
					{ id: 1, name: 'Speed', unit: 'rpm' },
					{ id: 2, name: 'Load', unit: '%' }
				]
			}
		]
	}
} as unknown as TraceFileEntry;

describe('WebMCP catalogue operations', () => {
	it('uses the selector matcher and caps search results', async () => {
		const search = toolsByName(fakeHost()).search_signals;
		expect(await search.execute({ query: 'engine speed', limit: 25 })).toMatchObject({
			truncated: false,
			results: [
				{
					key: engineKey,
					label: 'EEC1.EngineSpeed',
					arbitrationId: 'cf',
					selected: true,
					source: 'powertrain'
				}
			]
		});
		expect(await search.execute({ query: '0x18fef100' })).toMatchObject({
			results: [{ label: 'Cruise.WheelBasedSpeed', selected: false }]
		});
		expect(await search.execute({ query: 'e', limit: 10_000 })).toMatchObject({ limit: 50 });
	});

	it('resolves keys and exact labels, and reports missing and ambiguous references', async () => {
		const select = (host: WebMcpHost, signals: string[]) =>
			toolsByName(host).set_signal_selection.execute({ signals, selected: true });

		expect(await select(fakeHost(), [wheelKey, 'Status.EngineRpm', 'No.Such'])).toMatchObject({
			changed: [{ key: wheelKey }, { key: rpmKey }],
			missing: ['No.Such'],
			ambiguous: []
		});

		const duplicate = buildSelectorSearchIndexes([
			file('a', 'Engine', 'Rpm', '["a"]', '101'),
			file('b', 'Engine', 'Rpm', '["b"]', '102')
		]);
		expect(
			await select(fakeHost({ signalCatalog: () => duplicate }), ['Engine.Rpm'])
		).toMatchObject({
			changed: [],
			ambiguous: [{ ref: 'Engine.Rpm', matches: [{ key: '["a"]' }, { key: '["b"]' }] }]
		});
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
		const signals = Array.from({ length: 21 }, (_, index) =>
			plottedSignal(`key-${index}`, `Signal.${index}`)
		);
		const result = (await toolsByName(
			fakeHost({ plottedSignals: () => signals })
		).inspect_at_times.execute({ timesMs: [0] })) as {
			truncated: boolean;
			results: unknown[];
		};

		expect(result.truncated).toBe(true);
		expect(result.results).toHaveLength(20);
	});
});

describe('WebMCP shared plot', () => {
	afterEach(() => {
		resetAxes();
		update(appStore.getInitialState());
	});

	const axes = () => appStore.getState();
	const viewport = () => appStore.getState();
	const state = () => ({
		crosshairs: appStore.getState().crosshairs,
		readout: appStore.getState().legendCrosshairMode
	});

	/** Plots Engine.Speed in the real store and leaves Engine.Load unselected. */
	function plot() {
		// One plotted signal gives a full extent of 0-20 ms and, with Y padding, 0-8800.
		update({ trace: PLOT_TRACE });
		const [speed, load] = [...appStore.getState().signalByKey.values()];
		const series = { timesMs: Float64Array.of(0, 20), values: Float64Array.of(400, 8400) };
		update({
			selected: new Map([[speed.key, { colorIndex: 0, isDecoding: false, error: null, series }]])
		});
		return { tools: toolsByName(storeHost), speed, load };
	}

	it('describes the session as plain data without decoded arrays', async () => {
		const { tools, speed } = plot();
		const summary = (await tools.describe_session.execute({})) as { plotted: unknown[] };

		expect(summary.plotted).toEqual([
			expect.objectContaining({
				key: speed.key,
				label: speed.label,
				axis: 1,
				decodeStatus: 'ready'
			})
		]);
		expect(structuredClone(summary)).toEqual(summary);
		expect(JSON.stringify(summary)).not.toContain('8400');
	});

	it('places exact markers and reads their nearest samples without moving the shared plot', async () => {
		const { tools, speed } = plot();
		await tools.set_time_window.execute({ startMs: 2, endMs: 18 });
		const result = await tools.set_crosshairs.execute({
			crosshairs: [
				{ id: 2, timeMs: 16 },
				{ id: 1, timeMs: 4, value: 1000 }
			],
			readout: 'delta'
		});
		expect(state()).toEqual({
			crosshairs: [
				{ id: 1, x: 4, y: 1000 },
				{ id: 2, x: 16, y: 4400 }
			],
			readout: 'delta'
		});
		expect(() => structuredClone(result)).not.toThrow();
		expect(await tools.inspect_at_times.execute({ signals: [speed.key] })).toMatchObject({
			timesMs: [4, 16],
			deltaTimesMs: [null, 12],
			results: [
				{
					samples: [
						{ sampleTimeMs: 0, value: 400, distanceMs: 4 },
						{ sampleTimeMs: 20, value: 8400, distanceMs: 4, deltaFromPrevious: 8000 }
					]
				}
			]
		});
		const before = structuredClone(state());
		await tools.inspect_at_times.execute({ timesMs: [-5, 10, 25] });
		expect(state()).toEqual(before);
		expect(viewport().activeViewport).toEqual({ xMin: 2, xMax: 18, yMin: 0, yMax: 8800 });
	});

	it('reports clamping, keeps marker heights on moves and normalises the readout on removal', async () => {
		const { tools } = plot();
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
		expect(state().readout).toBe('c2');
		expect(state().crosshairs[0].x).toBe(20);
		await tools.set_crosshairs.execute({ crosshairs: [] });
		expect(state()).toEqual({ crosshairs: [], readout: 'c1' });
		await expect(tools.inspect_at_times.execute({})).rejects.toThrow('Place crosshairs');
	});

	it('rejects invalid marker batches without altering existing markers', async () => {
		const { tools } = plot();
		await tools.set_crosshairs.execute({ crosshairs: [{ id: 1, timeMs: 5 }] });
		const before = structuredClone(state());
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
		expect(state()).toEqual(before);
	});

	it('preserves Y zoom on time changes and resets all ranges on an empty request', async () => {
		const { tools } = plot();
		setViewport({ xMin: 5, xMax: 15, yMin: 2000, yMax: 6000 });
		expect(await tools.set_time_window.execute({ startMs: -10, endMs: 40 })).toMatchObject({
			clamped: true,
			view: { isFullTimeRange: true, axes: [{ axis: 1, range: { min: 2000, max: 6000 } }] }
		});
		await expect(tools.set_time_window.execute({ startMs: 10 })).rejects.toThrow();
		await expect(tools.set_time_window.execute({ startMs: 2, endMs: 2 })).rejects.toThrow(
			'startMs must be less than endMs'
		);
		await tools.set_time_window.execute({});
		expect(viewport().isFitAll).toBe(true);
		expect(viewport().activeViewport).toEqual({ xMin: 0, xMax: 20, yMin: 0, yMax: 8800 });
	});

	it('uses real legend axis assignments, repeats without creating extra axes and preserves empty axes', async () => {
		const { tools, speed } = plot();
		const input = { assignments: [{ signal: speed.key, axis: 2 }] };
		expect(await tools.set_signal_axes.execute(input)).toMatchObject({
			plotted: [{ key: speed.key, axis: 2 }]
		});
		await tools.set_signal_axes.execute(input);
		expect(axes().axisIds).toHaveLength(2);
		expect(axes().axisAssignment.get(speed.key)).toBe(axes().axisIds[1]);
		await tools.set_signal_axes.execute({ assignments: [{ signal: speed.label, axis: 1 }] });
		expect(axes().axisAssignment.has(speed.key)).toBe(false);
		expect(axes().axisIds).toHaveLength(2);
		addAxis();
		removeAxis(axes().axisIds[1]);
		await tools.set_signal_axes.execute(input);
		expect(axes().axisAssignment.get(speed.key)).toBe(axes().axisIds[1]);
		expect(axes().axisIds).toHaveLength(2);
	});

	it('validates the entire axis batch before changing the layout', async () => {
		const { tools, speed, load } = plot();
		for (const assignments of [
			// Engine.Load is in the catalogue but not plotted.
			[
				{ signal: speed.key, axis: 2 },
				{ signal: load.key, axis: 3 }
			],
			[{ signal: speed.key, axis: 6 }],
			// The same signal twice, by key and by label.
			[
				{ signal: speed.key, axis: 2 },
				{ signal: speed.label, axis: 3 }
			]
		])
			await expect(tools.set_signal_axes.execute({ assignments })).rejects.toThrow();
		expect(axes().axisIds).toEqual(['y']);
		expect(axes().axisAssignment.size).toBe(0);
	});

	it('enforces inspection limits for explicitly requested signals and flags times outside the samples', async () => {
		const { tools, speed } = plot();
		await expect(
			tools.inspect_at_times.execute({ timesMs: [0], signals: Array(21).fill(speed.key) })
		).rejects.toThrow();
		await expect(tools.inspect_at_times.execute({ timesMs: Array(21).fill(0) })).rejects.toThrow();
		expect(
			await tools.inspect_at_times.execute({ timesMs: [-5, 25], signals: [speed.key] })
		).toMatchObject({
			results: [
				{
					samples: [
						{ outsideSampleRange: true, sampleTimeMs: 0, value: 400, distanceMs: 5 },
						{ outsideSampleRange: true, sampleTimeMs: 20, value: 8400, distanceMs: 5 }
					]
				}
			]
		});
	});
});

describe('WebMCP registration', () => {
	it('feature-detects absence and registers with a single-input execute contract', async () => {
		vi.stubGlobal('document', {});
		mountWebMcp()();
		vi.unstubAllGlobals();
		mountWebMcp({} as ModelContext)();

		const registered = new Map<string, ReturnType<typeof createWebMcpTools>[number]>();
		const context = {
			registerTool: vi.fn(async (tool, options?: { signal?: AbortSignal }) => {
				registered.set(tool.name, tool);
				options?.signal?.addEventListener('abort', () => registered.delete(tool.name));
			})
		};
		const unmount = mountWebMcp(context);
		await vi.waitFor(() => expect(registered.has('set_signal_axes')).toBe(true));
		await expect(registered.get('describe_session')?.execute({})).resolves.toMatchObject({
			traceLoading: false
		});

		unmount();
		expect(registered.size).toBe(0);
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
		setSignalAxes: () => {},
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
		...overrides
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
): DecodedPlotSignal {
	const [messageName, signalName] = label.split('.');
	return {
		color: '#000000',
		signal: {
			kind: 'mf4',
			signalId: 0,
			key,
			label,
			messageName,
			signalName,
			format: {
				...RPM_FORMAT,
				unit: overrides.unit ?? RPM_FORMAT.unit,
				valueDescriptions: overrides.valueDescriptions ?? []
			}
		},
		series: {
			timesMs: new Float64Array([0, 10, 20]),
			values: new Float64Array(overrides.values ?? [1000, 1200, 1400])
		}
	};
}

const RPM_FORMAT: SignalFormat = {
	unit: 'rpm',
	valueType: 'integer',
	factor: 1,
	offset: 0,
	minimum: 0,
	maximum: 8000,
	valueDescriptions: []
};

function viewState(): ReturnType<WebMcpHost['view']> {
	return {
		timeDomainMs: { startMs: 0, endMs: 12_000 },
		timeWindowMs: { startMs: 1000, endMs: 2000 },
		isFullTimeRange: false,
		axes: [{ axis: 1, range: { min: 0, max: 8000 } }],
		crosshairs: [],
		readout: 'c1'
	};
}

function sessionSnapshot(): ReturnType<WebMcpHost['session']> {
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
		transient: false,
		messages: [
			{
				key: `${name}:${messageName}`,
				name: messageName,
				signals: [
					{
						kind: 'mf4',
						signalId: 0,
						key,
						label: `${messageName}.${signalName}`,
						messageName,
						signalName,
						arbitrationId,
						format: RPM_FORMAT
					}
				]
			}
		]
	};
}
