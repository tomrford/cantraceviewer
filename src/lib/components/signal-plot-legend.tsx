import { useState, type DragEvent } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import { SourceBadge } from '#lib/components/source-badge.js';
import { Button, buttonVariants } from '#lib/components/ui/button.js';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '#lib/components/ui/menu.js';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue
} from '#lib/components/ui/select.js';
import { PRIMARY_Y_AXIS_ID, type YAxisId } from '#lib/plot-axes.js';
import {
	crosshairById,
	type LegendCrosshairMode,
	type PlotCrosshair
} from '#lib/plot-crosshair.js';
import { ratioInRange, valueAtRatio } from '#lib/plot-viewport.js';
import {
	crosshairDeltaValue,
	crosshairValue,
	formatAxisTime,
	formatAxisValue,
	formatTimeDelta,
	type LegendSignalValue,
	type SignalView
} from '#lib/signal-plot-data.js';
import {
	addAxis,
	assignAxis,
	assignToNewAxis,
	canAddAxis,
	removeAxis
} from '#lib/stores/plot-axes.js';
import { setLegendCrosshairMode } from '#lib/stores/plot-view.js';
import { cn } from '#lib/utils.js';
import type { PlotAxisView } from '#lib/stores/derive.js';
import { appStore, type AppState } from '#lib/stores/store.js';

/**
 * Plot legend: signals grouped by Y axis with crosshair readouts and axis management. Readouts
 * are selected per row and per axis header, so a crosshair drag re-renders only changed values.
 */
