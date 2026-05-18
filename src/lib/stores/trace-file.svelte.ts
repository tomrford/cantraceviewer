import { closeTrace, openTrace, type TraceHandle, type TraceType } from '$lib/wasm.js';
import { TRACE_MAX_FILE_BYTES, assertFileSizeWithinLimit } from '$lib/file-limits.js';
import {
	TRACE_FILE_DESCRIPTION,
	displayTraceName,
	traceTypeForFileName
} from '$lib/trace-file-types.js';

export type TraceFileEntry = TraceHandle & { file: File };

class TraceFileStore {
	entry = $state<TraceFileEntry | null>(null);
	isLoading = $state(false);
	error = $state<string | null>(null);

	displayName = $derived(this.entry ? displayTraceName(this.entry.file.name) : 'CAN Trace Viewer');

	async openFile(file: File): Promise<boolean> {
		this.error = null;
		this.isLoading = true;

		let next: TraceFileEntry | null = null;
		try {
			const traceType = traceTypeForFile(file);
			assertFileSizeWithinLimit(file, TRACE_MAX_FILE_BYTES, 'Trace');

			const bytes = new Uint8Array(await file.arrayBuffer());
			next = await openTraceFile(traceType, file, bytes);

			const previous = this.entry;
			this.entry = next;
			next = null;

			if (previous) {
				await closeTrace(previous);
			}
			return true;
		} catch (error) {
			if (next) {
				await closeTrace(next);
			}
			this.error = error instanceof Error ? error.message : 'Trace load failed';
			return false;
		} finally {
			this.isLoading = false;
		}
	}

	async clear(): Promise<void> {
		const previous = this.entry;
		this.entry = null;

		if (previous) {
			await closeTrace(previous);
		}
	}

	clearError(): void {
		this.error = null;
	}
}

function traceTypeForFile(file: File): TraceType {
	const traceType = traceTypeForFileName(file.name);
	if (traceType !== null) return traceType;
	throw new Error(`Unsupported trace file type. Open ${TRACE_FILE_DESCRIPTION}.`);
}

async function openTraceFile(
	traceType: TraceType,
	file: File,
	bytes: Uint8Array
): Promise<TraceFileEntry> {
	return {
		...(await openTrace(traceType, bytes)),
		file
	};
}

export const traceFile = new TraceFileStore();
