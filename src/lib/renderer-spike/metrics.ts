export type TimingStats = {
	samples: number;
	minMs: number;
	medianMs: number;
	p95Ms: number;
	maxMs: number;
	meanMs: number;
	totalMs: number;
};

export type SamplePair = {
	cpuMs: number;
	frameMs: number;
};

export function summarize(values: readonly number[]): TimingStats {
	if (values.length === 0) {
		return { samples: 0, minMs: 0, medianMs: 0, p95Ms: 0, maxMs: 0, meanMs: 0, totalMs: 0 };
	}

	const sorted = [...values].sort((left, right) => left - right);
	const totalMs = values.reduce((sum, value) => sum + value, 0);
	return {
		samples: sorted.length,
		minMs: sorted[0],
		medianMs: percentile(sorted, 0.5),
		p95Ms: percentile(sorted, 0.95),
		maxMs: sorted[sorted.length - 1],
		meanMs: totalMs / sorted.length,
		totalMs
	};
}

export function summarizePairs(samples: readonly SamplePair[]): {
	cpu: TimingStats;
	frame: TimingStats;
} {
	return {
		cpu: summarize(samples.map((sample) => sample.cpuMs)),
		frame: summarize(samples.map((sample) => sample.frameMs))
	};
}

export function roundMs(value: number): number {
	return Math.round(value * 100) / 100;
}

function percentile(sorted: readonly number[], fraction: number): number {
	const index = (sorted.length - 1) * fraction;
	const low = Math.floor(index);
	const high = Math.ceil(index);
	if (low === high) return sorted[low];
	return sorted[low] * (high - index) + sorted[high] * (index - low);
}
