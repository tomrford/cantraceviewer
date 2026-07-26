import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '..');
const packageManifest = JSON.parse(
	await readFile(join(repo, 'packages/core/package.json'), 'utf8')
);
const tarball = resolve(
	process.argv[2] ??
		join(repo, 'artifacts', `${packageManifest.name}-${packageManifest.version}.tgz`)
);
const root = await mkdtemp(join(await realpath(tmpdir()), 'cantraceviewer-app-package-'));

try {
	for (const path of [
		'src',
		'static',
		'patches',
		'components.json',
		'svelte.config.js',
		'tsconfig.json',
		'vite.config.ts'
	]) {
		await cp(join(repo, path), join(root, path), { recursive: true });
	}

	const manifest = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'));
	manifest.dependencies.cantraceviewer = `file:${tarball}`;
	delete manifest.devDependencies.electron;
	delete manifest.devDependencies.playwright;
	manifest.scripts['package:build'] = "node -e ''";
	await writeFile(join(root, 'package.json'), `${JSON.stringify(manifest, null, '\t')}\n`);

	const workspaceSource = await readFile(join(repo, 'pnpm-workspace.yaml'), 'utf8');
	assert(workspaceSource.includes('  - packages/*\n'));
	const workspace = workspaceSource.replace('  - packages/*\n', '');
	await writeFile(join(root, 'pnpm-workspace.yaml'), workspace);
	await cp(join(repo, 'pnpm-lock.yaml'), join(root, 'pnpm-lock.yaml'));

	execFileSync('pnpm', ['install', '--no-frozen-lockfile'], { cwd: root, stdio: 'inherit' });
	const installed = JSON.parse(
		await readFile(join(root, 'node_modules/cantraceviewer/package.json'), 'utf8')
	);
	assert.equal(installed.name, packageManifest.name);
	assert.equal(installed.version, packageManifest.version);
	execFileSync('pnpm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
	assert.equal(await readFile(join(root, 'build/index.html'), 'utf8').then(Boolean), true);
	const output = await readdir(join(root, 'build'), { recursive: true });
	assert(
		output.some((name) => /workers\/worker-.*\.js$/.test(name)),
		'app omitted Worker'
	);
	assert(
		output.some((name) => /cantraceviewer_bg-.*\.wasm$/.test(name)),
		'app omitted WASM'
	);
	console.log('validated the CAN Trace Viewer production build against the installed tarball');
} finally {
	await rm(root, { recursive: true, force: true });
}
