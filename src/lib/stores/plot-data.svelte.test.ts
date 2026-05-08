import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { dbcFiles, signalKey } from './dbc-files.svelte';
import { plotData } from './plot-data.svelte';
import { traceFile } from './trace-file.svelte';
import { getSignalValues } from '$lib/wasm.js';
import type { DbcMessage, DbcSignal, DecodedSignalSeries } from '$lib/wasm.js';

vi.mock('$lib/wasm.js', () => ({
	closeDbc: vi.fn(() => Promise.resolve()),
	closeTrace: vi.fn(() => Promise.resolve()),
	getDbcCatalog: vi.fn(),
	getSignalValues: vi.fn(),
	openDbc: vi.fn()
}));

const getSignalValuesMock = getSignalValues as Mock<typeof getSignalValues>;

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
			{ ptr: 1 },
			traceFile.entry,
			'SpeedMessage',
			'VehicleSpeed'
		);
		expect(plotData.signals).toMatchObject([
			{
				key: key(),
				label: 'SpeedMessage.VehicleSpeed',
				series,
				isDecoding: false,
				decodeError: null
			}
		]);
	});

	it('keeps a stale decode result out of state after the trace changes', async () => {
		const deferred = createDeferred<DecodedSignalSeries>();
		getSignalValuesMock.mockReturnValueOnce(deferred.promise);

		const decode = plotData.toggleSignal(key());
		traceFile.entry = traceEntry(3);
		deferred.resolve(signalSeries([0.001], [99]));
		await decode;

		expect(plotData.signals[0]?.series).toBeNull();
		expect(plotData.signals[0]?.decodeError).toBeNull();
		expect(plotData.signals[0]?.isDecoding).toBe(false);
	});

	it('clears samples and decode errors when a signal is deselected', async () => {
		getSignalValuesMock.mockResolvedValueOnce(signalSeries([0.001], [12.5]));
		await plotData.toggleSignal(key());

		getSignalValuesMock.mockRejectedValueOnce(new Error('decode failed'));
		await plotData.toggleSignal(key());
		await plotData.toggleSignal(key());

		expect(plotData.signals[0]?.decodeError).toBe('decode failed');

		await plotData.toggleSignal(key());

		expect(plotData.selectedSignalKeys).toEqual([]);
		expect(plotData.signalSeries).toEqual({});
		expect(plotData.decodeErrors).toEqual({});
		expect(plotData.decodingSignalKeys).toEqual([]);
	});

	it('passes the selected trace through to signal decoding', async () => {
		traceFile.entry = traceEntry(4);
		getSignalValuesMock.mockResolvedValueOnce(signalSeries([0.001], [12.5]));

		await plotData.toggleSignal(key());

		expect(getSignalValuesMock).toHaveBeenCalledExactlyOnceWith(
			{ ptr: 1 },
			traceFile.entry,
			'SpeedMessage',
			'VehicleSpeed'
		);
	});
});

function key(): string {
	return signalKey('dbc-1', 'SpeedMessage', 'VehicleSpeed');
}

function dbcEntry() {
	return {
		id: 'dbc-1',
		file: new File(['dbc'], 'powertrain.dbc'),
		handle: { ptr: 1 },
		catalog: {
			messages: [message()]
		}
	};
}

function traceEntry(ptr: number) {
	return {
		ptr,
		file: new File(['trace'], 'drive.asc'),
		metadata: {
			measurementStartMs: null,
			validMessageCount: 1,
			durationNs: 1_000_000
		}
	};
}

function message(): DbcMessage {
	return {
		name: 'SpeedMessage',
		dbcId: 291,
		canId: 291,
		isExtended: false,
		isFd: false,
		sizeBytes: 8,
		transmitter: 'ECU',
		signals: [signal()]
	};
}

function signal(): DbcSignal {
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
		valueDescriptions: []
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
