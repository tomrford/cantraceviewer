import { readFile } from 'node:fs/promises';

import type { CanTraceClient } from 'cantraceviewer';
import { afterAll, afterEach, expect, it, vi } from 'vitest';

import { crosshairViewRatio } from '@/lib/plot/plot-crosshair';
import { plotSeriesForViews } from '@/lib/plot/plot-series';
import { PlotWindow } from '@/lib/plot/plot-window';
import type { WindowedSignalView } from '@/lib/plot/signal-plot-data';
import { closeTrace } from '@/lib/wasm';
import { storeHost } from '@/lib/webmcp';
import { startTraceSession } from '@/store/app-shell';
import { addDbcFiles, clearDbcFiles } from '@/store/dbc-files';
import { addAxis, assignAxis, removeAxis } from '@/store/plot-axes';
import { clearSelectedSignals, toggleSignal } from '@/store/plot-data';
import {
	panBy,
	placeCrosshair,
	resetZoom,
	setCrosshairs,
	setPointerRatio,
	setViewport,
	upsertCrosshair,
	zoomBy
} from '@/store/plot-view';
import { appStore, update } from '@/store/store';
import { loadTraceFile } from '@/store/trace-file';

// Use the same published Worker/WASM boundary as the app, with Node's transport.
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

afterEach(async () => {
	vi.useRealTimers();
	setPointerRatio(null);
	clearSelectedSignals();
	await clearDbcFiles();
});
afterAll(async () => {
	const { trace } = appStore.getState();
	if (trace) await closeTrace(trace.handle);
	update({ trace: null });
	await transport.client?.close();
});

async function load(trace?: string) {
	expect(
		await loadTraceFile(
			new File([trace ?? (await readFile('wasm/tests/fixtures/source-selection.asc'))], 'drive.asc')
		)
	).toBe(true);
	await startTraceSession();
	await addDbcFiles([
		new File([await readFile('wasm/tests/fixtures/source-selection.dbc')], 'network.dbc')
	]);
	expect(appStore.getState().dbcError).toBeNull();
	return appStore
		.getState()
		.selectorFiles[0].messages.filter((message) => message.name === 'BusOnly')
		.map((message) => message.signals[0].key);
}

function expectRange(axis: string, min: number, max: number) {
	expect(appStore.getState().axisRanges.get(axis)).toEqual({
		min: expect.closeTo(min),
		max: expect.closeTo(max)
	});
}

function expectViewport(xMin: number, xMax: number, yMin: number, yMax: number) {
	expect(appStore.getState().activeViewport).toEqual({
		xMin: expect.closeTo(xMin),
		xMax: expect.closeTo(xMax),
		yMin: expect.closeTo(yMin),
		yMax: expect.closeTo(yMax)
	});
}

it('opens a replacement trace at the full extent without the previous markers', async () => {
	await load();
	// Nothing is plotted, so this view sits on the trace-duration domain, as WebMCP can set it.
	setViewport({ xMin: 10, xMax: 20, yMin: 0, yMax: 1 });
	setCrosshairs([{ id: 1, x: 15, fitY: 0.5 }]);
	expect(appStore.getState().isFitAll).toBe(false);
	expect(appStore.getState().crosshairs).toHaveLength(1);

	await load();
	expect(appStore.getState().isFitAll).toBe(true);
	expect(appStore.getState().crosshairs).toEqual([]);
});

