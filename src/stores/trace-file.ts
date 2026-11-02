import { TRACE_MAX_FILE_BYTES, assertFileSizeWithinLimit } from '@/lib/file-limits';
import { TRACE_FILE_DESCRIPTION, traceTypeForFileName } from '@/lib/trace-file-types';
import { closeTrace, openTrace } from '@/lib/wasm';
import type { TraceFileEntry } from '@/stores/derive';
import { appStore, update } from '@/stores/store';

let nextTraceId = 1;

export async function openTraceFile(file: File): Promise<boolean> {
	update({ traceError: null });

	let next: TraceFileEntry | null = null;
	try {
		const traceType = traceTypeForFileName(file.name);
		if (traceType === null) {
			throw new Error(`Unsupported trace file type. Open ${TRACE_FILE_DESCRIPTION}.`);
		}
		assertFileSizeWithinLimit(file, TRACE_MAX_FILE_BYTES, 'Trace');

		next = { ...(await openTrace(traceType, await file.arrayBuffer())), id: nextTraceId++, file };

		const previous = appStore.getState().trace;
		update({ trace: next });
		next = null;

		if (previous) await closeTrace(previous.handle);
		return true;
	} catch (error) {
		if (next) await closeTrace(next.handle);
		update({ traceError: error instanceof Error ? error.message : 'Trace load failed' });
		return false;
	}
}

export function clearTraceError(): void {
	update({ traceError: null });
}
