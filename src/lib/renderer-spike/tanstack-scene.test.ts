import { describe, expect, it } from 'vitest';
import { createChartRuntime } from '@tanstack/charts/runtime';
import { createTanstackDefinition, createTanstackMarks } from './tanstack-definition';
import { sceneStats } from './scene-stats';
import { summarize } from './metrics';
import {
	buildSpikeWorkload,
	domainUpdateViewports,
	SPIKE_PLOT_HEIGHT,
	SPIKE_PLOT_WIDTH
} from './workload';

describe('TanStack Charts scene compilation', () => {
	it('compiles four line paths and reuses them across domain-only updates', () => {
		const workload = buildSpikeWorkload();
		const marks = createTanstackMarks(workload);
		const size = { width: SPIKE_PLOT_WIDTH, height: SPIKE_PLOT_HEIGHT };
		const runtime = createChartRuntime();

		try {
			const first = runtime.render(createTanstackDefinition(marks, workload, workload.fit), size);
			const stats = sceneStats(first);
			expect(stats.polylines).toBe(workload.series.length);
			expect(stats.polylineVertices).toBeGreaterThanOrEqual(workload.series.length);
			expect(first.scales.x).toBeDefined();
			expect(first.scales.y2).toBeDefined();

			const windows = domainUpdateViewports(workload, 12);
			const samples: number[] = [];
			for (const viewport of windows) {
				const start = performance.now();
				const scene = runtime.render(createTanstackDefinition(marks, workload, viewport), size);
				samples.push(performance.now() - start);
				expect(sceneStats(scene).polylines).toBe(workload.series.length);
			}

			const compiled = summarize(samples);
			expect(compiled.samples).toBe(12);
			console.info(
				`[renderer-spike] TanStack scene domain updates: median ${compiled.medianMs.toFixed(2)}ms p95 ${compiled.p95Ms.toFixed(2)}ms points=${stats.points} vertices=${stats.polylineVertices}`
			);
		} finally {
			runtime.destroy();
		}
	});
});
