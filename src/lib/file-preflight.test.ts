import { describe, expect, it } from 'vitest';
import {
	assertBlfFileContent,
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
});

function bytes(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}
