import type { SelectorDbcFile } from '$lib/stores/dbc-files.svelte.js';
import type { Mf4Signal, Mf4SignalGroup, TraceHandle } from '$lib/wasm.js';

export type Mf4SignalTarget = {
	trace: TraceHandle;
	group: Mf4SignalGroup;
	signal: Mf4Signal;
};

export function mf4SignalIdentityKey(traceId: number, signalId: number): string {
	return JSON.stringify(['mf4', traceId, signalId]);
}

export function mf4SelectorFiles(trace: TraceHandle | null): SelectorDbcFile[] {
	if (!trace?.mf4Catalog || trace.mf4Catalog.groups.length === 0) return [];

	return [
		{
			id: `mf4:${trace.id}:native`,
			name: 'Decoded signals',
			kind: 'mf4-native',
			transient: true,
			messages: trace.mf4Catalog.groups.map((group, groupIndex) => ({
				key: JSON.stringify(['mf4', trace.id, 'group', groupIndex]),
				name: group.name,
				signals: group.signals.map((signal) => ({
					key: mf4SignalIdentityKey(trace.id, signal.id),
					label: `${group.name}.${signal.name}`,
					messageName: group.name,
					signalName: signal.name
				}))
			}))
		}
	];
}

export function buildMf4SignalTargetIndex(
	trace: TraceHandle | null
): Record<string, Mf4SignalTarget> {
	const index: Record<string, Mf4SignalTarget> = {};
	if (!trace?.mf4Catalog) return index;

	for (const group of trace.mf4Catalog.groups) {
		for (const signal of group.signals) {
			index[mf4SignalIdentityKey(trace.id, signal.id)] = { trace, group, signal };
		}
	}
	return index;
}
