import { describe, expect, it } from 'vitest';
import {
	assertBlfFileContent,
	assertMf4FileContent,
	assertTextFileContent,
	assertTraceFileContent
} from './file-preflight';

describe('file preflight', () => {
	it('accepts text content without NUL bytes', () => {
		expect(() => assertTextFileContent(bytes('BO_ 1 Example: 8 ECU'), 'DBC')).not.toThrow();
	});

	it('rejects text formats that contain NUL bytes in the sniffed prefix', () => {
		expect(() => assertTextFileContent(new Uint8Array([0x42, 0x4f, 0, 0x5f]), 'DBC')).toThrow(
			'DBC file appears to be binary. Open a text DBC file.'
		);
	});

	it('accepts BLF files with LOGG magic', () => {
		expect(() => assertBlfFileContent(new Uint8Array([0x4c, 0x4f, 0x47, 0x47]))).not.toThrow();
	});

	it('rejects BLF files without LOGG magic', () => {
		expect(() => assertBlfFileContent(bytes('BO_ 1 Example: 8 ECU'))).toThrow(
			'File is not a valid BLF file.'
		);
	});

	it('routes trace preflight by trace type', () => {
		expect(() => assertTraceFileContent('asc', bytes('date Mon Jan 1 00:00:00.000'))).not.toThrow();
		expect(() => assertTraceFileContent('trc', new Uint8Array([0x3b, 0]))).toThrow(
			'TRC file appears to be binary. Open a text TRC file.'
		);
	});

	it('accepts MDF4 and rejects MDF3 content', () => {
		const mf4 = new Uint8Array(16);
		mf4.set(bytes('MDF     4.10'));
		expect(() => assertMf4FileContent(mf4)).not.toThrow();
		const unfinalized = new Uint8Array(16);
		unfinalized.set(bytes('UnFinMF 4.11'));
		expect(() => assertMf4FileContent(unfinalized)).toThrow(
			'Unfinalized MDF4 files are not supported. Finalize the recording before opening it.'
		);

		const mdf3 = new Uint8Array(16);
		mdf3.set(bytes('MDF     3.30'));
		expect(() => assertMf4FileContent(mdf3)).toThrow(
			'Unsupported MDF version. Open an MDF4 .mf4 file.'
		);
	});
});

function bytes(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}
