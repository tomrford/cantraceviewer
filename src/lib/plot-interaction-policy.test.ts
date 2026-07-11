import { describe, expect, it } from 'vitest';
import { plotDragMode, plotWheelAction } from './plot-interaction-policy.js';

describe('plot interaction policy', () => {
	it('uses left drag for pan or box selection according to the active mode', () => {
		expect(plotDragMode(0, false)).toBe('pan');
		expect(plotDragMode(0, true)).toBe('box');
	});

	it('always uses middle drag for panning', () => {
		expect(plotDragMode(1, false)).toBe('pan');
		expect(plotDragMode(1, true)).toBe('pan');
		expect(plotDragMode(2, false)).toBeNull();
	});

	it('pans the x axis for dominant unmodified horizontal movement', () => {
		expect(plotWheelAction({ x: 24, y: 2 }, { shift: false, alt: false })).toEqual({
			type: 'pan-x',
			deltaX: -24
		});
	});

	it('zooms both axes for ordinary wheel movement', () => {
		expect(plotWheelAction({ x: 0, y: 12 }, { shift: false, alt: false })).toEqual({
			type: 'zoom',
			delta: 12,
			axes: { x: true, y: true }
		});
	});

	it('uses Shift for x-only zoom and Alt for y-only zoom', () => {
		expect(plotWheelAction({ x: 0, y: 12 }, { shift: true, alt: false })).toEqual({
			type: 'zoom',
			delta: 12,
			axes: { x: true, y: false }
		});
		expect(plotWheelAction({ x: 0, y: 12 }, { shift: false, alt: true })).toEqual({
			type: 'zoom',
			delta: 12,
			axes: { x: false, y: true }
		});
	});

	it('does not handle zero movement or unspecified combined modifiers', () => {
		expect(plotWheelAction({ x: 0, y: 0 }, { shift: false, alt: false })).toBeNull();
		expect(plotWheelAction({ x: 0, y: 12 }, { shift: true, alt: true })).toBeNull();
	});
});
