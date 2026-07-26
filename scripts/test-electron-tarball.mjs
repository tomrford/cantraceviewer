import { strict as assert } from 'node:assert';
import { spawn, execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import electronPath from 'electron';
import { build } from 'vite';

const repo = resolve(import.meta.dirname, '..');
const packageManifest = JSON.parse(
	await readFile(join(repo, 'packages/core/package.json'), 'utf8')
);
const tarball = resolve(
	process.argv[2] ??
		join(repo, 'artifacts', `${packageManifest.name}-${packageManifest.version}.tgz`)
);
const root = await mkdtemp(join(await realpath(tmpdir()), 'cantraceviewer-electron-'));
const fixture = join(root, 'fixture');

try {
	await writeFile(
		join(root, 'package.json'),
		JSON.stringify(
			{
				name: 'cantraceviewer-electron-tarball-smoke',
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
	await cp(join(repo, 'fixtures/electron'), fixture, { recursive: true });

	for (const name of ['main.mjs', 'preload.mjs', 'renderer.js']) {
		const source = await readFile(join(fixture, name), 'utf8');
		assert(!source.includes('cantraceviewer/direct'), `${name} imports the blocking direct entry`);
	}

	await build({
		base: './',
		configFile: false,
		logLevel: 'silent',
		root: fixture,
		build: { outDir: join(root, 'renderer-dist'), emptyOutDir: true }
	});
	const output = await runElectron(join(fixture, 'main.mjs'), {
		CANTRACE_FIXTURES: resolve(repo, 'wasm/tests/fixtures'),
		CANTRACE_RENDERER_DIR: join(root, 'renderer-dist')
	});
	const marker = output.split('\n').find((line) => line.startsWith('CANTRACE_ELECTRON_RESULT '));
	assert(marker, `Electron fixture did not report a result:\n${output}`);
	const result = JSON.parse(marker.slice('CANTRACE_ELECTRON_RESULT '.length));
	assert.deepEqual(result, {
		browser: {
			detached: true,
			rendererYielded: true,
			messages: 1506,
			count: 251,
			value: 123.4
		},
		node: {
			detached: true,
			mainYielded: true,
			messages: 1506,
			count: 251,
			value: 123.4
		}
	});
	console.log('validated both Electron arrangements against the installed tarball');
} finally {
	await rm(root, { recursive: true, force: true });
}

function runElectron(main, extraEnv) {
	return new Promise((resolveRun, rejectRun) => {
		const child = spawn(electronPath, [main], {
			env: {
				...process.env,
				...extraEnv,
				ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
			},
			stdio: ['ignore', 'pipe', 'pipe']
		});
		let output = '';
		child.stdout.on('data', (chunk) => {
			output += chunk;
			process.stdout.write(chunk);
		});
		child.stderr.on('data', (chunk) => {
			output += chunk;
			process.stderr.write(chunk);
		});
		const timeout = setTimeout(() => {
			child.kill();
			rejectRun(new Error(`Electron process timed out:\n${output}`));
		}, 35_000);
		child.on('error', (error) => {
			clearTimeout(timeout);
			rejectRun(error);
		});
		child.on('exit', (code, signal) => {
			clearTimeout(timeout);
			if (code === 0) resolveRun(output);
			else rejectRun(new Error(`Electron exited with ${code ?? signal}:\n${output}`));
		});
	});
}
