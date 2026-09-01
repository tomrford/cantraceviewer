import { describe, expect, it } from 'vitest';
import {
	buildSpikeWorkload,
	domainUpdateViewports,
	SPIKE_POINTS_PER_SERIES,
	SPIKE_SERIES_COUNT,
	SPIKE_TOTAL_POINTS
} from './workload';
import { chartgpuSeries } from './chartgpu-options';

describe('renderer spike workload', () => {
	it('freezes 50,000 points across four series', () => {
		const workload = buildSpikeWorkload();
		expect(workload.series).toHaveLength(SPIKE_SERIES_COUNT);
		expect(workload.series.reduce((sum, series) => sum + series.points, 0)).toBe(
			SPIKE_TOTAL_POINTS
		);
		expect(workload.indexes).toHaveLength(SPIKE_POINTS_PER_SERIES);
		expect(workload.series[0].x).toBe(workload.series[1].x);
	});

	it('keeps typed-array identity on ChartGPU series across domain windows', () => {
		const workload = buildSpikeWorkload();
		const series = chartgpuSeries(workload);
		const first = series[0];
		if (first.type !== 'line') throw new Error('expected line series');
		const data = first.data;
		if (!isColumnData(data)) throw new Error('expected column data');

		const again = chartgpuSeries(workload);
		expect(again).not.toBe(series);
		expect(again[0]).not.toBe(first);
		if (again[0].type !== 'line' || !isColumnData(again[0].data)) {
			throw new Error('expected line column data');
		}
		expect(again[0].data.x).toBe(data.x);
		expect(again[0].data.y).toBe(data.y);
	});

	it('pans a window that stays inside the trace without rematerializing x', () => {
		const workload = buildSpikeWorkload();
		const windows = domainUpdateViewports(workload, 8);
		expect(windows.length).toBe(8);
		expect(windows[0].xMin).toBe(0);
		expect(windows[windows.length - 1].xMax).toBe(workload.xMax);
		for (const window of windows) {
			expect(window.xMax - window.xMin).toBeCloseTo(workload.xMax * 0.25);
			expect(window.primary).toBe(workload.primary);
		}
	});
});

function isColumnData(data: unknown): data is { x: ArrayLike<number>; y: ArrayLike<number> } {
	return (
		data !== null && typeof data === 'object' && !Array.isArray(data) && 'x' in data && 'y' in data
	);
}
