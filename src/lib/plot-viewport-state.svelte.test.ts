import { describe, expect, it } from 'vitest';
import { PlotViewportState } from './plot-viewport-state.svelte.js';
import type { PlotViewport } from './plot-viewport.js';

function viewport(xMin: number, xMax: number, yMin = 0, yMax = 1): PlotViewport {
	return { xMin, xMax, yMin, yMax };
}

describe('PlotViewportState', () => {
	it('starts in fit mode and follows a changing domain source', () => {
		const state = new PlotViewportState();
		let domain = $state<PlotViewport | null>(viewport(0, 10));
		state.domainSource = () => domain;

		expect(state.activeViewport).toEqual(viewport(0, 10));
		expect(state.isFitAll).toBe(true);

		domain = viewport(0, 20);

		expect(state.activeViewport).toEqual(viewport(0, 20));
		expect(state.isFitAll).toBe(true);
	});

	it('enters manual mode when zooming, panning, or setting a box viewport', () => {
		const state = new PlotViewportState();
		const fullDomain = viewport(0, 100);
		state.domainSource = () => fullDomain;

		state.zoomBy(0.5);
		expect(state.activeViewport).not.toEqual(fullDomain);
		expect(state.isFitAll).toBe(false);

		state.reset();
		state.panBy({ x: 10, y: 0 }, { width: 100, height: 100 });
		expect(state.activeViewport).not.toEqual(fullDomain);
		expect(state.isFitAll).toBe(false);

		state.reset();
		state.setManual(viewport(25, 75, 0.25, 0.75));
		expect(state.activeViewport).toEqual(viewport(25, 75, 0.25, 0.75));
		expect(state.isFitAll).toBe(false);
	});

	it('normalizes manual viewports near the full domain back to fit mode', () => {
		const state = new PlotViewportState();
		let domain = $state<PlotViewport | null>(viewport(0, 100));
		state.domainSource = () => domain;

		state.setManual(viewport(0, 100.00001, 0, 1));
		expect(state.isFitAll).toBe(true);

		domain = viewport(0, 200);

		expect(state.activeViewport).toEqual(viewport(0, 200));
		expect(state.isFitAll).toBe(true);
	});

	it('stays manual when the domain drifts into the manual viewport', () => {
		const state = new PlotViewportState();
		let domain = $state<PlotViewport | null>(viewport(0, 100));
		state.domainSource = () => domain;

		state.setManual(viewport(0, 80));
		domain = viewport(0, 80);

		expect(state.isFitAll).toBe(false);

		domain = viewport(0, 120);

		expect(state.activeViewport).toEqual(viewport(0, 80));

		state.reset();
		expect(state.activeViewport).toEqual(viewport(0, 120));
		expect(state.isFitAll).toBe(true);
	});

	it('reset returns to fit mode and follows later domain changes', () => {
		const state = new PlotViewportState();
		let domain = $state<PlotViewport | null>(viewport(0, 100));
		state.domainSource = () => domain;

		state.zoomBy(0.5);
		expect(state.isFitAll).toBe(false);

		state.reset();
		expect(state.activeViewport).toEqual(viewport(0, 100));
		expect(state.isFitAll).toBe(true);

		domain = viewport(0, 150);

		expect(state.activeViewport).toEqual(viewport(0, 150));
	});

	it('moves every axis by the same proportion of its own extent', () => {
		const state = new PlotViewportState();
		state.domainSource = () => viewport(0, 100, 0, 10);
		state.secondaryRangeSource = () => new Map([['y1', { min: 200, max: 400 }]]);

		expect(state.secondaryRanges.get('y1')).toEqual({ min: 200, max: 400 });

		// Halve the y span about the centre: both axes keep their own units but
		// show the same middle half, so the lines move together on screen.
		state.setManual(viewport(0, 100, 2.5, 7.5));

		expect(state.secondaryRanges.get('y1')).toEqual({ min: 250, max: 350 });

		state.reset();
		expect(state.secondaryRanges.get('y1')).toEqual({ min: 200, max: 400 });
	});

	it('leaves secondary axes at their fit range without a domain', () => {
		const state = new PlotViewportState();
		state.domainSource = () => null;
		state.secondaryRangeSource = () => new Map([['y1', { min: -5, max: 5 }]]);

		expect(state.secondaryRanges.get('y1')).toEqual({ min: -5, max: 5 });
	});

	it('keeps interaction methods as no-ops without a domain', () => {
		const state = new PlotViewportState();
		state.domainSource = () => null;

		state.zoomBy(0.5);
		state.panBy({ x: 10, y: 10 }, { width: 100, height: 100 });
		state.reset();

		expect(state.activeViewport).toBeNull();
		expect(state.isFitAll).toBe(true);
	});
});
