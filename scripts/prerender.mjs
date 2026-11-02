// Renders the app shell into dist/index.html after `vite build` so the first paint and crawlers
// get real markup; src/main.tsx hydrates it. Loads the server entry through Vite in memory, so no
// SSR bundle is written next to the static output.
import { readFile, writeFile } from 'node:fs/promises';

import { createServer } from 'vite';

process.env.NODE_ENV ??= 'production';

const placeholder = '<!--app-html-->';
const file = new URL('../dist/index.html', import.meta.url);
const html = await readFile(file, 'utf8');
if (!html.includes(placeholder)) throw new Error(`dist/index.html lacks ${placeholder}`);

const vite = await createServer({
	appType: 'custom',
	logLevel: 'error',
	mode: 'production',
	server: { middlewareMode: true, hmr: false, watch: null }
});
try {
	const { render } = await vite.ssrLoadModule('/src/server.tsx');
	await writeFile(
		file,
		html.replace(placeholder, () => render())
	);
} finally {
	await vite.close();
}
