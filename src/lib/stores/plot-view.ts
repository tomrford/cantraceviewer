import { subscribeWithSelector } from 'zustand/middleware';
import { createStore } from 'zustand/vanilla';
import { ownHmrSubscriptions } from './hmr-subscriptions.js';
import type { YAxisId } from '#lib/plot-axes.js';
import {
	crosshairById,
	removeCrosshair,
	setCrosshair,
	type CrosshairId,
	type LegendCrosshairMode,
	type PlotCrosshair
} from '#lib/plot-crosshair.js';
import type { PlotRatioPoint } from '#lib/plot-geometry.js';
import {
	advanceYWindow,
	applyYWindow,
	dataPointAtRatio,
	FULL_Y_WINDOW,
	panViewport,
	viewportCenter,
	viewportsAlmostEqual,
	zoomViewport,
	type PlotAxisRange,
	type PlotViewport,
	type PlotYWindow
} from '#lib/plot-viewport.js';
import { plotData } from './plot-data.js';
import { plotModel } from './plot-model.js';

export type ViewportMode = { mode: 'fit' } | { mode: 'manual'; xMin: number; xMax: number };

export type PlotViewState = {
	viewportMode: ViewportMode;
	yWindow: PlotYWindow;
	/** Derived from the mode, Y window and plot model on every write. */
	activeViewport: PlotViewport | null;
	isFitAll: boolean;
	/** Non-primary axis ranges with the Y window applied. */
	secondaryRanges: ReadonlyMap<YAxisId, PlotAxisRange>;
	/** `secondaryRanges` plus the primary axis range from `activeViewport`. */
	axisRanges: ReadonlyMap<YAxisId, PlotAxisRange>;

	crosshairs: PlotCrosshair[];
	legendCrosshairMode: LegendCrosshairMode;
	boxZoomEnabled: boolean;
	legendVisible: boolean;
	/** A legend menu is open; plot pointer interaction is suspended meanwhile. */
	legendSelectOpen: boolean;
};

const FIT: ViewportMode = { mode: 'fit' };
const CENTER: PlotRatioPoint = { xRatio: 0.5, yRatio: 0.5 };

export const plotView = createStore<PlotViewState>()(
	subscribeWithSelector((): PlotViewState => ({
		...viewportState(FIT, FULL_Y_WINDOW),
		crosshairs: [],
		legendCrosshairMode: 'c1',
		boxZoomEnabled: false,
		legendVisible: true,
		legendSelectOpen: false
	}))
);

// Pointer position over the plot area. Kept out of the store: it changes on every hover move and
// only `placeCrosshair` reads it.
let pointerRatio: PlotRatioPoint | null = null;

const unsubscribeModel = plotModel.subscribe((model, previous) => {
	if (
		model.fullDomain === previous.fullDomain &&
		model.secondaryFitRanges === previous.secondaryFitRanges &&
		model.primaryAxisId === previous.primaryAxisId
	) {
		return;
	}
	const { viewportMode, yWindow } = plotView.getState();
	plotView.setState(viewportState(viewportMode, yWindow));
});

// Nothing plottable: drop crosshairs and box zoom and return to the full extent.
const unsubscribeData = plotData.subscribe(({ hasPlottableSignals }, previous) => {
	if (hasPlottableSignals || !previous.hasPlottableSignals) return;
	plotView.setState({
		...crosshairState([]),
		boxZoomEnabled: false,
		...viewportState(FIT, FULL_Y_WINDOW)
	});
});

if (import.meta.hot) ownHmrSubscriptions(import.meta.hot, [unsubscribeModel, unsubscribeData]);

export function zoomBy(
	factor: number,
	anchor: PlotRatioPoint = CENTER,
	axes?: { x: boolean; y: boolean }
): void {
	const viewport = plotView.getState().activeViewport;
	if (viewport !== null) setViewport(zoomViewport(viewport, factor, anchor, axes));
}

export function panBy(
	delta: { x: number; y: number },
	plotSize: { width: number; height: number }
): void {
	const viewport = plotView.getState().activeViewport;
	if (viewport !== null) setViewport(panViewport(viewport, delta, plotSize));
}

/** Show `viewport`; a viewport matching the full extent returns to fit mode. */
export function setViewport(viewport: PlotViewport): void {
	if (viewportsAlmostEqual(viewport, plotModel.getState().fullDomain)) {
		resetZoom();
		return;
	}

	const { activeViewport, yWindow } = plotView.getState();
	plotView.setState(
		viewportState(
			{ mode: 'manual', xMin: viewport.xMin, xMax: viewport.xMax },
			activeViewport === null ? yWindow : advanceYWindow(yWindow, activeViewport, viewport)
		)
	);
}

