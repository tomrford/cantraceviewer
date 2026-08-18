import { describe, expect, it } from 'vitest';
import { createFuzzySearchIndex, searchFuzzyIndex } from './fuzzy-match';

const signals = [
	{ messageName: 'Message', signalName: 'Signal' },
	{ messageName: 'SpeedMessage', signalName: 'VehicleSpeed' },
	{ messageName: 'PowertrainStatus', signalName: 'vehicle_speed' },
	{ messageName: 'EngineStatus', signalName: 'EngineRpm' },
	{ messageName: 'VehicleAcceleration', signalName: 'LongitudinalAccel' },
	{ messageName: 'VeryLongUnrelatedSignal', signalName: 'Other' }
];

const index = createFuzzySearchIndex(
	signals,
	(signal) => `${signal.messageName}.${signal.signalName}`
);

function search(query: string): string[] {
	return searchFuzzyIndex(index, query).map(
		(signal) => `${signal.messageName}.${signal.signalName}`
	);
}

describe('searchFuzzyIndex', () => {
	it('returns all items for an empty query', () => {
		expect(search('')).toEqual([
			'Message.Signal',
			'SpeedMessage.VehicleSpeed',
			'PowertrainStatus.vehicle_speed',
			'EngineStatus.EngineRpm',
			'VehicleAcceleration.LongitudinalAccel',
			'VeryLongUnrelatedSignal.Other'
		]);
		expect(search('   ')).toHaveLength(signals.length);
	});

	it('matches name substrings and ANDs whitespace-separated terms', () => {
		expect(search('vehicle speed')).toEqual([
			'SpeedMessage.VehicleSpeed',
			'PowertrainStatus.vehicle_speed'
		]);
		expect(search('status')).toEqual(['PowertrainStatus.vehicle_speed', 'EngineStatus.EngineRpm']);
		expect(search('veh')).toEqual([
			'SpeedMessage.VehicleSpeed',
			'PowertrainStatus.vehicle_speed',
			'VehicleAcceleration.LongitudinalAccel'
		]);
		expect(search('message.sign')).toEqual(['Message.Signal']);
	});

	it('matches hex subsets and keeps one- and two-digit hex exact', () => {
		const withIds = createFuzzySearchIndex(
			[
				{ label: 'Cruise.WheelBasedSpeed', searchText: 'Cruise.WheelBasedSpeed 18fef100' },
				{ label: 'Status.EngineRpm', searchText: 'PowertrainStatus.EngineRpm 101' }
			],
			(item) => item.searchText
		);
		const labels = (query: string) => searchFuzzyIndex(withIds, query).map((item) => item.label);

		expect(labels('fef100')).toEqual(['Cruise.WheelBasedSpeed']);
		expect(labels('0x18fef100')).toEqual(['Cruise.WheelBasedSpeed']);
		expect(labels('18')).toEqual([]);
	});
});
