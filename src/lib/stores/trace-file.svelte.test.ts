import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { closeTrace, openTrace } from '$lib/wasm.js';
import type { TraceHandle, TraceMetadata } from '$lib/wasm.js';
import { traceFile } from './trace-file.svelte';

vi.mock('$lib/wasm.js', () => ({
	closeTrace: vi.fn(() => Promise.resolve()),
	openTrace: vi.fn()
}));

const openTraceMock = openTrace as Mock<typeof openTrace>;
const closeTraceMock = closeTrace as Mock<typeof closeTrace>;

describe('traceFile', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		traceFile.entry = null;
		traceFile.error = null;
		traceFile.isLoading = false;
		traceFile.clearWarning();
	});

	it('rejects unsupported trace extensions before reading bytes', async () => {
		await traceFile.openFile(file('trace.txt', 'BO_ 1 Example: 8 ECU'));

		expect(openTraceMock).not.toHaveBeenCalled();
		expect(traceFile.error).toBe('Unsupported trace file type. Open .asc, .trc, .blf, or .mf4.');
	});

	it('rejects BLF files without LOGG magic before WASM parse', async () => {
		await traceFile.openFile(file('trace.blf', 'BO_ 1 Example: 8 ECU'));

		expect(openTraceMock).not.toHaveBeenCalled();
		expect(traceFile.error).toBe('File is not a valid BLF file.');
	});

	it('rejects binary text trace content before WASM parse', async () => {
		await traceFile.openFile(new File([new Uint8Array([0x64, 0x61, 0, 0x65])], 'trace.asc'));

		expect(openTraceMock).not.toHaveBeenCalled();
		expect(traceFile.error).toBe('ASC file appears to be binary. Open a text ASC file.');
	});

	it('surfaces malformed skipped lines as a dismissible warning', async () => {
		openTraceMock.mockResolvedValueOnce(traceHandle(1, metadata({ skippedLineCount: 2 })));

		await traceFile.openFile(file('trace.asc', 'date Mon Jan 1 00:00:00.000'));

		expect(traceFile.warning).toBe('Parsed with 2 malformed lines skipped.');
		traceFile.clearWarning();
		expect(traceFile.warning).toBe(null);
		expect(closeTraceMock).not.toHaveBeenCalled();
	});

	it('keeps a dismissed warning dismissed when a later open fails', async () => {
		openTraceMock.mockResolvedValueOnce(traceHandle(1, metadata({ skippedLineCount: 2 })));

		await traceFile.openFile(file('trace.asc', 'date Mon Jan 1 00:00:00.000'));
		traceFile.clearWarning();
		await traceFile.openFile(file('trace.txt', 'not a trace'));

		expect(traceFile.error).not.toBe(null);
		expect(traceFile.warning).toBe(null);
	});

	it('does not warn when no malformed lines were skipped', async () => {
		openTraceMock.mockResolvedValueOnce(traceHandle(1, metadata({ skippedLineCount: 0 })));

		await traceFile.openFile(file('trace.trc', ';$FILEVERSION=1.1'));

		expect(traceFile.warning).toBe(null);
	});
});

function file(name: string, text: string): File {
	return new File([text], name, { type: 'text/plain' });
}

function traceHandle(id: number, metadata: TraceMetadata): TraceHandle {
	return { id, metadata } as TraceHandle;
}

function metadata({ skippedLineCount }: { skippedLineCount: number }): TraceMetadata {
	return {
		measurementStartMs: null,
		validMessageCount: 1,
		skippedLineCount,
		durationNs: null
	};
}
