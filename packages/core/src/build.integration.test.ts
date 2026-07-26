import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { build } from 'vite';

describe('cantraceviewer production build', () => {
	it('emits the worker chunk and WASM asset from a browser Vite build', async () => {
		// realpath: macOS /tmp is a symlink and rolldown asset names break on unresolved roots.
		const root = await mkdtemp(join(await realpath(tmpdir()), 'cantraceviewer-core-build-'));
		try {
			await writeFile(
				join(root, 'index.html'),
				'<!doctype html><script type="module" src="/entry.ts"></script>\n'
			);
			await writeFile(
				join(root, 'entry.ts'),
				"import { createCanTraceClient } from 'cantraceviewer';\n" +
					'(globalThis as { boot?: unknown }).boot = createCanTraceClient;\n'
			);
			await build({
				configFile: false,
				logLevel: 'silent',
				root,
				resolve: {
					alias: { cantraceviewer: resolve('packages/core/src/index.ts') }
				},
				build: { outDir: 'dist' }
			});

			const assetsDir = join(root, 'dist', 'assets');
			const assets = await readdir(assetsDir);
			expect(assets.some((name) => name.endsWith('.wasm'))).toBe(true);

			const scripts = await Promise.all(
				assets
					.filter((name) => name.endsWith('.js'))
					.map(async (name) => ({ name, text: await readFile(join(assetsDir, name), 'utf8') }))
			);
			const entryChunk = scripts.find((script) => script.text.includes('new Worker'));
			const workerChunk = scripts.find((script) => script.text.includes('wasmdbc_parse'));
			expect(entryChunk?.name).toBeDefined();
			expect(workerChunk?.name).toBeDefined();
			expect(workerChunk?.name).not.toBe(entryChunk?.name);
			// The Node entry and its worker thread must never reach a browser bundle.
			expect(scripts.filter((script) => script.text.includes('worker_threads'))).toEqual([]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 120_000);

	it('keeps Node built-ins out of the browser entry sources', async () => {
		const browserSources = [
			'index.ts',
			'client.ts',
			'rpc-client.ts',
			'worker.ts',
			'worker-runtime.ts',
			'direct.ts',
			'handles.ts',
			'protocol.ts',
			'types.ts'
		];
		for (const name of browserSources) {
			const source = await readFile(resolve('packages/core/src', name), 'utf8');
			expect({ name, nodeImports: /from 'node:/.test(source) }).toEqual({
				name,
				nodeImports: false
			});
		}
	});
});
