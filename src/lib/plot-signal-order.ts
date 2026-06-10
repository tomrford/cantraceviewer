import type { PlotSignal } from './stores/plot-data.svelte.js';

export type LegendOrderMode = 'selection' | 'alphabetical' | 'grouped';

export function orderPlotSignals(
	signals: PlotSignal[],
	mode: LegendOrderMode,
	selectionOrder: ReadonlyMap<string, number>
): PlotSignal[] {
	switch (mode) {
		case 'selection':
			return signals;
		case 'alphabetical':
			return [...signals].sort(compareAlphabetical);
		case 'grouped':
			return [...signals].sort(compareGrouped);
		default: {
			const unhandledMode: never = mode;
			throw new Error(`Unhandled legend order mode: ${unhandledMode}`);
		}
	}
}

function compareAlphabetical(a: PlotSignal, b: PlotSignal): number {
	return a.label.localeCompare(b.label);
}

function compareGrouped(a: PlotSignal, b: PlotSignal): number {
	const unitOrder = a.unit.localeCompare(b.unit);
	if (unitOrder !== 0) return unitOrder;

	const scaleOrder = compareScale(a, b);
	if (scaleOrder !== 0) return scaleOrder;

	return compareAlphabetical(a, b);
}

function compareScale(a: PlotSignal, b: PlotSignal): number {
	if (a.factor !== b.factor) return a.factor - b.factor;
	return a.offset - b.offset;
}
