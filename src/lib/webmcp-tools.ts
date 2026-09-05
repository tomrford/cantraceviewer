import { formatDecodedValue, nearestSignalSample } from '$lib/signal-plot-data.js';
import { searchIndex } from '$lib/search-index.js';
import type { SelectorSearchIndex } from '$lib/stores/dbc-files.svelte.js';
import type { PlotSignal } from '$lib/stores/plot-data.svelte.js';
import { MAX_Y_AXES } from '$lib/plot-axes.js';
import type { CrosshairId, LegendCrosshairMode } from '$lib/plot-crosshair.js';
import type { PlotAxisRange } from '$lib/plot-viewport.js';

export const SEARCH_RESULT_LIMIT_MAX = 50;
export const SEARCH_RESULT_LIMIT_DEFAULT = 25;
export const SIGNAL_SELECTION_LIMIT = 50;
export const INSPECTION_SIGNAL_LIMIT = 20;
export const INSPECTION_TIME_LIMIT = 20;

export type WebMcpTimeRange = {
	startMs: number;
	endMs: number;
};

export type WebMcpView = {
	timeDomainMs: WebMcpTimeRange | null;
	timeWindowMs: WebMcpTimeRange | null;
	isFullTimeRange: boolean;
	axes: Array<{ axis: number; range: PlotAxisRange | null }>;
	crosshairs: WebMcpCrosshair[];
	readout: LegendCrosshairMode;
};

export type WebMcpCrosshair = { id: CrosshairId; timeMs: number; value: number };
export type WebMcpCrosshairInput = Omit<WebMcpCrosshair, 'value'> & { value?: number };

export type WebMcpPlottedSignal = Pick<
	PlotSignal,
	'key' | 'label' | 'unit' | 'factor' | 'offset' | 'minimum' | 'maximum' | 'valueDescriptions'
> & {
	series: NonNullable<PlotSignal['series']>;
};

export type WebMcpHost = {
	view: () => WebMcpView;
	setTimeWindow: (range: WebMcpTimeRange | null) => WebMcpTimeRange | null;
	setCrosshairs: (crosshairs: WebMcpCrosshairInput[], readout?: LegendCrosshairMode) => void;
	setSignalAxes: (assignments: Array<{ key: string; axis: number }>) => Promise<void>;
	signalCatalog: () => SelectorSearchIndex[];
	plottedSignals: () => WebMcpPlottedSignal[];
	isSignalSelected: (key: string) => boolean;
	toggleSignal: (key: string) => Promise<void>;
	session: () => WebMcpSessionSnapshot;
	dbcLibrary: () => { loaded: boolean; loading: boolean };
};

export type WebMcpSessionSnapshot = {
	trace: {
		name: string;
		fileName: string;
		hasRawFrames: boolean;
		validMessageCount: number;
		skippedLineCount: number;
		durationNs: number | null;
		durationMs: number | null;
		measurementStartMs: number | null;
		mf4NativeSignalCount: number;
		warning: string | null;
	} | null;
	traceLoading: boolean;
	dbcLibrary: { loaded: boolean; loading: boolean };
	dbcs: Array<{
		name: string;
		origin: 'library' | 'mf4';
		messageCount: number;
		signalCount: number;
	}>;
	plotted: Array<{
		key: string;
		label: string;
		unit: string;
		axis: number;
		decodeStatus: 'idle' | 'decoding' | 'ready' | 'error';
		decodeError: string | null;
	}>;
};

export type WebMcpTool = {
	name: string;
	title: string;
	description: string;
	inputSchema: Record<string, unknown>;
	annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
	execute: (input: object, options?: { signal?: AbortSignal }) => Promise<unknown>;
};

type SignalReference = { key: string; label: string };

const EMPTY_OBJECT_SCHEMA = {
	type: 'object',
	additionalProperties: false
} as const;

