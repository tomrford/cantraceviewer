import { readFile } from 'node:fs/promises';
import { afterAll, expect, it, vi } from 'vitest';
import type { CanTraceClient } from 'cantraceviewer';

const transport = vi.hoisted(() => ({ client: null as CanTraceClient | null }));
// Exercise the app against the published package using its real Node worker transport.
vi.mock('cantraceviewer', async () => {
	const pkg = await import('cantraceviewer/node');
	return {
		...pkg,
		createCanTraceClient: async (limits: Parameters<typeof pkg.createCanTraceClient>[0]) => {
			transport.client = await pkg.createCanTraceClient(limits);
			return transport.client;
		}
	};
});
import { buildSignalCsv, signalCsvFilename, type SignalCsvSource } from './plot-data-export.js';
import { dbcFiles } from './stores/dbc-files.svelte.js';
import { plotData } from './stores/plot-data.svelte.js';
import { onTraceOpened } from './stores/session.js';
import { traceFile } from './stores/trace-file.svelte.js';
import { closeTrace } from './wasm.js';

const fixture = async (name: string) =>
	new File([await readFile(`wasm/tests/fixtures/${name}`)], name);

afterAll(async () => {
	plotData.clearSelectedSignals();
	await dbcFiles.clear();
	if (traceFile.entry) await closeTrace(traceFile.entry.handle);
	traceFile.entry = null;
	await transport.client?.close();
});

it('exports every decoded sample of the plotted signals', async () => {
	expect(await traceFile.openFile(await fixture('agentic-demo.asc'))).toBe(true);
	await onTraceOpened();
	await dbcFiles.addFiles([await fixture('agentic-demo.dbc')]);
	expect(dbcFiles.error).toBeNull();
	const signals = dbcFiles.selectorFiles[0].messages.flatMap((message) => message.signals);
	await plotData.toggleSignal(signals.find((signal) => signal.signalName === 'vehicle_speed')!.key);
	await plotData.toggleSignal(signals.find((signal) => signal.signalName === 'engine_rpm')!.key);

	const lines = buildSignalCsv(plotData.signals).split('\n');

	expect(lines[0]).toBe('signal,unit,timeMs,value');
	expect(lines).toContain('PowertrainStatus.vehicle_speed [Channel 1 · Rx],km/h,10,100');
	expect(lines).toContain('PowertrainStatus.vehicle_speed [Channel 1 · Rx],km/h,110,123.4');
	expect(lines).toContain('PowertrainStatus.engine_rpm [Channel 1 · Rx],rpm,110,5379');
	const vehicleSpeedRows = lines.filter((line) =>
		line.startsWith('PowertrainStatus.vehicle_speed')
	);
	expect(vehicleSpeedRows).toHaveLength(plotData.signals[0].series!.timesMs.length);
	expect(signalCsvFilename(traceFile.displayName)).toBe('agentic-demo-signals.csv');
});

it('omits signals without samples and quotes CSV fields', () => {
	const signals: SignalCsvSource[] = [
		{
			label: 'Mux.Signal, "quoted"',
			unit: '°C, amb',
			series: { timesMs: new Float64Array([1.5]), values: new Float64Array([-0.5]) }
		},
		{ label: 'Pending.Signal', unit: 'V', series: null }
	];

	expect(buildSignalCsv(signals)).toBe(
		'signal,unit,timeMs,value\n"Mux.Signal, ""quoted""","°C, amb",1.5,-0.5\n'
	);
});
