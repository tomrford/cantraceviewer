import { describe, expect, it } from 'vitest';
import { createSignalColorAssigner } from './plot-colors';

describe('createSignalColorAssigner', () => {
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
});