it('keeps proportional zoom and selection ownership through axis and signal changes', async () => {
	const [first, second] = await load();
	await toggleSignal(first);
	const firstView = appStore.getState().plotModel.views[0];
	await toggleSignal(second);
	expect(appStore.getState().plotModel.views[0]).toBe(firstView);
	const firstColor = appStore.getState().signals[0].color;
	const secondColor = appStore.getState().signals[1].color;
	expect(firstColor).not.toBe(secondColor);
	const secondary = addAxis()!;
	assignAxis(second, secondary);
	// Fixture values are 10/11 and 20/21; fit adds 5% padding to each range.
	expectRange('y', 9.95, 11.05);
	expectRange(secondary, 19.95, 21.05);
	zoomBy(0.5);
	expectViewport(25, 75, 10.225, 10.775);
	expectRange(secondary, 20.225, 20.775);
	assignAxis(first, secondary);
	// Empty primary uses 0..1; both signals now share 9.45..21.55 on Y2.
	expectViewport(25, 75, 0.25, 0.75);
	expectRange(secondary, 12.475, 18.525);
	panBy({ x: 10, y: 0 }, { width: 100, height: 100 });
	zoomBy(0.5, undefined, { x: true, y: false });
	expectViewport(32.5, 57.5, 0.25, 0.75);
	expectRange(secondary, 12.475, 18.525);
	removeAxis(secondary);
	expect(
		appStore.getState().plotModel.axes.map((axis) => axis.signals.map(({ signal }) => signal.key))
	).toEqual([[first, second]]);
	expectRange('y', 12.475, 18.525);
	const emptyAxis = addAxis()!;
	assignAxis(second, emptyAxis);
	await toggleSignal(second);
	expect(appStore.getState().axisIds).toEqual(['y', emptyAxis]);
	expect(appStore.getState().signals.map((signal) => signal.color)).toEqual([firstColor]);
	expectRange('y', 10.225, 10.775);
	const third = appStore
		.getState()
		.selectorFiles[0].messages.find((message) => message.name === 'DirectionOnly')!.signals[0].key;
	await toggleSignal(third);
	expect(appStore.getState().signals.map((signal) => signal.color)).toEqual([
		firstColor,
		secondColor
	]);
	await toggleSignal(third);
	await toggleSignal(second);
	expect(
		appStore.getState().plotModel.axes.map((axis) => axis.signals.map(({ signal }) => signal.key))
	).toEqual([[first, second], []]);
	expect(appStore.getState().signals.map((signal) => signal.color)).toEqual([
		firstColor,
		secondColor
	]);
	resetZoom();
	expect(appStore.getState().isFitAll).toBe(true);
	expectViewport(0, 100, 9.45, 21.55);
	clearSelectedSignals();
	await toggleSignal(second);
	expect(appStore.getState().signals[0].color).toBe(firstColor);
	expect(appStore.getState().axisIds).toEqual(['y', emptyAxis]);
});

it('keeps cursor heights through axis moves and recovers off-screen cursors after panning back', async () => {
	const [first, second] = await load();
	await toggleSignal(first);
	await toggleSignal(second);
	const secondary = addAxis()!;
	assignAxis(second, secondary);
	setPointerRatio({ xRatio: 0.25, yRatio: 0.25 });
	placeCrosshair(1);
	setPointerRatio({ xRatio: 0.75, yRatio: 0.75 });
	placeCrosshair(2);
	const visibleHeights = () => {
		const { crosshairs, yWindow } = appStore.getState();
		return crosshairs.map((marker) => crosshairViewRatio(marker, yWindow));
	};
	const times = () => storeHost.view().crosshairs.map((marker) => marker.timeMs);
	expect(visibleHeights()).toEqual([expect.closeTo(0.25), expect.closeTo(0.75)]);
	expect(times()).toEqual([25, 75]);
	// The first channel fits 9.95..11.05; a quarter down is 10.775.
	expect(storeHost.view().crosshairs[0].value).toBeCloseTo(10.775);
	assignAxis(first, secondary);
	expect(visibleHeights()).toEqual([expect.closeTo(0.25), expect.closeTo(0.75)]);
	expect(times()).toEqual([25, 75]);
	assignAxis(second, 'y');
	expect(visibleHeights()).toEqual([expect.closeTo(0.25), expect.closeTo(0.75)]);
	// The second channel now fits 19.95..21.05; the same height reads 20.775.
	expect(storeHost.view().crosshairs[0].value).toBeCloseTo(20.775);

	const markers = structuredClone(appStore.getState().crosshairs);
	panBy({ x: 0, y: 200 }, { width: 100, height: 100 });
	expect(visibleHeights()).toEqual([expect.closeTo(2.25), expect.closeTo(2.75)]);
	expect(appStore.getState().crosshairs).toEqual(markers);
	assignAxis(second, secondary);
	expect(visibleHeights()).toEqual([expect.closeTo(2.25), expect.closeTo(2.75)]);
	panBy({ x: 0, y: -200 }, { width: 100, height: 100 });
	expect(visibleHeights()).toEqual([expect.closeTo(0.25), expect.closeTo(0.75)]);
	expect(times()).toEqual([25, 75]);

	// Placing a marker in a panned view can give it a position outside the unzoomed fit.
	panBy({ x: 0, y: 200 }, { width: 100, height: 100 });
	upsertCrosshair({ id: 1, x: 25, y: 2.75 });
	expect(visibleHeights()[0]).toBeCloseTo(0.25);
	panBy({ x: 0, y: -200 }, { width: 100, height: 100 });
	expect(visibleHeights()[0]).toBeCloseTo(-1.75);
	panBy({ x: 0, y: 200 }, { width: 100, height: 100 });
	expect(visibleHeights()[0]).toBeCloseTo(0.25);
	expect(times()).toEqual([25, 75]);
});

