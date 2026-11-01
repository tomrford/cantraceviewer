import { useState, type ReactElement } from 'react';
import { Crosshair, Expand, List, Minus, Plus, SquareDashed, X } from 'lucide-react';
import { useStore } from 'zustand';
import { ShortcutKey } from '#lib/components/shortcut-key.js';
import { Button, buttonVariants } from '#lib/components/ui/button.js';
import { ButtonGroup } from '#lib/components/ui/button-group.js';
import { Popover, PopoverContent, PopoverTrigger } from '#lib/components/ui/popover.js';
import { Toggle } from '#lib/components/ui/toggle.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '#lib/components/ui/tooltip.js';
import type { ShortcutAction } from '#lib/keyboard-shortcuts.js';
import { crosshairById, type CrosshairId } from '#lib/plot-crosshair.js';
import {
	clearCrosshairs,
	placeCrosshair,
	plotView,
	resetZoom,
	setBoxZoomEnabled,
	setLegendVisible,
	zoomBy
} from '#lib/stores/plot-view.js';
import { cn } from '#lib/utils.js';

const toolbarIconButtonClass =
	'border-input bg-transparent hover:bg-muted hover:text-foreground dark:bg-transparent dark:hover:bg-muted/50';

// Only booleans are selected so panning, zooming and crosshair drags never re-render the toolbar.
export function PlotToolbar({ disabled }: { disabled: boolean }) {
	const isFitAll = useStore(plotView, (s) => s.isFitAll);
	const boxZoomEnabled = useStore(plotView, (s) => s.boxZoomEnabled);
	const legendVisible = useStore(plotView, (s) => s.legendVisible);
	const canPlaceCrosshair = useStore(plotView, (s) => s.activeViewport !== null);
	const hasC1 = useStore(plotView, (s) => crosshairById(s.crosshairs, 1) !== null);
	const hasC2 = useStore(plotView, (s) => crosshairById(s.crosshairs, 2) !== null);
	const hasCrosshairs = hasC1 || hasC2;
	const [crosshairMenuOpen, setCrosshairMenuOpen] = useState(false);

	function closeMenuAfter(action: () => void): void {
		setCrosshairMenuOpen(false);
		action();
	}

	const boxZoomLabel = boxZoomEnabled ? 'Use drag pan' : 'Use box zoom';
	const legendLabel = legendVisible ? 'Hide legend' : 'Show legend';

	return (
		<>
			<ButtonGroup aria-label="Plot zoom controls">
				<ZoomButton label="Zoom in" action="zoomIn" disabled={disabled} onClick={() => zoomBy(0.5)}>
					<Plus className="size-3.5" />
				</ZoomButton>
				<ZoomButton label="Zoom out" action="zoomOut" disabled={disabled} onClick={() => zoomBy(2)}>
					<Minus className="size-3.5" />
				</ZoomButton>
				<ZoomButton
					label="Zoom to full extent"
					action="resetZoom"
					disabled={disabled || isFitAll}
					onClick={resetZoom}
				>
					<Expand className="size-3.5" />
				</ZoomButton>
			</ButtonGroup>
			<ButtonGroup aria-label="Plot display controls">
				<DisplayToggle
					label={boxZoomLabel}
					action="toggleBoxZoom"
					pressed={boxZoomEnabled}
					onPressedChange={setBoxZoomEnabled}
					disabled={disabled}
				>
					<SquareDashed className="size-3.5" />
				</DisplayToggle>
				<Popover open={crosshairMenuOpen} onOpenChange={setCrosshairMenuOpen}>
					<ToolbarTooltip label="Crosshairs">
						<PopoverTrigger
							className={cn(
								buttonVariants({ variant: 'outline', size: 'default' }),
								toolbarIconButtonClass,
								hasCrosshairs && 'bg-muted text-foreground'
							)}
							disabled={disabled}
							aria-label="Manage crosshairs"
						>
							<Crosshair className="size-3.5" />
						</PopoverTrigger>
					</ToolbarTooltip>
					<PopoverContent align="end" className="w-52 gap-1 p-1.5">
						<CrosshairMenuItem
							id={1}
							placed={hasC1}
							disabled={!canPlaceCrosshair}
							onClick={() => closeMenuAfter(() => placeCrosshair(1, 'center'))}
						/>
						<CrosshairMenuItem
							id={2}
							placed={hasC2}
							disabled={!canPlaceCrosshair}
							onClick={() => closeMenuAfter(() => placeCrosshair(2, 'center'))}
						/>
						<Button
							variant="ghost"
							className="w-full justify-start text-destructive hover:bg-destructive/10 hover:text-destructive"
							disabled={!hasCrosshairs}
							onClick={() => closeMenuAfter(clearCrosshairs)}
						>
							<X />
							Clear all
							<ShortcutKey action="clearCrosshairs" className="ml-auto" />
						</Button>
					</PopoverContent>
				</Popover>
				<DisplayToggle
					label={legendLabel}
					action="toggleLegend"
					pressed={legendVisible}
					onPressedChange={setLegendVisible}
					disabled={disabled}
				>
					<List className="size-3.5" />
				</DisplayToggle>
			</ButtonGroup>
		</>
	);
}

function ToolbarTooltip({
	label,
	action,
	children
}: {
	label: string;
	action?: ShortcutAction;
	children: ReactElement;
}) {
	return (
		<Tooltip>
			<TooltipTrigger render={children} />
			<TooltipContent sideOffset={6}>
				{label}
				{action && <ShortcutKey action={action} />}
			</TooltipContent>
		</Tooltip>
	);
}

function ZoomButton({
	label,
	action,
	disabled,
	onClick,
	children
}: {
	label: string;
	action: ShortcutAction;
	disabled: boolean;
	onClick: () => void;
	children: ReactElement;
}) {
	return (
		<ToolbarTooltip label={label} action={action}>
			<Button
				variant="outline"
				size="icon"
				className={toolbarIconButtonClass}
				aria-label={label}
				disabled={disabled}
				onClick={onClick}
			>
				{children}
			</Button>
		</ToolbarTooltip>
	);
}

function DisplayToggle({
	label,
	action,
	pressed,
	onPressedChange,
	disabled,
	children
}: {
	label: string;
	action: ShortcutAction;
	pressed: boolean;
	onPressedChange: (pressed: boolean) => void;
	disabled: boolean;
	children: ReactElement;
}) {
	return (
		<ToolbarTooltip label={label} action={action}>
			<Toggle
				pressed={pressed}
				onPressedChange={onPressedChange}
				disabled={disabled}
				variant="outline"
				size="default"
				aria-label={label}
			>
				{children}
			</Toggle>
		</ToolbarTooltip>
	);
}

function CrosshairMenuItem({
	id,
	placed,
	disabled,
	onClick
}: {
	id: CrosshairId;
	placed: boolean;
	disabled: boolean;
	onClick: () => void;
}) {
	return (
		<Button variant="ghost" className="w-full justify-start" disabled={disabled} onClick={onClick}>
			<Crosshair />
			{placed ? `Center C${id}` : `Place C${id}`}
			<ShortcutKey action={id === 1 ? 'placeC1' : 'placeC2'} className="ml-auto" />
		</Button>
	);
}
