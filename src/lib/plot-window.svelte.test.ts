import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlotWindow } from './plot-window.svelte.js';
import type { SignalView } from './signal-plot-data.js';

function rampView(key: string, length: number): SignalView {
	const x = Float64Array.from({ length }, (_, i) => i);
	return {
		key,
		label: key,
		messageName: 'Message',
		signalName: key,
		unit: '',
		color: '#fff',
		x,
		y: x,
		points: length,
		latestText: '-',
		factor: 1,
		offset: 0,
		minimum: 0,
		maximum: 0,
		valueDescriptions: []
	};
}

function viewport(xMin: number, xMax: number) {
	return { xMin, xMax, yMin: 0, yMax: 1 };
}

describe('PlotWindow', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('passes small signals through at full resolution with source identity', () => {
		const plotWindow = new PlotWindow();
		const source = rampView('a', 100);
		const [windowed] = plotWindow.viewsFor([source], viewport(0, 99));

		expect(windowed.sampled).toBe(false);
		expect(windowed.x).toBe(source.x);
	});

	it('keeps slice and list identity while the viewport stays inside the buffer', () => {
		const plotWindow = new PlotWindow();
		const source = rampView('a', 100_000);

		const first = plotWindow.viewsFor([source], viewport(50_000, 51_000));
		const second = plotWindow.viewsFor([source], viewport(50_400, 51_400));

		expect(second).toBe(first);
		expect(second[0].sampled).toBe(false);
		expect(second[0].points).toBeLessThan(4000);
	});

	it('rematerializes synchronously when the viewport escapes the buffer', () => {
		const plotWindow = new PlotWindow();
		const source = rampView('a', 100_000);

		const [before] = plotWindow.viewsFor([source], viewport(50_000, 51_000));
		const [after] = plotWindow.viewsFor([source], viewport(60_000, 61_000));

		expect(after).not.toBe(before);
		expect(after.x[0]).toBeGreaterThan(55_000);
	});

	it('downsamples to the shared budget at full span', () => {
		const plotWindow = new PlotWindow();
		const [windowed] = plotWindow.viewsFor([rampView('a', 60_000)], null);

		expect(windowed.sampled).toBe(true);
		expect(windowed.points).toBe(50_000);
	});

	it('splits the budget across signals with points', () => {
		const plotWindow = new PlotWindow();
		const views = plotWindow.viewsFor(
			[rampView('a', 40_000), rampView('b', 40_000), rampView('empty', 0)],
			null
		);

		expect(views[0].points).toBe(25_000);
		expect(views[1].points).toBe(25_000);
		expect(views[2].points).toBe(0);
	});

	it('settles to a denser slice after interaction rests', () => {
		const plotWindow = new PlotWindow();
		const source = rampView('a', 100_000);

		const [coarse] = plotWindow.viewsFor([source], null);
		expect(coarse.sampled).toBe(true);

		// Zoom deep: still covered by the full-span materialization, so the
		// coarse slice is reused during the interaction...
		const zoomed = viewport(49_000, 51_000);
		expect(plotWindow.viewsFor([source], zoomed)[0]).toBe(coarse);

		// ...until the debounced settle recenters the window at full detail.
		plotWindow.settleAfter([source], zoomed);
		vi.runAllTimers();
		const [settled] = plotWindow.viewsFor([source], zoomed);

		expect(settled).not.toBe(coarse);
		expect(settled.sampled).toBe(false);
		expect(settled.x[0]).toBeGreaterThan(46_000);
	});

	it('settle is a no-op at rest', () => {
		const plotWindow = new PlotWindow();
		const source = rampView('a', 100_000);
		const window = viewport(50_000, 51_000);

		const [before] = plotWindow.viewsFor([source], window);
		plotWindow.settleAfter([source], window);
		vi.runAllTimers();

		expect(plotWindow.viewsFor([source], window)[0]).toBe(before);
	});

	it('rematerializes when the source series is replaced', () => {
		const plotWindow = new PlotWindow();
		const window = viewport(0, 99);

		const [before] = plotWindow.viewsFor([rampView('a', 100)], window);
		const [after] = plotWindow.viewsFor([rampView('a', 100)], window);

		expect(after).not.toBe(before);
	});
});
