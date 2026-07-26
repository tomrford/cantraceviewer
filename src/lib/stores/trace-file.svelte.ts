import { closeTrace, openTrace, type OpenTraceResult, type TraceType } from '$lib/wasm.js';
import { TRACE_MAX_FILE_BYTES, assertFileSizeWithinLimit } from '$lib/file-limits.js';
import { assertTraceFileContent } from '$lib/file-preflight.js';
import { buildMf4SignalTargetIndex, mf4SelectorSearchIndexes } from '$lib/mf4-signals.js';
import {
	TRACE_FILE_DESCRIPTION,
	displayTraceName,
	traceTypeForFileName
} from '$lib/trace-file-types.js';

export type TraceFileEntry = OpenTraceResult & { id: number; file: File };

let nextTraceId = 1;

class TraceFileStore {
	entry = $state<TraceFileEntry | null>(null);
	isLoading = $state(false);
	error = $state<string | null>(null);
	private dismissedWarningEntry = $state<TraceFileEntry | null>(null);

	displayName = $derived(this.entry ? displayTraceName(this.entry.file.name) : 'CAN Trace Viewer');
	mf4SignalTargetByKey = $derived.by(() => buildMf4SignalTargetIndex(this.entry));
	mf4SelectorIndexes = $derived.by(() => mf4SelectorSearchIndexes(this.entry));
	warning = $derived.by(() => {
		if (!this.entry || this.entry === this.dismissedWarningEntry) return null;
		const warnings = [...(this.entry.warnings ?? [])];
		const count = this.entry.metadata.skippedLineCount;
		if (count > 0) {
			warnings.push(`Parsed with ${count} malformed ${count === 1 ? 'line' : 'lines'} skipped.`);
		}

		return warnings.length > 0 ? warnings.join(' ') : null;
	});

	async openFile(file: File): Promise<boolean> {
		this.error = null;
		this.isLoading = true;

		let next: TraceFileEntry | null = null;
		try {
			const traceType = traceTypeForFile(file);
			assertFileSizeWithinLimit(file, TRACE_MAX_FILE_BYTES, 'Trace');

			const bytes = new Uint8Array(await file.arrayBuffer());
			assertTraceFileContent(traceType, bytes);
			next = await openTraceFile(traceType, file, bytes);

			const previous = this.entry;
			this.entry = next;
			this.dismissedWarningEntry = null;
			next = null;

			if (previous) {
				await closeTrace(previous.handle);
			}
			return true;
		} catch (error) {
			if (next) {
				await closeTrace(next.handle);
			}
			this.error = error instanceof Error ? error.message : 'Trace load failed';
			return false;
		} finally {
			this.isLoading = false;
		}
	}

	clearError(): void {
		this.error = null;
	}

	clearWarning(): void {
		this.dismissedWarningEntry = this.entry;
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
		id: nextTraceId++,
		file
	};
}

export const traceFile = new TraceFileStore();
