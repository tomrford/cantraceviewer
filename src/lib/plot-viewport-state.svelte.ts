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

	/** Fit domain of the shared x axis and of the primary y axis. */
	domainSource = $state<(() => PlotViewport | null) | null>(null);
	/**
	 * Fit y ranges of the non-primary axes. The primary axis is already carried
	 * by `domainSource`, and is what pan, zoom and box select operate on.
	 */
	secondaryRangeSource = $state<(() => ReadonlyMap<YAxisId, PlotAxisRange>) | null>(null);

	fullDomain = $derived.by(() => this.domainSource?.() ?? null);
	// Captured when the gesture happens rather than recomputed from the primary
	// axis's absolute bounds. Axis membership can change its fit range at any
	// time; keeping the gesture as a proportional window lets every axis refit
	// to its own current signals without changing the shared navigation state.
	#yWindow = $state<PlotYWindow>(FULL_Y_WINDOW);

	activeViewport = $derived.by(() => {
		const domain = this.fullDomain;
		if (this.#mode.mode === 'fit' || domain === null) return domain;

		const y = applyYWindow({ min: domain.yMin, max: domain.yMax }, this.#yWindow);
		return { xMin: this.#mode.xMin, xMax: this.#mode.xMax, yMin: y.min, yMax: y.max };
	});
	// Fit-all is a property of the mode, not of coincidental equality: a manual
	// viewport the domain later drifts into must stay manual (reset enabled),
	// since a derived cannot latch it to fit and it will not follow further
	// domain changes. Interactive returns to ~full extent still normalize to
	// fit at setManual time.
	isFitAll = $derived.by(() => this.#mode.mode === 'fit');

	/** The proportion of each axis's own extent currently on screen. */
	get yWindow(): PlotYWindow {
		return this.#yWindow;
	}

	/** Visible bounds of the non-primary axes, each fitted to its own signals. */
	secondaryRanges = $derived.by(() => {
		const window = this.#yWindow;
		// Built fresh on every evaluation and never mutated afterwards, so it
		// carries no reactive state of its own.
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

		// Read the outgoing viewport before replacing it: the window advances by
		// the change between the two, so an x-only navigation leaves it alone.
		const previous = this.activeViewport;
		if (previous !== null) this.#yWindow = advanceYWindow(this.#yWindow, previous, viewport);
		this.#mode = { mode: 'manual', xMin: viewport.xMin, xMax: viewport.xMax };
	}

	reset(): void {
		this.#mode = { mode: 'fit' };
		this.#yWindow = FULL_Y_WINDOW;
	}
}
