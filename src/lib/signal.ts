import type {
	DbcHandle,
	DbcMessageIdentity,
	DbcSignal,
	DecodedSignalSeries,
	RawSource
} from '@/lib/wasm';

/** How decoded values read. A DBC signal is its own format. */
export type SignalFormat = Pick<
	DbcSignal,
	'unit' | 'valueType' | 'factor' | 'offset' | 'minimum' | 'maximum' | 'valueDescriptions'
>;

/** One signal in the open catalogue, built once per DBC or trace change and keyed by `key`. */
export type Signal = {
	key: string;
	label: string;
	messageName: string;
	signalName: string;
	format: SignalFormat;
	sourceBadges?: string[];
	arbitrationId?: string;
	unavailableReason?: string;
} & (
	| {
			kind: 'dbc';
			fileId: string;
			handle: DbcHandle;
			message: DbcMessageIdentity;
			source?: RawSource;
	  }
	| { kind: 'mf4'; signalId: number }
);

export type PlotSignal = {
	key: string;
	color: string;
	signal: Signal;
	series: DecodedSignalSeries | null;
};

export type DecodedPlotSignal = PlotSignal & { series: DecodedSignalSeries };
