import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const packageDir = resolve(import.meta.dirname, '..');
const destination = resolve(process.argv[2] ?? resolve(packageDir, '..', '..', 'artifacts'));
const manifest = JSON.parse(await readFile(resolve(packageDir, 'package.json'), 'utf8'));
const tarball = resolve(destination, `${manifest.name}-${manifest.version}.tgz`);

await mkdir(destination, { recursive: true });
await rm(tarball, { force: true });
execFileSync('pnpm', ['pack', '--pack-destination', destination], {
	cwd: packageDir,
	stdio: 'inherit'
});

const checksum = createHash('sha256')
	.update(await readFile(tarball))
	.digest('hex');
await writeFile(`${tarball}.sha256`, `${checksum}  ${basename(tarball)}\n`);
console.log(`${tarball}\nsha256 ${checksum}`);
