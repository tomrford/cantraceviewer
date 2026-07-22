import { describe, expect, it } from 'vitest';
import {
	createCanTraceClientForWorker,
	type ClientWorker,
	type ClientWorkerEvent
} from './client.js';
import type { DirectClient } from './direct.js';
import type { WorkerRequest } from './protocol.js';
import { startWorkerRuntime, type WorkerRuntimeEndpoint } from './worker-runtime.js';
import type { DbcHandle, DecodedSignalSeries, TraceHandle } from './types.js';

const identity = { canId: 288, isExtended: false, sizeBytes: 8 };

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve!: () => void;
	const promise = new Promise<void>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

function packedSeries(times: number[], values: number[]): DecodedSignalSeries {
	const packed = new Float64Array([...times, ...values]);
	return { timesMs: packed.subarray(0, times.length), values: packed.subarray(times.length) };
}

/** Model stores such as Svelte `$state`, which recursively proxy only plain objects. */
function proxyPlainObjects<T>(value: T): T {
	const proxies = new WeakMap<object, object>();
	function wrap(nested: unknown): unknown {
		if (
			typeof nested !== 'object' ||
			nested === null ||
			Object.getPrototypeOf(nested) !== Object.prototype
		) {
			return nested;
		}
		const existing = proxies.get(nested);
		if (existing) return existing;
		const proxy = new Proxy(nested, {
			get(target, property, receiver) {
				return wrap(Reflect.get(target, property, receiver));
			}
		});
		proxies.set(nested, proxy);
		return proxy;
	}
	return wrap(value) as T;
}

function createFakeDirect(): { client: DirectClient; log: string[] } {
	const log: string[] = [];
	let nextId = 1;
	const client: DirectClient = {
		async openDbc(text) {
			log.push(`openDbc:${text}`);
			if (text === 'broken') {
				const error = new Error('invalid DBC message record');
				error.name = 'DbcParseError';
				throw error;
			}
			return { handle: { id: nextId++ } as unknown as DbcHandle, catalog: { messages: [] } };
		},
		async closeDbc() {
			log.push('closeDbc');
		},
		async openTrace(traceType, bytes) {
			log.push(`openTrace:${traceType}:${bytes.length}`);
			if (bytes[0] === 0xff) throw new Error('invalid trace bytes');
			return {
				id: nextId++,
				metadata: {
					measurementStartMs: 7,
					validMessageCount: bytes.length,
					skippedLineCount: 0,
					durationNs: 9
				},
				hasRawFrames: true,
				mf4Catalog: null,
				embeddedDbcs: [],
				warnings: ['w']
			} as unknown as TraceHandle;
		},
		async closeTrace() {
			log.push('closeTrace');
		},
		async getSignalValues() {
			log.push('decode');
			return packedSeries([1, 2], [10, 20]);
		},
		async getMf4SignalValues() {
			log.push('decodeMf4');
			return packedSeries([3], [30]);
		},
		async close() {
			log.push('close');
		}
	};
	return { client, log };
}

type Harness = {
	worker: ClientWorker;
	requests: WorkerRequest[];
	emit(type: 'error' | 'messageerror', event?: ClientWorkerEvent): void;
	terminated(): number;
	breakNextOkResponse(): void;
};

/** In-process loopback between the real client and the real worker runtime. structuredClone
 *  reproduces postMessage semantics, including transfer-list buffer detachment. */
function createHarness(loadClient: () => Promise<DirectClient>): Harness {
	const clientListeners = new Map<string, ((event: ClientWorkerEvent) => void)[]>();
	const runtimeListeners: ((event: { data: unknown }) => void)[] = [];
	const requests: WorkerRequest[] = [];
	let terminateCount = 0;
	let breakOkResponses = 0;

	const endpoint: WorkerRuntimeEndpoint = {
		postMessage(message, transfer = []) {
			if (breakOkResponses > 0 && message.type === 'ok') {
				breakOkResponses -= 1;
				throw new Error('could not clone response');
			}
			const data = structuredClone(message, { transfer });
			queueMicrotask(() => {
				if (terminateCount > 0) return;
				for (const listener of clientListeners.get('message') ?? []) listener({ data });
			});
		},
		addEventListener(_type, listener) {
			runtimeListeners.push(listener);
		}
	};

	const worker: ClientWorker = {
		postMessage(message, transfer) {
			const data = structuredClone(message, { transfer }) as WorkerRequest;
			requests.push(data);
			queueMicrotask(() => {
				for (const listener of runtimeListeners) listener({ data });
			});
		},
		addEventListener(type, listener) {
			const list = clientListeners.get(type) ?? [];
			list.push(listener);
			clientListeners.set(type, list);
		},
		terminate() {
			terminateCount += 1;
		}
	};

	startWorkerRuntime(endpoint, loadClient);
	return {
		worker,
		requests,
		emit(type, event = {}) {
			for (const listener of clientListeners.get(type) ?? []) listener(event);
		},
		terminated: () => terminateCount,
		breakNextOkResponse() {
			breakOkResponses += 1;
		}
	};
}

