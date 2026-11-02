// How each derived part of the app state is computed from its inputs. `withDerived` in store.ts
// decides when, and in what order. Nothing here reads the store.
import { plotGrid, type PlotGrid } from '#lib/plot-axis-layout.js';
import {
	groupSignalsByYAxis,
	PRIMARY_Y_AXIS_ID,
	yAxisLabel,
	yAxisUnit,
	type YAxisGroup,
	type YAxisId
} from '#lib/plot-axes.js';
import { signalColor } from '#lib/plot-colors.js';
import {
	crosshairById,
	type LegendCrosshairMode,
	type PlotCrosshair
} from '#lib/plot-crosshair.js';
import { orderPlotSignals, type LegendOrderMode } from '#lib/plot-signal-order.js';
import {
	applyYWindow,
	type PlotAxisRange,
	type PlotViewport,
	type PlotYWindow
} from '#lib/plot-viewport.js';
import { buildMf4SignalTargetIndex, mf4SelectorSearchIndexes } from '#lib/mf4-signals.js';
import { buildSelectorSearchIndexes, type SelectorDbcFile } from '#lib/selector-list.js';
import {
	axisSplitDomain,
	EMPTY_AXIS_RANGE,
	signalViews,
	signalYRange,
	type SignalView
} from '#lib/signal-plot-data.js';
import { displayTraceName } from '#lib/trace-file-types.js';
import type {
	DbcDiagnostic,
	DbcHandle,
	DbcMessage,
	DbcMessageIdentity,
	DbcSignal,
	DbcValueDescription,
	DbcValueType,
	DecodedSignalSeries,
	OpenTraceResult,
	ParsedDbc,
	RawMessage,
	RawSource
} from '#lib/wasm.js';

export type TraceFileEntry = OpenTraceResult & { id: number; file: File };

export type DbcFileEntry = {
	id: string;
	name: string;
	handle: DbcHandle;
	catalog: ParsedDbc;
	warnings: DbcDiagnostic[];
	origin: 'library' | 'mf4';
};

export type DbcSignalTarget = {
	unavailableReason?: string;
	source?: RawSource;
	sourceBadges?: string[];
	file: DbcFileEntry;
	message: DbcMessage;
	signal: DbcSignal;
};

export type SelectedSignalState = {
	/** Held for as long as the signal stays selected, so deselecting releases it. */
	colorIndex: number;
	isDecoding: boolean;
	series: DecodedSignalSeries | null;
	error: string | null;
};

export type PlotSignal = {
	key: string;
	color: string;
	label: string;
	messageName: string;
	sourceBadges?: string[];
	signalName: string;
	valueType: DbcValueType;
	factor: number;
	offset: number;
	minimum: number | null;
	maximum: number | null;
	unit: string;
	valueDescriptions: DbcValueDescription[];
	series: DecodedSignalSeries | null;
};

export type PlotAxisView = YAxisGroup<SignalView> & { unit: string | null; label: string };

/** Plot geometry derived from the plotted signals, axis layout and open trace. Read-only. */
export type PlotModelState = {
	/** Plottable signals (decoded, non-empty) in legend order. Unchanged signals keep identity. */
	views: SignalView[];
	/** Every axis in layout order, including empty ones; `axes[0]` is the primary axis. */
	axes: PlotAxisView[];
	/** Axes that hold at least one signal; these get a gutter. */
	gutterAxes: PlotAxisView[];
	axisIdByKey: ReadonlyMap<string, YAxisId>;
	grid: PlotGrid;
	/** Full extent: x over all signals, y over primary-axis signals; trace duration if none. */
	fullDomain: PlotViewport | null;
	/** Fit ranges for every non-primary axis. */
	secondaryFitRanges: ReadonlyMap<YAxisId, PlotAxisRange>;
};

export type ViewportMode = { mode: 'fit' } | { mode: 'manual'; xMin: number; xMax: number };

export function traceState(trace: TraceFileEntry | null) {
	return {
		traceName: trace ? displayTraceName(trace.file.name) : 'CAN Trace Viewer',
		traceWarning: traceWarning(trace),
		mf4SignalTargetByKey: buildMf4SignalTargetIndex(trace),
		mf4SelectorIndexes: mf4SelectorSearchIndexes(trace)
	};
}

function traceWarning(trace: TraceFileEntry | null): string | null {
	if (!trace) return null;
	const warnings = [...(trace.warnings ?? [])];
	const count = trace.metadata.skippedLineCount;
	if (count > 0) {
		warnings.push(`Parsed with ${count} malformed ${count === 1 ? 'line' : 'lines'} skipped.`);
	}
	return warnings.length > 0 ? warnings.join(' ') : null;
}

