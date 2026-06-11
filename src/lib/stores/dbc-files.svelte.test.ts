import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { dbcFiles } from './dbc-files.svelte';
import { listStoredDbcs, putStoredDbcs, resetStoredDbcs } from './dbc-library.js';
import { closeDbc, getDbcCatalog, openDbc } from '$lib/wasm.js';
import type { DbcHandle, DbcMessage, ParsedDbc } from '$lib/wasm.js';

vi.mock('$lib/wasm.js', () => ({
	closeDbc: vi.fn(() => Promise.resolve()),
	getDbcCatalog: vi.fn(),
	openDbc: vi.fn()
}));

vi.mock('./dbc-library.js', () => ({
	deleteStoredDbc: vi.fn(() => Promise.resolve()),
	listStoredDbcs: vi.fn(() => Promise.resolve([])),
	putStoredDbcs: vi.fn(() => Promise.resolve()),
	resetStoredDbcs: vi.fn(() => Promise.resolve()),
	storedDbcId: vi.fn((text: string) => Promise.resolve(text))
}));

const openDbcMock = openDbc as Mock<typeof openDbc>;
const getDbcCatalogMock = getDbcCatalog as Mock<typeof getDbcCatalog>;
const closeDbcMock = closeDbc as Mock<typeof closeDbc>;
const listStoredDbcsMock = listStoredDbcs as Mock<typeof listStoredDbcs>;
const putStoredDbcsMock = putStoredDbcs as Mock<typeof putStoredDbcs>;
const resetStoredDbcsMock = resetStoredDbcs as Mock<typeof resetStoredDbcs>;

describe('dbcFiles', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		dbcFiles.files = [];
		dbcFiles.error = null;
		dbcFiles.isLoading = false;
		dbcFiles.hasLoadedLibrary = false;
	});

	it('closes a parsed handle when catalog export fails', async () => {
		const handle = dbcHandle(101);
		openDbcMock.mockResolvedValueOnce(handle);
		getDbcCatalogMock.mockRejectedValueOnce(new Error('catalog failed'));

		await dbcFiles.addFiles([file('broken.dbc', 'BO_ 1 Broken: 8 ECU')]);

		expect(openDbcMock).toHaveBeenCalledWith('BO_ 1 Broken: 8 ECU');
		expect(closeDbcMock).toHaveBeenCalledExactlyOnceWith(handle);
		expect(dbcFiles.files).toEqual([]);
		expect(dbcFiles.error).toBe('catalog failed');
		expect(dbcFiles.isLoading).toBe(false);
	});

	it('allows overlapping CAN IDs across DBC files', async () => {
		const existingHandle = dbcHandle(201);
		const duplicateHandle = dbcHandle(202);
		openDbcMock.mockResolvedValueOnce(existingHandle).mockResolvedValueOnce(duplicateHandle);
		getDbcCatalogMock
			.mockResolvedValueOnce(catalog(message({ name: 'Existing', canId: 0x123 })))
			.mockResolvedValueOnce(catalog(message({ name: 'Duplicate', canId: 0x123 })));

		await dbcFiles.addFiles([file('existing.dbc', 'existing')]);
		await dbcFiles.addFiles([file('duplicate.dbc', 'duplicate')]);

		expect(dbcFiles.files).toHaveLength(2);
		expect(dbcFiles.files[0]?.handle).toBe(existingHandle);
		expect(dbcFiles.files[1]?.handle).toBe(duplicateHandle);
		expect(dbcFiles.error).toBe(null);
		expect(closeDbcMock).not.toHaveBeenCalled();
	});

	it('keeps classic and CAN FD messages with the same numeric ID in one file', async () => {
		const handle = dbcHandle(301);
		openDbcMock.mockResolvedValueOnce(handle);
		getDbcCatalogMock.mockResolvedValueOnce(
			catalog(
				message({ name: 'ClassicMessage', canId: 0x123, sizeBytes: 8, isFd: false }),
				message({ name: 'FdMessage', canId: 0x123, sizeBytes: 12, isFd: true })
			)
		);

		await dbcFiles.addFiles([file('mixed.dbc', 'mixed')]);

		expect(dbcFiles.files).toHaveLength(1);
		expect(dbcFiles.files[0]?.handle).toBe(handle);
		expect(dbcFiles.error).toBe(null);
		expect(dbcFiles.sidebarFiles[0]?.messages).toHaveLength(2);
	});

	it('rejects duplicate frame identities within one DBC file', async () => {
		const handle = dbcHandle(302);
		openDbcMock.mockResolvedValueOnce(handle);
		getDbcCatalogMock.mockResolvedValueOnce(
			catalog(
				message({ name: 'FirstMessage', canId: 0x123, sizeBytes: 8 }),
				message({ name: 'SecondMessage', canId: 0x123, sizeBytes: 8 })
			)
		);

		await dbcFiles.addFiles([file('ambiguous.dbc', 'ambiguous')]);

		expect(dbcFiles.files).toHaveLength(0);
		expect(dbcFiles.error).toBe(
			'ambiguous contains multiple messages with the same CAN ID, frame format, and payload length.'
		);
		expect(closeDbcMock).toHaveBeenCalledExactlyOnceWith(handle);
		expect(putStoredDbcsMock).not.toHaveBeenCalled();
	});

	it('ignores added files while another DBC operation is loading', async () => {
		dbcFiles.isLoading = true;

		await dbcFiles.addFiles([file('late.dbc', 'late')]);

		expect(openDbcMock).not.toHaveBeenCalled();
		expect(putStoredDbcsMock).not.toHaveBeenCalled();
		expect(dbcFiles.files).toEqual([]);
		expect(dbcFiles.isLoading).toBe(true);
	});

	it('resets the stored DBC library after a library load failure', async () => {
		const handle = dbcHandle(401);
		listStoredDbcsMock.mockResolvedValueOnce([
			{ id: 'stored-id', name: 'stored.dbc', text: 'stored' }
		]);
		openDbcMock.mockResolvedValueOnce(handle);
		getDbcCatalogMock.mockRejectedValueOnce(new Error('cached DBC failed'));

		await dbcFiles.loadLibrary();

		expect(openDbcMock).toHaveBeenCalledExactlyOnceWith('stored');
		expect(closeDbcMock).toHaveBeenCalledExactlyOnceWith(handle);
		expect(resetStoredDbcsMock).toHaveBeenCalledOnce();
		expect(dbcFiles.hasLoadedLibrary).toBe(true);
		expect(dbcFiles.files).toEqual([]);
		expect(dbcFiles.error).toBe(null);
	});

	it('resets loaded DBC handles and the stored DBC library', async () => {
		const handle = dbcHandle(501);
		dbcFiles.files = [
			{
				id: 'stored-id',
				name: 'stored.dbc',
				handle,
				catalog: catalog(message({ name: 'Stored' }))
			}
		];
		dbcFiles.error = 'previous error';
		dbcFiles.hasLoadedLibrary = false;

		await dbcFiles.resetLibrary();

		expect(closeDbcMock).toHaveBeenCalledExactlyOnceWith(handle);
		expect(resetStoredDbcsMock).toHaveBeenCalledOnce();
		expect(dbcFiles.files).toEqual([]);
		expect(dbcFiles.error).toBe(null);
		expect(dbcFiles.hasLoadedLibrary).toBe(true);
	});
});

function file(name: string, text: string): File {
	return new File([text], name, { type: 'text/plain' });
}

function dbcHandle(id: number): DbcHandle {
	return { id } as DbcHandle;
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
