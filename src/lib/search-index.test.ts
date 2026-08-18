import { describe, expect, it } from 'vitest';
import { createSearchIndex, searchIndex } from './search-index';

const signals = [
	{ messageName: 'Message', signalName: 'Signal' },
	{ messageName: 'SpeedMessage', signalName: 'VehicleSpeed' },
	{ messageName: 'PowertrainStatus', signalName: 'vehicle_speed' },
	{ messageName: 'EngineStatus', signalName: 'EngineRpm' },
	{ messageName: 'VehicleAcceleration', signalName: 'LongitudinalAccel' },
	{ messageName: 'VeryLongUnrelatedSignal', signalName: 'Other' }
];

const index = createSearchIndex(signals, (signal) => `${signal.messageName}.${signal.signalName}`);

function search(query: string): string[] {
	return searchIndex(index, query).map((signal) => `${signal.messageName}.${signal.signalName}`);
}

describe('searchIndex', () => {
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

	it('matches names normally while keeping one- and two-digit identifiers exact', () => {
		const withIds = createSearchIndex(
			[
				{ label: 'Cruise.WheelBasedSpeed', arbitrationId: '18fef100' },
				{ label: 'Status.EngineRpm', arbitrationId: '101' },
				{ label: 'EEC1.EngineSpeed', arbitrationId: 'cf00400' }
			],
			(item) => item.label,
			(item) => item.arbitrationId
		);
		const labels = (query: string) => searchIndex(withIds, query).map((item) => item.label);

		expect(labels('b')).toEqual(['Cruise.WheelBasedSpeed']);
		expect(labels('101')).toEqual(['Status.EngineRpm']);
		expect(labels('fef100')).toEqual(['Cruise.WheelBasedSpeed']);
		expect(labels('0x18fef100')).toEqual(['Cruise.WheelBasedSpeed']);
		expect(labels('0cf00400')).toEqual(['EEC1.EngineSpeed']);
		expect(labels('0x0cf00400')).toEqual(['EEC1.EngineSpeed']);
		expect(labels('18')).toEqual([]);
	});
});
