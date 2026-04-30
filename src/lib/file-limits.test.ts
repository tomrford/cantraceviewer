import { describe, expect, it } from 'vitest';
import { ASC_MAX_FILE_BYTES, DBC_MAX_FILE_BYTES, assertFileSizeWithinLimit } from './file-limits';

describe('assertFileSizeWithinLimit', () => {
	it('accepts files at the configured limit', () => {
		const file = new File([new Uint8Array(DBC_MAX_FILE_BYTES)], 'limit.dbc');

		assertFileSizeWithinLimit(file, DBC_MAX_FILE_BYTES, 'DBC');

		expect(file.size).toBe(DBC_MAX_FILE_BYTES);
	});

	it('rejects files over the configured limit with the product label', () => {
		const file = new File([new Uint8Array(DBC_MAX_FILE_BYTES + 1)], 'too-large.dbc');

		expect(() => assertFileSizeWithinLimit(file, DBC_MAX_FILE_BYTES, 'DBC')).toThrow(
			'DBC file exceeds the 1 MiB limit'
		);
	});

	it('keeps the ASC cap at 100 MiB', () => {
		expect(ASC_MAX_FILE_BYTES).toBe(100 * 1024 * 1024);
	});
});
