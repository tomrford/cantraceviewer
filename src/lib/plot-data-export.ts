import type { PlotSignal } from './stores/plot-data.svelte.js';

const CSV_HEADER = 'signal,unit,timeMs,value';

/** The decoded series a CSV row is built from. */
export type SignalCsvSource = Pick<PlotSignal, 'label' | 'unit' | 'series'>;

/**
 * One row per decoded sample, in legend order. Signals without decoded samples are omitted.
 * Times are trace-relative milliseconds, matching the relative x-axis.
 */
export function buildSignalCsv(signals: readonly SignalCsvSource[]): string {
	const rows = [CSV_HEADER];
	for (const signal of signals) {
		const series = signal.series;
		if (series === null) continue;

		const name = csvField(signal.label);
		const unit = csvField(signal.unit);
		const points = Math.min(series.timesMs.length, series.values.length);
		for (let index = 0; index < points; index += 1) {
			rows.push(`${name},${unit},${series.timesMs[index]},${series.values[index]}`);
		}
	}

	return `${rows.join('\n')}\n`;
}

export function signalCsvFilename(traceName: string): string {
	const baseName = traceName.trim() || 'cantraceviewer';
	return `${baseName}-signals.csv`;
}

function csvField(value: string): string {
	return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
