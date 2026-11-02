import { GripVertical, Plus, Trash2 } from 'lucide-react';
import { useState, type DragEvent, type KeyboardEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { SourceBadge } from '#lib/components/source-badge.js';
import { Button, buttonVariants } from '#lib/components/ui/button.js';
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger
} from '#lib/components/ui/context-menu.js';
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
import type { PlotAxisView } from '#lib/stores/derive.js';
import {
	addAxis,
	assignAxis,
	assignToNewAxis,
	canAddAxis,
	removeAxis
} from '#lib/stores/plot-axes.js';
import { setLegendCrosshairMode } from '#lib/stores/plot-view.js';
import { useAppStore, type AppState } from '#lib/stores/store.js';
import { cn } from '#lib/utils.js';

/**
 * Plot legend: signals grouped by Y axis with crosshair readouts and axis management. Readouts
 * are selected per row and per axis header, so a crosshair drag re-renders only changed values.
 */
export function SignalPlotLegend() {
	const axes = useAppStore((s) => s.plotModel.axes);
	const addable = useAppStore(canAddAxis);
	const hasC1 = useAppStore((s) => crosshairById(s.crosshairs, 1) !== null);
	const hasC2 = useAppStore((s) => crosshairById(s.crosshairs, 2) !== null);
	const mode = useAppStore((s) => s.legendCrosshairMode);
	const [moveSignalKey, setMoveSignalKey] = useState<string | null>(null);

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

			{/* Keep the menu mounted while a move reparents its trigger into another axis. */}
			<ContextMenu>
				<div className={multiAxis ? 'space-y-1' : 'space-y-2'}>
					{axes.map((axis) => (
						<LegendAxisGroup
							key={axis.id}
							axis={axis}
							showHeader={multiAxis}
							onMoveMenu={setMoveSignalKey}
						/>
					))}
				</div>
				{moveSignalKey !== null && (
					<ContextMenuContent
						align="start"
						className="w-48"
						aria-label="Move signal to another Y axis"
						// Moving axes remounts the row; let the menu restore focus to its new trigger.
						finalFocus={() => document.getElementById(moveTriggerId(moveSignalKey))}
					>
						<div className="px-2 py-1 text-xs font-medium text-muted-foreground">Move to</div>
						{axes.map((target) => (
							<ContextMenuItem
								key={target.id}
								className="h-6 font-normal [&_svg]:size-3"
								disabled={target.signals.some((signal) => signal.key === moveSignalKey)}
								onClick={() => assignAxis(moveSignalKey, target.id)}
							>
								{target.label}
							</ContextMenuItem>
						))}
						{addable && (
							<ContextMenuItem
								className="h-6 font-normal [&_svg]:size-3"
								onClick={() => assignToNewAxis(moveSignalKey)}
							>
								<Plus />
								New Y axis
							</ContextMenuItem>
						)}
					</ContextMenuContent>
				)}
			</ContextMenu>

			{addable && (
				<Button variant="outline" className="mt-2 w-full" onClick={() => addAxis()}>
					<Plus data-icon="inline-start" />
					Add Y axis
				</Button>
			)}

			<LegendReadout multiAxis={multiAxis} />
		</div>
	);
}

/** The crosshair time/value line; the only legend part that follows crosshair positions. */
function LegendReadout({ multiAxis }: { multiAxis: boolean }) {
	const crosshairs = useAppStore((s) => s.crosshairs);
	const mode = useAppStore((s) => s.legendCrosshairMode);
	const timestampMode = useAppStore((s) => s.timestampMode);
	const measurementStartMs = useAppStore((s) => s.trace?.metadata.measurementStartMs);
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

function LegendAxisGroup({
	axis,
	showHeader,
	onMoveMenu
}: {
	axis: PlotAxisView;
	showHeader: boolean;
	onMoveMenu: (key: string) => void;
}) {
	const cursorText = useAppStore((s) => (showHeader ? axisCursorText(s, axis.id) : null));
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
							variant="ghost-destructive"
							size="icon-xs"
							className="-mr-1"
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
						<LegendSignalRow key={view.key} view={view} onMoveMenu={onMoveMenu} />
					))}
				</ul>
			)}
		</div>
	);
}

function LegendSignalRow({
	view,
	onMoveMenu
}: {
	view: SignalView;
	onMoveMenu: (key: string) => void;
}) {
	// Only `value` follows a crosshair drag; `movable` is a boolean, so axis edits elsewhere don't re-render the row.
	const movable = useAppStore((s) => s.plotModel.axes.length > 1);
	const value = useAppStore(
		useShallow((s) => legendValue(view, s.crosshairs, s.legendCrosshairMode))
	);

	function startDrag(event: DragEvent) {
		if (!movable) return;
		event.dataTransfer.setData('text/plain', view.key);
		event.dataTransfer.effectAllowed = 'move';
		// Only the grip starts a drag, but what follows the pointer is the whole row.
		const row = event.currentTarget.closest('li');
		if (!row) return;
		const { left, top } = row.getBoundingClientRect();
		event.dataTransfer.setDragImage(row, event.clientX - left, event.clientY - top);
	}

	function openMoveMenuFromKey(event: KeyboardEvent<HTMLElement>) {
		if (
			event.key !== 'Enter' &&
			event.key !== ' ' &&
			event.key !== 'ContextMenu' &&
			!(event.shiftKey && event.key === 'F10')
		)
			return;
		event.preventDefault();
		// Base UI's context trigger handles pointer events only. Use the same path for keyboard
		// activation, anchored to the grip instead of the last mouse position.
		const rect = event.currentTarget.getBoundingClientRect();
		event.currentTarget.dispatchEvent(
			new MouseEvent('contextmenu', {
				bubbles: true,
				cancelable: true,
				clientX: rect.left,
				clientY: rect.bottom
			})
		);
	}

	return (
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
		>
			{movable && (
				<ContextMenuTrigger
					render={<button type="button" aria-label={`Move ${view.label} to another Y axis`} />}
					id={moveTriggerId(view.key)}
					draggable
					onDragStart={startDrag}
					onContextMenu={() => onMoveMenu(view.key)}
					onTouchStart={() => onMoveMenu(view.key)}
					onKeyDown={openMoveMenuFromKey}
					aria-haspopup="menu"
					title="Drag to another Y axis; right-click or press Enter for move options"
					className={cn(
						buttonVariants({ variant: 'ghost', size: 'icon' }),
						'size-5 cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing'
					)}
				>
					<GripVertical className="size-3.5" />
				</ContextMenuTrigger>
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

function moveTriggerId(signalKey: string): string {
	return `move-signal-${signalKey}`;
}
