import type { ChartGPUInstance } from 'chartgpu';
import { mountChart } from '@tanstack/charts/dom';
import type { ChartMarkRenderer } from '@tanstack/charts';
import { sceneStats, type SceneStats } from './scene-stats.js';
import { chartgpuOptions, chartgpuSeries } from './chartgpu-options.js';
import { createTanstackDefinition, createTanstackMarks } from './tanstack-definition.js';
import type { SpikeViewport, SpikeWorkload } from './workload.js';

export type RendererId = 'chartgpu' | 'tanstack-canvas' | 'tanstack-svg';

export type PlotSize = { width: number; height: number };

export type SpikeDriver = {
	id: RendererId;
	label: string;
	available(): boolean | Promise<boolean>;
	mount(
		container: HTMLElement,
		viewport: SpikeViewport,
		size: PlotSize
	): Promise<SceneStats | null>;
	domainUpdate(viewport: SpikeViewport, size: PlotSize): void;
	resize(size: PlotSize): void;
	destroy(): void;
};

const ARIA_LABEL = 'Renderer spike plot';

export function createChartgpuDriver(workload: SpikeWorkload): SpikeDriver {
	const series = chartgpuSeries(workload);
	let chart: ChartGPUInstance | null = null;

	return {
		id: 'chartgpu',
		label: 'ChartGPU 0.3.3',
		available() {
			return typeof navigator !== 'undefined' && 'gpu' in navigator;
		},
		async mount(container, viewport) {
			const { ChartGPU } = await import('chartgpu');
			chart = await ChartGPU.create(container, chartgpuOptions(series, viewport));
			return null;
		},
		domainUpdate(viewport) {
			if (!chart) throw new Error('ChartGPU is not mounted.');
			chart.setOption(chartgpuOptions(series, viewport));
		},
		resize() {
			chart?.resize();
		},
		destroy() {
			chart?.dispose();
			chart = null;
		}
	};
}

export function createTanstackDriver(
	workload: SpikeWorkload,
	surface: 'svg' | 'canvas'
): SpikeDriver {
	let marks = createTanstackMarks(workload);
	let lastViewport = workload.fit;
	let mounted: {
		update(viewport: SpikeViewport, size: PlotSize): void;
		scene(): SceneStats;
		destroy(): void;
	} | null = null;

	return {
		id: surface === 'canvas' ? 'tanstack-canvas' : 'tanstack-svg',
		label: surfaceLabel(surface),
		available() {
			return true;
		},
		async mount(container, viewport, size) {
			lastViewport = viewport;
			const renderer = await markRenderer(surface);
			marks = createTanstackMarks(workload, renderer);
			const host = mountChart(container, {
				definition: createTanstackDefinition(marks, workload, viewport),
				width: size.width,
				height: size.height,
				ariaLabel: ARIA_LABEL
			});
			mounted = {
				update(nextViewport, nextSize) {
					host.update({
						definition: createTanstackDefinition(marks, workload, nextViewport),
						width: nextSize.width,
						height: nextSize.height,
						ariaLabel: ARIA_LABEL
					});
				},
				scene: () => sceneStats(host.getScene()),
				destroy: () => host.destroy()
			};
			return mounted.scene();
		},
		domainUpdate(viewport, size) {
			if (!mounted) throw new Error('TanStack Charts is not mounted.');
			lastViewport = viewport;
			mounted.update(viewport, size);
		},
		resize(size) {
			if (!mounted) throw new Error('TanStack Charts is not mounted.');
			mounted.update(lastViewport, size);
		},
		destroy() {
			mounted?.destroy();
			mounted = null;
		}
	};
}

async function markRenderer(surface: 'svg' | 'canvas'): Promise<ChartMarkRenderer | undefined> {
	if (surface !== 'canvas') return undefined;
	const { canvasChartRenderer } = await import('@tanstack/charts/canvas');
	return canvasChartRenderer;
}

function surfaceLabel(surface: 'svg' | 'canvas'): string {
	return surface === 'canvas'
		? 'TanStack Charts 0.16.0 Canvas marks'
		: 'TanStack Charts 0.16.0 SVG';
}
