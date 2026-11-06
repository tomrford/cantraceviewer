import { lttbSample } from '@/lib/lttb';
import type { PlotViewport } from '@/lib/plot/plot-viewport';
import {
	renderIndexRange,
	type SignalView,
	type WindowedSignalView
} from '@/lib/plot/signal-plot-data';

const TOTAL_SAMPLING_BUDGET = 50_000;
const BUFFER_SPANS = 3;
const SETTLE_MS = 150;

type WindowSlice = { start: number; end: number; xMin: number; xMax: number };

type MaterializedSignal = WindowSlice & {
	source: SignalView;
	budget: number;
	view: WindowedSignalView;
};

/**
 * Windows and LTTB-samples signal views around the viewport, reusing buffered slices while
 * panning. `settleAfter` re-samples exactly once interaction pauses and calls `onSettle` when
 * that changed any view, so the caller can push the result again.
 */
export class PlotWindow {
	#cache = new Map<string, MaterializedSignal>();
	#lastViews: WindowedSignalView[] = [];
	#settleTimer: ReturnType<typeof setTimeout> | null = null;
	#onSettle: () => void;

	constructor(onSettle: () => void) {
		this.#onSettle = onSettle;
	}

	viewsFor(views: SignalView[], viewport: PlotViewport | null): WindowedSignalView[] {
		const budget = perSignalBudget(views);
		const next = views.map((view) => this.#materialize(view, viewport, budget, false));

		if (this.#cache.size !== views.length) {
			const keep = new Set(views.map((view) => view.key));
			for (const key of this.#cache.keys()) {
				if (!keep.has(key)) this.#cache.delete(key);
			}
		}

		if (!sameViews(this.#lastViews, next)) this.#lastViews = next;
		return this.#lastViews;
	}

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
			if (changed) this.#onSettle();
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
		const target = slice.xMin === -Infinity ? budget : budget * BUFFER_SPANS;
		const sampled = points > target;
		const columns = sampled
			? lttbSample(view.x, view.y, slice.start, slice.end, target)
			: { x: view.x.subarray(slice.start, slice.end), y: view.y.subarray(slice.start, slice.end) };
		const materialized = { ...view, ...columns, sampled };

		this.#cache.set(view.key, { ...slice, source: view, budget, view: materialized });
		return materialized;
	}
}

function perSignalBudget(views: SignalView[]): number {
	const active = views.filter((view) => view.x.length > 0).length;
	return Math.max(2, Math.floor(TOTAL_SAMPLING_BUDGET / Math.max(1, active)));
}

function covers(cached: MaterializedSignal, viewport: PlotViewport | null): boolean {
	if (viewport === null) return cached.xMin === -Infinity && cached.xMax === Infinity;
	return viewport.xMin >= cached.xMin && viewport.xMax <= cached.xMax;
}

function windowSlice(view: SignalView, viewport: PlotViewport | null): WindowSlice {
	if (viewport === null) {
		return { start: 0, end: view.x.length, xMin: -Infinity, xMax: Infinity };
	}

	const span = viewport.xMax - viewport.xMin;
	const bufferedMin = viewport.xMin - span;
	const bufferedMax = viewport.xMax + span;
	const { start, end } = renderIndexRange(view.x, bufferedMin, bufferedMax);
	if (start === 0 && end === view.x.length) {
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
