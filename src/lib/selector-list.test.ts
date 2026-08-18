import { describe, expect, it } from 'vitest';
import { flattenSelectorTree, type SelectorListDbc } from './selector-list';

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
