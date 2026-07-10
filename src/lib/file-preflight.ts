import type { TraceType } from './wasm';

const TEXT_SNIFF_BYTES = 1024;
const BLF_MAGIC = [0x4c, 0x4f, 0x47, 0x47];
const MDF_MAGIC = [0x4d, 0x44, 0x46, 0x20, 0x20, 0x20, 0x20, 0x20];
const UNFINALIZED_MDF_MAGIC = [0x55, 0x6e, 0x46, 0x69, 0x6e, 0x4d, 0x46, 0x20];

export function assertTextFileContent(bytes: Uint8Array, format: string): void {
	const sample = bytes.subarray(0, TEXT_SNIFF_BYTES);
	if (!sample.includes(0)) return;

	throw new Error(`${format} file appears to be binary. Open a text ${format} file.`);
}

export function assertBlfFileContent(bytes: Uint8Array): void {
	if (BLF_MAGIC.every((byte, index) => bytes[index] === byte)) return;

	throw new Error('File is not a valid BLF file.');
}

export function assertMf4FileContent(bytes: Uint8Array): void {
	if (UNFINALIZED_MDF_MAGIC.every((byte, index) => bytes[index] === byte)) {
		throw new Error(
			'Unfinalized MDF4 files are not supported. Finalize the recording before opening it.'
		);
	}
	if (!MDF_MAGIC.every((byte, index) => bytes[index] === byte)) {
		throw new Error('File is not a valid MDF4 file.');
	}
	if (bytes[8] === 0x34) return;

	throw new Error('Unsupported MDF version. Open an MDF4 .mf4 file.');
}

export function assertTraceFileContent(traceType: TraceType, bytes: Uint8Array): void {
	if (traceType === 'blf') {
		assertBlfFileContent(bytes);
		return;
	}
	if (traceType === 'mf4') {
		assertMf4FileContent(bytes);
		return;
	}

	assertTextFileContent(bytes, traceType.toUpperCase());
}
