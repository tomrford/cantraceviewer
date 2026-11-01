import { createStore } from 'zustand/vanilla';
import { closeTrace, openTrace, type OpenTraceResult } from '#lib/wasm.js';
import { TRACE_MAX_FILE_BYTES, assertFileSizeWithinLimit } from '#lib/file-limits.js';
import { buildMf4SignalTargetIndex, mf4SelectorSearchIndexes } from '#lib/mf4-signals.js';
import {
	TRACE_FILE_DESCRIPTION,
	displayTraceName,
	traceTypeForFileName
} from '#lib/trace-file-types.js';

export type TraceFileEntry = OpenTraceResult & { id: number; file: File };

let nextTraceId = 1;

export const traceFile = createStore(() => ({
	...entryState(null),
	isLoading: false,
	error: null as string | null
}));

export async function openTraceFile(file: File): Promise<boolean> {
	traceFile.setState({ error: null, isLoading: true });

	let next: TraceFileEntry | null = null;
	try {
		const traceType = traceTypeForFileName(file.name);
		if (traceType === null) {
			throw new Error(`Unsupported trace file type. Open ${TRACE_FILE_DESCRIPTION}.`);
		}
		assertFileSizeWithinLimit(file, TRACE_MAX_FILE_BYTES, 'Trace');

		next = { ...(await openTrace(traceType, await file.arrayBuffer())), id: nextTraceId++, file };

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
