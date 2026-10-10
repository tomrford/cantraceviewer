import { cp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

await rm(new URL('../dist', import.meta.url), { recursive: true, force: true });
execFileSync(
	'tsc',
	['--project', fileURLToPath(new URL('../tsconfig.build.json', import.meta.url))],
	{
		stdio: 'inherit'
	}
);

const browserClient = new URL('../dist/client.js', import.meta.url);
const browserSource = await readFile(browserClient, 'utf8');
const packagedSource = browserSource.replace(
	"new URL('./worker.ts', import.meta.url)",
	"new URL('./worker.js', import.meta.url)"
);
if (packagedSource === browserSource) throw new Error('browser Worker URL was not rewritten');
await writeFile(browserClient, packagedSource);

const dist = new URL('../dist/', import.meta.url);
for (const relative of await readdir(dist, { recursive: true })) {
	if (!relative.endsWith('.d.ts')) continue;
	const declaration = new URL(relative, dist);
	const source = await readFile(declaration, 'utf8');
	const imports = source.replace(/(from\s+['"]\.\.?\/[^'"]+)\.ts(['"])/g, '$1.js$2');
	await writeFile(
		declaration,
		relative === 'direct.d.ts' ? `/// <reference lib="dom" />\n${imports}` : imports
	);
}

await cp(
	new URL('../src/wasm-bindgen', import.meta.url),
	new URL('../dist/wasm-bindgen', import.meta.url),
	{ recursive: true }
);
