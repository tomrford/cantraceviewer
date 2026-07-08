import type { PlotRatioPoint } from './plot-geometry.js';
import {
	panViewport,
	type PlotViewport,
	viewportsAlmostEqual,
	zoomViewport
} from './plot-viewport.js';

export type ViewportMode = { mode: 'fit' } | { mode: 'manual'; viewport: PlotViewport };

const CENTER: PlotRatioPoint = { xRatio: 0.5, yRatio: 0.5 };

export class PlotViewportState {
	#mode = $state<ViewportMode>({ mode: 'fit' });

	domainSource = $state<(() => PlotViewport | null) | null>(null);
	fullDomain = $derived.by(() => this.domainSource?.() ?? null);
	activeViewport = $derived.by(() =>
		this.#mode.mode === 'fit' ? this.fullDomain : this.#mode.viewport
	);
	isFitAll = $derived.by(
		() => this.#mode.mode === 'fit' || viewportsAlmostEqual(this.#mode.viewport, this.fullDomain)
	);

	zoomBy(factor: number, anchor: PlotRatioPoint = CENTER, axes?: { x: boolean; y: boolean }): void {
		const viewport = this.activeViewport;
		if (viewport === null) return;
		this.setManual(zoomViewport(viewport, factor, anchor, axes));
	}

	panBy(delta: { x: number; y: number }, plotSize: { width: number; height: number }): void {
		const viewport = this.activeViewport;
		if (viewport === null) return;
		this.setManual(panViewport(viewport, delta, plotSize));
	}

	setManual(viewport: PlotViewport): void {
		this.#mode = viewportsAlmostEqual(viewport, this.fullDomain)
			? { mode: 'fit' }
			: { mode: 'manual', viewport };
	}

	reset(): void {
		this.#mode = { mode: 'fit' };
	}
}
