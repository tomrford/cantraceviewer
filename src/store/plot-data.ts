import { nextSignalColorIndex } from '@/lib/plot/plot-colors';
import type { YAxisId } from '@/lib/plot/y-axis';
import { getMf4SignalValues, getSignalValues } from '@/lib/wasm';
import type { DbcSignalTarget, SelectedSignalState, TraceFileEntry } from '@/store/derive';
import { appStore, update } from '@/store/store';

export function isSignalSelected(key: string): boolean {
	return appStore.getState().selected.has(key);
}

export function signalDecodeStatus(key: string): {
	isDecoding: boolean;
	decodeError: string | null;
} {
	const state = appStore.getState().selected.get(key);
	return { isDecoding: state?.isDecoding ?? false, decodeError: state?.error ?? null };
}

export async function toggleSignal(key: string): Promise<void> {
	if (isSignalSelected(key)) {
		const state = appStore.getState();
		const selected = new Map(state.selected);
		selected.delete(key);
		update({ selected, axisAssignment: withoutSignals(state.axisAssignment, [key]) });
		return;
	}

	const target = findSignalTarget(key);
	if (!target || (target.kind === 'dbc' && target.value.unavailableReason)) return;

	const colorIndex = nextSignalColorIndex(
		Array.from(appStore.getState().selected.values(), (state) => state.colorIndex)
	);
	setSignalState(key, { colorIndex, isDecoding: false, series: null, error: null });
	await decodeSignal(key, target, colorIndex);
}

export function deselectDbcFile(dbcFileId: string): void {
	const state = appStore.getState();
	const selected = new Map(state.selected);
	const released: string[] = [];
	for (const [key, target] of Object.entries(state.signalTargetByKey)) {
		if (target.file.id !== dbcFileId || !selected.delete(key)) continue;
		released.push(key);
	}
	if (released.length === 0) return;
	update({ selected, axisAssignment: withoutSignals(state.axisAssignment, released) });
}

export function clearSelectedSignals(): void {
	update({ selected: new Map(), axisAssignment: new Map() });
}

async function decodeSignal(
	key: string,
	target: NonNullable<ReturnType<typeof findSignalTarget>>,
	colorIndex: number
): Promise<void> {
	const { trace } = appStore.getState();
	if (!trace) return;

	const decoding: SelectedSignalState = { colorIndex, isDecoding: true, series: null, error: null };
	setSignalState(key, decoding);
	const isCurrent = () =>
		appStore.getState().selected.get(key) === decoding &&
		appStore.getState().trace === trace &&
		findSignalTarget(key) !== null;

	try {
		const series =
			target.kind === 'mf4'
				? await getMf4SignalValues(trace.handle, target.value.signal.id)
				: await decodeDbcSignal(trace, target.value);

		if (isCurrent()) setSignalState(key, { ...decoding, isDecoding: false, series });
	} catch (error) {
		if (isCurrent()) {
			setSignalState(key, {
				...decoding,
				isDecoding: false,
				error: error instanceof Error ? error.message : 'Signal decode failed'
			});
		}
	} finally {
		if (appStore.getState().selected.get(key) === decoding) {
			setSignalState(key, { ...decoding, isDecoding: false });
		}
	}
}

function decodeDbcSignal(trace: TraceFileEntry, target: DbcSignalTarget) {
	if (!trace.hasRawFrames) {
		throw new Error('This trace has no raw CAN frames for DBC decoding.');
	}
	return getSignalValues(
		target.file.handle,
		trace.handle,
		{
			canId: target.message.canId,
			isExtended: target.message.isExtended,
			sizeBytes: target.message.sizeBytes
		},
		target.signal.name,
		target.source
	);
}

function setSignalState(key: string, state: SelectedSignalState): void {
	update({ selected: new Map(appStore.getState().selected).set(key, state) });
}

function findSignalTarget(key: string) {
	const { signalTargetByKey, mf4SignalTargetByKey } = appStore.getState();
	const dbc = signalTargetByKey[key];
	if (dbc) return { kind: 'dbc' as const, value: dbc };
	const mf4 = mf4SignalTargetByKey.get(key);
	return mf4 ? { kind: 'mf4' as const, value: mf4 } : null;
}

function withoutSignals(
	assignment: ReadonlyMap<string, YAxisId>,
	signalKeys: string[]
): ReadonlyMap<string, YAxisId> {
	const next = new Map(assignment);
	for (const key of signalKeys) next.delete(key);
	return next.size === assignment.size ? assignment : next;
}
