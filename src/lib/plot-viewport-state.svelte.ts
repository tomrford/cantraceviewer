import type { YAxisId } from './plot-axes.js';
import type { PlotRatioPoint } from './plot-geometry.js';
import {
	applyYWindow,
	FULL_Y_WINDOW,
	panViewport,
	type PlotAxisRange,
	type PlotViewport,
	viewportsAlmostEqual,
	yWindowOf,
	zoomViewport
} from './plot-viewport.js';

export type ViewportMode = { mode: 'fit' } | { mode: 'manual'; viewport: PlotViewport };

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
	activeViewport = $derived.by(() =>
		this.#mode.mode === 'fit' ? this.fullDomain : this.#mode.viewport
	);
	// Fit-all is a property of the mode, not of coincidental equality: a manual
	// viewport the domain later drifts into must stay manual (reset enabled),
	// since a derived cannot latch it to fit and it will not follow further
	// domain changes. Interactive returns to ~full extent still normalize to
	// fit at setManual time.
	isFitAll = $derived.by(() => this.#mode.mode === 'fit');

	/** The proportion of each axis's own extent currently on screen. */
	yWindow = $derived.by(() => {
		const domain = this.fullDomain;
		const active = this.activeViewport;
		return domain === null || active === null ? FULL_Y_WINDOW : yWindowOf(domain, active);
	});

	/** Visible bounds of the non-primary axes, each fitted to its own signals. */
	secondaryRanges = $derived.by(() => {
		const window = this.yWindow;
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
		this.#mode = viewportsAlmostEqual(viewport, this.fullDomain)
			? { mode: 'fit' }
			: { mode: 'manual', viewport };
	}

	reset(): void {
		this.#mode = { mode: 'fit' };
	}
}
