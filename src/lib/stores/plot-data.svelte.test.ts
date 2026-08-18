import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { dbcFiles, signalIdentityKey, type DbcFileEntry } from './dbc-files.svelte';
import { plotData } from './plot-data.svelte';
import { traceFile, type TraceFileEntry } from './trace-file.svelte';
import { getMf4SignalValues, getSignalValues } from '$lib/wasm.js';
import { mf4SignalIdentityKey } from '$lib/mf4-signals.js';
import type {
	DbcHandle,
	DbcMessage,
	DbcSignal,
	DecodedSignalSeries,
	TraceHandle
} from '$lib/wasm.js';

vi.mock('$lib/wasm.js', () => ({
	closeDbc: vi.fn(() => Promise.resolve()),
	closeTrace: vi.fn(() => Promise.resolve()),
	getMf4SignalValues: vi.fn(),
	getSignalValues: vi.fn(),
	openDbc: vi.fn()
}));

const getSignalValuesMock = getSignalValues as Mock<typeof getSignalValues>;
const getMf4SignalValuesMock = getMf4SignalValues as Mock<typeof getMf4SignalValues>;

describe('plotData', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		dbcFiles.files = [dbcEntry()];
		traceFile.entry = traceEntry(2);
		traceFile.error = null;
		traceFile.isLoading = false;
		plotData.clearSelectedSignals();
	});

	it('decodes a selected signal into samples', async () => {
		const series = signalSeries([0.001], [12.5]);
		getSignalValuesMock.mockResolvedValueOnce(series);

		await plotData.toggleSignal(key());

		expect(getSignalValuesMock).toHaveBeenCalledExactlyOnceWith(
			dbcFiles.files[0]!.handle,
			traceFile.entry!.handle,
			{ canId: 291, isExtended: false, sizeBytes: 8 },
			'VehicleSpeed'
		);
		expect(plotData.signals).toMatchObject([
			{
				key: key(),
				label: 'SpeedMessage.VehicleSpeed',
				series
			}
		]);
		expect(plotData.signalDecodeStatus(key())).toEqual({
			isDecoding: false,
			decodeError: null
		});
		expect(plotData.hasPlottableSignals).toBe(true);
	});

	it('plots an MF4-native signal without hiding the DBC catalog', async () => {
		const trace = traceEntry(9, {
			hasRawFrames: false,
			mf4Catalog: {
				groups: [
					{
						name: 'Decoded powertrain',
						signals: [{ id: 7, name: 'VehicleSpeed', unit: 'km/h' }]
					}
				]
			}
		});
		traceFile.entry = trace;
		const series = signalSeries([100], [12.5]);
		getMf4SignalValuesMock.mockResolvedValueOnce(series);
		const nativeKey = mf4SignalIdentityKey(trace.id, 7);

		await plotData.toggleSignal(nativeKey);

		expect(getMf4SignalValuesMock).toHaveBeenCalledExactlyOnceWith(trace.handle, 7);
		expect(dbcFiles.selectorFiles).toHaveLength(1);
		expect(plotData.signals).toMatchObject([
			{
				key: nativeKey,
				label: 'Decoded powertrain.VehicleSpeed',
				unit: 'km/h',
				series
			}
		]);
	});

	it('reports that DBC signals need raw frames in a decoded-only MF4', async () => {
		const trace = traceEntry(10, { hasRawFrames: false });
		traceFile.entry = trace;

		await plotData.toggleSignal(key());

		expect(getSignalValuesMock).not.toHaveBeenCalled();
		expect(plotData.signalDecodeStatus(key())).toEqual({
			isDecoding: false,
			decodeError: 'This trace has no raw CAN frames for DBC decoding.'
		});
	});

	it('keeps a stale decode result out of state after the trace changes', async () => {
		const deferred = createDeferred<DecodedSignalSeries>();
		getSignalValuesMock.mockReturnValueOnce(deferred.promise);

		const decode = plotData.toggleSignal(key());
		traceFile.entry = traceEntry(3);
		deferred.resolve(signalSeries([0.001], [99]));
		await decode;

		expect(plotData.signals[0]?.series).toBeNull();
		expect(plotData.signalDecodeStatus(key())).toEqual({
			isDecoding: false,
			decodeError: null
		});
	});

	it('clears samples and decode errors when a signal is deselected', async () => {
		getSignalValuesMock.mockResolvedValueOnce(signalSeries([0.001], [12.5]));
		await plotData.toggleSignal(key());

		getSignalValuesMock.mockRejectedValueOnce(new Error('decode failed'));
		await plotData.toggleSignal(key());
		await plotData.toggleSignal(key());

		expect(plotData.signalDecodeStatus(key())).toEqual({
			isDecoding: false,
			decodeError: 'decode failed'
		});

		await plotData.toggleSignal(key());

		expect([...plotData.selectedSignals]).toEqual([]);
		expect(plotData.signalDecodeStatus(key())).toEqual({
			isDecoding: false,
			decodeError: null
		});
	});

	it('passes the selected trace through to signal decoding', async () => {
		traceFile.entry = traceEntry(4);
		getSignalValuesMock.mockResolvedValueOnce(signalSeries([0.001], [12.5]));

		await plotData.toggleSignal(key());

		expect(getSignalValuesMock).toHaveBeenCalledExactlyOnceWith(
			dbcFiles.files[0]!.handle,
			traceFile.entry!.handle,
			{ canId: 291, isExtended: false, sizeBytes: 8 },
			'VehicleSpeed'
		);
	});

	it('keeps same-name messages separate by CAN identity', async () => {
		dbcFiles.files = [
			dbcEntry({
				messages: [
					message({
						canId: 0x100,
						sizeBytes: 1,
						signals: [signal({ name: 'Value' })]
					}),
					message({
						canId: 0x200,
						sizeBytes: 1,
						signals: [signal({ name: 'Value' })]
					})
				]
			})
		];
		getSignalValuesMock.mockResolvedValueOnce(signalSeries([0.001], [12.5]));

		await plotData.toggleSignal(
			signalIdentityKey('dbc-1', { canId: 0x200, isExtended: false, sizeBytes: 1 }, 'Value')
		);

		expect(getSignalValuesMock).toHaveBeenCalledExactlyOnceWith(
			dbcFiles.files[0]!.handle,
			traceFile.entry!.handle,
			{ canId: 0x200, isExtended: false, sizeBytes: 1 },
			'Value'
		);
		expect(plotData.signals[0]).toMatchObject({
			messageName: 'SpeedMessage',
			signalName: 'Value'
		});
	});

	it('selects a signal without decoding when no trace is loaded', async () => {
		traceFile.entry = null;

		await plotData.toggleSignal(key());

		expect(plotData.isSignalSelected(key())).toBe(true);
		expect(plotData.selectedSignals.get(key())).toEqual({
			status: 'idle',
			series: null,
			error: null
		});
		expect(getSignalValuesMock).not.toHaveBeenCalled();
	});

	it('removes signals for a DBC file and releases their colors', async () => {
		const firstKey = key();
		const secondKey = signalIdentityKey(
			'dbc-1',
			message({ canId: 0x200, signals: [signal({ name: 'Rpm' })] }),
			'Rpm'
		);
		dbcFiles.files = [
			dbcEntry({
				messages: [message(), message({ canId: 0x200, signals: [signal({ name: 'Rpm' })] })]
			})
		];
		getSignalValuesMock
			.mockResolvedValueOnce(signalSeries([0.001], [12.5]))
			.mockResolvedValueOnce(signalSeries([0.001], [42]));

		await plotData.toggleSignal(firstKey);
		const firstColor = plotData.signals.find((signal) => signal.key === firstKey)?.color;
		await plotData.toggleSignal(secondKey);

		plotData.deselectDbcFile('dbc-1');

		expect([...plotData.selectedSignals]).toEqual([]);

		getSignalValuesMock.mockResolvedValueOnce(signalSeries([0.001], [12.5]));
		await plotData.toggleSignal(firstKey);

		expect(plotData.signals.find((signal) => signal.key === firstKey)?.color).toBe(firstColor);
	});

	it('clears selected signals and releases colors', async () => {
		getSignalValuesMock.mockResolvedValueOnce(signalSeries([0.001], [12.5]));

		await plotData.toggleSignal(key());
		const color = plotData.signals[0]?.color;

		plotData.clearSelectedSignals();

		expect([...plotData.selectedSignals]).toEqual([]);

		getSignalValuesMock.mockResolvedValueOnce(signalSeries([0.001], [12.5]));
		await plotData.toggleSignal(key());

		expect(plotData.signals[0]?.color).toBe(color);
	});
});

