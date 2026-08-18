import { describe, expect, it } from 'vitest';
import {
	SELECTOR_DBC_ROW_HEIGHT_PX,
	SELECTOR_ITEM_ROW_HEIGHT_PX,
	SELECTOR_ROW_GAP_PX,
	flattenSelectorTree,
	windowSelectorRows,
	type SelectorListDbc
} from './selector-list';

function dbc(overrides: Partial<SelectorListDbc> = {}): SelectorListDbc {
	return {
		id: 'dbc-1',
		name: 'powertrain',
		expanded: false,
		kind: 'dbc',
		transient: false,
		messages: [
			{
				key: 'msg-1',
				name: 'PowertrainStatus',
				expanded: false,
				signals: [
					{ key: 'sig-1', label: 'PowertrainStatus.Speed', signalName: 'Speed' },
					{ key: 'sig-2', label: 'PowertrainStatus.Rpm', signalName: 'Rpm' }
				]
			}
		],
		...overrides
	};
}

describe('flattenSelectorTree', () => {
	it('omits children of collapsed nodes', () => {
		expect(flattenSelectorTree([dbc()]).map((row) => row.kind)).toEqual(['dbc']);
		expect(
			flattenSelectorTree([dbc({ expanded: true })]).map((row) =>
				row.kind === 'signal' ? row.signal.signalName : row.kind
			)
		).toEqual(['dbc', 'message']);
	});

	it('includes expanded signal rows', () => {
		const tree = dbc({
			expanded: true,
			messages: [
				{
					key: 'msg-1',
					name: 'PowertrainStatus',
					expanded: true,
					signals: [
						{ key: 'sig-1', label: 'PowertrainStatus.Speed', signalName: 'Speed' },
						{ key: 'sig-2', label: 'PowertrainStatus.Rpm', signalName: 'Rpm' }
					]
				}
			]
		});

		expect(flattenSelectorTree([tree]).map((row) => row.kind)).toEqual([
			'dbc',
			'message',
			'signal',
			'signal'
		]);
	});
});

describe('windowSelectorRows', () => {
	it('keeps the full result list in the scroll height and only a viewport slice in the window', () => {
		const files: SelectorListDbc[] = [
			{
				id: 'dbc-1',
				name: 'body',
				expanded: true,
				kind: 'dbc',
				transient: false,
				messages: Array.from({ length: 40 }, (_, messageIndex) => ({
					key: `msg-${messageIndex}`,
					name: `Message${messageIndex}`,
					expanded: true,
					signals: [
						{
							key: `sig-${messageIndex}`,
							label: `Message${messageIndex}.Value`,
							signalName: 'Value'
						}
					]
				}))
			}
		];
		const rows = flattenSelectorTree(files);
		expect(rows).toHaveLength(81);

		const window = windowSelectorRows(rows, 0, SELECTOR_DBC_ROW_HEIGHT_PX + 80, 0);
		expect(window.totalHeight).toBe(
			SELECTOR_DBC_ROW_HEIGHT_PX + 80 * (SELECTOR_ITEM_ROW_HEIGHT_PX + SELECTOR_ROW_GAP_PX)
		);
		expect(window.rows.length).toBeLessThan(rows.length);
		expect(window.rows[0]?.kind).toBe('dbc');
	});
});
