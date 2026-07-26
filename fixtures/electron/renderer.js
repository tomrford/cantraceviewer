import { createCanTraceClient } from 'cantraceviewer';

const identity = { canId: 288, isExtended: false, sizeBytes: 8 };

try {
	const dbcText = new TextDecoder().decode(
		await globalThis.canTraceFixture.readFixture('agentic-demo.dbc')
	);
	const traceBytes = await globalThis.canTraceFixture.readFixture('agentic-demo.asc');
	const buffer = Uint8Array.from(traceBytes).buffer;
	const client = await createCanTraceClient();
	const dbc = (await client.openDbc(dbcText)).handle;
	let rendererYielded = false;
	setTimeout(() => {
		rendererYielded = true;
	}, 0);
	const trace = await client.openTrace('asc', buffer);
	const series = await client.getSignalValues(dbc, trace.handle, identity, 'vehicle_speed');
	const browser = {
		detached: buffer.byteLength === 0,
		rendererYielded,
		messages: trace.metadata.validMessageCount,
		count: series.values.length,
		value: series.values[1]
	};
	await client.closeTrace(trace.handle);
	await client.closeDbc(dbc);
	await client.close();

	const node = await globalThis.canTraceFixture.runNodePath();
	globalThis.canTraceFixture.report({ browser, node });
} catch (error) {
	globalThis.canTraceFixture.report({
		error: error instanceof Error ? error.stack : String(error)
	});
}