async function createPair() {
	const fake = createFakeDirect();
	const harness = createHarness(async () => fake.client);
	let factoryCalls = 0;
	const client = await createCanTraceClientForWorker(() => {
		factoryCalls += 1;
		return harness.worker;
	});
	return { fake, harness, client, factoryCalls: () => factoryCalls };
}

async function until(condition: () => boolean): Promise<void> {
	for (let i = 0; i < 1000 && !condition(); i++) await Promise.resolve();
	expect(condition()).toBe(true);
}

async function settle(): Promise<void> {
	for (let i = 0; i < 50; i++) await Promise.resolve();
}

describe('createCanTraceClient worker transport', () => {
	it('boots, maps requests to direct operations, and transfers buffers both ways', async () => {
		const { fake, harness, client } = await createPair();
		const { handle: dbc, catalog } = await client.openDbc('VERSION ""');
		expect(catalog).toEqual({ messages: [] });

		const buffer = new Uint8Array([1, 2, 3]).buffer;
		const trace = await client.openTrace('asc', buffer);
		expect(buffer.byteLength).toBe(0); // transferred to the worker and detached here
		expect(trace.metadata).toEqual({
			measurementStartMs: 7,
			validMessageCount: 3,
			skippedLineCount: 0,
			durationNs: 9
		});
		expect(trace.warnings).toEqual(['w']);

		const series = await client.getSignalValues(dbc, trace, identity, 'vehicle_speed');
		expect(Array.from(series.timesMs)).toEqual([1, 2]);
		expect(Array.from(series.values)).toEqual([10, 20]);
		expect(series.timesMs.buffer).toBe(series.values.buffer); // one transferred buffer, two views

		const mf4 = await client.getMf4SignalValues(trace, 0);
		expect(Array.from(mf4.values)).toEqual([30]);

		expect(harness.requests.map((request) => request.id)).toEqual([1, 2, 3, 4]);
		await client.close();
		expect(fake.log).toEqual([
			'openDbc:VERSION ""',
			'openTrace:asc:3',
			'decode',
			'decodeMf4',
			'close'
		]);
		expect(harness.terminated()).toBe(1);
	});

	it('rejects a non-ArrayBuffer trace input without posting a request', async () => {
		const { harness, client } = await createPair();
		const view = new Uint8Array([1, 2, 3]);
		await expect(client.openTrace('asc', view as unknown as ArrayBuffer)).rejects.toThrow(
			'exact ArrayBuffer'
		);
		expect(view.byteLength).toBe(3); // never copied, never detached
		expect(harness.requests).toHaveLength(0);
		await client.close();
	});

	it('keeps operation failures isolated, consumes transferred input, and never recycles IDs', async () => {
		const { harness, client } = await createPair();
		const error = await client.openDbc('broken').then(
			() => null,
			(rejection: Error) => rejection
		);
		expect(error?.name).toBe('DbcParseError');
		expect(error?.message).toBe('invalid DBC message record');

		const invalidTrace = new Uint8Array([0xff]).buffer;
		await expect(client.openTrace('asc', invalidTrace)).rejects.toThrow('invalid trace bytes');
		expect(invalidTrace.byteLength).toBe(0);

		const { catalog } = await client.openDbc('good');
		expect(catalog).toEqual({ messages: [] });
		expect(harness.requests.map((request) => request.id)).toEqual([1, 2, 3]);
		await client.close();
	});

	it('settles an open queued before close and invalidates its handle', async () => {
		const { fake, client } = await createPair();
		const gate = deferred();
		fake.client.openTrace = async () => {
			fake.log.push('openTrace:start');
			await gate.promise;
			fake.log.push('openTrace:end');
			return {
				id: 1,
				metadata: {
					measurementStartMs: null,
					validMessageCount: 1,
					skippedLineCount: 0,
					durationNs: null
				},
				hasRawFrames: true,
				mf4Catalog: null,
				embeddedDbcs: [],
				warnings: []
			} as unknown as TraceHandle;
		};

		const openPromise = client.openTrace('asc', new Uint8Array([1]).buffer);
		await until(() => fake.log.includes('openTrace:start'));
		const closePromise = client.close();
		await settle();
		expect(fake.log).not.toContain('close');

		gate.resolve();
		const trace = await openPromise;
		await closePromise;
		await client.closeTrace(trace);
		await expect(client.getMf4SignalValues(trace, 0)).rejects.toThrow('client is closed');
		expect(fake.log.slice(-3)).toEqual(['openTrace:start', 'openTrace:end', 'close']);
	});

	it('runs requests serially: close never interrupts an active decode', async () => {
		const { fake, client } = await createPair();
		const { handle: dbc } = await client.openDbc('d');
		const trace = await client.openTrace('asc', new Uint8Array([1]).buffer);

		const gate = deferred();
		fake.client.getSignalValues = async () => {
			fake.log.push('decode:start');
			await gate.promise;
			fake.log.push('decode:end');
			return packedSeries([1], [2]);
		};

		const decodePromise = client.getSignalValues(dbc, trace, identity, 's');
		await until(() => fake.log.includes('decode:start'));
		const closeTracePromise = client.closeTrace(trace);
		const closePromise = client.close();
		await settle();
		expect(fake.log).not.toContain('closeTrace');
		expect(fake.log).not.toContain('close');

		gate.resolve();
		await Promise.all([decodePromise, closeTracePromise, closePromise]);
		expect(fake.log.slice(-4)).toEqual(['decode:start', 'decode:end', 'closeTrace', 'close']);
	});

	it('enforces ownership and closure rules on reactive, spread-safe handles', async () => {
		const first = await createPair();
		const second = await createPair();
		const { handle: dbc } = await first.client.openDbc('d');
		const trace = await first.client.openTrace('asc', new Uint8Array([1]).buffer);

		await expect(second.client.closeTrace(trace)).rejects.toThrow(
			'trace handle does not belong to this client'
		);
		await expect(first.client.closeTrace(dbc as unknown as TraceHandle)).rejects.toThrow(
			'trace handle does not belong to this client'
		);

		const reactiveDbc = proxyPlainObjects({ ...dbc });
		const spreadTrace = { ...proxyPlainObjects(trace) };
		await expect(
			first.client.getSignalValues(reactiveDbc, spreadTrace, identity, 's')
		).resolves.toEqual({
			timesMs: new Float64Array([1, 2]),
			values: new Float64Array([10, 20])
		});
		await first.client.closeTrace(spreadTrace);
		await first.client.closeTrace(trace); // idempotent through the shared state
		expect(first.fake.log.filter((entry) => entry === 'closeTrace')).toHaveLength(1);
		await expect(first.client.getSignalValues(dbc, trace, identity, 's')).rejects.toThrow(
			'trace handle is closed'
		);
		await first.client.closeDbc(reactiveDbc);
		await first.client.closeDbc(dbc);
		expect(first.fake.log.filter((entry) => entry === 'closeDbc')).toHaveLength(1);
		expect(second.fake.log).toEqual([]); // cross-client attempts never reach the other worker
		await Promise.all([first.client.close(), second.client.close()]);
	});

	it('close is idempotent, invalidates handles, and rejects later operations', async () => {
		const { fake, harness, client } = await createPair();
		const { handle: dbc } = await client.openDbc('d');
		const trace = await client.openTrace('asc', new Uint8Array([1]).buffer);

		const firstClose = client.close();
		expect(client.close()).toBe(firstClose);
		await firstClose;

		expect(harness.requests.at(-1)?.op).toBe('closeClient');
		expect(fake.log).toContain('close');
		expect(fake.log).not.toContain('closeTrace'); // worker-side close() owns remaining cleanup
		expect(harness.terminated()).toBe(1);

		await client.closeDbc(dbc); // invalidated handles close silently after client close
		await client.closeTrace(trace);
		await expect(client.openDbc('x')).rejects.toThrow('client is closed');
		await expect(client.getMf4SignalValues(trace, 0)).rejects.toThrow('client is closed');
	});

	it('treats a worker error as fatal: rejects pending and future work, never restarts', async () => {
		const { fake, harness, client, factoryCalls } = await createPair();
		const { handle: dbc } = await client.openDbc('d');
		const trace = await client.openTrace('asc', new Uint8Array([1]).buffer);

		const gate = deferred();
		fake.client.getSignalValues = async () => {
			await gate.promise;
			return packedSeries([1], [2]);
		};
		const decodePromise = client.getSignalValues(dbc, trace, identity, 's');
		await settle();

		harness.emit('error', { message: 'boom' });
		await expect(decodePromise).rejects.toThrow('worker crashed: boom');
		await expect(client.openDbc('x')).rejects.toThrow('worker crashed: boom');
		await client.closeTrace(trace); // handles were invalidated; close resolves silently
		expect(harness.terminated()).toBeGreaterThan(0);

		await client.close(); // fatal client still closes cleanly
		expect(factoryCalls()).toBe(1); // no transparent worker restart
		gate.resolve();
	});

	it('treats messageerror as fatal', async () => {
		const { harness, client } = await createPair();
		harness.emit('messageerror');
		await expect(client.openDbc('x')).rejects.toThrow('worker message failed to deserialize');
		expect(harness.terminated()).toBe(1);
		await client.close();
	});

	it('rejects client creation when worker boot fails and terminates the worker', async () => {
		const harness = createHarness(async () => {
			throw new Error('wasm 404');
		});
		await expect(createCanTraceClientForWorker(() => harness.worker)).rejects.toThrow('wasm 404');
		expect(harness.terminated()).toBe(1);
	});

	it('frees the worker-side trace when response shaping fails', async () => {
		const { fake, harness, client } = await createPair();
		harness.breakNextOkResponse();
		await expect(client.openTrace('asc', new Uint8Array([1]).buffer)).rejects.toThrow(
			'could not clone response'
		);
		await until(() => fake.log.includes('closeTrace'));

		const trace = await client.openTrace('asc', new Uint8Array([9]).buffer); // queue survives
		expect(trace.metadata.validMessageCount).toBe(1);
		await client.close();
	});
});
