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
		valueType: 'integer' as const,
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

	it('keeps the same buffered samples while a pan stays inside the buffer', () => {
		const plotWindow = new PlotWindow();
		const source = rampView('a', 100_000);

		const [first] = plotWindow.viewsFor([source], viewport(50_000, 51_000));
		const [second] = plotWindow.viewsFor([source], viewport(50_400, 51_400));

		expect(first.sampled).toBe(false);
		expect(first.points).toBe(3003);
		expect(first.x[0]).toBe(48_999);
		expect(first.x[3002]).toBe(52_001);
		expect(second.sampled).toBe(false);
		expect(second.points).toBe(3003);
		expect(second.x[0]).toBe(48_999);
		expect(second.x[3002]).toBe(52_001);
	});

	it('replaces the slice when the viewport leaves the buffer', () => {
		const plotWindow = new PlotWindow();
		const source = rampView('a', 100_000);

		const [before] = plotWindow.viewsFor([source], viewport(50_000, 51_000));
		const [after] = plotWindow.viewsFor([source], viewport(60_000, 61_000));

		expect(before.x[0]).toBe(48_999);
		expect(after.sampled).toBe(false);
		expect(after.points).toBe(3003);
		expect(after.x[0]).toBe(58_999);
		expect(after.x[3002]).toBe(62_001);
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
		expect(coarse.points).toBe(50_000);
		expect(coarse.x[0]).toBe(0);
		expect(coarse.x[49_999]).toBe(99_999);

		const zoomed = viewport(49_000, 51_000);
		const [during] = plotWindow.viewsFor([source], zoomed);
		expect(during.sampled).toBe(true);
		expect(during.points).toBe(50_000);
		expect(during.x[0]).toBe(0);
		expect(during.x[49_999]).toBe(99_999);

		plotWindow.settleAfter([source], zoomed);
		vi.runAllTimers();
		const [settled] = plotWindow.viewsFor([source], zoomed);

		expect(settled.sampled).toBe(false);
		expect(settled.points).toBe(6003);
		expect(settled.x[0]).toBe(46_999);
		expect(settled.x[6002]).toBe(53_001);
	});
});
