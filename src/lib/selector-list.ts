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
	transient: boolean;
};

type SelectorFilter = {
	hideUnavailable?: boolean;
	query: string;
	activeOnly: boolean;
	isSignalSelected: (key: string) => boolean;
	/** DBC ids and message keys. They cannot collide: message keys are JSON arrays. */
	expanded: ReadonlySet<string>;
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
	| { kind: 'dbc'; key: string; dbc: SelectorDbcFile; expanded: boolean }
	| { kind: 'message'; key: string; message: SelectorDbcMessage; expanded: boolean }
	| { kind: 'signal'; key: string; signal: SelectorListSignal };

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

export function selectorRows(
	indexes: readonly SelectorSearchIndex[],
	filter: SelectorFilter
): SelectorListRow[] {
	const query = filter.query.trim();
	// A punctuation-only query has no search terms, but it still counts as filtering.
	const filtering = query.length > 0 || filter.activeOnly || filter.hideUnavailable;
	// This runs per deferred keystroke. Match every catalogue before allocating any rows, because
	// rows still alive during matching get copied by each scavenge on a large catalogue.
	const catalogues = indexes.map(({ dbc, signals }) => ({
		dbc,
		matches: filtering ? visibleSignalsByMessage(signals, query, filter) : null
	}));
	const rows: SelectorListRow[] = [];

	for (const { dbc, matches } of catalogues) {
		// Only filtering hides a DBC with nothing to show; unfiltered, an empty DBC keeps its row.
		if (matches?.size === 0) continue;

		const dbcExpanded = filter.expanded.has(dbc.id);
		rows.push({ kind: 'dbc', key: `dbc:${dbc.id}`, dbc, expanded: dbcExpanded });
		if (!dbcExpanded) continue;

		for (const message of dbc.messages) {
			const visible = matches ? matches.get(message.key) : message.signals;
			if (!visible?.length) continue;

			const expanded = filter.expanded.has(message.key);
			rows.push({ kind: 'message', key: `message:${message.key}`, message, expanded });
			if (!expanded) continue;

			for (const signal of visible) {
				rows.push({ kind: 'signal', key: `signal:${signal.key}`, signal });
			}
		}
	}
	return rows;
}

function visibleSignalsByMessage(
	signals: SearchIndex<SelectorSearchEntry>,
	query: string,
	filter: SelectorFilter
): Map<string, SelectorListSignal[]> {
	const byMessage = new Map<string, SelectorListSignal[]>();
	for (const { messageKey, signal } of searchIndex(signals, query)) {
		if (filter.activeOnly && !filter.isSignalSelected(signal.key)) continue;
		if (filter.hideUnavailable && signal.unavailableReason) continue;

		const group = byMessage.get(messageKey);
		if (group) group.push(signal);
		else byMessage.set(messageKey, [signal]);
	}
	return byMessage;
}
