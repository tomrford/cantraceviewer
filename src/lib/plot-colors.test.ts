import { describe, expect, it } from 'vitest';
import { createSignalColorAssigner } from './plot-colors';

describe('createSignalColorAssigner', () => {
	it('keeps a signal color stable when an earlier signal is hidden', () => {
		const colors = createSignalColorAssigner(['blue', 'pink', 'green']);

		const a = colors.colorFor('a');
		const b = colors.colorFor('b');
		const c = colors.colorFor('c');

		expect(a).toBe('blue');
		expect(b).toBe('pink');
		expect(c).toBe('green');
		expect(colors.colorFor('c')).toBe(c);
		expect(colors.colorFor('b')).toBe(b);
	});

	it('reuses the lowest available index for new signals without renumbering existing signals', () => {
		const colors = createSignalColorAssigner(['blue', 'pink']);

		expect(colors.colorFor('a')).toBe('blue');
		expect(colors.colorFor('b')).toBe('pink');
		expect(colors.colorFor('c')).toBe('blue');

		colors.release('b');

		expect(colors.colorFor('d')).toBe('pink');
		expect(colors.colorFor('a')).toBe('blue');
		expect(colors.colorFor('c')).toBe('blue');
	});

	it('does not walk one toggled signal through the palette', () => {
		const colors = createSignalColorAssigner(['blue', 'pink', 'green']);

		expect(colors.colorFor('a')).toBe('blue');
		colors.release('a');
		expect(colors.colorFor('a')).toBe('blue');
	});
});
