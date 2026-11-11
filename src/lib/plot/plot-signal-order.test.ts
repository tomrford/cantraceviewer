import { describe, expect, it } from 'vitest';

import { orderPlotSignals } from '@/lib/plot/plot-signal-order';
import type { PlotSignal, SignalFormat } from '@/lib/signal';

describe('orderPlotSignals', () => {
	it('preserves selection order by default', () => {
		const signals = [plotSignal('b', 'Msg.B'), plotSignal('a', 'Msg.A')];

		expect(orderPlotSignals(signals, 'selection').map(({ signal }) => signal.key)).toEqual([
			'b',
			'a'
		]);
	});

	it('sorts alphabetically by visible signal then message', () => {
		const signals = [
			plotSignal('engine-speed', 'Engine.Speed'),
			plotSignal('body-amps', 'Body.Amps'),
			plotSignal('powertrain-speed', 'Powertrain.Speed')
		];

		expect(orderPlotSignals(signals, 'alphabetical').map(({ signal }) => signal.key)).toEqual([
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

		expect(orderPlotSignals(signals, 'grouped').map(({ signal }) => signal.key)).toEqual([
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

		expect(orderPlotSignals(signals, 'grouped').map(({ signal }) => signal.key)).toEqual([
			'fine',
			'coarse'
		]);
	});

	it('groups equivalent value tables before scale and label', () => {
		const signals = [
			plotSignal('state-a', 'Msg.StateA', {
				valueDescriptions: [
					{ rawValue: 0, label: 'Off' },
					{ rawValue: 1, label: 'On' }
				]
			}),
			plotSignal('state-b', 'Msg.StateB', {
				valueDescriptions: [
					{ rawValue: 0, label: 'Park' },
					{ rawValue: 1, label: 'Drive' }
				]
			}),
			plotSignal('state-c', 'Msg.StateC', {
				factor: 2,
				valueDescriptions: [
					{ rawValue: 1, label: 'On' },
					{ rawValue: 0, label: 'Off' }
				]
			})
		];

		expect(orderPlotSignals(signals, 'grouped').map(({ signal }) => signal.key)).toEqual([
			'state-a',
			'state-c',
			'state-b'
		]);
	});
});

function plotSignal(key: string, label: string, format: Partial<SignalFormat> = {}): PlotSignal {
	const [messageName, signalName] = label.split('.');
	return {
		color: '#000000',
		series: null,
		signal: {
			kind: 'mf4',
			signalId: 0,
			key,
			label,
			messageName,
			signalName,
			format: {
				valueType: 'integer',
				factor: 1,
				offset: 0,
				minimum: 0,
				maximum: 1,
				unit: '',
				valueDescriptions: [],
				...format
			}
		}
	};
}
