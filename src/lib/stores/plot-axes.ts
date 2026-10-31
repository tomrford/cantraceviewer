import { createStore } from 'zustand/vanilla';
import { MAX_Y_AXES, nextYAxisId, PRIMARY_Y_AXIS_ID, type YAxisId } from '#lib/plot-axes.js';

export type PlotAxesState = {
	ids: readonly YAxisId[];
	/** Signal key -> non-primary axis; unassigned signals sit on the primary axis. */
	assignment: ReadonlyMap<string, YAxisId>;
};

export const plotAxes = createStore<PlotAxesState>()(() => ({
	ids: [PRIMARY_Y_AXIS_ID],
	assignment: new Map()
}));

export const canAddAxis = (state: PlotAxesState): boolean => state.ids.length < MAX_Y_AXES;

export function addAxis(): YAxisId | null {
	const { ids } = plotAxes.getState();
	if (ids.length >= MAX_Y_AXES) return null;
	const id = nextYAxisId(ids);
	plotAxes.setState({ ids: [...ids, id] });
	return id;
}

export function removeAxis(id: YAxisId): void {
	const { ids, assignment } = plotAxes.getState();
	if (id === PRIMARY_Y_AXIS_ID || !ids.includes(id)) return;
	plotAxes.setState({
		ids: ids.filter((axisId) => axisId !== id),
		assignment: new Map([...assignment].filter(([, axisId]) => axisId !== id))
	});
}

export function assignAxis(signalKey: string, axisId: YAxisId): void {
	const { ids, assignment } = plotAxes.getState();
	if (!ids.includes(axisId) || (assignment.get(signalKey) ?? PRIMARY_Y_AXIS_ID) === axisId) return;
	const next = new Map(assignment);
	if (axisId === PRIMARY_Y_AXIS_ID) next.delete(signalKey);
	else next.set(signalKey, axisId);
	plotAxes.setState({ assignment: next });
}

export function assignToNewAxis(signalKey: string): void {
	const id = addAxis();
	if (id !== null) assignAxis(signalKey, id);
}

export function releaseAxes(signalKeys: Iterable<string>): void {
	const { assignment } = plotAxes.getState();
	const next = new Map(assignment);
	for (const key of signalKeys) next.delete(key);
	if (next.size !== assignment.size) plotAxes.setState({ assignment: next });
}

export function releaseAllAxes(): void {
	if (plotAxes.getState().assignment.size > 0) plotAxes.setState({ assignment: new Map() });
}

export function resetAxes(): void {
	plotAxes.setState(plotAxes.getInitialState());
}
