import type { YAxisId } from './plot-axes.js';
import type { PlotRatioPoint } from './plot-geometry.js';
import {
	advanceYWindow,
	applyYWindow,
	FULL_Y_WINDOW,
	panViewport,
	type PlotAxisRange,
	type PlotViewport,
	type PlotYWindow,
	viewportsAlmostEqual,
	zoomViewport
} from './plot-viewport.js';

export type ViewportMode = { mode: 'fit' } | { mode: 'manual'; xMin: number; xMax: number };

const CENTER: PlotRatioPoint = { xRatio: 0.5, yRatio: 0.5 };
const NO_RANGES: ReadonlyMap<YAxisId, PlotAxisRange> = new Map();

export class PlotViewportState {
	#mode = $state<ViewportMode>({ mode: 'fit' });

	domainSource = $state<(() => PlotViewport | null) | null>(null);
	secondaryRangeSource = $state<(() => ReadonlyMap<YAxisId, PlotAxisRange>) | null>(null);

	fullDomain = $derived.by(() => this.domainSource?.() ?? null);
	#yWindow = $state<PlotYWindow>(FULL_Y_WINDOW);

	activeViewport = $derived.by(() => {
		const domain = this.fullDomain;
		if (this.#mode.mode === 'fit' || domain === null) return domain;

		const y = applyYWindow({ min: domain.yMin, max: domain.yMax }, this.#yWindow);
		return { xMin: this.#mode.xMin, xMax: this.#mode.xMax, yMin: y.min, yMax: y.max };
	});
	isFitAll = $derived.by(() => this.#mode.mode === 'fit');

	get yWindow(): PlotYWindow {
		return this.#yWindow;
	}

	secondaryRanges = $derived.by(() => {
		const window = this.#yWindow;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const ranges = new Map<YAxisId, PlotAxisRange>();
		for (const [id, range] of this.secondaryRangeSource?.() ?? NO_RANGES) {
			ranges.set(id, applyYWindow(range, window));
		}
		return ranges;
	});

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
		if (viewportsAlmostEqual(viewport, this.fullDomain)) {
			this.reset();
			return;
		}

		const previous = this.activeViewport;
		if (previous !== null) this.#yWindow = advanceYWindow(this.#yWindow, previous, viewport);
		this.#mode = { mode: 'manual', xMin: viewport.xMin, xMax: viewport.xMax };
	}

	reset(): void {
		this.#mode = { mode: 'fit' };
		this.#yWindow = FULL_Y_WINDOW;
	}
}
