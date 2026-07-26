import { createCanTraceClient, type CanTraceClient } from 'cantraceviewer';
import { describe, expect, it, vi } from 'vitest';
import { openDbc } from './wasm.js';

vi.mock('cantraceviewer', () => ({ createCanTraceClient: vi.fn() }));

const createClientMock = vi.mocked(createCanTraceClient);

describe('WASM app adapter', () => {
	it('retries failed startup without restarting a client that later becomes fatal', async () => {
		const clientOpenDbc = vi.fn();
		const client = { openDbc: clientOpenDbc } as unknown as CanTraceClient;
		createClientMock
			.mockRejectedValueOnce(new Error('worker boot failed'))
			.mockResolvedValue(client);

		await expect(openDbc('first')).rejects.toThrow('worker boot failed');

		clientOpenDbc.mockResolvedValueOnce({ handle: {}, catalog: { messages: [] } });
		await expect(openDbc('second')).resolves.toMatchObject({ catalog: { messages: [] } });
		expect(createClientMock).toHaveBeenCalledTimes(2);

		clientOpenDbc.mockRejectedValue(new Error('worker crashed'));
		await expect(openDbc('third')).rejects.toThrow('worker crashed');
		await expect(openDbc('fourth')).rejects.toThrow('worker crashed');
		expect(createClientMock).toHaveBeenCalledTimes(2);
	});
});
