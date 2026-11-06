import type { CrosshairId, LegendCrosshairMode } from '@/lib/plot/plot-crosshair';
import { formatDecodedValue, nearestSignalSample } from '@/lib/plot/signal-plot-data';
import { MAX_Y_AXES } from '@/lib/plot/y-axis';
import { searchIndex } from '@/lib/search-index';
import type { SelectorSearchIndex } from '@/lib/selector-list';
import type { storeHost } from '@/lib/webmcp';
import type { PlotSignal } from '@/store/derive';

export const SEARCH_RESULT_LIMIT_MAX = 50;
const SEARCH_RESULT_LIMIT_DEFAULT = 25;
const SIGNAL_SELECTION_LIMIT = 50;
export const INSPECTION_SIGNAL_LIMIT = 20;
const INSPECTION_TIME_LIMIT = 20;

export type WebMcpTimeRange = {
	startMs: number;
	endMs: number;
};

export type WebMcpCrosshairInput = { id: CrosshairId; timeMs: number; value?: number };

export type WebMcpPlottedSignal = Pick<
	PlotSignal,
	| 'key'
	| 'label'
	| 'unit'
	| 'valueType'
	| 'factor'
	| 'offset'
	| 'minimum'
	| 'maximum'
	| 'valueDescriptions'
> & {
	series: NonNullable<PlotSignal['series']>;
};

export type WebMcpHost = typeof storeHost;

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

export function describeSession(
	snapshot: ReturnType<WebMcpHost['session']>,
	view: ReturnType<WebMcpHost['view']>
) {
	return {
		...snapshot,
		view,
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
	const hits = indexes.flatMap((index) =>
		searchIndex(index.signals, query).map(({ signal }) => ({
			key: signal.key,
			label: signal.label,
			messageName: signal.messageName,
			signalName: signal.signalName,
			arbitrationId: signal.arbitrationId ?? null,
			selected: isSignalSelected(signal.key),
			available: !signal.unavailableReason,
			unavailableReason: signal.unavailableReason ?? null,
			source: index.dbc.name
		}))
	);

	return {
		query,
		limit: cappedLimit,
		truncated: hits.length > cappedLimit,
		results: hits.slice(0, cappedLimit),
		libraryLoaded: library.loaded,
		libraryLoading: library.loading,
		...(library.loaded
			? {}
			: {
					note: 'The saved DBC library has not finished loading. Empty results are not a complete catalogue; search again after dbcLibrary.loaded is true.'
				})
	};
}

export function resolveSignalRefs(indexes: SelectorSearchIndex[], refs: string[]) {
	return resolveRefs(
		indexes.flatMap((index) => index.signals.items.map(({ signal }) => signal)),
		refs
	);
}

function resolveRefs<T extends SignalReference>(signals: T[], refs: string[]) {
	const byKey = new Map(signals.map((signal) => [signal.key, signal]));
	const byLabel = Map.groupBy(signals, (signal) => signal.label.toLowerCase());
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
				options?.signal?.throwIfAborted();
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
				options?.signal?.throwIfAborted();
				const { query, limit = SEARCH_RESULT_LIMIT_DEFAULT } = input as {
					query: string;
					limit?: number;
				};
				return searchCatalogSignals(
					host.signalCatalog(),
					query,
					host.isSignalSelected,
					limit,
					host.session().dbcLibrary
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
				const unavailable: Array<{ key: string; label: string; reason: string }> = [];

				for (const signal of resolved) {
					options?.signal?.throwIfAborted();
					if (selected && !host.isSignalSelected(signal.key) && signal.unavailableReason) {
						unavailable.push({
							key: signal.key,
							label: signal.label,
							reason: signal.unavailableReason
						});
						continue;
					}
					if (host.isSignalSelected(signal.key) === selected) {
						unchanged.push({ key: signal.key, label: signal.label, selected });
						continue;
					}
					await host.toggleSignal(signal.key);
					if (host.isSignalSelected(signal.key) === selected) {
						changed.push({ key: signal.key, label: signal.label, selected });
					} else {
						const current = resolveSignalRefs(host.signalCatalog(), [signal.key]).resolved[0];
						if (current?.unavailableReason)
							unavailable.push({
								key: signal.key,
								label: signal.label,
								reason: current.unavailableReason
							});
						else
							unchanged.push({
								key: signal.key,
								label: signal.label,
								selected: host.isSignalSelected(signal.key)
							});
					}
				}

				options?.signal?.throwIfAborted();
				return { selected, changed, unchanged, unavailable, missing, ambiguous };
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
				options?.signal?.throwIfAborted();
				const bounds = input as Partial<WebMcpTimeRange>;
				if (bounds.startMs === undefined && bounds.endMs === undefined) {
					const applied = host.setTimeWindow(null);
					return { ok: applied !== null, applied, view: host.view() };
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
					requested,
					domain,
					applied,
					clamped: applied?.startMs !== requested.startMs || applied?.endMs !== requested.endMs,
					view: host.view()
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
				options?.signal?.throwIfAborted();
				const { timesMs: requestedTimes, signals: refs } = input as {
					timesMs?: number[];
					signals?: string[];
				};
				const crosshairs = requestedTimes === undefined ? host.view().crosshairs : [];
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
					timesMs,
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
				options?.signal?.throwIfAborted();
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
					requested: crosshairs,
					clamped: applied.some((marker, index) => marker.timeMs !== crosshairs[index].timeMs),
					view: host.view()
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
				options?.signal?.throwIfAborted();
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
				host.setSignalAxes(resolved);
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
