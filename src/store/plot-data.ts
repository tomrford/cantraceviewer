import { nextSignalColorIndex } from '@/lib/plot/plot-colors';
import type { YAxisId } from '@/lib/plot/y-axis';
import type { Signal } from '@/lib/signal';
import { getMf4SignalValues, getSignalValues } from '@/lib/wasm';
import type { SelectedSignalState, TraceFileEntry } from '@/store/derive';
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

	const signal = appStore.getState().signalByKey.get(key);
	if (!signal || signal.unavailableReason) return;

	const colorIndex = nextSignalColorIndex(
		Array.from(appStore.getState().selected.values(), (state) => state.colorIndex)
	);
	await decodeSignal(signal, colorIndex);
}

export function deselectDbcFile(dbcFileId: string): void {
	const state = appStore.getState();
	const selected = new Map(state.selected);
	const released: string[] = [];
	for (const signal of state.signalByKey.values()) {
		if (signal.kind === 'dbc' && signal.fileId === dbcFileId && selected.delete(signal.key)) {
			released.push(signal.key);
		}
	}
	if (released.length === 0) return;
	update({ selected, axisAssignment: withoutSignals(state.axisAssignment, released) });
}

export function clearSelectedSignals(): void {
	update({ selected: new Map(), axisAssignment: new Map() });
}

async function decodeSignal(signal: Signal, colorIndex: number): Promise<void> {
	const { key } = signal;
	const { trace } = appStore.getState();
	const decoding = { colorIndex, isDecoding: trace !== null, series: null, error: null };
	setSignalState(key, decoding);
	if (!trace) return;

	let outcome: Partial<SelectedSignalState>;
	try {
		outcome = {
			series:
				signal.kind === 'mf4'
					? await getMf4SignalValues(trace.handle, signal.signalId)
					: await decodeDbcSignal(trace, signal)
		};
	} catch (error) {
		outcome = { error: error instanceof Error ? error.message : 'Signal decode failed' };
	}

	// Deselecting or reselecting the signal replaced its state, and that newer state wins. A
	// replaced trace, or a signal gone from the catalogue, only ends the spinner.
	const state = appStore.getState();
	if (state.selected.get(key) !== decoding) return;
	const stale = trace.session.signal.aborted || !state.signalByKey.has(key);
	setSignalState(key, { ...decoding, isDecoding: false, ...(stale ? {} : outcome) });
}

function decodeDbcSignal(trace: TraceFileEntry, signal: Extract<Signal, { kind: 'dbc' }>) {
	if (!trace.hasRawFrames) {
		throw new Error('This trace has no raw CAN frames for DBC decoding.');
	}
	return getSignalValues(
		signal.handle,
		trace.handle,
		signal.message,
		signal.signalName,
		signal.source
	);
}

function setSignalState(key: string, state: SelectedSignalState): void {
	update({ selected: new Map(appStore.getState().selected).set(key, state) });
}

function withoutSignals(
	assignment: ReadonlyMap<string, YAxisId>,
	signalKeys: string[]
): ReadonlyMap<string, YAxisId> {
	const next = new Map(assignment);
	for (const key of signalKeys) next.delete(key);
	return next.size === assignment.size ? assignment : next;
}
