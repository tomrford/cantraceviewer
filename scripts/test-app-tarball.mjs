import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = resolve(import.meta.dirname, '..');
const packageManifest = JSON.parse(
	await readFile(join(repo, 'packages/core/package.json'), 'utf8')
);
const tarball = resolve(
	process.argv[2] ??
		join(repo, 'artifacts', `${packageManifest.name}-${packageManifest.version}.tgz`)
);
const packageRoot = await mkdtemp(join(await realpath(tmpdir()), 'cantraceviewer-package-'));
const appRoot = await mkdtemp(join(await realpath(tmpdir()), 'cantraceviewer-app-package-'));

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
		join(packageRoot, 'package.json'),
		JSON.stringify(
			{
				name: 'cantraceviewer-package-smoke',
				private: true,
				type: 'module',
				dependencies: { cantraceviewer: `file:${tarball}` }
			},
			null,
			2
		)
	);
	execFileSync('bun', ['install'], { cwd: packageRoot, stdio: 'inherit' });

	for (const [name, lib, source] of [
		[
			'node',
			['ES2022'],
			`import { createCanTraceClient, DEFAULT_PARSING_LIMITS, type ParsingLimits } from 'cantraceviewer/node';
const limits: ParsingLimits = DEFAULT_PARSING_LIMITS;
void createCanTraceClient(limits);
`
		],
		[
			'direct',
			['ES2022'],
			`import { createDirectClient, DEFAULT_PARSING_LIMITS, type ParsingLimits } from 'cantraceviewer/direct';
const limits: ParsingLimits = DEFAULT_PARSING_LIMITS;
void createDirectClient(new Uint8Array(), limits);
`
		],
		[
			'browser',
			['ES2022', 'DOM'],
			`import { createCanTraceClient, DEFAULT_PARSING_LIMITS, type ParsingLimits } from 'cantraceviewer';
import { createDirectClient } from 'cantraceviewer/direct';
const limits: ParsingLimits = DEFAULT_PARSING_LIMITS;
void [createDirectClient(new Uint8Array()), createCanTraceClient(limits)];
`
		]
	]) {
		const file = `./${name}-type-smoke.ts`;
		const config = join(packageRoot, `tsconfig-${name}.json`);
		await writeFile(join(packageRoot, file), source);
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
		execFileSync('bun', ['check', '-p', config], { cwd: packageRoot, stdio: 'inherit' });
	}

	const fixturesUrl = JSON.stringify(
		pathToFileURL(resolve(repo, 'wasm/tests/fixtures') + '/').href
	);
	execFileSync(
		'node',
		[
			'--input-type=module',
			'--eval',
			`import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { createDirectClient, wasmUrl } from 'cantraceviewer/direct';
import { createCanTraceClient } from 'cantraceviewer/node';

const dbcText = await readFile(new URL('agentic-demo.dbc', ${fixturesUrl}), 'utf8');
const asc = await readFile(new URL('agentic-demo.asc', ${fixturesUrl}));
const identity = { canId: 288, isExtended: false, sizeBytes: 8 };

const direct = createDirectClient(await readFile(wasmUrl));
try {
	const dbc = direct.openDbc(dbcText).handle;
	const trace = direct.openTrace('asc', Uint8Array.from(asc));
	assert.equal(trace.metadata.validMessageCount, 1506);
	assert.equal(
		direct.getSignalValues(dbc, trace.handle, identity, 'vehicle_speed').values[1],
		123.4
	);
} finally {
	direct.close();
}

const node = await createCanTraceClient();
try {
	const dbc = (await node.openDbc(dbcText)).handle;
	const input = Uint8Array.from(asc).buffer;
	const trace = await node.openTrace('asc', input);
	assert.equal(input.byteLength, 0);
	assert.equal(trace.metadata.validMessageCount, 1506);
	assert.equal(
		(await node.getSignalValues(dbc, trace.handle, identity, 'vehicle_speed')).values[1],
		123.4
	);
} finally {
	await node.close();
}`
		],
		{ cwd: packageRoot, stdio: 'inherit' }
	);

	for (const path of [
		'src',
		'wasm/tests/fixtures',
		'public',
		'scripts/prerender.mjs',
		'index.html',
		'tsconfig.json',
		'vite.config.ts'
	]) {
		await cp(join(repo, path), join(appRoot, path), { recursive: true });
	}

	const manifest = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'));
	delete manifest.workspaces;
	manifest.dependencies.cantraceviewer = `file:${tarball}`;
	await writeFile(join(appRoot, 'package.json'), `${JSON.stringify(manifest, null, '\t')}\n`);

	await cp(join(repo, 'bunfig.toml'), join(appRoot, 'bunfig.toml'));
	await cp(join(repo, 'bun.lock'), join(appRoot, 'bun.lock'));

	execFileSync('bun', ['install'], { cwd: appRoot, stdio: 'inherit' });
	execFileSync('bun', ['check', '-p', 'tsconfig.json'], {
		cwd: appRoot,
		stdio: 'inherit'
	});
	execFileSync('bun', ['run', 'test:run'], { cwd: appRoot, stdio: 'inherit' });
	const installed = JSON.parse(
		await readFile(join(appRoot, 'node_modules/cantraceviewer/package.json'), 'utf8')
	);
	assert.equal(installed.name, packageManifest.name);
	assert.equal(installed.version, packageManifest.version);
	execFileSync('bun', ['run', 'build'], { cwd: appRoot, stdio: 'inherit' });
	assert.equal(await readFile(join(appRoot, 'dist/index.html'), 'utf8').then(Boolean), true);
	const output = await readdir(join(appRoot, 'dist'), { recursive: true });
	assert(
		output.some((name) => /(^|\/)worker-[^/]*\.js$/.test(name)),
		'app omitted Worker'
	);
	assert(
		output.some((name) => /cantraceviewer_bg-.*\.wasm$/.test(name)),
		'app omitted WASM'
	);
	if (process.env.KEEP_PACKAGE_SMOKE)
		console.log(`Package fixture: ${packageRoot}\nApp fixture: ${appRoot}`);
	console.log(
		'validated the installed tarball against standalone package exports, types, and the production app build'
	);
} finally {
	if (!process.env.KEEP_PACKAGE_SMOKE) {
		await rm(packageRoot, { recursive: true, force: true });
		await rm(appRoot, { recursive: true, force: true });
	}
}
