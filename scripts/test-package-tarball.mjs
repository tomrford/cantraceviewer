import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { build, preview } from 'vite';

const repo = resolve(import.meta.dirname, '..');
const packageManifest = JSON.parse(
	await readFile(join(repo, 'packages/core/package.json'), 'utf8')
);
const tarball = resolve(
	process.argv[2] ??
		join(repo, 'artifacts', `${packageManifest.name}-${packageManifest.version}.tgz`)
);
const root = await mkdtemp(join(await realpath(tmpdir()), 'cantraceviewer-package-'));
let browser;
let server;

try {
	const members = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).trim().split('\n');
	assert(
		members.every((name) =>
			/^package\/(?:dist\/|LICENSE\.md$|README\.md$|package\.json$)/.test(name)
		),
		`tarball contains an unintended file:\n${members.join('\n')}`
	);
	assert(!members.some((name) => /(?:^|\/)(?:src|scripts|test|tsconfig)/.test(name)));

	await writeFile(
		join(root, 'package.json'),
		JSON.stringify(
			{
				name: 'cantraceviewer-tarball-smoke',
				private: true,
				type: 'module',
				dependencies: { cantraceviewer: `file:${tarball}` }
			},
			null,
			2
		)
	);
	execFileSync('pnpm', ['install', '--ignore-workspace', '--no-frozen-lockfile'], {
		cwd: root,
		stdio: 'inherit'
	});

	const installedManifest = JSON.parse(
		await readFile(join(root, 'node_modules/cantraceviewer/package.json'), 'utf8')
	);
	assert.deepEqual(Object.keys(installedManifest.exports), ['.', './direct', './node']);
	assert.equal(installedManifest.name, packageManifest.name);
	assert.equal(installedManifest.version, packageManifest.version);

	await writeFile(
		join(root, 'node-type-smoke.ts'),
		`import { createCanTraceClient } from 'cantraceviewer/node';
const client = createCanTraceClient();
void client;
`
	);
	await writeFile(
		join(root, 'direct-type-smoke.ts'),
		`import { createDirectClient } from 'cantraceviewer/direct';
const direct = createDirectClient(new Uint8Array());
void direct;
`
	);
	await writeFile(
		join(root, 'browser-type-smoke.ts'),
		`import { createCanTraceClient } from 'cantraceviewer';
import { createDirectClient, type DbcEndianness } from 'cantraceviewer/direct';
const endianness: DbcEndianness = 'intel';
const direct = createDirectClient(new Uint8Array());
void [endianness, direct, createCanTraceClient];
`
	);
	for (const [name, lib, file] of [
		['node', ['ES2022'], './node-type-smoke.ts'],
		['direct', ['ES2022'], './direct-type-smoke.ts'],
		['browser', ['ES2022', 'DOM'], './browser-type-smoke.ts']
	]) {
		const config = join(root, `tsconfig-${name}.json`);
		await writeFile(
			config,
			JSON.stringify({
				compilerOptions: {
					lib,
					module: 'NodeNext',
					moduleResolution: 'NodeNext',
					noEmit: true,
					strict: true
				},
				files: [file]
			})
		);
		execFileSync('tsc', ['--project', config], { cwd: root, stdio: 'inherit' });
	}

	await writeFile(
		join(root, 'node-smoke.mjs'),
		`import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { createDirectClient, wasmUrl } from 'cantraceviewer/direct';
import { createCanTraceClient } from 'cantraceviewer/node';

const dbcText = await readFile(new URL('agentic-demo.dbc', ${JSON.stringify(pathToFileURL(resolve(repo, 'wasm/tests/fixtures') + '/').href)}), 'utf8');
const asc = await readFile(new URL('agentic-demo.asc', ${JSON.stringify(pathToFileURL(resolve(repo, 'wasm/tests/fixtures') + '/').href)}));
const identity = { canId: 288, isExtended: false, sizeBytes: 8 };

const direct = createDirectClient(await readFile(wasmUrl));
const directDbc = direct.openDbc(dbcText).handle;
const directTrace = direct.openTrace('asc', Uint8Array.from(asc));
assert.equal(directTrace.metadata.validMessageCount, 1506);
assert.equal(direct.getSignalValues(directDbc, directTrace.handle, identity, 'vehicle_speed').values[1], 123.4);
direct.close();

const node = await createCanTraceClient();
const nodeDbc = (await node.openDbc(dbcText)).handle;
const input = Uint8Array.from(asc).buffer;
const nodeTrace = await node.openTrace('asc', input);
assert.equal(input.byteLength, 0);
assert.equal(nodeTrace.metadata.validMessageCount, 1506);
assert.equal((await node.getSignalValues(nodeDbc, nodeTrace.handle, identity, 'vehicle_speed')).values[1], 123.4);
await node.close();
`
	);
	execFileSync('node', [join(root, 'node-smoke.mjs')], { cwd: root, stdio: 'inherit' });
	execFileSync(
		'node',
		[
			'--input-type=module',
			'--eval',
			"import { createCanTraceClient } from 'cantraceviewer/node'; const client = await createCanTraceClient(); await client.close();"
		],
		{ cwd: root, stdio: 'inherit' }
	);

	await writeFile(
		join(root, 'index.html'),
		'<!doctype html><script type="module" src="/entry.js"></script>\n'
	);
	await writeFile(
		join(root, 'entry.js'),
		`import { createCanTraceClient } from 'cantraceviewer';

globalThis.smoke = (async () => {
	const client = await createCanTraceClient();
	const dbcText = await fetch('/agentic-demo.dbc').then((response) => response.text());
	const buffer = await fetch('/agentic-demo.asc').then((response) => response.arrayBuffer());
	const dbc = (await client.openDbc(dbcText)).handle;
	let yielded = false;
	setTimeout(() => { yielded = true; }, 0);
	const trace = await client.openTrace('asc', buffer);
	const series = await client.getSignalValues(
		dbc,
		trace.handle,
		{ canId: 288, isExtended: false, sizeBytes: 8 },
		'vehicle_speed'
	);
	const result = {
		detached: buffer.byteLength === 0,
		yielded,
		messages: trace.metadata.validMessageCount,
		count: series.values.length,
		value: series.values[1]
	};
	await client.close();
	return result;
})();
`
	);
	await build({
		configFile: false,
		logLevel: 'silent',
		root,
		build: { outDir: 'browser-dist' }
	});

	const assets = await readdir(join(root, 'browser-dist', 'assets'));
	assert(
		assets.some((name) => name.endsWith('.wasm')),
		'browser build did not emit WASM'
	);
	const scripts = await Promise.all(
		assets
			.filter((name) => name.endsWith('.js'))
			.map((name) => readFile(join(root, 'browser-dist', 'assets', name), 'utf8'))
	);
	assert(
		scripts.some((source) => source.includes('new Worker')),
		'browser build did not emit Worker'
	);
	assert(!scripts.some((source) => source.includes('worker_threads')), 'Node built-ins leaked');

	await cp(
		resolve(repo, 'wasm/tests/fixtures/agentic-demo.dbc'),
		join(root, 'browser-dist/agentic-demo.dbc')
	);
	await cp(
		resolve(repo, 'wasm/tests/fixtures/agentic-demo.asc'),
		join(root, 'browser-dist/agentic-demo.asc')
	);
	server = await preview({
		configFile: false,
		logLevel: 'silent',
		root,
		build: { outDir: 'browser-dist' },
		preview: { host: '127.0.0.1', port: 0 }
	});
	const address = server.httpServer.address();
	assert(address && typeof address === 'object');
	browser = await chromium.launch({ headless: true });
	const page = await browser.newPage();
	await page.goto(`http://127.0.0.1:${address.port}`);
	const smoke = await page.evaluate(() => globalThis.smoke);
	assert.deepEqual(smoke, {
		detached: true,
		yielded: true,
		messages: 1506,
		count: 251,
		value: 123.4
	});

	console.log(`validated installed ${basename(tarball)} through direct, Node, and live browser`);
} finally {
	await browser?.close();
	await new Promise((resolveClose) => server?.httpServer.close(resolveClose) ?? resolveClose());
	await rm(root, { recursive: true, force: true });
}
