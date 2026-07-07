/**
 * Dev-only metrics for chart option pushes, exposed as `window.__plotPerf` so
 * benchmark scripts can read setOption frequency and cost from the console.
 * Returns null (and records nothing) in production builds.
 */
export type PlotPerfStats = {
	count: number;
	totalMs: number;
	maxMs: number;
	record(ms: number): void;
	reset(): void;
};

export function createPlotPerfStats(): PlotPerfStats | null {
	if (!import.meta.env.DEV || typeof window === 'undefined') return null;

	const stats: PlotPerfStats = {
		count: 0,
		totalMs: 0,
		maxMs: 0,
		record(ms: number) {
			stats.count += 1;
			stats.totalMs += ms;
			if (ms > stats.maxMs) stats.maxMs = ms;
		},
		reset() {
			stats.count = 0;
			stats.totalMs = 0;
			stats.maxMs = 0;
		}
	};

	(window as Window & { __plotPerf?: PlotPerfStats }).__plotPerf = stats;
	return stats;
}
