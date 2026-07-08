import type { TraceType } from './wasm';

const TEXT_SNIFF_BYTES = 1024;
const BLF_MAGIC = [0x4c, 0x4f, 0x47, 0x47];

export function assertTextFileContent(bytes: Uint8Array, format: string): void {
	const sample = bytes.subarray(0, TEXT_SNIFF_BYTES);
	if (!sample.includes(0)) return;

	throw new Error(`${format} file appears to be binary. Open a text ${format} file.`);
}

export function assertBlfFileContent(bytes: Uint8Array): void {
	if (BLF_MAGIC.every((byte, index) => bytes[index] === byte)) return;

	throw new Error('File is not a valid BLF file.');
}

export function assertTraceFileContent(traceType: TraceType, bytes: Uint8Array): void {
	if (traceType === 'blf') {
		assertBlfFileContent(bytes);
		return;
	}

	assertTextFileContent(bytes, traceType.toUpperCase());
}
