import { describe, expect, it } from 'vitest';
import { rankedFuzzySearch } from './fuzzy-match';

const signals = [
	{ messageName: 'Message', signalName: 'Signal' },
	{ messageName: 'SpeedMessage', signalName: 'VehicleSpeed' },
	{ messageName: 'PowertrainStatus', signalName: 'vehicle_speed' },
	{ messageName: 'EngineStatus', signalName: 'EngineRpm' },
	{ messageName: 'VehicleAcceleration', signalName: 'LongitudinalAccel' },
	{ messageName: 'VeryLongUnrelatedSignal', signalName: 'Other' }
];

function search(query: string): string[] {
	return rankedFuzzySearch(
		signals,
		query,
		(signal) => `${signal.messageName}.${signal.signalName}`
	).map((signal) => `${signal.messageName}.${signal.signalName}`);
}

describe('rankedFuzzySearch', () => {
	it('uses MiniSearch token matching with camel and separator boundaries', () => {
		expect(search('vehicle speed')).toEqual(
			expect.arrayContaining(['SpeedMessage.VehicleSpeed', 'PowertrainStatus.vehicle_speed'])
		);
		expect(search('status')).toEqual(
			expect.arrayContaining(['PowertrainStatus.vehicle_speed', 'EngineStatus.EngineRpm'])
		);
	});

	it('keeps partial fuzzy searches useful', () => {
		expect(search('s')).toEqual(
			expect.arrayContaining([
				'Message.Signal',
				'SpeedMessage.VehicleSpeed',
				'PowertrainStatus.vehicle_speed'
			])
		);
		expect(search('veh')).toEqual(
			expect.arrayContaining([
				'SpeedMessage.VehicleSpeed',
				'PowertrainStatus.vehicle_speed',
				'VehicleAcceleration.LongitudinalAccel'
			])
		);
		expect(search('veh')).not.toContain('VeryLongUnrelatedSignal.Other');
	});

	it('supports full label searches across message and signal names', () => {
		expect(search('message.sign')[0]).toBe('Message.Signal');
		expect(search('age.sign')).toEqual([]);
	});

	it('keeps a little typo tolerance without broadening short abbreviations', () => {
		expect(search('vehcile')).toEqual(
			expect.arrayContaining([
				'SpeedMessage.VehicleSpeed',
				'PowertrainStatus.vehicle_speed',
				'VehicleAcceleration.LongitudinalAccel'
			])
		);
		expect(search('vhc')).toEqual([]);
	});
});
