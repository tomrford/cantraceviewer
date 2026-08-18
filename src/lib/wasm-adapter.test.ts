import { describe, expect, it, vi } from 'vitest';
import { createClientSlot } from './wasm.js';

describe('WASM app adapter', () => {
	it('retries failed startup without restarting a client that later becomes fatal', async () => {
		const clientOpenDbc = vi.fn();
		let createCount = 0;
		const client = createClientSlot(async () => {
			createCount += 1;
			if (createCount === 1) throw new Error('worker boot failed');
			return { openDbc: clientOpenDbc };
		});

		await expect(client()).rejects.toThrow('worker boot failed');

		clientOpenDbc.mockResolvedValueOnce({ handle: {}, catalog: { messages: [] } });
		await expect((await client()).openDbc('second')).resolves.toMatchObject({
			catalog: { messages: [] }
		});
		expect(createCount).toBe(2);

		clientOpenDbc.mockRejectedValue(new Error('worker crashed'));
		await expect((await client()).openDbc('third')).rejects.toThrow('worker crashed');
		await expect((await client()).openDbc('fourth')).rejects.toThrow('worker crashed');
		expect(createCount).toBe(2);
	});
});
