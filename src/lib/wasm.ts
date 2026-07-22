/** App adapter for the worker-backed core package. File limits live in '$lib/file-limits.js'. */
import { createCanTraceClient, type CanTraceClient } from '@cantraceviewer/core';
import type {
	DbcHandle,
	DbcMessageIdentity,
	DecodedSignalSeries,
	ParsedDbc,
	TraceHandle,
	TraceType
} from '@cantraceviewer/core';

export type * from '@cantraceviewer/core';

let clientPromise: Promise<CanTraceClient> | null = null;

function client(): Promise<CanTraceClient> {
	return (clientPromise ??= createCanTraceClient());
}

export async function openDbc(text: string): Promise<{ handle: DbcHandle; catalog: ParsedDbc }> {
	return (await client()).openDbc(text);
}

export async function closeDbc(handle: DbcHandle): Promise<void> {
	return (await client()).closeDbc(handle);
}

export async function openTrace(traceType: TraceType, bytes: Uint8Array): Promise<TraceHandle> {
	const buffer = bytes.buffer;
	if (
		!(buffer instanceof ArrayBuffer) ||
		bytes.byteOffset !== 0 ||
		bytes.byteLength !== buffer.byteLength
	) {
		throw new Error(
			'openTrace requires a Uint8Array over one exact ordinary ArrayBuffer; subviews and SharedArrayBuffer-backed views are not supported'
		);
	}

	return (await client()).openTrace(traceType, buffer);
}

export async function closeTrace(handle: TraceHandle): Promise<void> {
	return (await client()).closeTrace(handle);
}

export async function getSignalValues(
	dbcHandle: DbcHandle,
	traceHandle: TraceHandle,
	messageIdentity: DbcMessageIdentity,
	signalName: string
): Promise<DecodedSignalSeries> {
	return (await client()).getSignalValues(dbcHandle, traceHandle, messageIdentity, signalName);
}

export async function getMf4SignalValues(
	traceHandle: TraceHandle,
	signalId: number
): Promise<DecodedSignalSeries> {
	return (await client()).getMf4SignalValues(traceHandle, signalId);
}
