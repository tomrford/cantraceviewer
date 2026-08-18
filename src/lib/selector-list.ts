export type SelectorListDbc = {
	id: string;
	name: string;
	expanded: boolean;
	messages: SelectorListMessage[];
	kind: 'dbc' | 'mf4-native';
	transient: boolean;
};

export type SelectorListMessage = {
	key: string;
	name: string;
	expanded: boolean;
	signals: SelectorListSignal[];
};

export type SelectorListSignal = {
	key: string;
	label: string;
	signalName: string;
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