export function SignalPlotLegend() {
	const axes = useStore(appStore, (state) => state.plotModel.axes);
	const addable = useStore(appStore, canAddAxis);
	const hasC1 = useStore(appStore, (state) => crosshairById(state.crosshairs, 1) !== null);
	const hasC2 = useStore(appStore, (state) => crosshairById(state.crosshairs, 2) !== null);
	const mode = useStore(appStore, (state) => state.legendCrosshairMode);

	const options: { value: LegendCrosshairMode; label: string }[] = [];
	if (hasC1) options.push({ value: 'c1', label: 'Value at C1' });
	if (hasC2) options.push({ value: 'c2', label: 'Value at C2' });
	if (hasC1 && hasC2) options.push({ value: 'delta', label: 'Delta C2 − C1' });
	const multiAxis = axes.length > 1;

	return (
		<div
			className={cn(
				'absolute top-3 right-3 z-50 max-h-[calc(100%-1.5rem)] overflow-auto rounded-lg border border-border/70 bg-popover/90 p-3 text-popover-foreground shadow-sm backdrop-blur',
				multiAxis ? 'w-[22rem]' : 'w-80'
			)}
		>
			{options.length > 0 && (
				<div className="mb-3 flex items-center justify-between gap-2">
					<span className="text-xs font-medium text-muted-foreground">Legend values</span>
					<Select
						items={options}
						value={mode}
						onValueChange={(value) => value !== null && setLegendCrosshairMode(value)}
					>
						<SelectTrigger className="w-36">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{options.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			)}

			<div className={multiAxis ? 'space-y-1' : 'space-y-2'}>
				{axes.map((axis) => (
					<LegendAxisGroup key={axis.id} axis={axis} showHeader={multiAxis} />
				))}
			</div>

			{addable && (
				<button
					type="button"
					className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border py-1.5 text-xs text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
					onClick={() => addAxis()}
				>
					<Plus className="size-3.5" />
					Add Y axis
				</button>
			)}

			<LegendReadout multiAxis={multiAxis} />
		</div>
	);
}

/** The crosshair time/value line; the only legend part that follows crosshair positions. */
function LegendReadout({ multiAxis }: { multiAxis: boolean }) {
	const crosshairs = useStore(appStore, (state) => state.crosshairs);
	const mode = useStore(appStore, (state) => state.legendCrosshairMode);
	const timestampMode = useStore(appStore, (state) => state.timestampMode);
	const measurementStartMs = useStore(
		appStore,
		(state) => state.trace?.metadata.measurementStartMs
	);
	const c1 = crosshairById(crosshairs, 1);
	const c2 = crosshairById(crosshairs, 2);

	if (mode === 'delta' && c1 !== null && c2 !== null) {
		return (
			<div className="mt-2 font-mono text-xs text-muted-foreground tabular-nums">
				C2 − C1 · Δt {formatTimeDelta(c2.x - c1.x)}
				{multiAxis ? '' : ` · Δy ${yText(c2.y - c1.y)}`}
			</div>
		);
	}
	const active = mode === 'c1' ? c1 : mode === 'c2' ? c2 : null;
	if (active === null) return null;
	return (
		<div className="mt-2 font-mono text-xs text-muted-foreground tabular-nums">
			C{active.id} · {formatAxisTime(active.x, { measurementStartMs, mode: timestampMode })}
			{multiAxis ? '' : ` · y ${yText(active.y)}`}
		</div>
	);
}

function LegendAxisGroup({ axis, showHeader }: { axis: PlotAxisView; showHeader: boolean }) {
	const cursorText = useStore(appStore, (state) =>
		showHeader ? axisCursorText(state, axis.id) : null
	);
	const [dropActive, setDropActive] = useState(false);

	function allowDrop(event: DragEvent) {
		event.preventDefault();
		event.dataTransfer.dropEffect = 'move';
		setDropActive(true);
	}

	function drop(event: DragEvent) {
		event.preventDefault();
		setDropActive(false);
		const signalKey = event.dataTransfer.getData('text/plain');
		if (signalKey) assignAxis(signalKey, axis.id);
	}

	return (
		// A drop target for legend rows; the move menu is the keyboard path.
		// oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
		<div
			className={cn(
				'rounded-md',
				showHeader && 'border border-transparent p-1.5',
				dropActive && 'border-dashed border-ring! bg-accent/40'
			)}
			// A div keeps the block layout that a fieldset would change.
			// oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
			role="group"
			aria-label={axis.label}
			onDragOver={allowDrop}
			onDragLeave={() => setDropActive(false)}
			onDrop={drop}
		>
			{showHeader && (
				<div className="mb-1.5 flex items-center gap-2 text-xs">
					<span className="rounded-sm bg-muted-foreground px-1 font-mono text-[0.625rem] leading-4 font-semibold text-background">
						Y{axis.index + 1}
					</span>
					<span className="min-w-0 flex-1 truncate text-muted-foreground">{axis.unit ?? ''}</span>
					{cursorText !== null && (
						<span className="font-mono text-muted-foreground tabular-nums">{cursorText}</span>
					)}
					{axis.index !== 0 && (
						<Button
							variant="ghost"
							size="icon"
							className="-mr-1 size-5 text-muted-foreground hover:text-destructive"
							aria-label={`Remove ${axis.label}`}
							onClick={() => removeAxis(axis.id)}
						>
							<Trash2 className="size-3" />
						</Button>
					)}
				</div>
			)}

			{axis.signals.length === 0 ? (
				<p className="px-1 py-2 text-xs text-muted-foreground italic">Drag or move signals here.</p>
			) : (
				<ul className="space-y-2">
					{axis.signals.map((view) => (
						<LegendSignalRow key={view.key} view={view} axisId={axis.id} />
					))}
				</ul>
			)}
		</div>
	);
}

function LegendSignalRow({ view, axisId }: { view: SignalView; axisId: YAxisId }) {
	// Neither field changes during a crosshair drag, so only `value` follows the drag.
	const axes = useStore(appStore, (state) => state.plotModel.axes);
	const addable = useStore(appStore, canAddAxis);
	const value = useStore(
		appStore,
		useShallow((state) => legendValue(view, state.crosshairs, state.legendCrosshairMode))
	);
	const movable = axes.length > 1;
	const triggerId = `move-signal-${view.key}`;

	function startDrag(event: DragEvent) {
		if (!movable) return;
		event.dataTransfer.setData('text/plain', view.key);
		event.dataTransfer.effectAllowed = 'move';
	}

	return (
		// Rows drag onto other axis groups; the move menu is the keyboard path.
		// oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
		<li
			className={cn(
				'grid min-w-0 items-center gap-2 rounded-sm text-xs',
				movable
					? value !== null
						? 'grid-cols-[1.25rem_0.75rem_minmax(0,1fr)_auto]'
						: 'grid-cols-[1.25rem_0.75rem_minmax(0,1fr)]'
					: value !== null
						? 'grid-cols-[0.75rem_minmax(0,1fr)_auto]'
						: 'grid-cols-[0.75rem_minmax(0,1fr)]'
			)}
			draggable={movable}
			onDragStart={startDrag}
		>
			{movable && (
				<Menu>
					<MenuTrigger
						id={triggerId}
						className={cn(
							buttonVariants({ variant: 'ghost', size: 'icon' }),
							'size-5 cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing'
						)}
						aria-label={`Move ${view.label} to another Y axis`}
					>
						<GripVertical className="size-3.5" />
					</MenuTrigger>
					<MenuContent
						align="start"
						className="w-48"
						// Moving axes remounts the row; let the menu restore focus to its new trigger.
						finalFocus={() => document.getElementById(triggerId)}
					>
						<div className="px-2 py-1 text-xs font-medium text-muted-foreground">Move to</div>
						{axes.map((target) => (
							<MenuItem
								key={target.id}
								className="h-6 font-normal [&_svg]:size-3"
								disabled={target.id === axisId}
								onClick={() => assignAxis(view.key, target.id)}
							>
								{target.label}
							</MenuItem>
						))}
						{addable && (
							<MenuItem
								className="h-6 font-normal [&_svg]:size-3"
								onClick={() => assignToNewAxis(view.key)}
							>
								<Plus />
								New Y axis
							</MenuItem>
						)}
					</MenuContent>
				</Menu>
			)}

			<span className="size-2 rounded-full" style={{ backgroundColor: view.color }} />
			<span className="flex min-w-0 items-center gap-1" title={view.label} aria-label={view.label}>
				<span className="min-w-0 flex-[0_1_max-content] truncate">{view.signalName}</span>
				<span className="text-muted-foreground">&nbsp;(</span>
				<span className="min-w-0 flex-[0_9999_auto] truncate text-muted-foreground">
					{view.messageName}
				</span>
				<span className="text-muted-foreground">)</span>
				{view.sourceBadges?.map((badge) => (
					<SourceBadge key={badge}>{badge}</SourceBadge>
				))}
			</span>
			{value !== null && (
				<span
					className={cn('font-mono tabular-nums', value.outOfRange && 'text-destructive')}
					title={
						value.outOfRange ? `Outside DBC range [${view.minimum}, ${view.maximum}]` : undefined
					}
				>
					{value.text}
				</span>
			)}
		</li>
	);
}

function legendValue(
	view: SignalView,
	crosshairs: PlotCrosshair[],
	mode: LegendCrosshairMode
): LegendSignalValue | null {
	const c1 = crosshairById(crosshairs, 1);
	const c2 = crosshairById(crosshairs, 2);
	if (mode === 'delta' && c1 !== null && c2 !== null) return crosshairDeltaValue(view, c1.x, c2.x);
	const crosshair = mode === 'c2' ? c2 : c1;
	return crosshair === null ? null : crosshairValue(view, crosshair.x);
}

function axisCursorText(state: AppState, axisId: YAxisId) {
	const range = state.axisRanges.get(axisId);
	const primaryRange = state.axisRanges.get(PRIMARY_Y_AXIS_ID);
	if (range === undefined || primaryRange === undefined) return null;
	const c1 = crosshairById(state.crosshairs, 1);
	const c2 = crosshairById(state.crosshairs, 2);

	if (state.legendCrosshairMode === 'delta') {
		if (c1 === null || c2 === null) return null;
		const rowSpan = ratioInRange(primaryRange, c1.y) - ratioInRange(primaryRange, c2.y);
		return `Δy ${yText(rowSpan * (range.max - range.min))}`;
	}

	const active = state.legendCrosshairMode === 'c1' ? c1 : c2;
	if (active === null) return null;
	return `y ${yText(valueAtRatio(range, ratioInRange(primaryRange, active.y)))}`;
}

function yText(value: number): string {
	return formatAxisValue(value) ?? '-';
}
