import { describe, expect, it } from 'vitest';
import { orderPlotSignals, type LegendOrderMode } from './plot-signal-order.js';
import type { PlotSignal } from './stores/plot-data.svelte.js';

describe('orderPlotSignals', () => {
	it('preserves selection order by default', () => {
		const signals = [plotSignal('b', 'Msg.B'), plotSignal('a', 'Msg.A')];

		expect(orderPlotSignals(signals, 'selection').map((signal) => signal.key)).toEqual(['b', 'a']);
	});

	it('falls back to selection order for an unknown persisted mode', () => {
		const signals = [plotSignal('b', 'Msg.B'), plotSignal('a', 'Msg.A')];

		expect(
			orderPlotSignals(signals, 'stale-mode' as LegendOrderMode).map((signal) => signal.key)
		).toEqual(['b', 'a']);
	});

	it('sorts alphabetically by visible signal then message', () => {
		const signals = [
			plotSignal('engine-speed', 'Engine.Speed'),
			plotSignal('body-amps', 'Body.Amps'),
			plotSignal('powertrain-speed', 'Powertrain.Speed')
		];

		expect(orderPlotSignals(signals, 'alphabetical').map((signal) => signal.key)).toEqual([
			'body-amps',
			'engine-speed',
			'powertrain-speed'
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

		expect(orderPlotSignals(signals, 'grouped').map((signal) => signal.key)).toEqual([
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

		expect(orderPlotSignals(signals, 'grouped').map((signal) => signal.key)).toEqual([
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
		messageName: label.split('.')[0] ?? label,
		signalName: label.split('.')[1] ?? label,
		factor: overrides.factor ?? 1,
		offset: overrides.offset ?? 0,
		minimum: 0,
		maximum: 1,
		unit: overrides.unit ?? '',
		valueDescriptions: [],
		series: null
	};
}
