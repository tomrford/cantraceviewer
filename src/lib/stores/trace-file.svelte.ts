import {
	closeAsc,
	closeTrc,
	getAscMetadata,
	getTrcMetadata,
	openAsc,
	openTrc,
	type AscHandle,
	type TrcHandle,
	type TraceMetadata
} from '$lib/wasm.js';
import { TRACE_MAX_FILE_BYTES, assertFileSizeWithinLimit } from '$lib/file-limits.js';

export type AscTraceFileEntry = {
	traceType: 'asc';
	file: File;
	handle: AscHandle;
	metadata: TraceMetadata;
};

export type TrcTraceFileEntry = {
	traceType: 'trc';
	file: File;
	handle: TrcHandle;
	metadata: TraceMetadata;
};

export type TraceFileEntry = AscTraceFileEntry | TrcTraceFileEntry;

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
			next = await openTrace(traceType, file, bytes);

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

function displayTraceName(fileName: string): string {
	return fileName.replace(/\.(asc|trc)$/i, '');
}

function traceTypeForFile(file: File): TraceFileEntry['traceType'] {
	if (/\.trc$/i.test(file.name)) return 'trc';
	if (/\.asc$/i.test(file.name)) return 'asc';
	throw new Error('Unsupported trace file type');
}

async function openTrace(
	traceType: TraceFileEntry['traceType'],
	file: File,
	bytes: Uint8Array
): Promise<TraceFileEntry> {
	if (traceType === 'trc') {
		const handle = await openTrc(bytes);
		try {
			return {
				traceType,
				file,
				handle,
				metadata: await getTrcMetadata(handle)
			};
		} catch (error) {
			await closeTrc(handle);
			throw error;
		}
	}

	const handle = await openAsc(bytes);
	try {
		return {
			traceType,
			file,
			handle,
			metadata: await getAscMetadata(handle)
		};
	} catch (error) {
		await closeAsc(handle);
		throw error;
	}
}

async function closeTrace(entry: TraceFileEntry): Promise<void> {
	if (entry.traceType === 'trc') {
		await closeTrc(entry.handle);
		return;
	}
	await closeAsc(entry.handle);
}

export const traceFile = new TraceFileStore();