export function resetZoom(): void {
	plotView.setState(viewportState(FIT, FULL_Y_WINDOW));
}

/** Add or move a crosshair; ignored while nothing is plottable. */
export function upsertCrosshair(crosshair: PlotCrosshair): void {
	if (!plotData.getState().hasPlottableSignals) return;
	plotView.setState(crosshairState(setCrosshair(plotView.getState().crosshairs, crosshair)));
}

/** Place a crosshair at the plot pointer (or the viewport centre when off the plot / `'center'`). */
export function placeCrosshair(id: CrosshairId, anchor: 'pointer' | 'center' = 'pointer'): void {
	const { activeViewport } = plotView.getState();
	if (activeViewport === null) return;
	const point =
		anchor === 'center' || pointerRatio === null
			? viewportCenter(activeViewport)
			: dataPointAtRatio(activeViewport, pointerRatio);
	upsertCrosshair({ id, ...point });
}

export function deleteCrosshair(id: CrosshairId): void {
	plotView.setState(crosshairState(removeCrosshair(plotView.getState().crosshairs, id)));
}

export function clearCrosshairs(): void {
	plotView.setState(crosshairState([]));
}

/** Replace all crosshairs, optionally with a readout mode (WebMCP); not gated on plottability. */
export function setCrosshairs(crosshairs: PlotCrosshair[], mode?: LegendCrosshairMode): void {
	plotView.setState(crosshairState(crosshairs, mode));
}

export function setLegendCrosshairMode(mode: LegendCrosshairMode): void {
	plotView.setState(crosshairState(plotView.getState().crosshairs, mode));
}

/** Enabling is ignored while nothing is plottable. */
export function setBoxZoomEnabled(enabled: boolean): void {
	if (enabled && !plotData.getState().hasPlottableSignals) return;
	plotView.setState({ boxZoomEnabled: enabled });
}

export function toggleBoxZoom(): void {
	setBoxZoomEnabled(!plotView.getState().boxZoomEnabled);
}

/** Hiding the legend also closes its menus. */
export function setLegendVisible(visible: boolean): void {
	plotView.setState((state) => ({
		legendVisible: visible,
		legendSelectOpen: visible && state.legendSelectOpen
	}));
}

export function toggleLegend(): void {
	setLegendVisible(!plotView.getState().legendVisible);
}

/** Stays false while the legend is hidden. */
export function setLegendSelectOpen(open: boolean): void {
	plotView.setState((state) => ({ legendSelectOpen: open && state.legendVisible }));
}

export function setPointerRatio(ratio: PlotRatioPoint | null): void {
	pointerRatio = ratio;
}

function viewportState(viewportMode: ViewportMode, yWindow: PlotYWindow) {
	const { fullDomain, secondaryFitRanges, primaryAxisId } = plotModel.getState();
	let activeViewport = fullDomain;
	if (viewportMode.mode === 'manual' && fullDomain !== null) {
		const y = applyYWindow({ min: fullDomain.yMin, max: fullDomain.yMax }, yWindow);
		activeViewport = { xMin: viewportMode.xMin, xMax: viewportMode.xMax, yMin: y.min, yMax: y.max };
	}

	const secondaryRanges = new Map<YAxisId, PlotAxisRange>();
	for (const [id, range] of secondaryFitRanges)
		secondaryRanges.set(id, applyYWindow(range, yWindow));
	const axisRanges = new Map(secondaryRanges);
	if (activeViewport !== null) {
		axisRanges.set(primaryAxisId, { min: activeViewport.yMin, max: activeViewport.yMax });
	}

	return {
		viewportMode,
		yWindow,
		activeViewport,
		isFitAll: viewportMode.mode === 'fit',
		secondaryRanges,
		axisRanges
	};
}

// Keep the legend readout on a crosshair that exists.
function crosshairState(
	crosshairs: PlotCrosshair[],
	mode: LegendCrosshairMode = plotView.getState().legendCrosshairMode
) {
	const c1 = crosshairById(crosshairs, 1) !== null;
	const c2 = crosshairById(crosshairs, 2) !== null;
	let legendCrosshairMode = mode;
	if (mode === 'delta' && (!c1 || !c2)) legendCrosshairMode = c1 ? 'c1' : c2 ? 'c2' : 'c1';
	else if (mode === 'c1' && !c1 && c2) legendCrosshairMode = 'c2';
	else if (mode === 'c2' && !c2 && c1) legendCrosshairMode = 'c1';
	return { crosshairs, legendCrosshairMode };
}
