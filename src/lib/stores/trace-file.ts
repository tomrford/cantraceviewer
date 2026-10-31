import { createStore } from 'zustand/vanilla';
import { closeTrace, openTrace, type OpenTraceResult, type TraceType } from '#lib/wasm.js';
import { TRACE_MAX_FILE_BYTES, assertFileSizeWithinLimit } from '#lib/file-limits.js';
import {
	buildMf4SignalTargetIndex,
	mf4SelectorSearchIndexes,
	type Mf4SignalTarget
} from '#lib/mf4-signals.js';
import type { SelectorSearchIndex } from '#lib/selector-list.js';
import {
	TRACE_FILE_DESCRIPTION,
	displayTraceName,
	traceTypeForFileName
} from '#lib/trace-file-types.js';

export type TraceFileEntry = OpenTraceResult & { id: number; file: File };

export type TraceFileState = {
	entry: TraceFileEntry | null;
	isLoading: boolean;
	error: string | null;
	/** Derived from `entry` on every write. */
	displayName: string;
	warning: string | null;
	mf4SignalTargetByKey: ReadonlyMap<string, Mf4SignalTarget>;
	mf4SelectorIndexes: SelectorSearchIndex[];
};

let nextTraceId = 1;

export const traceFile = createStore<TraceFileState>()(() => ({
	...entryState(null),
	isLoading: false,
	error: null
}));

export async function openTraceFile(file: File): Promise<boolean> {
	traceFile.setState({ error: null, isLoading: true });

	let next: TraceFileEntry | null = null;
	try {
		const traceType = traceTypeForFile(file);
		assertFileSizeWithinLimit(file, TRACE_MAX_FILE_BYTES, 'Trace');

		const bytes = new Uint8Array(await file.arrayBuffer());
		next = { ...(await openTrace(traceType, bytes)), id: nextTraceId++, file };

		const previous = traceFile.getState().entry;
		traceFile.setState(entryState(next));
		next = null;

		if (previous) await closeTrace(previous.handle);
		return true;
	} catch (error) {
		if (next) await closeTrace(next.handle);
		traceFile.setState({ error: error instanceof Error ? error.message : 'Trace load failed' });
		return false;
	} finally {
		traceFile.setState({ isLoading: false });
	}
}

export function clearTraceError(): void {
	traceFile.setState({ error: null });
}

function entryState(entry: TraceFileEntry | null) {
	return {
		entry,
		displayName: entry ? displayTraceName(entry.file.name) : 'CAN Trace Viewer',
		warning: traceWarning(entry),
		mf4SignalTargetByKey: buildMf4SignalTargetIndex(entry),
		mf4SelectorIndexes: mf4SelectorSearchIndexes(entry)
	};
}

function traceWarning(entry: TraceFileEntry | null): string | null {
	if (!entry) return null;
	const warnings = [...(entry.warnings ?? [])];
	const count = entry.metadata.skippedLineCount;
	if (count > 0) {
		warnings.push(`Parsed with ${count} malformed ${count === 1 ? 'line' : 'lines'} skipped.`);
	}
	return warnings.length > 0 ? warnings.join(' ') : null;
}

function traceTypeForFile(file: File): TraceType {
	const traceType = traceTypeForFileName(file.name);
	if (traceType !== null) return traceType;
	throw new Error(`Unsupported trace file type. Open ${TRACE_FILE_DESCRIPTION}.`);
}
