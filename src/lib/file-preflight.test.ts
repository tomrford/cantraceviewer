import { describe, expect, it } from 'vitest';
import { assertBlfFileContent, assertMf4FileContent } from './file-preflight';

describe('file preflight', () => {
	it('accepts BLF files with LOGG magic', () => {
		expect(() => assertBlfFileContent(new Uint8Array([0x4c, 0x4f, 0x47, 0x47]))).not.toThrow();
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
