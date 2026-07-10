import { describe, expect, it } from 'vitest';
import { buildMf4SignalTargetIndex, mf4SelectorFiles, mf4SignalIdentityKey } from './mf4-signals';
import type { TraceHandle } from './wasm';

describe('MF4 signal sources', () => {
	it('projects native channels as a marked transient selector source', () => {
		const trace = mf4Trace();

		expect(mf4SelectorFiles(trace)).toEqual([
			{
				id: 'mf4:17:native',
				name: 'Decoded signals',
				kind: 'mf4-native',
				transient: true,
				messages: [
					{
						key: JSON.stringify(['mf4', 17, 'group', 0]),
						name: 'Powertrain',
						signals: [
							{
								key: mf4SignalIdentityKey(17, 3),
								label: 'Powertrain.Speed',
								messageName: 'Powertrain',
								signalName: 'Speed'
							}
						]
					}
				]
			}
		]);
	});

	it('indexes native identity by trace and MDF signal id', () => {
		const trace = mf4Trace();
		const target = buildMf4SignalTargetIndex(trace)[mf4SignalIdentityKey(17, 3)];

		expect(target).toMatchObject({
			trace,
			group: { name: 'Powertrain' },
			signal: { id: 3, name: 'Speed', unit: 'km/h' }
		});
	});
});

function mf4Trace(): TraceHandle {
	return {
		id: 17,
		hasRawFrames: false,
		mf4Catalog: {
			groups: [
				{
					name: 'Powertrain',
					signals: [{ id: 3, name: 'Speed', unit: 'km/h' }]
				}
			]
		},
		embeddedDbcs: [],
		warnings: [],
		metadata: {
			measurementStartMs: null,
			validMessageCount: 0,
			skippedLineCount: 0,
			durationNs: 1
		}
	} as unknown as TraceHandle;
}
