import {
	ASC_MAX_FILE_BYTES,
	assertFileSizeWithinLimit,
	closeAsc,
	getAscMetadata,
	openAsc,
	type AscHandle,
	type TraceMetadata
} from '$lib/wasm.js';

export type TraceFileEntry = {
	file: File;
	handle: AscHandle;
	metadata: TraceMetadata;
};

class TraceFileStore {
	entry = $state<TraceFileEntry | null>(null);
	isLoading = $state(false);
	error = $state<string | null>(null);

	displayName = $derived(this.entry ? displayTraceName(this.entry.file.name) : 'Load trace');

	async openFile(file: File): Promise<void> {
		this.error = null;
		this.isLoading = true;

		let next: TraceFileEntry | null = null;
		try {
			const previous = this.entry;
			this.entry = null;
			if (previous) {
				await closeAsc(previous.handle);
			}

			assertFileSizeWithinLimit(file, ASC_MAX_FILE_BYTES, 'ASC');

			const text = await file.text();
			const handle = await openAsc(text);

			try {
				next = {
					file,
					handle,
					metadata: await getAscMetadata(handle)
				};
			} catch (error) {
				await closeAsc(handle);
				throw error;
			}

			this.entry = next;
			next = null;
		} catch (error) {
			if (next) {
				await closeAsc(next.handle);
			}
			this.error = error instanceof Error ? error.message : 'ASC load failed';
		} finally {
			this.isLoading = false;
		}
	}

	async clear(): Promise<void> {
		const previous = this.entry;
		this.entry = null;

		if (previous) {
			await closeAsc(previous.handle);
		}
	}

	clearError(): void {
		this.error = null;
	}
}

function displayTraceName(fileName: string): string {
	return fileName.replace(/\.asc$/i, '');
}

export const traceFile = new TraceFileStore();
