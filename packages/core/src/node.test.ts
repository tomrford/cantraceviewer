import { markAsUntransferable } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import { createNodeClientForWorker, type NodeClientWorker } from './node-transport.ts';
import type { WireOpenDbc, WorkerRequest, WorkerResponse } from './protocol.ts';

type WorkerEvent = 'message' | 'messageerror' | 'error' | 'exit';

type FakeWorker = {
	worker: NodeClientWorker;
	requests: WorkerRequest[];
	reply(response: WorkerResponse): void;
	emit(event: WorkerEvent, payload: unknown): void;
	terminateCalls(): number;
	blockTermination(): () => void;
};

/**
 * worker_threads-shaped stub. It covers the Node transport contract only: event adaptation,
 * awaited termination, and fatal failures. The real worker thread is exercised in
 * node.integration.test.ts.
 */
function createFakeWorker(): FakeWorker {
	const listeners = new Map<WorkerEvent, ((payload: unknown) => void)[]>();
	const requests: WorkerRequest[] = [];
	let terminateCount = 0;
	let gate: Promise<void> | null = null;

	function emit(event: WorkerEvent, payload: unknown): void {
		for (const listener of listeners.get(event) ?? []) listener(payload);
	}

	const worker: NodeClientWorker = {
		postMessage(message, transfer) {
			// worker_threads detaches transferred buffers exactly like postMessage does.
			requests.push(
				structuredClone(message, { transfer: transfer as ArrayBuffer[] }) as WorkerRequest
			);
		},
		on(event: WorkerEvent, listener: (payload: never) => void) {
			const list = listeners.get(event) ?? [];
			list.push(listener as (payload: unknown) => void);
			listeners.set(event, list);
			return worker;
		},
		async terminate() {
			terminateCount += 1;
			await gate;
			emit('exit', 0);
			return 0;
		}
	};

	return {
		worker,
		requests,
		reply(response) {
			emit('message', response);
		},
		emit,
		terminateCalls: () => terminateCount,
		blockTermination() {
			let release!: () => void;
			gate = new Promise<void>((resolve) => {
				release = resolve;
			});
			return release;
		}
	};
}

/** Boot one client over the stub: the worker reports ready as the real worker runtime does. */
async function createBootedClient(fake = createFakeWorker()) {
	const pending = createNodeClientForWorker(() => fake.worker);
	fake.reply({ type: 'ready' });
	return { fake, client: await pending };
}

async function settle(): Promise<void> {
	for (let i = 0; i < 50; i++) await Promise.resolve();
}

describe('cantraceviewer node transport', () => {
	it('boots on ready, posts requests, and resolves them from worker replies', async () => {
		const { fake, client } = await createBootedClient();
		const openPromise = client.openDbc('VERSION ""');
		expect(fake.requests).toEqual([{ op: 'openDbc', text: 'VERSION ""', id: 1 }]);

		const result: WireOpenDbc = { dbcId: 4, catalog: { messages: [] } };
		fake.reply({ type: 'ok', id: 1, result });
		const opened = await openPromise;
		expect(opened.catalog).toEqual({ messages: [] });
		expect(Object.keys(opened.handle)).toEqual([]); // opaque: the wire id stays private
	});

	it('transfers the exact trace ArrayBuffer to the worker thread', async () => {
		const { fake, client } = await createBootedClient();
		const buffer = new Uint8Array([1, 2, 3]).buffer;
		void client.openTrace('asc', buffer);
		expect(buffer.byteLength).toBe(0);
		expect(fake.requests[0]?.op).toBe('openTrace');
	});

	it('rejects a Node buffer marked as untransferable without detaching it', async () => {
		const { fake, client } = await createBootedClient();
		const buffer = new Uint8Array([1, 2, 3]).buffer;
		markAsUntransferable(buffer);
		await expect(client.openTrace('asc', buffer)).rejects.toThrow('marked as untransferable');
		expect(buffer.byteLength).toBe(3);
		expect(fake.requests).toEqual([]);
		const close = client.close();
		fake.reply({ type: 'ok', id: 2, result: null });
		await close;
	});

	it('waits for the worker thread to stop before close resolves', async () => {
		const { fake, client } = await createBootedClient();
		const release = fake.blockTermination();

		const closePromise = client.close();
		fake.reply({ type: 'ok', id: 1, result: null }); // acknowledges closeClient
		await settle();
		let closed = false;
		void closePromise.then(() => {
			closed = true;
		});
		await settle();
		expect(closed).toBe(false); // termination is still in progress
		expect(fake.terminateCalls()).toBe(1);

		release();
		await closePromise;
		expect(closed).toBe(true);
	});

	it('ignores the exit event that follows a requested close', async () => {
		const { fake, client } = await createBootedClient();
		const closePromise = client.close();
		fake.reply({ type: 'ok', id: 1, result: null });
		await closePromise; // the stub emits exit while terminating

		// A fatal failure would have replaced this message.
		await expect(client.openDbc('x')).rejects.toThrow('client is closed');
	});

	it('treats an unexpected worker exit as fatal for pending and future work', async () => {
		const { fake, client } = await createBootedClient();
		const pending = client.openDbc('d');
		fake.emit('exit', 3);

		await expect(pending).rejects.toThrow('worker thread exited unexpectedly with code 3');
		await expect(client.openDbc('x')).rejects.toThrow(
			'worker thread exited unexpectedly with code 3'
		);
		expect(fake.terminateCalls()).toBe(1); // terminated once, never restarted
		await client.close();
	});

	it('treats a worker thread crash as fatal and keeps its reported reason', async () => {
		const { fake, client } = await createBootedClient();
		const cause = new Error('out of memory');
		fake.emit('error', cause);

		const error = await client.openDbc('d').then(
			() => null,
			(rejection: Error) => rejection
		);
		expect(error?.message).toBe('worker thread crashed: out of memory');
		expect(error?.cause).toBe(cause);
		await client.close();
	});

	it('treats an undeliverable message as fatal', async () => {
		const { fake, client } = await createBootedClient();
		fake.emit('messageerror', new Error('unsupported value'));
		await expect(client.openDbc('d')).rejects.toThrow(
			'worker thread message failed to deserialize: unsupported value'
		);
		await client.close();
	});

	it('rejects client creation when the worker thread fails to load WASM', async () => {
		const fake = createFakeWorker();
		const pending = createNodeClientForWorker(() => fake.worker);
		fake.reply({
			type: 'boot-error',
			error: { name: 'Error', message: 'failed to read WASM module' }
		});
		await expect(pending).rejects.toThrow('failed to read WASM module');
		expect(fake.terminateCalls()).toBe(1);
	});
});