function throwIfAborted(signal?: AbortSignal): void {
	if (signal === undefined || !signal.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	throw new DOMException('The operation was aborted.', 'AbortError');
}

export function describeSession(snapshot: WebMcpSessionSnapshot, view: WebMcpView) {
	return {
		trace: snapshot.trace === null ? null : { ...snapshot.trace },
		traceLoading: snapshot.traceLoading,
		dbcLibrary: { ...snapshot.dbcLibrary },
		dbcs: snapshot.dbcs.map((dbc) => ({ ...dbc })),
		plotted: snapshot.plotted.map((signal) => ({ ...signal })),
		view: copyView(view),
		notes: [
			'Load trace and DBC files with the visible browser controls.',
			...(snapshot.dbcLibrary.loaded
				? []
				: [
						'The saved DBC library has not finished loading. An empty DBC list is not the final catalogue.'
					])
		]
	};
}

export function searchCatalogSignals(
	indexes: SelectorSearchIndex[],
	query: string,
	isSignalSelected: (key: string) => boolean,
	limit: number,
	library: { loaded: boolean; loading: boolean } = { loaded: true, loading: false }
) {
	const cappedLimit = clampLimit(limit);
	const hits: Array<{
		key: string;
		label: string;
		messageName: string;
		signalName: string;
		arbitrationId: string | null;
		selected: boolean;
		source: string;
	}> = [];

	for (const index of indexes) {
		for (const { signal } of searchIndex(index.signals, query)) {
			hits.push({
				key: signal.key,
				label: signal.label,
				messageName: signal.messageName,
				signalName: signal.signalName,
				arbitrationId: signal.arbitrationId ?? null,
				selected: isSignalSelected(signal.key),
				source: index.dbc.name
			});
			if (hits.length > cappedLimit) {
				return searchResult(query, cappedLimit, true, hits.slice(0, cappedLimit), library);
			}
		}
	}

	return searchResult(query, cappedLimit, false, hits, library);
}

export function resolveSignalRefs(indexes: SelectorSearchIndex[], refs: string[]) {
	return resolveRefs(
		indexes.flatMap((index) => index.signals.items.map(({ signal }) => signal)),
		refs
	);
}

function resolveRefs<T extends SignalReference>(signals: T[], refs: string[]) {
	const byKey = new Map(signals.map((signal) => [signal.key, signal]));
	const byLabel = new Map<string, T[]>();

	for (const signal of signals) {
		const label = signal.label.toLowerCase();
		const matches = byLabel.get(label);
		if (matches) matches.push(signal);
		else byLabel.set(label, [signal]);
	}

	const resolved: T[] = [];
	const missing: string[] = [];
	const ambiguous: Array<{ ref: string; matches: Array<{ key: string; label: string }> }> = [];
	const seen = new Set<string>();

	for (const ref of refs) {
		const exact = byKey.get(ref);
		const matches = exact === undefined ? (byLabel.get(ref.toLowerCase()) ?? []) : [exact];
		if (matches.length === 0) {
			missing.push(ref);
			continue;
		}
		if (matches.length > 1) {
			ambiguous.push({
				ref,
				matches: matches.map(({ key, label }) => ({ key, label }))
			});
			continue;
		}
		const signal = matches[0];
		if (!seen.has(signal.key)) {
			resolved.push(signal);
			seen.add(signal.key);
		}
	}

	return { resolved, missing, ambiguous };
}

export function createWebMcpTools(host: WebMcpHost): WebMcpTool[] {
	return [
		{
			name: 'describe_session',
			title: 'Describe analysis session',
			description:
				'Summarise loaded files, selected signals and their axes, decode states, visible ranges, crosshairs and legend readout. Use screenshots to inspect the plot shape.',
			inputSchema: EMPTY_OBJECT_SCHEMA,
			annotations: { readOnlyHint: true, untrustedContentHint: true },
			execute: async (_input, options) => {
				throwIfAborted(options?.signal);
				return describeSession(host.session(), host.view());
			}
		},
		{
			name: 'search_signals',
			title: 'Search signals',
			description:
				'Search the loaded DBC and MF4-native signal catalogues. Results contain stable keys for later tool calls.',
			inputSchema: {
				type: 'object',
				properties: {
					query: { type: 'string', description: 'Signal, message, or CAN identifier text.' },
					limit: {
						type: 'integer',
						minimum: 1,
						maximum: SEARCH_RESULT_LIMIT_MAX,
						default: SEARCH_RESULT_LIMIT_DEFAULT
					}
				},
				required: ['query'],
				additionalProperties: false
			},
			annotations: { readOnlyHint: true, untrustedContentHint: true },
			execute: async (input, options) => {
				throwIfAborted(options?.signal);
				const { query, limit = SEARCH_RESULT_LIMIT_DEFAULT } = input as {
					query: string;
					limit?: number;
				};
				return searchCatalogSignals(
					host.signalCatalog(),
					query,
					host.isSignalSelected,
					limit,
					host.dbcLibrary()
				);
			}
		},
		{
			name: 'set_signal_selection',
			title: 'Set signal selection',
			description:
				'Select or deselect signals by stable key or exact label. Selection decodes signals for plotting and inspection.',
			inputSchema: {
				type: 'object',
				properties: {
					signals: {
						type: 'array',
						items: { type: 'string' },
						minItems: 1,
						maxItems: SIGNAL_SELECTION_LIMIT
					},
					selected: { type: 'boolean' }
				},
				required: ['signals', 'selected'],
				additionalProperties: false
			},
			annotations: { untrustedContentHint: true },
			execute: async (input, options) => {
				const { signals, selected } = input as { signals: string[]; selected: boolean };
				validateRefs(signals, SIGNAL_SELECTION_LIMIT);
				const { resolved, missing, ambiguous } = resolveSignalRefs(host.signalCatalog(), signals);
				const changed: Array<{ key: string; label: string; selected: boolean }> = [];
				const unchanged: Array<{ key: string; label: string; selected: boolean }> = [];

				for (const signal of resolved) {
					throwIfAborted(options?.signal);
					if (host.isSignalSelected(signal.key) === selected) {
						unchanged.push({ key: signal.key, label: signal.label, selected });
						continue;
					}
					await host.toggleSignal(signal.key);
					changed.push({ key: signal.key, label: signal.label, selected });
				}

				throwIfAborted(options?.signal);
				return { selected, changed, unchanged, missing, ambiguous };
			}
		},
		{
			name: 'set_time_window',
			title: 'Set time window',
			description:
				'Set the visible plot time window in trace-relative milliseconds, clamped to the plot domain, preserving Y zoom. Omit both bounds to reset all axes to their full extent.',
			inputSchema: {
				type: 'object',
				properties: {
					startMs: { type: 'number' },
					endMs: { type: 'number' }
				},
				additionalProperties: false
			},
			execute: async (input, options) => {
				throwIfAborted(options?.signal);
				const bounds = input as Partial<WebMcpTimeRange>;
				if (bounds.startMs === undefined && bounds.endMs === undefined) {
					const applied = host.setTimeWindow(null);
					return { ok: applied !== null, applied, view: copyView(host.view()) };
				}
				const requested = bounds as WebMcpTimeRange;
				if (!Number.isFinite(requested.startMs) || !Number.isFinite(requested.endMs)) {
					throw new TypeError('startMs and endMs must be finite numbers.');
				}
				if (requested.startMs >= requested.endMs) {
					throw new RangeError('startMs must be less than endMs.');
				}

				const domain = host.view().timeDomainMs;
				if (domain === null) {
					return { ok: false, error: 'No decoded signal time domain is available.' };
				}
				const clamped = {
					startMs: Math.max(domain.startMs, requested.startMs),
					endMs: Math.min(domain.endMs, requested.endMs)
				};
				if (clamped.startMs >= clamped.endMs) {
					return {
						ok: false,
						error: 'The requested window does not overlap the signal time domain.'
					};
				}

				const applied = host.setTimeWindow(clamped);
				return {
					ok: applied !== null,
					requested: { ...requested },
					domain: { ...domain },
					applied,
					clamped: applied?.startMs !== requested.startMs || applied?.endMs !== requested.endMs,
					view: copyView(host.view())
				};
			}
		},
		{
			name: 'inspect_at_times',
			title: 'Inspect signal values at times',
			description:
				'Read nearest decoded samples, units, enum labels and deltas without moving the plot. Omit timesMs to read current crosshairs in C1/C2 order. Sample timestamps and distances show sampling uncertainty; nearest samples are not interpolated or necessarily simultaneous.',
			inputSchema: {
				type: 'object',
				properties: {
					timesMs: {
						type: 'array',
						items: { type: 'number' },
						minItems: 1,
						maxItems: INSPECTION_TIME_LIMIT
					},
					signals: {
						type: 'array',
						items: { type: 'string' },
						minItems: 1,
						maxItems: INSPECTION_SIGNAL_LIMIT,
						description: 'Stable keys or exact labels. Omit to inspect plotted signals.'
					}
				},
				additionalProperties: false
			},
			annotations: { readOnlyHint: true, untrustedContentHint: true },
			execute: async (input, options) => {
				throwIfAborted(options?.signal);
				const { timesMs: requestedTimes, signals: refs } = input as {
					timesMs?: number[];
					signals?: string[];
				};
				const crosshairs = requestedTimes === undefined ? copyView(host.view()).crosshairs : [];
				const timesMs = requestedTimes ?? crosshairs.map((crosshair) => crosshair.timeMs);
				if (requestedTimes === undefined && timesMs.length === 0) {
					throw new Error('Place crosshairs or provide timesMs to inspect.');
				}
				if (timesMs.length === 0 || timesMs.length > INSPECTION_TIME_LIMIT) {
					throw new RangeError(`timesMs must contain 1 to ${INSPECTION_TIME_LIMIT} values.`);
				}
				if (timesMs.some((time) => !Number.isFinite(time))) {
					throw new TypeError('Every inspection time must be a finite number.');
				}
				if (refs !== undefined) validateRefs(refs, INSPECTION_SIGNAL_LIMIT);

				const plotted = host.plottedSignals();
				const resolution =
					refs === undefined
						? { resolved: plotted.slice(0, INSPECTION_SIGNAL_LIMIT), missing: [], ambiguous: [] }
						: resolveRefs(plotted, refs);
				const truncated = refs === undefined && plotted.length > INSPECTION_SIGNAL_LIMIT;
				const results = resolution.resolved.map((signal) => inspectSignal(signal, timesMs));

				return {
					timesMs: [...timesMs],
					crosshairs,
					deltaTimesMs: timesMs.map((time, index) =>
						index === 0 ? null : time - timesMs[index - 1]
					),
					signalLimit: INSPECTION_SIGNAL_LIMIT,
					truncated,
					results,
					missing: resolution.missing,
					ambiguous: resolution.ambiguous
				};
			}
		},
		{
			name: 'set_crosshairs',
			title: 'Set crosshairs',
			description:
				"Replace the plot crosshairs; use an empty array to clear them. Times are trace-relative milliseconds, clamped to the full plot domain. Optional value is the horizontal marker in primary Y-axis units; omitted values keep that marker's height or use the viewport centre. The time window stays unchanged.",
			inputSchema: {
				type: 'object',
				properties: {
					crosshairs: {
						type: 'array',
						maxItems: 2,
						items: {
							type: 'object',
							properties: {
								id: { type: 'integer', enum: [1, 2] },
								timeMs: { type: 'number' },
								value: { type: 'number' }
							},
							required: ['id', 'timeMs'],
							additionalProperties: false
						}
					},
					readout: {
						type: 'string',
						enum: ['c1', 'c2', 'delta'],
						description: 'Legend readout. Delta requires both markers.'
					}
				},
				required: ['crosshairs'],
				additionalProperties: false
			},
			execute: async (input, options) => {
				throwIfAborted(options?.signal);
				const { crosshairs, readout } = input as {
					crosshairs: WebMcpCrosshairInput[];
					readout?: LegendCrosshairMode;
				};
				if (
					!Array.isArray(crosshairs) ||
					crosshairs.length > 2 ||
					new Set(crosshairs.map(({ id }) => id)).size !== crosshairs.length
				) {
					throw new TypeError('Provide at most one marker for each of C1 and C2.');
				}
				for (const marker of crosshairs) {
					if (
						![1, 2].includes(marker.id) ||
						!Number.isFinite(marker.timeMs) ||
						(marker.value !== undefined && !Number.isFinite(marker.value))
					) {
						throw new TypeError('Crosshairs require id 1 or 2 and finite coordinates.');
					}
				}
				if (
					readout !== undefined &&
					(readout === 'delta'
						? crosshairs.length !== 2
						: !crosshairs.some(({ id }) => readout === `c${id}`))
				) {
					throw new TypeError('The requested legend readout requires its crosshairs.');
				}
				const domain = host.view().timeDomainMs;
				if (crosshairs.length > 0 && domain === null)
					throw new Error('No plot domain is available.');
				const applied =
					domain === null
						? []
						: crosshairs.map((marker) => ({
								...marker,
								timeMs: Math.max(domain.startMs, Math.min(domain.endMs, marker.timeMs))
							}));
				host.setCrosshairs(applied, readout);
				return {
					requested: crosshairs.map((marker) => ({ ...marker })),
					clamped: applied.some((marker, index) => marker.timeMs !== crosshairs[index].timeMs),
					view: copyView(host.view())
				};
			}
		},
		{
			name: 'set_signal_axes',
			title: 'Set signal axes',
			description:
				'Assign selected signals to axis numbers Y1–Y5 in legend order, creating axes as needed. Existing signals keep their assignments unless listed. Axes refit using the same behaviour as the legend move menu; existing Y zoom is retained.',
			inputSchema: {
				type: 'object',
				properties: {
					assignments: {
						type: 'array',
						minItems: 1,
						maxItems: SIGNAL_SELECTION_LIMIT,
						items: {
							type: 'object',
							properties: {
								signal: { type: 'string' },
								axis: { type: 'integer', minimum: 1, maximum: MAX_Y_AXES }
							},
							required: ['signal', 'axis'],
							additionalProperties: false
						}
					}
				},
				required: ['assignments'],
				additionalProperties: false
			},
			annotations: { untrustedContentHint: true },
			execute: async (input, options) => {
				throwIfAborted(options?.signal);
				const { assignments } = input as { assignments: Array<{ signal: string; axis: number }> };
				validateRefs(
					assignments.map(({ signal }) => signal),
					SIGNAL_SELECTION_LIMIT
				);
				const selected = host.session().plotted;
				const resolved = assignments.map(({ signal, axis }) => {
					if (!Number.isInteger(axis) || axis < 1 || axis > MAX_Y_AXES)
						throw new RangeError(`Axis must be between 1 and ${MAX_Y_AXES}.`);
					const { resolved, missing, ambiguous } = resolveRefs(selected, [signal]);
					if (missing.length || ambiguous.length)
						throw new Error(`Signal must identify exactly one selected signal: ${signal}`);
					return { key: resolved[0].key, axis };
				});
				if (new Set(resolved.map(({ key }) => key)).size !== resolved.length)
					throw new TypeError('Assign each signal only once.');
				await host.setSignalAxes(resolved);
				return describeSession(host.session(), host.view());
			}
		}
	];
}

function inspectSignal(signal: WebMcpPlottedSignal, timesMs: number[]) {
	const sourceTimes = signal.series.timesMs;
	const sourceValues = signal.series.values;
	const sourcePoints = Math.min(sourceTimes.length, sourceValues.length);
	const sampleRangeMs =
		sourcePoints === 0 ? null : { startMs: sourceTimes[0], endMs: sourceTimes[sourcePoints - 1] };
	return {
		key: signal.key,
		label: signal.label,
		unit: signal.unit,
		sourcePoints,
		sampleRangeMs,
		samples: timesMs.map((requestedTimeMs, index) => {
			const sample = nearestSignalSample(sourceTimes, sourceValues, requestedTimeMs);
			if (sample === null) {
				return {
					requestedTimeMs,
					sampleTimeMs: null,
					distanceMs: null,
					outsideSampleRange: false,
					value: null,
					formattedValue: '-',
					outOfRange: false,
					deltaFromPrevious: null
				};
			}

			const formatted = formatDecodedValue(sample.value, signal);
			const previous =
				index === 0 || signal.valueDescriptions.length > 0
					? null
					: nearestSignalSample(sourceTimes, sourceValues, timesMs[index - 1]);
			return {
				requestedTimeMs,
				sampleTimeMs: sample.timeMs,
				distanceMs: Math.abs(sample.timeMs - requestedTimeMs),
				outsideSampleRange:
					sampleRangeMs !== null &&
					(requestedTimeMs < sampleRangeMs.startMs || requestedTimeMs > sampleRangeMs.endMs),
				value: sample.value,
				formattedValue: formatted.text,
				outOfRange: formatted.outOfRange,
				deltaFromPrevious: previous === null ? null : sample.value - previous.value
			};
		})
	};
}

function validateRefs(refs: string[], limit: number): void {
	if (
		!Array.isArray(refs) ||
		refs.length < 1 ||
		refs.length > limit ||
		refs.some((ref) => typeof ref !== 'string' || ref.length === 0)
	) {
		throw new TypeError(`Provide 1 to ${limit} non-empty signal references.`);
	}
}

function clampLimit(limit: number): number {
	if (!Number.isFinite(limit)) return SEARCH_RESULT_LIMIT_DEFAULT;
	return Math.min(SEARCH_RESULT_LIMIT_MAX, Math.max(1, Math.floor(limit)));
}

function searchResult(
	query: string,
	limit: number,
	truncated: boolean,
	results: Array<{
		key: string;
		label: string;
		messageName: string;
		signalName: string;
		arbitrationId: string | null;
		selected: boolean;
		source: string;
	}>,
	library: { loaded: boolean; loading: boolean }
) {
	return {
		query,
		limit,
		truncated,
		results,
		libraryLoaded: library.loaded,
		libraryLoading: library.loading,
		...(library.loaded
			? {}
			: {
					note: 'The saved DBC library has not finished loading. Empty results are not a complete catalogue; search again after dbcLibrary.loaded is true.'
				})
	};
}

function copyRange(range: WebMcpTimeRange | null): WebMcpTimeRange | null {
	return range === null ? null : { ...range };
}

function copyView(view: WebMcpView): WebMcpView {
	return {
		timeDomainMs: copyRange(view.timeDomainMs),
		timeWindowMs: copyRange(view.timeWindowMs),
		isFullTimeRange: view.isFullTimeRange,
		axes: view.axes.map(({ axis, range }) => ({
			axis,
			range: range === null ? null : { ...range }
		})),
		crosshairs: view.crosshairs.map((marker) => ({ ...marker })).sort((a, b) => a.id - b.id),
		readout: view.readout
	};
}