function key(): string {
	return signalIdentityKey('dbc-1', message(), 'VehicleSpeed');
}

function dbcEntry(overrides: { messages?: DbcMessage[] } = {}): DbcFileEntry {
	return {
		id: 'dbc-1',
		name: 'powertrain.dbc',
		handle: {} as DbcHandle,
		catalog: {
			messages: overrides.messages ?? [message()]
		},
		origin: 'library'
	};
}

function traceEntry(
	id: number,
	overrides: Partial<Pick<TraceFileEntry, 'hasRawFrames' | 'mf4Catalog'>> = {}
): TraceFileEntry {
	return {
		id,
		handle: {} as TraceHandle,
		file: new File(['trace'], 'drive.asc'),
		hasRawFrames: true,
		mf4Catalog: null,
		embeddedDbcs: [],
		warnings: [],
		...overrides,
		metadata: {
			measurementStartMs: null,
			validMessageCount: 1,
			skippedLineCount: 0,
			durationNs: 1_000_000
		}
	};
}

function message(overrides: Partial<DbcMessage> = {}): DbcMessage {
	return {
		name: 'SpeedMessage',
		dbcId: overrides.canId ?? 291,
		canId: overrides.canId ?? 291,
		isExtended: false,
		isFd: false,
		sizeBytes: 8,
		transmitter: 'ECU',
		signals: [signal()],
		...overrides
	};
}

function signal(overrides: Partial<DbcSignal> = {}): DbcSignal {
	return {
		name: 'VehicleSpeed',
		startBit: 0,
		bitLength: 16,
		endianness: 'intel',
		signedness: 'unsigned',
		factor: 0.1,
		offset: 0,
		minimum: 0,
		maximum: 250,
		unit: 'km/h',
		valueType: 'integer',
		unsupportedMux: false,
		receivers: ['DASH'],
		valueDescriptions: [],
		...overrides
	};
}

function signalSeries(timesMs: number[], values: number[]): DecodedSignalSeries {
	return {
		timesMs: new Float64Array(timesMs),
		values: new Float64Array(values)
	};
}

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((innerResolve, innerReject) => {
		resolve = innerResolve;
		reject = innerReject;
	});
	return { promise, resolve, reject };
}
