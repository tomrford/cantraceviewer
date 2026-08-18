export const SELECTOR_ROW_GAP_PX = 4;
export const SELECTOR_DBC_ROW_HEIGHT_PX = 32;
export const SELECTOR_ITEM_ROW_HEIGHT_PX = 28;
export const SELECTOR_ROW_OVERSCAN = 8;

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

export type SelectorRowWindow = {
	rows: SelectorListRow[];
	startOffset: number;
	totalHeight: number;
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

export function selectorRowHeight(row: SelectorListRow): number {
	return row.kind === 'dbc' ? SELECTOR_DBC_ROW_HEIGHT_PX : SELECTOR_ITEM_ROW_HEIGHT_PX;
}

export function windowSelectorRows(
	rows: SelectorListRow[],
	scrollTop: number,
	viewportHeight: number,
	overscan = SELECTOR_ROW_OVERSCAN
): SelectorRowWindow {
	if (rows.length === 0) return { rows: [], startOffset: 0, totalHeight: 0 };

	const offsets = new Array<number>(rows.length);
	let y = 0;
	for (let index = 0; index < rows.length; index++) {
		offsets[index] = y;
		const row = rows[index];
		if (row === undefined) continue;
		y += selectorRowHeight(row) + SELECTOR_ROW_GAP_PX;
	}
	const totalHeight = y - SELECTOR_ROW_GAP_PX;
	const view = viewportHeight > 0 ? viewportHeight : 480;
	const startY = Math.max(0, scrollTop - overscan * SELECTOR_ITEM_ROW_HEIGHT_PX);
	const endY = scrollTop + view + overscan * SELECTOR_ITEM_ROW_HEIGHT_PX;

	let start = 0;
	while (start < rows.length) {
		const row = rows[start];
		const offset = offsets[start];
		if (row === undefined || offset === undefined) break;
		if (offset + selectorRowHeight(row) > startY) break;
		start += 1;
	}

	let end = start;
	while (end < rows.length) {
		const offset = offsets[end];
		if (offset === undefined || offset >= endY) break;
		end += 1;
	}

	return {
		rows: rows.slice(start, end),
		startOffset: offsets[start] ?? 0,
		totalHeight
	};
}
