/** Identifier of a y axis, as passed to ChartGPU's `axes.y[].id` and `series.yAxis`. */
export type YAxisId = string;

/** The axis every signal starts on. It cannot be removed, and it drives the grid lines. */
export const PRIMARY_Y_AXIS_ID: YAxisId = 'y';

/**
 * Each axis costs a gutter's worth of plot width, and the app already refuses to
 * run below 600px wide, so the cap keeps the plot area usable at the extreme.
 */
export const MAX_Y_AXES = 5;

export type YAxisGroup<T> = {
	id: YAxisId;
	/** Position in the axis list. 0 is the primary axis, drawn closest to the plot. */
	index: number;
	signals: T[];
};

export function nextYAxisId(existing: readonly YAxisId[]): YAxisId {
	let counter = existing.length;
	let candidate = `y${counter}`;
	while (existing.includes(candidate)) {
		counter += 1;
		candidate = `y${counter}`;
	}
	return candidate;
}

/**
 * Buckets signals by their assigned axis, preserving signal order within each
 * bucket. Signals with no assignment, or one naming an axis that no longer
 * exists, fall back to the primary axis.
 */
export function groupSignalsByYAxis<T extends { key: string }>(
	signals: readonly T[],
	axisIds: readonly YAxisId[],
	assignment: ReadonlyMap<string, YAxisId>
): YAxisGroup<T>[] {
	const ids = axisIds.length > 0 ? axisIds : [PRIMARY_Y_AXIS_ID];
	const groups: YAxisGroup<T>[] = ids.map((id, index) => ({ id, index, signals: [] }));
	const byId = new Map(groups.map((group) => [group.id, group]));

	for (const signal of signals) {
		const assigned = assignment.get(signal.key);
		const group = (assigned === undefined ? undefined : byId.get(assigned)) ?? groups[0];
		group.signals.push(signal);
	}

	return groups;
}

/** The unit an axis can be titled by: the one its signals agree on, or none. */
export function yAxisUnit(signals: readonly { unit: string }[]): string | null {
	let unit: string | null = null;
	for (const signal of signals) {
		if (signal.unit.length === 0) continue;
		if (unit !== null && unit !== signal.unit) return null;
		unit = signal.unit;
	}
	return unit;
}

/** Display name for an axis: `Y2 · km/h`, falling back to the bare number. */
export function yAxisLabel(index: number, unit: string | null): string {
	return unit === null ? `Y${index + 1}` : `Y${index + 1} · ${unit}`;
}
