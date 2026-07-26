import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_Y_AXES, PRIMARY_Y_AXIS_ID } from '$lib/plot-axes.js';
import { plotAxes } from './plot-axes.svelte.js';

describe('plotAxes', () => {
	beforeEach(() => plotAxes.reset());

	it('starts with the primary axis alone and caps how many can be added', () => {
		expect(plotAxes.ids).toEqual([PRIMARY_Y_AXIS_ID]);

		while (plotAxes.canAddAxis) plotAxes.addAxis();

		expect(plotAxes.ids).toHaveLength(MAX_Y_AXES);
		expect(plotAxes.addAxis()).toBeNull();
		expect(plotAxes.ids).toHaveLength(MAX_Y_AXES);
	});

	it('returns an axis worth of signals to the primary axis when it is removed', () => {
		const second = plotAxes.addAxis();
		if (second === null) throw new Error('expected an axis');
		plotAxes.assign('a', second);
		expect(plotAxes.assignment.get('a')).toBe(second);

		plotAxes.removeAxis(second);

		expect(plotAxes.ids).toEqual([PRIMARY_Y_AXIS_ID]);
		expect(plotAxes.assignment.has('a')).toBe(false);
	});

	it('refuses to remove the primary axis', () => {
		plotAxes.removeAxis(PRIMARY_Y_AXIS_ID);
		expect(plotAxes.ids).toEqual([PRIMARY_Y_AXIS_ID]);
	});

	it('forgets a deselected signal without disturbing its axis', () => {
		const second = plotAxes.addAxis();
		if (second === null) throw new Error('expected an axis');
		plotAxes.assign('a', second);
		plotAxes.assign('b', second);

		plotAxes.release('a');

		// The signal comes back to the primary axis rather than remembering where
		// it was, and the axis it left survives for the signals still on it.
		expect(plotAxes.assignment.has('a')).toBe(false);
		expect(plotAxes.assignment.get('b')).toBe(second);
		expect(plotAxes.ids).toEqual([PRIMARY_Y_AXIS_ID, second]);
	});

	it('keeps the axes when every assignment is released', () => {
		const second = plotAxes.addAxis();
		if (second === null) throw new Error('expected an axis');
		plotAxes.assign('a', second);

		plotAxes.releaseAll();

		expect(plotAxes.assignment.size).toBe(0);
		expect(plotAxes.ids).toEqual([PRIMARY_Y_AXIS_ID, second]);
	});

	it('stores an assignment to the primary axis as the absence of one', () => {
		const second = plotAxes.addAxis();
		if (second === null) throw new Error('expected an axis');
		plotAxes.assign('a', second);

		plotAxes.assign('a', PRIMARY_Y_AXIS_ID);

		expect(plotAxes.assignment.has('a')).toBe(false);
	});
});
