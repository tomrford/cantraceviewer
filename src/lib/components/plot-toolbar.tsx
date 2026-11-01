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
import { plotData } from '#lib/stores/plot-data.js';
import {
	clearCrosshairs,
	placeCrosshair,
	plotView,
	resetZoom,
	setBoxZoomEnabled,
	setLegendSelectOpen,
	setLegendVisible,
	zoomBy
} from '#lib/stores/plot-view.js';
import { cn } from '#lib/utils.js';

const toolbarIconButtonClass =
	'border-input bg-transparent hover:bg-muted hover:text-foreground dark:bg-transparent dark:hover:bg-muted/50';

// Only booleans are selected so panning, zooming and crosshair drags never re-render the toolbar.
export function PlotToolbar({ disabled }: { disabled: boolean }) {
	const isFitAll = useStore(plotView, (s) => s.isFitAll);
	const hasPlottableSignals = useStore(plotData, (s) => s.hasPlottableSignals);
	const canResetZoom = hasPlottableSignals && !isFitAll;
	const boxZoomEnabled = useStore(plotView, (s) => s.boxZoomEnabled);
	const legendVisible = useStore(plotView, (s) => s.legendVisible);
	const canPlaceCrosshair = useStore(plotView, (s) => s.activeViewport !== null);
	const hasCrosshairs = useStore(plotView, (s) => s.crosshairs.length > 0);
	const hasC1 = useStore(plotView, (s) => crosshairById(s.crosshairs, 1) !== null);
	const hasC2 = useStore(plotView, (s) => crosshairById(s.crosshairs, 2) !== null);
	const [crosshairMenuOpen, setCrosshairMenuOpen] = useState(false);

	function closeMenuAfter(action: () => void): void {
		setCrosshairMenuOpen(false);
		action();
	}

	function tooltipButton(trigger: ReactElement, label: string, action?: ShortcutAction) {
		return (
			<Tooltip>
				<TooltipTrigger render={trigger} />
				<TooltipContent sideOffset={6}>
					{label}
					{action && <ShortcutKey action={action} />}
				</TooltipContent>
			</Tooltip>
		);
	}

	function crosshairItem(id: CrosshairId, placed: boolean) {
		return (
			<Button
				variant="ghost"
				className="w-full justify-start"
				disabled={!canPlaceCrosshair}
				onClick={() => closeMenuAfter(() => placeCrosshair(id, 'center'))}
			>
				<Crosshair />
				{placed ? `Center C${id}` : `Place C${id}`}
				<ShortcutKey action={id === 1 ? 'placeC1' : 'placeC2'} className="ml-auto" />
			</Button>
		);
	}

	const boxZoomLabel = boxZoomEnabled ? 'Use drag pan' : 'Use box zoom';
	const legendLabel = legendVisible ? 'Hide legend' : 'Show legend';

	return (
		<>
			<ButtonGroup aria-label="Plot zoom controls">
				{tooltipButton(
					<Button
						variant="outline"
						size="icon"
						className={toolbarIconButtonClass}
						aria-label="Zoom in"
						disabled={disabled}
						onClick={() => zoomBy(0.5)}
					>
						<Plus className="size-3.5" />
					</Button>,
					'Zoom in',
					'zoomIn'
				)}
				{tooltipButton(
					<Button
						variant="outline"
						size="icon"
						className={toolbarIconButtonClass}
						aria-label="Zoom out"
						disabled={disabled}
						onClick={() => zoomBy(2)}
					>
						<Minus className="size-3.5" />
					</Button>,
					'Zoom out',
					'zoomOut'
				)}
				{tooltipButton(
					<Button
						variant="outline"
						size="icon"
						className={toolbarIconButtonClass}
						aria-label="Zoom to full extent"
						disabled={disabled || !canResetZoom}
						onClick={resetZoom}
					>
						<Expand className="size-3.5" />
					</Button>,
					'Zoom to full extent',
					'resetZoom'
				)}
			</ButtonGroup>
			<ButtonGroup aria-label="Plot display controls">
				{tooltipButton(
					<Toggle
						pressed={boxZoomEnabled}
						onPressedChange={setBoxZoomEnabled}
						disabled={disabled}
						variant="outline"
						size="default"
						aria-label={boxZoomLabel}
					>
						<SquareDashed className="size-3.5" />
					</Toggle>,
					boxZoomLabel,
					'toggleBoxZoom'
				)}
				<Popover
					open={crosshairMenuOpen}
					onOpenChange={(open) => {
						setCrosshairMenuOpen(open);
						if (open) setLegendSelectOpen(false);
					}}
				>
					{tooltipButton(
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
						</PopoverTrigger>,
						'Crosshairs'
					)}
					<PopoverContent align="end" className="w-52 gap-1 p-1.5">
						{crosshairItem(1, hasC1)}
						{crosshairItem(2, hasC2)}
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
				{tooltipButton(
					<Toggle
						pressed={legendVisible}
						onPressedChange={setLegendVisible}
						disabled={disabled}
						variant="outline"
						size="default"
						aria-label={legendLabel}
					>
						<List className="size-3.5" />
					</Toggle>,
					legendLabel,
					'toggleLegend'
				)}
			</ButtonGroup>
		</>
	);
}
