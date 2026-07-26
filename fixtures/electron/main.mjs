import { app, BrowserWindow, ipcMain, protocol } from 'electron';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { createCanTraceClient } from 'cantraceviewer/node';

const fixtureDir = process.env.CANTRACE_FIXTURES;
const rendererDir = process.env.CANTRACE_RENDERER_DIR;
if (!fixtureDir || !rendererDir) throw new Error('fixture paths were not configured');

const identity = { canId: 288, isExtended: false, sizeBytes: 8 };
app.commandLine.appendSwitch('disable-gpu');
let window;
let timeout;

protocol.registerSchemesAsPrivileged([
	{
		scheme: 'cantracefixture',
		privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
	}
]);

ipcMain.handle('fixture:read', (_event, name) => readFile(join(fixtureDir, name)));
ipcMain.handle('fixture:node', async () => {
	const client = await createCanTraceClient();
	try {
		const dbc = (await client.openDbc(await readFile(join(fixtureDir, 'agentic-demo.dbc'), 'utf8')))
			.handle;
		const buffer = Uint8Array.from(await readFile(join(fixtureDir, 'agentic-demo.asc'))).buffer;
		let mainYielded = false;
		setImmediate(() => {
			mainYielded = true;
		});
		const trace = await client.openTrace('asc', buffer);
		const series = await client.getSignalValues(dbc, trace.handle, identity, 'vehicle_speed');
		const result = {
			detached: buffer.byteLength === 0,
			mainYielded,
			messages: trace.metadata.validMessageCount,
			count: series.values.length,
			value: series.values[1]
		};
		await client.closeTrace(trace.handle);
		await client.closeDbc(dbc);
		return result;
	} finally {
		await client.close();
	}
});
ipcMain.on('fixture:result', (_event, result) => {
	clearTimeout(timeout);
	console.log(`CANTRACE_ELECTRON_RESULT ${JSON.stringify(result)}`);
	app.exit(result.error ? 1 : 0);
});

console.log('Electron fixture waiting for app readiness');
void app
	.whenReady()
	.then(async () => {
		console.log('Electron fixture app ready');
		protocol.handle('cantracefixture', async (request) => {
			const requested = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '');
			const root = resolve(rendererDir);
			const file = resolve(root, requested || 'index.html');
			if (file !== root && !file.startsWith(`${root}${sep}`)) {
				return new Response('Not found', { status: 404 });
			}
			try {
				return new Response(await readFile(file), {
					headers: { 'content-type': contentType(file) }
				});
			} catch {
				return new Response('Not found', { status: 404 });
			}
		});
		window = new BrowserWindow({
			show: false,
			webPreferences: {
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: false,
				preload: join(import.meta.dirname, 'preload.mjs')
			}
		});
		window.webContents.on('console-message', (_event, _level, message) => {
			console.error(`renderer: ${message}`);
		});
		window.webContents.on('render-process-gone', (_event, details) => {
			console.error(`renderer exited: ${details.reason}`);
			app.exit(1);
		});
		timeout = setTimeout(() => {
			console.error('Electron fixture timed out');
			app.exit(1);
		}, 30_000);
		await window.loadURL('cantracefixture://bundle/index.html');
	})
	.catch((error) => {
		console.error(error);
		app.exit(1);
	});

function contentType(file) {
	switch (extname(file)) {
		case '.html':
			return 'text/html; charset=utf-8';
		case '.js':
			return 'text/javascript; charset=utf-8';
		case '.wasm':
			return 'application/wasm';
		default:
			return 'application/octet-stream';
	}
}
