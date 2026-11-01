import { useStore } from 'zustand';
import { PRIMARY_Y_AXIS_ID } from '#lib/plot-axes.js';
import {
	axisGutterOffset,
	axisTicks,
	axisTicksAtRatios,
	Y_AXIS_GUTTER,
	type AxisTickGenerator
} from '#lib/plot-axis-layout.js';
import { formatAxisValue } from '#lib/signal-plot-data.js';
import { plotModel } from '#lib/stores/plot-model.js';
import { plotView } from '#lib/stores/plot-view.js';

/** Y-axis gutters with tick labels; secondary axes put their ticks at the primary tick ratios. */
export function SignalPlotAxes({ generateTicks }: { generateTicks: AxisTickGenerator }) {
	const axes = useStore(plotModel, (state) => state.gutterAxes);
	const numbered = useStore(plotModel, (state) => state.axes.length > 1);
	const grid = useStore(plotModel, (state) => state.grid);
	const ranges = useStore(plotView, (state) => state.axisRanges);

	const primaryTicks = axisTicks(ranges.get(PRIMARY_Y_AXIS_ID) ?? null, generateTicks);
	const ratios = primaryTicks.map((tick) => tick.ratio);

	return (
		<div className="pointer-events-none absolute inset-0 z-20">
			{axes.map((axis, position) => {
				const ticks =
					axis.id === PRIMARY_Y_AXIS_ID
						? primaryTicks
						: axisTicksAtRatios(ranges.get(axis.id) ?? null, ratios);
				return (
					<div
						key={axis.id}
						className="absolute"
						style={{
							left: axisGutterOffset(position, axes.length),
							width: Y_AXIS_GUTTER,
							top: grid.top,
							bottom: grid.bottom
						}}
						role="presentation"
						// role=presentation with a label keeps the accessibility tree unchanged.
						// oxlint-disable-next-line jsx-a11y/role-supports-aria-props
						aria-label={axis.label}
					>
						<span className="absolute inset-y-0 right-0 border-r border-border" />
						{ticks.map((tick) => {
							const text = formatAxisValue(tick.value);
							return (
								text !== null && (
									<span
										key={tick.ratio}
										className="absolute right-2.5 -translate-y-1/2 font-mono text-xs leading-none text-muted-foreground tabular-nums"
										style={{ top: `${tick.ratio * 100}%` }}
									>
										{text}
									</span>
								)
							);
						})}
						{numbered && (
							<span
								className="absolute top-full right-2.5 mt-2 rounded-sm bg-muted-foreground px-1 font-mono text-[0.625rem] leading-4 font-semibold text-background"
								title={axis.label}
							>
								Y{axis.index + 1}
							</span>
						)}
					</div>
				);
			})}
		</div>
	);
}
