import { lttbSample } from './lttb.js';
import type { PlotViewport } from './plot-viewport.js';
import { renderIndexRange, type SignalView, type WindowedSignalView } from './signal-plot-data.js';

/** Total point budget shared by all rendered lines per materialization. */
const TOTAL_SAMPLING_BUDGET = 50_000;
/** Buffered slices span viewport ± span, so they hold up to 3x the on-screen window. */
const BUFFER_SPANS = 3;
const SETTLE_MS = 150;

type MaterializedSignal = {
	source: SignalView;
	budget: number;
	/** Viewports inside this x-range can reuse the slice; ±Infinity for full coverage. */
	xMin: number;
	xMax: number;
	start: number;
	end: number;
	view: WindowedSignalView;
};

type WindowSlice = { start: number; end: number; xMin: number; xMax: number };

/**
 * App-owned render window for chart series.
 *
 * Materializes a buffered slice (viewport ± one span) of each signal,
 * downsampled to the shared budget, and keeps its identity stable while the
 * viewport stays inside the buffer. Pan/zoom frames therefore push only new
 * axis bounds to ChartGPU with unchanged series references, keeping the
 * library's per-setOption work off its O(points) copy/sample paths. Slices
 * rematerialize synchronously when the viewport escapes the buffer or the
 * source data changes, and a debounced settle recenters them for full detail
 * once interaction rests.
 */
export class PlotWindow {
	#revision = $state(0);
	// Deliberately non-reactive: viewsFor mutates the cache while evaluating a
	// $derived, and #revision carries the one reactive signal (settle updates).
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	#cache = new Map<string, MaterializedSignal>();
	#lastViews: WindowedSignalView[] = [];
	#settleTimer: ReturnType<typeof setTimeout> | null = null;

	viewsFor(views: SignalView[], viewport: PlotViewport | null): WindowedSignalView[] {
		void this.#revision;
		const budget = perSignalBudget(views);
		const next = views.map((view) => this.#materialize(view, viewport, budget, false));

		if (this.#cache.size !== views.length) {
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- transient lookup set
			const keep = new Set(views.map((view) => view.key));
			for (const key of this.#cache.keys()) {
				if (!keep.has(key)) this.#cache.delete(key);
			}
		}

		if (!sameViews(this.#lastViews, next)) this.#lastViews = next;
		return this.#lastViews;
	}

	/** Debounced rematerialization around the rested viewport. */
	settleAfter(views: SignalView[], viewport: PlotViewport | null): void {
		if (this.#settleTimer !== null) clearTimeout(this.#settleTimer);
		this.#settleTimer = setTimeout(() => {
			this.#settleTimer = null;
			const budget = perSignalBudget(views);
			let changed = false;
			for (const view of views) {
				const before = this.#cache.get(view.key)?.view;
				if (this.#materialize(view, viewport, budget, true) !== before) changed = true;
			}
			if (changed) this.#revision += 1;
		}, SETTLE_MS);
	}

	dispose(): void {
		if (this.#settleTimer !== null) clearTimeout(this.#settleTimer);
	}

	#materialize(
		view: SignalView,
		viewport: PlotViewport | null,
		budget: number,
		exact: boolean
	): WindowedSignalView {
		const cached = this.#cache.get(view.key);
		const reusable = cached !== undefined && cached.source === view && cached.budget === budget;
		if (reusable && !exact && covers(cached, viewport)) return cached.view;

		const slice = windowSlice(view, viewport);
		if (reusable && cached.start === slice.start && cached.end === slice.end) {
			cached.xMin = slice.xMin;
			cached.xMax = slice.xMax;
			return cached.view;
		}

		const points = slice.end - slice.start;
		// Buffered slices carry proportionally more points so on-screen density
		// during interaction matches the settled density.
		const target = slice.xMin === -Infinity ? budget : budget * BUFFER_SPANS;
		let materialized: WindowedSignalView;
		if (points > target) {
			const sampledColumns = lttbSample(view.x, view.y, slice.start, slice.end, target);
			materialized = {
				...view,
				x: sampledColumns.x,
				y: sampledColumns.y,
				points: target,
				sampled: true
			};
		} else if (slice.start === 0 && slice.end === view.points) {
			materialized = { ...view, sampled: false };
		} else {
			materialized = {
				...view,
				x: view.x.subarray(slice.start, slice.end),
				y: view.y.subarray(slice.start, slice.end),
				points,
				sampled: false
			};
		}

		this.#cache.set(view.key, {
			source: view,
			budget,
			xMin: slice.xMin,
			xMax: slice.xMax,
			start: slice.start,
			end: slice.end,
			view: materialized
		});
		return materialized;
	}
}

function perSignalBudget(views: SignalView[]): number {
	const active = views.filter((view) => view.points > 0).length;
	return Math.max(2, Math.floor(TOTAL_SAMPLING_BUDGET / Math.max(1, active)));
}

function covers(cached: MaterializedSignal, viewport: PlotViewport | null): boolean {
	if (viewport === null) return cached.xMin === -Infinity && cached.xMax === Infinity;
	return viewport.xMin >= cached.xMin && viewport.xMax <= cached.xMax;
}

function windowSlice(view: SignalView, viewport: PlotViewport | null): WindowSlice {
	if (viewport === null) {
		return { start: 0, end: view.points, xMin: -Infinity, xMax: Infinity };
	}

	const span = viewport.xMax - viewport.xMin;
	const bufferedMin = viewport.xMin - span;
	const bufferedMax = viewport.xMax + span;
	const { start, end } = renderIndexRange(view.x, bufferedMin, bufferedMax);
	if (start === 0 && end === view.points) {
		return { start, end, xMin: -Infinity, xMax: Infinity };
	}
	return { start, end, xMin: bufferedMin, xMax: bufferedMax };
}

function sameViews(a: WindowedSignalView[], b: WindowedSignalView[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}
