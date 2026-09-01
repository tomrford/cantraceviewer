import { roundMs, summarizePairs, type TimingStats } from './metrics.js';
import type { SceneStats } from './scene-stats.js';
import {
	createChartgpuDriver,
	createTanstackDriver,
	type PlotSize,
	type RendererId,
	type SpikeDriver
} from './drivers.js';
import {
	domainUpdateViewports,
	resizeSteps,
	SPIKE_PLOT_HEIGHT,
	SPIKE_PLOT_WIDTH,
	SPIKE_WARMUP,
	spikeWorkload,
	type SpikeWorkload
} from './workload.js';

export type ScenarioId = 'mount' | 'domainUpdate' | 'resize' | 'destroy';

export type ScenarioResult = {
	renderer: RendererId;
	label: string;
	scenario: ScenarioId;
	skipped?: string;
	cpu?: TimingStats;
	frame?: TimingStats;
	scene?: SceneStats;
	size?: PlotSize;
};

export type SuiteReport = {
	startedAt: string;
	userAgent: string;
	workload: {
		series: number;
		pointsPerSeries: number;
		totalPoints: number;
		domainUpdates: number;
		resizeSteps: number;
	};
	results: ScenarioResult[];
};

const DEFAULT_SIZE: PlotSize = { width: SPIKE_PLOT_WIDTH, height: SPIKE_PLOT_HEIGHT };

export async function runRendererSpike(options?: {
	workload?: SpikeWorkload;
	renderers?: RendererId[];
}): Promise<SuiteReport> {
	const workload = options?.workload ?? spikeWorkload();
	const selected = new Set(options?.renderers ?? ['chartgpu', 'tanstack-canvas', 'tanstack-svg']);
	const drivers = [
		createChartgpuDriver(workload),
		createTanstackDriver(workload, 'canvas'),
		createTanstackDriver(workload, 'svg')
	].filter((driver) => selected.has(driver.id));

	const results: ScenarioResult[] = [];
	for (const driver of drivers) {
		results.push(...(await runDriver(driver, workload)));
	}

	return {
		startedAt: new Date().toISOString(),
		userAgent: typeof navigator === 'undefined' ? 'node' : navigator.userAgent,
		workload: {
			series: workload.series.length,
			pointsPerSeries: workload.series[0]?.points ?? 0,
			totalPoints: workload.series.reduce((sum, series) => sum + series.points, 0),
			domainUpdates: domainUpdateViewports(workload).length,
			resizeSteps: resizeSteps().length
		},
		results
	};
}

export function formatReport(report: SuiteReport): string {
	const lines = [
		`Renderer spike ${report.startedAt}`,
		`Workload: ${report.workload.series} series × ${report.workload.pointsPerSeries} points (${report.workload.totalPoints} total)`,
		''
	];
	for (const result of report.results) {
		if (result.skipped) {
			lines.push(`${result.label} / ${result.scenario}: skipped (${result.skipped})`);
			continue;
		}
		const cpu = result.cpu ? formatStats(result.cpu) : 'n/a';
		const frame = result.frame ? formatStats(result.frame) : 'n/a';
		const scene = result.scene
			? ` points=${result.scene.points} polylines=${result.scene.polylines} vertices=${result.scene.polylineVertices}`
			: '';
		lines.push(`${result.label} / ${result.scenario}: cpu ${cpu}; frame ${frame}${scene}`);
	}
	return lines.join('\n');
}

