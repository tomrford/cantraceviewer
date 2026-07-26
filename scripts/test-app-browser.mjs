import { strict as assert } from 'node:assert';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { preview } from 'vite';

const repo = resolve(import.meta.dirname, '..');
const fixtures = resolve(repo, 'wasm/tests/fixtures');
let browser;
let server;
let appUrl = process.env.CANTRACE_APP_URL;

try {
	if (!appUrl) {
		server = await preview({
			configFile: false,
			logLevel: 'silent',
			root: repo,
			build: { outDir: 'build' },
			preview: { host: '127.0.0.1', port: 0 }
		});
		const address = server.httpServer.address();
		assert(address && typeof address === 'object');
		appUrl = `http://127.0.0.1:${address.port}`;
	}

	browser = await chromium.launch({
		headless: true,
		args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader']
	});
	const page = await browser.newPage();
	const diagnostics = [];
	page.on('console', (message) => {
		if (message.type() === 'warning' || message.type() === 'error') {
			diagnostics.push(`${message.type()}: ${message.text()}`);
		}
	});
	page.on('pageerror', (error) => diagnostics.push(`pageerror: ${error.message}`));

	await page.goto(appUrl, { waitUntil: 'load' });
	await page
		.locator('input[type="file"][accept*=".asc"]')
		.setInputFiles(resolve(fixtures, 'agentic-demo.asc'));
	await page.getByRole('button', { name: 'Load trace' }).waitFor();
	assert.match(await page.getByRole('button', { name: 'Load trace' }).innerText(), /agentic-demo/);

	await page.getByRole('button', { name: 'Open signal selector' }).click();
	await page
		.locator('input[type="file"][accept*=".dbc"]')
		.setInputFiles(resolve(fixtures, 'agentic-demo.dbc'));
	const dbcToggle = page.getByRole('button', { name: /(?:Expand|Collapse) agentic-demo/ });
	try {
		await dbcToggle.waitFor({ timeout: 5000 });
	} catch (error) {
		console.error(await page.locator('body').innerText());
		throw error;
	}
	if ((await dbcToggle.getAttribute('aria-expanded')) === 'false') await dbcToggle.click();
	const messageToggle = page.getByRole('button', {
		name: /(?:Expand|Collapse) PowertrainStatus/
	});
	await messageToggle.waitFor();
	if ((await messageToggle.getAttribute('aria-expanded')) === 'false') await messageToggle.click();
	await page.getByRole('checkbox', { name: 'Plot PowertrainStatus.vehicle_speed' }).check();

	await page.getByLabel('Selected signal plot').waitFor();
	await page.locator('button[aria-label="Zoom in"]:not(:disabled)').waitFor();
	assert.deepEqual(diagnostics, []);

	console.log('validated the CAN Trace Viewer UI with the installed registry package');
} finally {
	await browser?.close();
	await new Promise((resolveClose) => server?.httpServer.close(resolveClose) ?? resolveClose());
}