export function catalogState(files: DbcFileEntry[], trace: TraceFileEntry | null) {
	const rawMessages = Map.groupBy(trace?.metadata.rawMessages ?? [], rawMessageIdentityKey);
	const traceLoaded = trace !== null;
	const signalTargetByKey: Record<string, DbcSignalTarget> = {};
	const selectorFiles = files.map<SelectorDbcFile>((file) => ({
		id: file.id,
		name: file.name.replace(/\.dbc$/i, ''),
		transient: file.origin === 'mf4',
		messages: file.catalog.messages.flatMap((message) => {
			const sources: (RawSource | undefined)[] = rawMessages
				.get(rawMessageIdentityKey(message))
				?.map((raw) => raw.source) ?? [undefined];
			const unavailableReason = messageUnavailableReason(message, rawMessages, traceLoaded);
			return sources.map((source) => {
				const badges = sourceBadges(source, sources);
				return {
					key: selectorMessageKey(file.id, message, source),
					name: message.name,
					sourceLabel: sourceLabel(source),
					sourceBadges: badges,
					signals: message.signals.map((signal) => {
						const key = signalIdentityKey(file.id, message, signal.name, source);
						signalTargetByKey[key] = {
							unavailableReason,
							file,
							message,
							signal,
							source,
							sourceBadges: badges
						};
						return {
							key,
							label: `${message.name}.${signal.name}${sourceLabel(source)}`,
							messageName: message.name,
							signalName: signal.name,
							arbitrationId: message.canId.toString(16),
							unavailableReason
						};
					})
				};
			});
		})
	}));

	return {
		signalTargetByKey,
		selectorFiles,
		selectorSearchIndexes: buildSelectorSearchIndexes(selectorFiles)
	};
}

function sourceLabel(source?: RawSource): string {
	if (!source) return '';
	const channel = source.channel === null ? 'Unknown channel' : `Channel ${source.channel}`;
	const direction = { unknown: 'unknown direction', rx: 'Rx', tx: 'Tx' }[source.direction];
	return ` [${channel} · ${direction}]`;
}

function signalIdentityKey(
	dbcFileId: string,
	message: DbcMessageIdentity,
	signalName: string,
	source?: RawSource
): string {
	return JSON.stringify([
		dbcFileId,
		messageIdentityKey(message),
		signalName,
		...(source ? [source.channel, source.direction] : [])
	]);
}

function messageIdentityKey(message: DbcMessageIdentity): string {
	return `${message.isExtended ? 'extended' : 'standard'}:${message.canId}:${message.sizeBytes}`;
}

function rawMessageIdentityKey(message: Pick<DbcMessageIdentity, 'canId' | 'isExtended'>): string {
	return `${message.canId}:${message.isExtended}`;
}

function selectorMessageKey(dbcFileId: string, message: DbcMessage, source?: RawSource): string {
	return JSON.stringify([
		dbcFileId,
		messageIdentityKey(message),
		...(source ? [source.channel, source.direction] : [])
	]);
}

function messageUnavailableReason(
	message: DbcMessage,
	rawMessages: Map<string, RawMessage[]>,
	traceLoaded: boolean
): string | undefined {
	if (message.rawFrameDecodable === false) return 'Plotting not yet supported';
	if (traceLoaded && !rawMessages.has(rawMessageIdentityKey(message)))
		return 'Not present in this trace';
	return undefined;
}

function sourceBadges(source: RawSource | undefined, sources: (RawSource | undefined)[]): string[] {
	if (!source || sources.length < 2) return [];
	const badges: string[] = [];
	if (new Set(sources.map((item) => item?.channel)).size > 1) {
		badges.push(source.channel === null ? 'Unknown channel' : String(source.channel));
	}
	if (new Set(sources.map((item) => item?.direction)).size > 1) {
		badges.push({ unknown: 'Unknown direction', rx: 'Rx', tx: 'Tx' }[source.direction]);
	}
	return badges;
}

const NO_VALUE_DESCRIPTIONS: DbcValueDescription[] = [];

function isPlottableSignal(signal: PlotSignal): boolean {
	return Boolean(signal.series && signal.series.timesMs.length > 0);
}

