import type { PlotSignal } from './stores/plot-data.svelte.js';

export type LegendOrderMode = 'selection' | 'alphabetical' | 'grouped';

export function orderPlotSignals(signals: PlotSignal[], mode: LegendOrderMode): PlotSignal[] {
	switch (mode) {
		case 'alphabetical':
			return [...signals].sort(compareAlphabetical);
		case 'grouped':
			return [...signals].sort(compareGrouped);
		case 'selection':
		default:
			return signals;
	}
}

function compareAlphabetical(a: PlotSignal, b: PlotSignal): number {
	return (
		a.signalName.localeCompare(b.signalName) ||
		a.messageName.localeCompare(b.messageName) ||
		a.label.localeCompare(b.label) ||
		a.key.localeCompare(b.key)
	);
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
