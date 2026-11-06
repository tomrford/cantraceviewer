import { createCanTraceClient, type CanTraceClient } from 'cantraceviewer';

import { APP_PARSING_LIMITS } from '@/lib/file-limits';

export type * from 'cantraceviewer';

let clientPromise: Promise<CanTraceClient> | null = null;

function client(): Promise<CanTraceClient> {
	return (clientPromise ??= createCanTraceClient(APP_PARSING_LIMITS).catch((error: unknown) => {
		// A rejected factory produced no client. Let a later user operation retry startup without
		// restarting a client that had already become fatal during normal operation.
		clientPromise = null;
		throw error;
	}));
}

export const openDbc: CanTraceClient['openDbc'] = async (...args) =>
	(await client()).openDbc(...args);

export const closeDbc: CanTraceClient['closeDbc'] = async (...args) =>
	(await client()).closeDbc(...args);

export const openTrace: CanTraceClient['openTrace'] = async (...args) =>
	(await client()).openTrace(...args);

export const closeTrace: CanTraceClient['closeTrace'] = async (...args) =>
	(await client()).closeTrace(...args);

export const getSignalValues: CanTraceClient['getSignalValues'] = async (...args) =>
	(await client()).getSignalValues(...args);

export const getMf4SignalValues: CanTraceClient['getMf4SignalValues'] = async (...args) =>
	(await client()).getMf4SignalValues(...args);