export function signalsState(
	selected: ReadonlyMap<string, SelectedSignalState>,
	dbcTargets: Readonly<Record<string, DbcSignalTarget>>,
	mf4Targets: ReturnType<typeof buildMf4SignalTargetIndex>,
	order: LegendOrderMode
) {
	const signals: PlotSignal[] = [];
	for (const [key, state] of selected) {
		const dbc = dbcTargets[key];
		if (dbc) {
			signals.push({
				key,
				color: signalColor(state.colorIndex),
				label: `${dbc.message.name}.${dbc.signal.name}${sourceLabel(dbc.source)}`,
				messageName: dbc.message.name,
				sourceBadges: dbc.sourceBadges,
				signalName: dbc.signal.name,
				unit: dbc.signal.unit,
				valueType: dbc.signal.valueType,
				factor: dbc.signal.factor,
				offset: dbc.signal.offset,
				minimum: dbc.signal.minimum,
				maximum: dbc.signal.maximum,
				valueDescriptions: dbc.signal.valueDescriptions,
				series: state.series
			});
			continue;
		}

		const mf4 = mf4Targets.get(key);
		if (!mf4) continue;
		signals.push({
			key,
			color: signalColor(state.colorIndex),
			label: `${mf4.group.name}.${mf4.signal.name}`,
			messageName: mf4.group.name,
			signalName: mf4.signal.name,
			unit: mf4.signal.unit,
			valueType: 'float64',
			factor: 1,
			offset: 0,
			minimum: null,
			maximum: null,
			valueDescriptions: NO_VALUE_DESCRIPTIONS,
			series: state.series
		});
	}

	const ordered = orderPlotSignals(signals, order);
	return { signals: ordered, hasPlottableSignals: ordered.some(isPlottableSignal) };
}

export function modelState(
	signals: PlotSignal[],
	axisIds: readonly YAxisId[],
	axisAssignment: ReadonlyMap<string, YAxisId>,
	trace: TraceFileEntry | null,
	previous: PlotModelState | null
): PlotModelState {
	const views = signalViews(signals.filter(isPlottableSignal), previous?.views ?? []);
	const groups = groupSignalsByYAxis(views, axisIds, axisAssignment);
	const axes = groups.map((group) => {
		const unit = yAxisUnit(group.signals);
		return { ...group, unit, label: yAxisLabel(group.index, unit) };
	});
	const gutterAxes = axes.filter((axis) => axis.signals.length > 0);
	const domain =
		axisSplitDomain(views, groups[0].signals) ?? traceDurationDomain(trace?.metadata.durationNs);

	return {
		views,
		axes,
		gutterAxes,
		axisIdByKey: new Map(
			groups.flatMap((group) => group.signals.map((view) => [view.key, group.id]))
		),
		grid:
			previous !== null && previous.gutterAxes.length === gutterAxes.length
				? previous.grid
				: plotGrid(gutterAxes.length),
		fullDomain:
			previous?.fullDomain != null && domain !== null && sameViewport(previous.fullDomain, domain)
				? previous.fullDomain
				: domain,
		// Without a trace there is no plot surface, so there are no axis ranges to report.
		secondaryFitRanges: new Map(
			trace === null
				? []
				: groups
						.slice(1)
						.map((group) => [group.id, signalYRange(group.signals) ?? EMPTY_AXIS_RANGE])
		)
	};
}

function traceDurationDomain(durationNs: number | null | undefined): PlotViewport | null {
	if (durationNs === null || durationNs === undefined || !Number.isFinite(durationNs)) return null;
	const durationMs = durationNs / 1_000_000;
	return durationMs > 0 ? { xMin: 0, xMax: durationMs, yMin: 0, yMax: 1 } : null;
}

function sameViewport(a: PlotViewport, b: PlotViewport): boolean {
	return a.xMin === b.xMin && a.xMax === b.xMax && a.yMin === b.yMin && a.yMax === b.yMax;
}

/** `axisRanges` holds the non-primary fit ranges with the Y window applied, plus the primary axis. */
export function viewportState(
	viewportMode: ViewportMode,
	yWindow: PlotYWindow,
	{ fullDomain, secondaryFitRanges }: PlotModelState
) {
	let activeViewport = fullDomain;
	if (viewportMode.mode === 'manual' && fullDomain !== null) {
		const y = applyYWindow({ min: fullDomain.yMin, max: fullDomain.yMax }, yWindow);
		activeViewport = { xMin: viewportMode.xMin, xMax: viewportMode.xMax, yMin: y.min, yMax: y.max };
	}

	const axisRanges = new Map<YAxisId, PlotAxisRange>();
	for (const [id, range] of secondaryFitRanges) axisRanges.set(id, applyYWindow(range, yWindow));
	if (activeViewport !== null) {
		axisRanges.set(PRIMARY_Y_AXIS_ID, { min: activeViewport.yMin, max: activeViewport.yMax });
	}

	return { activeViewport, isFitAll: viewportMode.mode === 'fit', axisRanges };
}

/** Keep the legend readout on a crosshair that exists, or on C1 when there are none. */
export function readoutMode(
	crosshairs: PlotCrosshair[],
	mode: LegendCrosshairMode
): LegendCrosshairMode {
	const c1 = crosshairById(crosshairs, 1) !== null;
	const c2 = crosshairById(crosshairs, 2) !== null;
	const available = mode === 'delta' ? c1 && c2 : mode === 'c1' ? c1 : c2;
	if (available) return mode;
	return c2 && !c1 ? 'c2' : 'c1';
}
