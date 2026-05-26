import '@vitest/web-worker';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('WASM worker boot', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.resetModules();
	});

	it('rejects API calls when wasm boot fails', async () => {
		vi.stubGlobal('fetch', async () => {
			throw new Error('WASM fetch failed');
		});

		const { openDbc } = await import('$lib/wasm.js');

		await expect(openDbc('VERSION ""')).rejects.toThrow('WASM fetch failed');
	});
});
