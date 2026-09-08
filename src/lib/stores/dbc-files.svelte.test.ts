import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import {
	buildSelectorSearchIndexes,
	dbcFiles,
	signalIdentityKey,
	type DbcFileEntry
} from './dbc-files.svelte';
import { listStoredDbcs, putStoredDbcs, resetStoredDbcs } from './dbc-library.js';
import { closeDbc, openDbc } from '$lib/wasm.js';
import type { DbcHandle, DbcMessage, DbcSignal, OpenDbcResult, ParsedDbc } from '$lib/wasm.js';

vi.mock('$lib/wasm.js', () => ({
	closeDbc: vi.fn(() => Promise.resolve()),
	openDbc: vi.fn()
}));

vi.mock('./dbc-library.js', () => ({
	deleteStoredDbc: vi.fn(() => Promise.resolve()),
	listStoredDbcs: vi.fn(() => Promise.resolve([])),
	putStoredDbcs: vi.fn(() => Promise.resolve()),
	resetStoredDbcs: vi.fn(() => Promise.resolve()),
	storedDbcId: vi.fn((input: string | Uint8Array) =>
		Promise.resolve(typeof input === 'string' ? input : new TextDecoder().decode(input))
	)
}));

const openDbcMock = openDbc as Mock<typeof openDbc>;
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

	it('retains legacy bytes and recoverable warnings in the library flow', async () => {
		const bytes = new Uint8Array([0x42, 0x4f, 0x5f, 0x20, 0x80]);
		const warnings = [
			{
				category: 'unsupported-record' as const,
				keyword: 'CM_',
				line: 3,
				column: 2,
				message: 'Record is not used by the viewer.'
			}
		];
		openDbcMock.mockResolvedValueOnce({
			...openDbcResult({} as DbcHandle, catalog(message())),
			warnings
		});
		await dbcFiles.addFiles([new File([bytes], 'legacy.dbc')]);
		expect(openDbcMock).toHaveBeenCalledExactlyOnceWith(bytes);
		expect(vi.mocked(putStoredDbcs).mock.calls[0][0][0]).toMatchObject({
			name: 'legacy.dbc',
			bytes
		});
		expect(dbcFiles.files[0].warnings).toEqual(warnings);
		expect(dbcFiles.error).toBeNull();
	});

	it('rejects an oversized DBC before reading file contents', async () => {
		const oversized = new File([new Uint8Array(1024 * 1024 + 1)], 'large.dbc');
		const read = vi.spyOn(oversized, 'arrayBuffer');
		await dbcFiles.addFiles([oversized]);
		expect(read).not.toHaveBeenCalled();
		expect(openDbcMock).not.toHaveBeenCalled();
		expect(dbcFiles.error).toContain('1 MiB');
	});

	it('keeps transport-only J1939 catalogued without offering raw plot targets', () => {
		dbcFiles.files = [
			dbcEntry({
				messages: [
					message({ name: 'Raw', signals: [signal()] }),
					message({
						name: 'Transport',
						canId: 0x18f00400,
						isExtended: true,
						sizeBytes: 12,
						frameFormat: 'j1939',
						rawFrameDecodable: false,
						j1939: { pgn: 0xf004, sourceAddress: 0, priority: 6 },
						signals: [signal()]
					})
				]
			})
		];

		expect(dbcFiles.files[0].catalog.messages).toHaveLength(2);
		expect(dbcFiles.selectorFiles[0].messages.map((entry) => entry.name)).toEqual(['Raw']);
		expect(Object.values(dbcFiles.signalTargetByKey).map((target) => target.message.name)).toEqual([
			'Raw'
		]);
	});

	it('reports an open failure without closing a handle', async () => {
		openDbcMock.mockRejectedValueOnce(new Error('catalog failed'));

		await dbcFiles.addFiles([file('broken.dbc', 'BO_ 1 Broken: 8 ECU')]);

		expect(openDbcMock).toHaveBeenCalledWith(new TextEncoder().encode('BO_ 1 Broken: 8 ECU'));
		expect(closeDbcMock).not.toHaveBeenCalled();
		expect(dbcFiles.files).toEqual([]);
		expect(dbcFiles.error).toBe('broken.dbc: catalog failed');
		expect(dbcFiles.isLoading).toBe(false);
	});

	it('rejects unsupported DBC extensions before size checks', async () => {
		await dbcFiles.addFiles([new File([new Uint8Array(2 * 1024 * 1024)], 'large.asc')]);

		expect(openDbcMock).not.toHaveBeenCalled();
		expect(dbcFiles.error).toBe('Unsupported DBC file type. Open .dbc.');
	});

	it('rejects binary DBC content before WASM parse', async () => {
		await dbcFiles.addFiles([new File([new Uint8Array([0x42, 0x4f, 0, 0x5f])], 'binary.dbc')]);

		expect(openDbcMock).not.toHaveBeenCalled();
		expect(dbcFiles.error).toBe('DBC file appears to be binary. Open a text DBC file.');
	});

	it('allows overlapping CAN IDs across DBC files', async () => {
		const existingHandle = dbcHandle(201);
		const duplicateHandle = dbcHandle(202);
		openDbcMock
			.mockResolvedValueOnce(
				openDbcResult(existingHandle, catalog(message({ name: 'Existing', canId: 0x123 })))
			)
			.mockResolvedValueOnce(
				openDbcResult(duplicateHandle, catalog(message({ name: 'Duplicate', canId: 0x123 })))
			);

		await dbcFiles.addFiles([file('existing.dbc', 'existing')]);
		await dbcFiles.addFiles([file('duplicate.dbc', 'duplicate')]);

		expect(dbcFiles.files).toHaveLength(2);
		expect(dbcFiles.files[0]?.handle).toBe(existingHandle);
		expect(dbcFiles.files[1]?.handle).toBe(duplicateHandle);
		expect(dbcFiles.error).toBe(null);
		expect(closeDbcMock).not.toHaveBeenCalled();
	});

	it('keeps embedded MF4 DBCs transient and closes them with their trace', async () => {
		const handle = dbcHandle(203);
		openDbcMock.mockResolvedValueOnce(
			openDbcResult(handle, catalog(message({ name: 'Embedded' })))
		);

		await dbcFiles.addTransientDbcs(42, [{ name: 'embedded.dbc', text: 'embedded' }]);

		expect(dbcFiles.files).toMatchObject([
			{
				id: 'mf4:42:0',
				name: 'embedded.dbc',
				origin: 'mf4'
			}
		]);
		expect(dbcFiles.selectorFiles[0]).toMatchObject({
			name: 'embedded',
			kind: 'dbc',
			transient: true
		});
		expect(putStoredDbcsMock).not.toHaveBeenCalled();

		await dbcFiles.clearTransientDbcs();

		expect(dbcFiles.files).toEqual([]);
		expect(closeDbcMock).toHaveBeenCalledExactlyOnceWith(handle);
	});

	it('clears a failed embedded DBC error when the trace is replaced', async () => {
		openDbcMock.mockRejectedValueOnce(new Error('embedded catalog failed'));

		await dbcFiles.addTransientDbcs(42, [{ name: 'broken.dbc', text: 'broken' }]);
		expect(dbcFiles.error).toBe('broken.dbc: embedded catalog failed');

		await dbcFiles.addTransientDbcs(43, []);

		expect(dbcFiles.error).toBe(null);
		expect(dbcFiles.files).toEqual([]);
	});

	it('skips re-added DBC files with identical content without opening a handle', async () => {
		const handle = dbcHandle(211);
		openDbcMock.mockResolvedValueOnce(openDbcResult(handle, catalog(message({ name: 'Vehicle' }))));

		await dbcFiles.addFiles([
			file('vehicle.dbc', 'same-content'),
			file('vehicle-copy.dbc', 'same-content')
		]);
		await dbcFiles.addFiles([file('vehicle-again.dbc', 'same-content')]);

		expect(openDbcMock).toHaveBeenCalledExactlyOnceWith(new TextEncoder().encode('same-content'));
		expect(closeDbcMock).not.toHaveBeenCalled();
		expect(putStoredDbcsMock).toHaveBeenCalledExactlyOnceWith([
			{ id: 'same-content', name: 'vehicle.dbc', bytes: new TextEncoder().encode('same-content') }
		]);
		expect(dbcFiles.files).toHaveLength(1);
		expect(dbcFiles.files[0]?.id).toBe('same-content');
		expect(dbcFiles.files[0]?.handle).toBe(handle);
		expect(dbcFiles.error).toBe(null);
	});

	it('keeps classic and CAN FD messages with the same numeric ID in one file', async () => {
		const handle = dbcHandle(301);
		openDbcMock.mockResolvedValueOnce(
			openDbcResult(
				handle,
				catalog(
					message({
						name: 'ClassicMessage',
						canId: 0x123,
						sizeBytes: 8,
						isFd: false
					}),
					message({
						name: 'FdMessage',
						canId: 0x123,
						sizeBytes: 12,
						isFd: true
					})
				)
			)
		);

		await dbcFiles.addFiles([file('mixed.dbc', 'mixed')]);

		expect(dbcFiles.files).toHaveLength(1);
		expect(dbcFiles.files[0]?.handle).toBe(handle);
		expect(dbcFiles.error).toBe(null);
		expect(dbcFiles.selectorFiles[0]?.messages).toHaveLength(2);
	});

	it('returns the full signal tree for an empty selector query', () => {
		dbcFiles.files = [
			dbcEntry({
				id: 'dbc-1',
				name: 'powertrain.dbc',
				messages: [
					message({
						name: 'PowertrainStatus',
						canId: 0x101,
						signals: [signal({ name: 'VehicleSpeed' }), signal({ name: 'EngineRpm' })]
					}),
					message({ name: 'EmptyMessage', canId: 0x102, signals: [] })
				]
			}),
			dbcEntry({
				id: 'dbc-2',
				name: 'body.dbc',
				messages: [
					message({
						name: 'DoorStatus',
						canId: 0x201,
						signals: [signal({ name: 'DoorOpen' })]
					})
				]
			})
		];

		expect(visibleSelectorSignals('')).toMatchObject([
			{
				id: 'dbc-1',
				name: 'powertrain',
				messages: [
					{
						name: 'PowertrainStatus',
						signals: [{ signalName: 'VehicleSpeed' }, { signalName: 'EngineRpm' }]
					}
				]
			},
			{
				id: 'dbc-2',
				name: 'body',
				messages: [
					{
						name: 'DoorStatus',
						signals: [{ signalName: 'DoorOpen' }]
					}
				]
			}
		]);
	});

	it('returns empty children for collapsed nodes so closed sections never render', () => {
		dbcFiles.files = [
			dbcEntry({
				id: 'dbc-1',
				name: 'powertrain.dbc',
				messages: [
					message({
						name: 'PowertrainStatus',
						canId: 0x101,
						signals: [signal({ name: 'VehicleSpeed' })]
					}),
					message({
						name: 'BatteryStatus',
						canId: 0x102,
						signals: [signal({ name: 'BatteryVoltage' })]
					})
				]
			})
		];
		const powertrainKey = dbcFiles.selectorFiles[0].messages[0].key;

		expect(
			visibleSelectorSignals('', {
				expandedDbcIds: new Set(),
				expandedMessageKeys: new Set([powertrainKey])
			})
		).toMatchObject([{ id: 'dbc-1', expanded: false, messages: [] }]);

		expect(
			visibleSelectorSignals('', {
				expandedDbcIds: new Set(['dbc-1']),
				expandedMessageKeys: new Set([powertrainKey])
			})
		).toMatchObject([
			{
				id: 'dbc-1',
				expanded: true,
				messages: [
					{
						name: 'PowertrainStatus',
						expanded: true,
						signals: [{ signalName: 'VehicleSpeed' }]
					},
					{ name: 'BatteryStatus', expanded: false, signals: [] }
				]
			}
		]);
	});

	it('filters selector signals by query and hides empty messages and DBCs', () => {
		dbcFiles.files = [
			dbcEntry({
				id: 'dbc-1',
				name: 'powertrain.dbc',
				messages: [
					message({
						name: 'PowertrainStatus',
						canId: 0x101,
						signals: [signal({ name: 'VehicleSpeed' }), signal({ name: 'EngineRpm' })]
					}),
					message({
						name: 'BatteryStatus',
						canId: 0x102,
						signals: [signal({ name: 'BatteryVoltage' })]
					})
				]
			}),
			dbcEntry({
				id: 'dbc-2',
				name: 'body.dbc',
				messages: [
					message({
						name: 'DoorStatus',
						canId: 0x201,
						signals: [signal({ name: 'DoorOpen' })]
					})
				]
			})
		];

		expect(visibleSelectorSignals('vehicle')).toMatchObject([
			{
				id: 'dbc-1',
				messages: [
					{
						name: 'PowertrainStatus',
						signals: [{ signalName: 'VehicleSpeed' }]
					}
				]
			}
		]);
		expect(visibleSelectorSignals('101 engine')).toMatchObject([
			{
				id: 'dbc-1',
				messages: [
					{
						name: 'PowertrainStatus',
						signals: [{ signalName: 'EngineRpm' }]
					}
				]
			}
		]);
	});

	it('matches a hex subset of an arbitration ID without treating short prefixes as IDs', () => {
		dbcFiles.files = [
			dbcEntry({
				id: 'dbc-1',
				name: 'j1939.dbc',
				messages: [
					message({
						name: 'CruiseControlVehicleSpeed',
						canId: 0x18fef100,
						isExtended: true,
						signals: [signal({ name: 'WheelBasedSpeed' })]
					})
				]
			})
		];

		expect(visibleSelectorSignals('fef100')).toMatchObject([
			{
				id: 'dbc-1',
				messages: [
					{
						name: 'CruiseControlVehicleSpeed',
						signals: [{ signalName: 'WheelBasedSpeed' }]
					}
				]
			}
		]);
		expect(visibleSelectorSignals('18')).toEqual([]);
	});

	it('merges prebuilt native MF4 indexes into the tree and search', () => {
		dbcFiles.files = [
			dbcEntry({
				id: 'dbc-1',
				name: 'powertrain.dbc',
				messages: [
					message({
						name: 'PowertrainStatus',
						canId: 0x101,
						signals: [signal({ name: 'VehicleSpeed' })]
					})
				]
			})
		];
		const nativeIndexes = buildSelectorSearchIndexes([
			{
				id: 'mf4:1:native',
				name: 'Decoded signals',
				kind: 'mf4-native',
				transient: true,
				messages: [
					{
						key: 'native-group',
						name: 'Powertrain',
						signals: [
							{
								key: 'native-motor-speed',
								label: 'Powertrain.MotorSpeed',
								messageName: 'Powertrain',
								signalName: 'MotorSpeed'
							}
						]
					}
				]
			}
		]);
		const filter = (query: string) => ({
			query,
			activeOnly: false,
			isSignalSelected: () => false,
			expandedDbcIds: new Set(['dbc-1', 'mf4:1:native']),
			expandedMessageKeys: new Set<string>()
		});

		expect(dbcFiles.visibleSelectorTree(filter(''), nativeIndexes)).toMatchObject([
			{ id: 'dbc-1', expanded: true },
			{ id: 'mf4:1:native', kind: 'mf4-native', expanded: true, messages: [{ name: 'Powertrain' }] }
		]);
		expect(dbcFiles.visibleSelectorTree(filter('motorspeed'), nativeIndexes)).toMatchObject([
			{
				id: 'mf4:1:native',
				messages: [{ name: 'Powertrain', signals: [{ signalName: 'MotorSpeed' }] }]
			}
		]);
	});

	it('filters the selector tree to active signals only', () => {
		const powertrain = message({
			name: 'PowertrainStatus',
			canId: 0x101,
			signals: [signal({ name: 'VehicleSpeed' }), signal({ name: 'EngineRpm' })]
		});
		const selectedKey = signalIdentityKey('dbc-1', powertrain, 'EngineRpm');
		dbcFiles.files = [
			dbcEntry({
				id: 'dbc-1',
				name: 'powertrain.dbc',
				messages: [powertrain]
			}),
			dbcEntry({
				id: 'dbc-2',
				name: 'body.dbc',
				messages: [
					message({
						name: 'DoorStatus',
						canId: 0x201,
						signals: [signal({ name: 'DoorOpen' })]
					})
				]
			})
		];

		expect(
			visibleSelectorSignals('', {
				activeOnly: true,
				isSignalSelected: (key) => key === selectedKey
			})
		).toMatchObject([
			{
				id: 'dbc-1',
				messages: [
					{
						name: 'PowertrainStatus',
						signals: [{ signalName: 'EngineRpm' }]
					}
				]
			}
		]);
	});

	it('updates selector filtering when catalogs are added and removed', async () => {
		dbcFiles.files = [
			dbcEntry({
				id: 'dbc-1',
				name: 'powertrain.dbc',
				messages: [
					message({
						name: 'PowertrainStatus',
						canId: 0x101,
						signals: [signal({ name: 'VehicleSpeed' })]
					})
				]
			})
		];

		expect(visibleSelectorSignals('vehicle')).toMatchObject([
			{
				id: 'dbc-1',
				messages: [{ signals: [{ signalName: 'VehicleSpeed' }] }]
			}
		]);

		dbcFiles.files = [
			...dbcFiles.files,
			dbcEntry({
				id: 'dbc-2',
				name: 'body.dbc',
				handle: dbcHandle(2),
				messages: [
					message({
						name: 'DoorStatus',
						canId: 0x201,
						signals: [signal({ name: 'DoorOpen' })]
					})
				]
			})
		];
		await dbcFiles.removeFile('dbc-1');

		expect(visibleSelectorSignals('vehicle')).toEqual([]);
		expect(visibleSelectorSignals('door')).toMatchObject([
			{
				id: 'dbc-2',
				messages: [{ signals: [{ signalName: 'DoorOpen' }] }]
			}
		]);
	});

	it('rejects duplicate frame identities within one DBC file', async () => {
		const handle = dbcHandle(302);
		openDbcMock.mockResolvedValueOnce(
			openDbcResult(
				handle,
				catalog(
					message({ name: 'FirstMessage', canId: 0x123, sizeBytes: 8 }),
					message({ name: 'SecondMessage', canId: 0x123, sizeBytes: 8 })
				)
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

	it('skips bad stored DBC files and loads the rest without resetting storage', async () => {
		const firstHandle = dbcHandle(401);
		const secondHandle = dbcHandle(403);
		listStoredDbcsMock.mockResolvedValueOnce([
			{ id: 'first-id', name: 'first.dbc', text: 'first' },
			{ id: 'bad-id', name: 'bad.dbc', text: 'bad' },
			{ id: 'second-id', name: 'second.dbc', text: 'second' }
		]);
		openDbcMock
			.mockResolvedValueOnce(openDbcResult(firstHandle, catalog(message({ name: 'First' }))))
			.mockRejectedValueOnce(new Error('cached DBC failed'))
			.mockResolvedValueOnce(openDbcResult(secondHandle, catalog(message({ name: 'Second' }))));

		await dbcFiles.loadLibrary();

		expect(dbcFiles.files).toMatchObject([
			{ id: 'first-id', name: 'first.dbc', handle: firstHandle },
			{ id: 'second-id', name: 'second.dbc', handle: secondHandle }
		]);
		expect(closeDbcMock).not.toHaveBeenCalled();
		expect(resetStoredDbcsMock).not.toHaveBeenCalled();
		expect(dbcFiles.hasLoadedLibrary).toBe(true);
		expect(dbcFiles.error).toBe('Saved DBC "bad.dbc" failed to load.');
	});

	it('surfaces storage-level library read failures without resetting storage', async () => {
		listStoredDbcsMock.mockRejectedValueOnce(new Error('indexeddb failed'));

		await dbcFiles.loadLibrary();

		expect(dbcFiles.files).toEqual([]);
		expect(dbcFiles.error).toBe('Saved DBC library could not be read.');
		expect(dbcFiles.hasLoadedLibrary).toBe(true);
		expect(resetStoredDbcsMock).not.toHaveBeenCalled();
		expect(openDbcMock).not.toHaveBeenCalled();
	});

	it('waits for an earlier load before resetting its handles and storage', async () => {
		const handle = dbcHandle(502);
		let finishRead!: (stored: Awaited<ReturnType<typeof listStoredDbcs>>) => void;
		listStoredDbcsMock.mockReturnValueOnce(
			new Promise((resolve) => {
				finishRead = resolve;
			})
		);
		openDbcMock.mockResolvedValueOnce(openDbcResult(handle, catalog(message())));
		const loading = dbcFiles.loadLibrary();
		const resetting = dbcFiles.resetLibrary();
		await vi.waitFor(() => expect(listStoredDbcsMock).toHaveBeenCalledOnce());
		expect(dbcFiles.isLoading).toBe(true);
		expect(resetStoredDbcsMock).not.toHaveBeenCalled();
		finishRead([{ id: 'old', name: 'old.dbc', text: 'old' }]);
		await Promise.all([loading, resetting]);
		expect(dbcFiles.files).toEqual([]);
		expect(closeDbcMock).toHaveBeenCalledExactlyOnceWith(handle);
		expect(resetStoredDbcsMock).toHaveBeenCalledOnce();
		expect(dbcFiles.isLoading).toBe(false);
	});

	it('finishes an in-flight import write before deleting the library', async () => {
		const handle = dbcHandle(503);
		let finishWrite!: () => void;
		openDbcMock.mockResolvedValueOnce(openDbcResult(handle, catalog(message())));
		putStoredDbcsMock.mockReturnValueOnce(
			new Promise<void>((resolve) => {
				finishWrite = resolve;
			})
		);
		const importing = dbcFiles.addFiles([file('new.dbc', 'new')]);
		await vi.waitFor(() => expect(putStoredDbcsMock).toHaveBeenCalledOnce());
		const resetting = dbcFiles.resetLibrary();
		expect(resetStoredDbcsMock).not.toHaveBeenCalled();
		finishWrite();
		await Promise.all([importing, resetting]);
		expect(dbcFiles.files).toEqual([]);
		expect(closeDbcMock).toHaveBeenCalledExactlyOnceWith(handle);
		expect(resetStoredDbcsMock).toHaveBeenCalledOnce();
		expect(dbcFiles.isLoading).toBe(false);
	});

	it('keeps imports blocked through a queued reset after the first reset fails', async () => {
		let failReset!: (error: Error) => void;
		let finishReset!: () => void;
		resetStoredDbcsMock
			.mockReturnValueOnce(
				new Promise((_, reject) => {
					failReset = reject;
				})
			)
			.mockReturnValueOnce(
				new Promise((resolve) => {
					finishReset = resolve;
				})
			);
		const first = dbcFiles.resetLibrary();
		const second = dbcFiles.resetLibrary();
		await vi.waitFor(() => expect(resetStoredDbcsMock).toHaveBeenCalledOnce());
		failReset(new Error('storage unavailable'));
		await expect(first).rejects.toThrow('storage unavailable');
		await vi.waitFor(() => expect(resetStoredDbcsMock).toHaveBeenCalledTimes(2));
		expect(dbcFiles.isLoading).toBe(true);
		await dbcFiles.addFiles([file('ignored.dbc', 'ignored')]);
		expect(openDbcMock).not.toHaveBeenCalled();
		finishReset();
		await second;
		expect(dbcFiles.isLoading).toBe(false);
	});

	it('resets loaded DBC handles and the stored DBC library', async () => {
		const handle = dbcHandle(501);
		dbcFiles.files = [
			{
				id: 'stored-id',
				name: 'stored.dbc',
				handle,
				catalog: catalog(message({ name: 'Stored' })),
				warnings: [],
				origin: 'library'
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
	void id;
	return {} as DbcHandle;
}

function openDbcResult(handle: DbcHandle, catalog: ParsedDbc): OpenDbcResult {
	const result = { handle, catalog, warnings: [] };
	return result;
}

function dbcEntry({
	id = 'dbc-1',
	name = 'dbc.dbc',
	handle = dbcHandle(1),
	messages = [message()]
}: {
	id?: string;
	name?: string;
	handle?: DbcHandle;
	messages?: DbcMessage[];
} = {}): DbcFileEntry {
	return {
		id,
		name,
		handle,
		catalog: catalog(...messages),
		warnings: [],
		origin: 'library'
	};
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
		...{ frameFormat: 'standard-can' as const, rawFrameDecodable: true, j1939: null },
		sizeBytes: 8,
		transmitter: 'ECU',
		signals: [],
		...overrides
	};
}

function signal(overrides: Partial<DbcSignal> = {}): DbcSignal {
	return {
		name: 'Signal',
		startBit: 0,
		bitLength: 8,
		endianness: 'intel',
		signedness: 'unsigned',
		factor: 1,
		offset: 0,
		minimum: 0,
		maximum: 255,
		unit: '',
		valueType: 'integer',
		...{ unsupportedMux: false, isMultiplexer: false, multiplex: null },
		receivers: [],
		valueDescriptions: [],
		...overrides
	};
}

function visibleSelectorSignals(
	query: string,
	{
		activeOnly = false,
		isSignalSelected = () => false,
		expandedDbcIds = new Set(dbcFiles.selectorFiles.map((dbc) => dbc.id)),
		expandedMessageKeys = new Set(
			dbcFiles.selectorFiles.flatMap((dbc) => dbc.messages.map((message) => message.key))
		)
	}: {
		activeOnly?: boolean;
		isSignalSelected?: (key: string) => boolean;
		expandedDbcIds?: ReadonlySet<string>;
		expandedMessageKeys?: ReadonlySet<string>;
	} = {}
) {
	return dbcFiles.visibleSelectorTree({
		query,
		activeOnly,
		isSignalSelected,
		expandedDbcIds,
		expandedMessageKeys
	});
}
