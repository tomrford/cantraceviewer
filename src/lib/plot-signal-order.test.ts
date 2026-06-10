import { describe, expect, it } from 'vitest';
import { orderPlotSignals } from './plot-signal-order.js';
import type { PlotSignal } from './stores/plot-data.svelte.js';

describe('orderPlotSignals', () => {
	it('preserves selection order by default', () => {
		const signals = [plotSignal('b', 'Msg.B'), plotSignal('a', 'Msg.A')];
		const selectionOrder = new Map([
			['b', 0],
			['a', 1]
		]);

		expect(orderPlotSignals(signals, 'selection', selectionOrder).map((signal) => signal.key)).toEqual([
			'b',
			'a'
		]);
	});

	it('sorts alphabetically by label', () => {
		const signals = [
			plotSignal('z', 'Zeta.Z'),
			plotSignal('a', 'Alpha.A'),
			plotSignal('m', 'Middle.M')
		];

		expect(orderPlotSignals(signals, 'alphabetical', new Map()).map((signal) => signal.label)).toEqual([
			'Alpha.A',
			'Middle.M',
			'Zeta.Z'
		]);
	});

	it('groups by unit, then scale, then label', () => {
		const signals = [
			plotSignal('rpm-b', 'Engine.RpmB', { unit: 'rpm', factor: 1, offset: 0 }),
			plotSignal('temp-b', 'Powertrain.TempB', { unit: 'degC', factor: 1, offset: -40 }),
			plotSignal('temp-a', 'Powertrain.TempA', { unit: 'degC', factor: 1, offset: -40 }),
			plotSignal('speed', 'Powertrain.Speed', { unit: 'km/h', factor: 0.1, offset: 0 }),
			plotSignal('rpm-a', 'Engine.RpmA', { unit: 'rpm', factor: 1, offset: 0 })
		];

		expect(orderPlotSignals(signals, 'grouped', new Map()).map((signal) => signal.key)).toEqual([
			'temp-a',
			'temp-b',
			'speed',
			'rpm-a',
			'rpm-b'
		]);
	});

	it('uses scale before label when units match', () => {
		const signals = [
			plotSignal('fine', 'Msg.Fine', { unit: 'V', factor: 0.01, offset: 0 }),
			plotSignal('coarse', 'Msg.Coarse', { unit: 'V', factor: 0.1, offset: 0 })
		];

		expect(orderPlotSignals(signals, 'grouped', new Map()).map((signal) => signal.key)).toEqual([
			'fine',
			'coarse'
		]);
	});
});

function plotSignal(
	key: string,
	label: string,
	overrides: Partial<Pick<PlotSignal, 'unit' | 'factor' | 'offset'>> = {}
): PlotSignal {
	return {
		key,
		label,
		color: '#000000',
		dbcFileId: 'dbc-1',
		dbcName: 'demo.dbc',
		sourceFileName: 'demo.dbc',
		messageName: label.split('.')[0] ?? label,
		signalName: label.split('.')[1] ?? label,
		canId: 1,
		dbcId: 1,
		isExtended: false,
		isFd: false,
		sizeBytes: 8,
		transmitter: 'ECU',
		startBit: 0,
		bitLength: 16,
		endianness: 'intel',
		signedness: 'unsigned',
		factor: overrides.factor ?? 1,
		offset: overrides.offset ?? 0,
		minimum: 0,
		maximum: 1,
		unit: overrides.unit ?? '',
		valueType: 'integer',
		receivers: [],
		valueDescriptions: [],
		series: null,
		isDecoding: false,
		decodeError: null
	};
}
