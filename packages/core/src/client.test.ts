import { describe, expect, it } from 'vitest';
import {
	createCanTraceClientForWorker,
	type ClientWorker,
	type ClientWorkerEvent
} from './client.ts';
import type { DirectClient } from './direct.ts';
import type { WorkerRequest } from './protocol.ts';
import { startWorkerRuntime, type WorkerRuntimeEndpoint } from './worker-runtime.ts';
import { DEFAULT_PARSING_LIMITS, type ParsingLimits } from './limits.ts';
import type { DbcHandle, DecodedSignalSeries, TraceHandle } from './types.ts';

const identity = { canId: 288, isExtended: false, sizeBytes: 8 };

function deferred() {
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
	function wrap<T>(nested: T): T {
		if (
			nested === null ||
			typeof nested !== 'object' ||
			Object.getPrototypeOf(nested) !== Object.prototype
		) {
			return nested;
		}
		const existing = proxies.get(nested);
		if (existing) return existing as T;
		const proxy = new Proxy(nested, {
			get(target, property, receiver) {
				return wrap(Reflect.get(target, property, receiver));
			}
		});
		proxies.set(nested, proxy);
		return proxy;
	}
	return wrap(value);
}

/** Synchronous stand-in for the WASM-backed direct client. */
function createFakeDirect() {
	const log: string[] = [];
	const client: DirectClient = {
		openDbc(input) {
			const text = typeof input === 'string' ? input : new TextDecoder().decode(input);
			log.push(`openDbc:${text}`);
			return { handle: {} as DbcHandle, catalog: { messages: [] }, warnings: [] };
		},
		closeDbc() {
			log.push('closeDbc');
		},
		openTrace(traceType, bytes) {
			log.push(`openTrace:${traceType}:${bytes.length}`);
			return {
				handle: {} as TraceHandle,
				metadata: {
					rawMessages: [],
					measurementStartMs: 7,
					validMessageCount: bytes.length,
					skippedLineCount: 0,
					durationNs: 9
				},
				hasRawFrames: true,
				mf4Catalog: null,
				embeddedDbcs: [],
				warnings: ['w']
			};
		},
		closeTrace() {
			log.push('closeTrace');
		},
		getSignalValues() {
			log.push('decode');
			return packedSeries([1, 2], [10, 20]);
		},
		getMf4SignalValues() {
			log.push('decodeMf4');
			return packedSeries([3], [30]);
		},
		close() {
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
function createHarness(loadClient: (limits: ParsingLimits) => Promise<DirectClient>): Harness {
	const clientListeners = new Map<string, ((event: ClientWorkerEvent) => void)[]>();
	const runtimeListeners: ((event: { data: WorkerRequest }) => void)[] = [];
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
			const data = structuredClone(message, { transfer });
			if (data.op !== 'init') requests.push(data);
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
	it('validates complete limits before creating a worker', async () => {
		let created = false;
		for (const value of [0, -1, 1.5, NaN, Infinity, 0x1_0000_0000, undefined]) {
			await expect(
				createCanTraceClientForWorker(
					() => {
						created = true;
						throw new Error('unexpected worker');
					},
					{ ...DEFAULT_PARSING_LIMITS, maxDbcBytes: value } as ParsingLimits
				)
			).rejects.toThrow('maxDbcBytes must be an integer');
		}
		expect(created).toBe(false);
	});

	it('snapshots limits before boot and rejects oversized inputs before posting or transfer', async () => {
		const fake = createFakeDirect();
		const gate = deferred();
		const limits = { maxDbcBytes: 3, maxTraceInputBytes: 2, maxTraceDataBytes: 17 };
		let received: ParsingLimits | undefined;
		const harness = createHarness(async (policy) => {
			received = policy;
			await gate.promise;
			return fake.client;
		});
		const pending = createCanTraceClientForWorker(() => harness.worker, limits);
		limits.maxDbcBytes = 100;
		gate.resolve();
		const client = await pending;
		try {
			expect(received).toEqual({ maxDbcBytes: 3, maxTraceInputBytes: 2, maxTraceDataBytes: 17 });
			await expect(client.openDbc('😀')).rejects.toThrow('3 byte limit');
			const buffer = new Uint8Array(3).buffer;
			await expect(client.openTrace('asc', buffer)).rejects.toThrow('2 byte limit');
			expect(buffer.byteLength).toBe(3);
			expect(harness.requests).toEqual([]);
			await client.openDbc('€');
			await client.openTrace('asc', new Uint8Array(2).buffer);
			expect(fake.log).toEqual(['openDbc:€', 'openTrace:asc:2']);
			const backing = new Uint8Array(100);
			backing.set([1, 2, 3], 50);
			await client.openDbc(backing.subarray(50, 53));
			const posted = harness.requests.at(-1);
			if (posted?.op !== 'openDbc') throw new Error('missing DBC request');
			expect(posted.input.buffer.byteLength).toBe(3);
			expect(Array.from(posted.input)).toEqual([1, 2, 3]);
			expect(backing.byteLength).toBe(100);
		} finally {
			await client.close();
		}
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

	it('runs requests serially in post order, holding them behind a slow worker boot', async () => {
		const boot = deferred();
		const fake = createFakeDirect();
		const harness = createHarness(async () => {
			await boot.promise;
			return fake.client;
		});
		const clientPromise = createCanTraceClientForWorker(() => harness.worker);
		await settle();
		expect(fake.log).toEqual([]); // nothing runs before the WASM client exists

		boot.resolve();
		const client = await clientPromise;
		const { handle: dbc } = await client.openDbc('d');
		const opened = await client.openTrace('asc', new Uint8Array([1]).buffer);
		const results = await Promise.all([
			client.getSignalValues(dbc, opened.handle, identity, 's'),
			client.getMf4SignalValues(opened.handle, 0),
			client.closeTrace(opened.handle)
		]);
		expect(Array.from(results[0].values)).toEqual([10, 20]);
		await client.close();
		expect(fake.log).toEqual([
			'openDbc:d',
			'openTrace:asc:1',
			'decode',
			'decodeMf4',
			'closeTrace',
			'close'
		]);
	});

	it('settles an open queued before close and invalidates its handle', async () => {
		const { fake, client } = await createPair();
		const openPromise = client.openTrace('asc', new Uint8Array([1]).buffer);
		const closePromise = client.close();
		const opened = await openPromise;
		await closePromise;

		await client.closeTrace(opened.handle);
		await expect(client.getMf4SignalValues(opened.handle, 0)).rejects.toThrow('client is closed');
		expect(fake.log).toEqual(['openTrace:asc:1', 'close']);
	});

	it('enforces ownership and closure rules on reactive, spread-safe handles', async () => {
		const first = await createPair();
		const second = await createPair();
		const { handle: dbc } = await first.client.openDbc('d');
		const { handle: trace } = await first.client.openTrace('asc', new Uint8Array([1]).buffer);

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

	it('treats a worker error as fatal: rejects pending and future work, never restarts', async () => {
		const { client, harness, factoryCalls } = await createPair();
		const { handle: dbc } = await client.openDbc('d');
		const { handle: trace } = await client.openTrace('asc', new Uint8Array([1]).buffer);

		// In flight: posted, but the worker dies before its response arrives.
		const decodePromise = client.getSignalValues(dbc, trace, identity, 's');
		harness.emit('error', { message: 'boom' });
		await expect(decodePromise).rejects.toThrow('worker crashed: boom');
		await expect(client.openDbc('x')).rejects.toThrow('worker crashed: boom');
		await client.closeTrace(trace); // handles were invalidated; close resolves silently
		expect(harness.terminated()).toBeGreaterThan(0);

		await client.close(); // fatal client still closes cleanly
		expect(factoryCalls()).toBe(1); // no transparent worker restart
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

		const opened = await client.openTrace('asc', new Uint8Array([9]).buffer); // queue survives
		expect(opened.metadata.validMessageCount).toBe(1);
		await client.close();
	});
});
