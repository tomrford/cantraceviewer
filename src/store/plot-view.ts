import {
	crosshairAt,
	crosshairById,
	moveCrosshair,
	removeCrosshair,
	setCrosshair,
	type CrosshairDragAxis,
	type CrosshairId,
	type LegendCrosshairMode,
	type PlotCrosshair
} from '@/lib/plot/plot-crosshair';
import type { PlotRatioPoint } from '@/lib/plot/plot-pointer';
import {
	advanceYWindow,
	dataPointAtRatio,
	FULL_Y_WINDOW,
	panViewport,
	viewportCenter,
	viewportsAlmostEqual,
	zoomViewport,
	type PlotPoint,
	type PlotViewport
} from '@/lib/plot/plot-viewport';
import { PRIMARY_Y_AXIS_ID } from '@/lib/plot/y-axis';
import { axisFitRange } from '@/store/derive';
import { appStore, FIT, update } from '@/store/store';

const CENTER: PlotRatioPoint = { xRatio: 0.5, yRatio: 0.5 };

// Pointer position over the plot area. Kept out of the store: it changes on every hover move and
// only `placeCrosshair` reads it.
let pointerRatio: PlotRatioPoint | null = null;

export function zoomBy(
	factor: number,
	anchor: PlotRatioPoint = CENTER,
	axes?: { x: boolean; y: boolean }
): void {
	const viewport = appStore.getState().activeViewport;
	if (viewport !== null) setViewport(zoomViewport(viewport, factor, anchor, axes));
}

export function zoomIn(): void {
	zoomBy(0.5);
}

export function zoomOut(): void {
	zoomBy(2);
}

export function panBy(
	delta: { x: number; y: number },
	plotSize: { width: number; height: number }
): void {
	const viewport = appStore.getState().activeViewport;
	if (viewport !== null) setViewport(panViewport(viewport, delta, plotSize));
}

/** Show `viewport`; a viewport matching the full extent returns to fit mode. */
export function setViewport(viewport: PlotViewport): void {
	if (viewportsAlmostEqual(viewport, appStore.getState().plotModel.fullDomain)) {
		resetZoom();
		return;
	}

	const { activeViewport, yWindow } = appStore.getState();
	update({
		viewportMode: { mode: 'manual', xMin: viewport.xMin, xMax: viewport.xMax },
		yWindow: activeViewport === null ? yWindow : advanceYWindow(yWindow, activeViewport, viewport)
	});
}

export function resetZoom(): void {
	update({ viewportMode: FIT, yWindow: FULL_Y_WINDOW });
}

/** Add or move a crosshair; ignored while nothing is plottable. */
export function upsertCrosshair(
	point: PlotPoint & { id: CrosshairId },
	axis: CrosshairDragAxis = 'both'
): void {
	const { hasPlottableSignals, crosshairs, plotModel } = appStore.getState();
	const primaryFit = axisFitRange(plotModel, PRIMARY_Y_AXIS_ID);
	if (!hasPlottableSignals || primaryFit === null) return;
	const crosshair = crosshairAt(point, primaryFit);
	const current = crosshairById(crosshairs, point.id);
	update({
		crosshairs: setCrosshair(
			crosshairs,
			current === null ? crosshair : moveCrosshair(current, crosshair, axis)
		)
	});
}

/** Place a crosshair at the plot pointer (or the viewport centre when off the plot / `'center'`). */
export function placeCrosshair(id: CrosshairId, anchor: 'pointer' | 'center' = 'pointer'): void {
	const { activeViewport } = appStore.getState();
	if (activeViewport === null) return;
	const point =
		anchor === 'center' || pointerRatio === null
			? viewportCenter(activeViewport)
			: dataPointAtRatio(activeViewport, pointerRatio);
	upsertCrosshair({ id, ...point });
}

export function deleteCrosshair(id: CrosshairId): void {
	update({ crosshairs: removeCrosshair(appStore.getState().crosshairs, id) });
}

export function clearCrosshairs(): void {
	update({ crosshairs: [] });
}

/** Replace all crosshairs, optionally with a readout mode (WebMCP); not gated on plottability. */
export function setCrosshairs(crosshairs: PlotCrosshair[], mode?: LegendCrosshairMode): void {
	update(mode === undefined ? { crosshairs } : { crosshairs, legendCrosshairMode: mode });
}

export function setLegendCrosshairMode(mode: LegendCrosshairMode): void {
	update({ legendCrosshairMode: mode });
}

/** Enabling is ignored while nothing is plottable. */
export function setBoxZoomEnabled(enabled: boolean): void {
	if (enabled && !appStore.getState().hasPlottableSignals) return;
	update({ boxZoomEnabled: enabled });
}

export function toggleBoxZoom(): void {
	setBoxZoomEnabled(!appStore.getState().boxZoomEnabled);
}

export function setLegendVisible(visible: boolean): void {
	update({ legendVisible: visible });
}

export function toggleLegend(): void {
	setLegendVisible(!appStore.getState().legendVisible);
}

export function setPointerRatio(ratio: PlotRatioPoint | null): void {
	pointerRatio = ratio;
}
