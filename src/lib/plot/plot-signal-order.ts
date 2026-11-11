import type { PlotSignal, Signal, SignalFormat } from '@/lib/signal';

export type LegendOrderMode = 'selection' | 'alphabetical' | 'grouped';

export function orderPlotSignals(signals: PlotSignal[], mode: LegendOrderMode): PlotSignal[] {
	switch (mode) {
		case 'alphabetical':
			return [...signals].sort((a, b) => compareAlphabetical(a.signal, b.signal));
		case 'grouped':
			return [...signals].sort((a, b) => compareGrouped(a.signal, b.signal));
		case 'selection':
			return signals;
	}
}

function compareAlphabetical(a: Signal, b: Signal): number {
	return (
		a.signalName.localeCompare(b.signalName) ||
		a.messageName.localeCompare(b.messageName) ||
		a.label.localeCompare(b.label) ||
		a.key.localeCompare(b.key)
	);
}

function compareGrouped(a: Signal, b: Signal): number {
	const groupOrder = compareGroup(a, b);
	if (groupOrder !== 0) return groupOrder;

	const scaleOrder = compareScale(a, b);
	if (scaleOrder !== 0) return scaleOrder;

	return compareAlphabetical(a, b);
}

function compareGroup({ format: a }: Signal, { format: b }: Signal): number {
	const aHasValueTable = a.valueDescriptions.length > 0;
	const bHasValueTable = b.valueDescriptions.length > 0;

	if (aHasValueTable && bHasValueTable) {
		return valueTableKey(a).localeCompare(valueTableKey(b));
	}
	if (aHasValueTable !== bHasValueTable) return aHasValueTable ? -1 : 1;

	return a.unit.localeCompare(b.unit);
}

function valueTableKey(format: SignalFormat): string {
	const entries = [...format.valueDescriptions]
		.sort((a, b) => a.rawValue - b.rawValue || a.label.localeCompare(b.label))
		.map(({ rawValue, label }) => [rawValue, label]);

	return JSON.stringify(entries);
}

function compareScale({ format: a }: Signal, { format: b }: Signal): number {
	if (a.factor !== b.factor) return a.factor - b.factor;
	return a.offset - b.offset;
}