it('budgets decoded render data, settles to every visible sample and follows a distant pan', async () => {
	// A deterministic long capture: one byte per channel per millisecond, 60 seconds.
	const trace = ['base hex timestamps absolute'];
	for (let ms = 0; ms < 60_000; ms++) {
		for (const channel of [1, 2]) {
			trace.push(
				`${(ms / 1000).toFixed(3)} ${channel} 100 Rx d 1 ${((ms + channel) % 251).toString(16).padStart(2, '0')}`
			);
		}
	}
	const keys = await load(trace.join('\n'));
	for (const key of keys) await toggleSignal(key);
	vi.useFakeTimers();
	let rendered: WindowedSignalView[] = [];
	const render = () => {
		const { plotModel, activeViewport } = appStore.getState();
		rendered = window.viewsFor(plotModel.views, activeViewport);
	};
	const window = new PlotWindow(render);
	try {
		render();
		expect(rendered.map((view) => view.x.length)).toEqual([25_000, 25_000]);
		expect(rendered.map((view) => [view.x[0], view.x.at(-1)])).toEqual([
			[0, 59_999],
			[0, 59_999]
		]);
		expect(plotSeriesForViews(rendered, () => 'y').map((series) => series.type)).toEqual([
			'line',
			'line'
		]);
		setViewport({ xMin: 49_000, xMax: 51_000, yMin: 0, yMax: 250 });
		render();
		window.settleAfter(appStore.getState().plotModel.views, appStore.getState().activeViewport);
		vi.runAllTimers();
		const checkVisible = (start: number, end: number) => {
			for (const [index, view] of rendered.entries()) {
				expect(view.sampled).toBe(false);
				expect(view.x.length).toBeLessThan(10_000);
				expect(view.x[0]).toBeLessThanOrEqual(start);
				expect(view.x.at(-1)).toBeGreaterThanOrEqual(end);
				const visible = Array.from(view.x).flatMap((x, i) =>
					x >= start && x <= end ? [[x, view.y[i]]] : []
				);
				expect(visible).toEqual(
					Array.from({ length: end - start + 1 }, (_, i) => [
						start + i,
						(start + i + index + 1) % 251
					])
				);
			}
		};
		checkVisible(49_000, 51_000);
		expect(plotSeriesForViews(rendered, () => 'y').map((series) => series.type)).toEqual([
			'line',
			'scatter',
			'line',
			'scatter'
		]);
		setViewport({ xMin: 10_000, xMax: 11_000, yMin: 0, yMax: 250 });
		render();
		checkVisible(10_000, 11_000);
	} finally {
		window.dispose();
	}
});
