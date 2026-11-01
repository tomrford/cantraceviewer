import { createStore } from 'zustand/vanilla';
import { plotGrid, type PlotGrid } from '#lib/plot-axis-layout.js';
import {
	groupSignalsByYAxis,
	yAxisLabel,
	yAxisUnit,
	type YAxisGroup,
	type YAxisId
} from '#lib/plot-axes.js';
import type { PlotAxisRange, PlotViewport } from '#lib/plot-viewport.js';
import {
	axisSplitDomain,
	createSignalViewCache,
	EMPTY_AXIS_RANGE,
	signalYRange,
	type SignalView
} from '#lib/signal-plot-data.js';
import { plotAxes } from './plot-axes.js';
import { isPlottableSignal, plotData } from './plot-data.js';
import { traceFile } from './trace-file.js';

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

const viewsForSignals = createSignalViewCache();
let derivedFrom: unknown[] = [];

export const plotModel = createStore<PlotModelState>()(() => modelState(null));

for (const store of [plotData, plotAxes, traceFile] as const) {
	store.subscribe(() => {
		const next = modelState(plotModel.getState());
		if (next !== plotModel.getState()) plotModel.setState(next);
	});
}

function modelState(previous: PlotModelState | null): PlotModelState {
	const { signals } = plotData.getState();
	const { ids, assignment } = plotAxes.getState();
	const trace = traceFile.getState().entry;
	const inputs = [signals, ids, assignment, trace];
	if (previous !== null && inputs.every((input, index) => input === derivedFrom[index])) {
		return previous;
	}
	derivedFrom = inputs;

	const views = viewsForSignals(signals.filter(isPlottableSignal));
	const groups = groupSignalsByYAxis(views, ids, assignment);
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
