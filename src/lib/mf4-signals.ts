import { buildSelectorSearchIndexes, type SelectorSearchIndex } from '#lib/selector-list.js';
import type { Mf4Signal, Mf4SignalGroup, OpenTraceResult } from '#lib/wasm.js';

type Mf4Trace = OpenTraceResult & { id: number };

export type Mf4SignalTarget = {
	group: Mf4SignalGroup;
	signal: Mf4Signal;
};

function mf4SignalIdentityKey(traceId: number, signalId: number): string {
	return JSON.stringify(['mf4', traceId, signalId]);
}

export function mf4SelectorSearchIndexes(trace: Mf4Trace | null): SelectorSearchIndex[] {
	if (!trace?.mf4Catalog || trace.mf4Catalog.groups.length === 0) return [];

	return buildSelectorSearchIndexes([
		{
			id: `mf4:${trace.id}:native`,
			name: 'Decoded signals',
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
	]);
}

export function buildMf4SignalTargetIndex(trace: Mf4Trace | null) {
	const index = new Map<string, Mf4SignalTarget>();
	if (!trace?.mf4Catalog) return index;

	for (const group of trace.mf4Catalog.groups) {
		for (const signal of group.signals) {
			index.set(mf4SignalIdentityKey(trace.id, signal.id), { group, signal });
		}
	}
	return index;
}
