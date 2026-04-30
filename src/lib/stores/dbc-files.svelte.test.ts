import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { dbcFiles } from './dbc-files.svelte';
import { closeDbc, getDbcCatalog, openDbc } from '$lib/wasm.js';
import type { DbcMessage, ParsedDbc } from '$lib/wasm.js';

vi.mock('$lib/wasm.js', () => ({
	closeDbc: vi.fn(() => Promise.resolve()),
	getDbcCatalog: vi.fn(),
	openDbc: vi.fn()
}));

const openDbcMock = openDbc as Mock<typeof openDbc>;
const getDbcCatalogMock = getDbcCatalog as Mock<typeof getDbcCatalog>;
const closeDbcMock = closeDbc as Mock<typeof closeDbc>;

describe('dbcFiles', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		dbcFiles.files = [];
		dbcFiles.error = null;
		dbcFiles.isLoading = false;
	});

	it('closes a parsed handle when catalog export fails', async () => {
		const handle = { ptr: 101 };
		openDbcMock.mockResolvedValueOnce(handle);
		getDbcCatalogMock.mockRejectedValueOnce(new Error('catalog failed'));

		await dbcFiles.addFiles([file('broken.dbc', 'BO_ 1 Broken: 8 ECU')]);

		expect(openDbcMock).toHaveBeenCalledWith('BO_ 1 Broken: 8 ECU');
		expect(closeDbcMock).toHaveBeenCalledExactlyOnceWith(handle);
		expect(dbcFiles.files).toEqual([]);
		expect(dbcFiles.error).toBe('catalog failed');
		expect(dbcFiles.isLoading).toBe(false);
	});

	it('rejects overlapping CAN IDs without dropping existing DBC handles', async () => {
		const existingHandle = { ptr: 201 };
		const duplicateHandle = { ptr: 202 };
		openDbcMock.mockResolvedValueOnce(existingHandle).mockResolvedValueOnce(duplicateHandle);
		getDbcCatalogMock
			.mockResolvedValueOnce(catalog(message({ name: 'Existing', canId: 0x123 })))
			.mockResolvedValueOnce(catalog(message({ name: 'Duplicate', canId: 0x123 })));

		await dbcFiles.addFiles([file('existing.dbc', 'existing')]);
		await dbcFiles.addFiles([file('duplicate.dbc', 'duplicate')]);

		expect(dbcFiles.files).toHaveLength(1);
		expect(dbcFiles.files[0]?.handle).toBe(existingHandle);
		expect(closeDbcMock).toHaveBeenCalledExactlyOnceWith(duplicateHandle);
		expect(dbcFiles.error).toBe(
			'duplicate contains messages which overlap with those defined in existing files.'
		);
	});
});

function file(name: string, text: string): File {
	return new File([text], name, { type: 'text/plain' });
}

function catalog(...messages: DbcMessage[]): ParsedDbc {
	return { messages };
}

function message(overrides: Partial<DbcMessage> = {}): DbcMessage {
	return {
		name: 'Message',
		dbcId: overrides.canId ?? 1,
		canId: 1,
		isExtended: false,
		isFd: false,
		sizeBytes: 8,
		transmitter: 'ECU',
		signals: [],
		...overrides
	};
}
