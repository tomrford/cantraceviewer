export type YAxisId = string;

export const PRIMARY_Y_AXIS_ID: YAxisId = 'y';

export const MAX_Y_AXES = 5;

export type YAxisGroup<T> = {
	id: YAxisId;
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

export function yAxisUnit(signals: readonly { unit: string }[]): string | null {
	let unit: string | null = null;
	for (const signal of signals) {
		if (signal.unit.length === 0) continue;
		if (unit !== null && unit !== signal.unit) return null;
		unit = signal.unit;
	}
	return unit;
}

export function yAxisLabel(index: number, unit: string | null): string {
	return unit === null ? `Y${index + 1}` : `Y${index + 1} · ${unit}`;
}