async function runDriver(driver: SpikeDriver, workload: SpikeWorkload): Promise<ScenarioResult[]> {
	const available = await driver.available();
	if (!available) {
		return ['mount', 'domainUpdate', 'resize', 'destroy'].map((scenario) => ({
			renderer: driver.id,
			label: driver.label,
			scenario: scenario as ScenarioId,
			skipped: 'renderer unavailable in this environment'
		}));
	}

	const host = document.createElement('div');
	host.style.cssText = `position:fixed;left:-12000px;top:0;width:${DEFAULT_SIZE.width}px;height:${DEFAULT_SIZE.height}px;`;
	document.body.appendChild(host);

	try {
		const mount = await measure(async () => driver.mount(host, workload.fit, DEFAULT_SIZE));
		const scene = mount.value;
		const results: ScenarioResult[] = [
			{
				renderer: driver.id,
				label: driver.label,
				scenario: 'mount',
				cpu: mount.cpu,
				frame: mount.frame,
				scene: scene ?? undefined,
				size: DEFAULT_SIZE
			}
		];

		const windows = domainUpdateViewports(workload);
		for (let index = 0; index < SPIKE_WARMUP; index += 1) {
			driver.domainUpdate(windows[index % windows.length], DEFAULT_SIZE);
			await nextPaint();
		}

		const domainSamples = [];
		for (const viewport of windows) {
			domainSamples.push(await sample(() => driver.domainUpdate(viewport, DEFAULT_SIZE)));
		}
		const domain = summarizePairs(domainSamples);
		results.push({
			renderer: driver.id,
			label: driver.label,
			scenario: 'domainUpdate',
			cpu: domain.cpu,
			frame: domain.frame
		});

		const sizes = resizeSteps();
		for (let index = 0; index < Math.min(SPIKE_WARMUP, sizes.length); index += 1) {
			applySize(host, sizes[index]);
			driver.resize(sizes[index]);
			await nextPaint();
		}
		const resizeSamples = [];
		for (const size of sizes) {
			resizeSamples.push(
				await sample(() => {
					applySize(host, size);
					driver.resize(size);
				})
			);
		}
		const resized = summarizePairs(resizeSamples);
		results.push({
			renderer: driver.id,
			label: driver.label,
			scenario: 'resize',
			cpu: resized.cpu,
			frame: resized.frame
		});

		applySize(host, DEFAULT_SIZE);
		const destroy = await measure(() => {
			driver.destroy();
		});
		results.push({
			renderer: driver.id,
			label: driver.label,
			scenario: 'destroy',
			cpu: destroy.cpu,
			frame: destroy.frame
		});
		return results;
	} catch (error) {
		driver.destroy();
		const message = error instanceof Error ? error.message : String(error);
		return ['mount', 'domainUpdate', 'resize', 'destroy'].map((scenario) => ({
			renderer: driver.id,
			label: driver.label,
			scenario: scenario as ScenarioId,
			skipped: message
		}));
	} finally {
		host.remove();
	}
}

async function measure<T>(work: () => Promise<T> | T): Promise<{
	value: T;
	cpu: TimingStats;
	frame: TimingStats;
}> {
	const sample = await time(work);
	const stats = summarizePairs([sample]);
	return { value: sample.value, cpu: stats.cpu, frame: stats.frame };
}

async function sample(work: () => void): Promise<{ cpuMs: number; frameMs: number }> {
	const timed = await time(work);
	return { cpuMs: timed.cpuMs, frameMs: timed.frameMs };
}

async function time<T>(work: () => Promise<T> | T): Promise<{
	value: T;
	cpuMs: number;
	frameMs: number;
}> {
	const start = performance.now();
	const value = await work();
	const cpuMs = performance.now() - start;
	await nextPaint();
	return { value, cpuMs, frameMs: performance.now() - start };
}

function applySize(host: HTMLElement, size: PlotSize): void {
	host.style.width = `${size.width}px`;
	host.style.height = `${size.height}px`;
}

function nextPaint(): Promise<void> {
	return new Promise((resolve) => {
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
	});
}

function formatStats(stats: TimingStats): string {
	if (stats.samples === 1) return `${roundMs(stats.meanMs)}ms`;
	return `n=${stats.samples} median ${roundMs(stats.medianMs)}ms p95 ${roundMs(stats.p95Ms)}ms max ${roundMs(stats.maxMs)}ms`;
}
