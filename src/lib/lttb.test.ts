import { describe, expect, it } from 'vitest';
import { lttbSample } from './lttb';

function ramp(length: number): Float64Array {
	return Float64Array.from({ length }, (_, i) => i);
}

describe('lttbSample', () => {
	it('keeps range endpoints and hits the target count', () => {
		const x = ramp(1000);
		const y = ramp(1000);
		const sampled = lttbSample(x, y, 0, 1000, 100);

		expect(sampled.x).toHaveLength(100);
		expect(sampled.x[0]).toBe(0);
		expect(sampled.x[99]).toBe(999);
	});

	it('copies the range untouched when already under the target', () => {
		const x = ramp(10);
		const sampled = lttbSample(x, x, 2, 8, 100);

		expect(Array.from(sampled.x)).toEqual([2, 3, 4, 5, 6, 7]);
	});

	it('preserves an isolated spike', () => {
		const x = ramp(1000);
		const y = new Float64Array(1000);
		y[500] = 100;
		const sampled = lttbSample(x, y, 0, 1000, 50);

		expect(Array.from(sampled.y)).toContain(100);
	});

	it('samples only the requested range', () => {
		const x = ramp(1000);
		const sampled = lttbSample(x, x, 200, 800, 50);

		expect(sampled.x[0]).toBe(200);
		expect(sampled.x[49]).toBe(799);
		for (const value of sampled.x) {
			expect(value).toBeGreaterThanOrEqual(200);
			expect(value).toBeLessThan(800);
		}
	});
});
