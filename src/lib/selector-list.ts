import { createSearchIndex, searchIndex, type SearchIndex } from './search-index.js';

export type SelectorListSignal = {
	unavailableReason?: string;
	key: string;
	label: string;
	messageName: string;
	signalName: string;
	arbitrationId?: string;
};

export type SelectorDbcMessage = {
	key: string;
	name: string;
	sourceLabel?: string;
	sourceBadges?: string[];
	signals: SelectorListSignal[];
};

export type SelectorDbcFile = {
	id: string;
	name: string;
	messages: SelectorDbcMessage[];
	kind: 'dbc' | 'mf4-native';
	transient: boolean;
};

export type SelectorListMessage = SelectorDbcMessage & { expanded: boolean };

export type SelectorListDbc = Omit<SelectorDbcFile, 'messages'> & {
	expanded: boolean;
	messages: SelectorListMessage[];
};

export type SelectorFilter = {
	hideUnavailable?: boolean;
	query: string;
	activeOnly: boolean;
	isSignalSelected: (key: string) => boolean;
	expandedDbcIds: ReadonlySet<string>;
	expandedMessageKeys: ReadonlySet<string>;
};

type SelectorSearchEntry = {
	messageKey: string;
	signal: SelectorListSignal;
};

export type SelectorSearchIndex = {
	dbc: SelectorDbcFile;
	signals: SearchIndex<SelectorSearchEntry>;
};

export type SelectorListRow =
	| { kind: 'dbc'; key: string; dbc: SelectorListDbc }
	| { kind: 'message'; key: string; dbc: SelectorListDbc; message: SelectorListMessage }
	| {
			kind: 'signal';
			key: string;
			dbc: SelectorListDbc;
			message: SelectorListMessage;
			signal: SelectorListSignal;
	  };

export function buildSelectorSearchIndexes(files: SelectorDbcFile[]): SelectorSearchIndex[] {
	return files.map((dbc) => {
		const signals = dbc.messages.flatMap<SelectorSearchEntry>((message) =>
			message.signals.map((signal) => ({ messageKey: message.key, signal }))
		);

		return {
			dbc,
			signals: createSearchIndex(
				signals,
				({ signal }) => signal.label,
				({ signal }) => signal.arbitrationId
			)
		};
	});
}

export function visibleSelectorTree(
	indexes: readonly SelectorSearchIndex[],
	filter: SelectorFilter
): SelectorListDbc[] {
	const query = filter.query.trim().toLowerCase();
	if (query.length === 0 && !filter.activeOnly && !filter.hideUnavailable) {
		return indexes.map(({ dbc }) => {
			if (!filter.expandedDbcIds.has(dbc.id)) return { ...dbc, expanded: false, messages: [] };

			return {
				...dbc,
				expanded: true,
				messages: dbc.messages
					.filter((message) => message.signals.length > 0)
					.map((message) =>
						filter.expandedMessageKeys.has(message.key)
							? { ...message, expanded: true }
							: { ...message, expanded: false, signals: [] }
					)
			};
		});
	}

	return indexes.flatMap((index) => {
		const signalsByMessage: Record<string, SelectorListSignal[]> = {};
		const visibleSignals = searchIndex(index.signals, query).filter(
			({ signal }) =>
				(!filter.activeOnly || filter.isSignalSelected(signal.key)) &&
				(!filter.hideUnavailable || !signal.unavailableReason)
		);

		for (const { messageKey, signal } of visibleSignals) {
			signalsByMessage[messageKey] ??= [];
			signalsByMessage[messageKey].push(signal);
		}

		const messages = index.dbc.messages
			.map((message) => ({
				...message,
				expanded: filter.expandedMessageKeys.has(message.key),
				signals: signalsByMessage[message.key] ?? []
			}))
			.filter((message) => message.signals.length > 0);

		if (messages.length === 0) return [];

		const expanded = filter.expandedDbcIds.has(index.dbc.id);
		return [
			{
				...index.dbc,
				expanded,
				messages: expanded
					? messages.map((message) => ({
							...message,
							signals: message.expanded ? message.signals : []
						}))
					: []
			}
		];
	});
}

export function flattenSelectorTree(files: SelectorListDbc[]): SelectorListRow[] {
	const rows: SelectorListRow[] = [];
	for (const dbc of files) {
		rows.push({ kind: 'dbc', key: `dbc:${dbc.id}`, dbc });
		if (!dbc.expanded) continue;

		for (const message of dbc.messages) {
			rows.push({ kind: 'message', key: `message:${message.key}`, dbc, message });
			if (!message.expanded) continue;

			for (const signal of message.signals) {
				rows.push({ kind: 'signal', key: `signal:${signal.key}`, dbc, message, signal });
			}
		}
	}
	return rows;
}
