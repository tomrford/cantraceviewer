import { MAX_Y_AXES, nextYAxisId, PRIMARY_Y_AXIS_ID, type YAxisId } from '#lib/plot-axes.js';

import { appStore, update, type AppState } from './store.js';

export const canAddAxis = (s: AppState): boolean => s.axisIds.length < MAX_Y_AXES;

export function addAxis(): YAxisId | null {
	const { axisIds } = appStore.getState();
	if (axisIds.length >= MAX_Y_AXES) return null;
	const id = nextYAxisId(axisIds);
	update({ axisIds: [...axisIds, id] });
	return id;
}

export function removeAxis(id: YAxisId): void {
	const { axisIds, axisAssignment } = appStore.getState();
	if (id === PRIMARY_Y_AXIS_ID || !axisIds.includes(id)) return;
	update({
		axisIds: axisIds.filter((axisId) => axisId !== id),
		axisAssignment: new Map([...axisAssignment].filter(([, axisId]) => axisId !== id))
	});
}

export function assignAxis(signalKey: string, axisId: YAxisId): void {
	const { axisIds, axisAssignment } = appStore.getState();
	if (
		!axisIds.includes(axisId) ||
		(axisAssignment.get(signalKey) ?? PRIMARY_Y_AXIS_ID) === axisId
	) {
		return;
	}
	const next = new Map(axisAssignment);
	if (axisId === PRIMARY_Y_AXIS_ID) next.delete(signalKey);
	else next.set(signalKey, axisId);
	update({ axisAssignment: next });
}

export function assignToNewAxis(signalKey: string): void {
	const id = addAxis();
	if (id !== null) assignAxis(signalKey, id);
}

export function resetAxes(): void {
	const { axisIds, axisAssignment } = appStore.getInitialState();
	update({ axisIds, axisAssignment });
}
