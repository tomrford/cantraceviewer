import { Crosshair, Expand, List, Minus, Plus, SquareDashed, X } from 'lucide-react';
import type { ReactElement } from 'react';

import { ShortcutKey } from '@/components/shortcut-key';
import { Button, buttonVariants } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { Toggle } from '@/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { ShortcutAction } from '@/lib/keyboard-shortcuts';
import { crosshairById, type CrosshairId } from '@/lib/plot/plot-crosshair';
import { cn } from '@/lib/utils';
import {
	clearCrosshairs,
	placeCrosshair,
	resetZoom,
	setBoxZoomEnabled,
	setLegendVisible,
	zoomIn,
	zoomOut
} from '@/store/plot-view';
import { useAppStore } from '@/store/store';

const toolbarIconButtonClass =
	'border-input bg-transparent hover:bg-muted hover:text-foreground dark:bg-transparent dark:hover:bg-muted/50';

// Only booleans are selected so panning, zooming and crosshair drags never re-render the toolbar.
export function PlotToolbar({ disabled }: { disabled: boolean }) {
	const isFitAll = useAppStore((s) => s.isFitAll);
	const boxZoomEnabled = useAppStore((s) => s.boxZoomEnabled);
	const legendVisible = useAppStore((s) => s.legendVisible);
	const canPlaceCrosshair = useAppStore((s) => s.activeViewport !== null);
	const hasC1 = useAppStore((s) => crosshairById(s.crosshairs, 1) !== null);
	const hasC2 = useAppStore((s) => crosshairById(s.crosshairs, 2) !== null);
	const hasCrosshairs = hasC1 || hasC2;
	const boxZoomLabel = boxZoomEnabled ? 'Use drag pan' : 'Use box zoom';
	const legendLabel = legendVisible ? 'Hide legend' : 'Show legend';

	return (
		<>
			<ButtonGroup aria-label="Plot zoom controls">
				<ZoomButton label="Zoom in" action="zoomIn" disabled={disabled} onClick={zoomIn}>
					<Plus className="size-3.5" />
				</ZoomButton>
				<ZoomButton label="Zoom out" action="zoomOut" disabled={disabled} onClick={zoomOut}>
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
				<Menu>
					<ToolbarTooltip label="Crosshairs">
						<MenuTrigger
							className={cn(
								buttonVariants({ variant: 'outline', size: 'default' }),
								toolbarIconButtonClass,
								hasCrosshairs && 'bg-muted text-foreground'
							)}
							disabled={disabled}
							aria-label="Manage crosshairs"
						>
							<Crosshair className="size-3.5" />
						</MenuTrigger>
					</ToolbarTooltip>
					<MenuContent align="end" className="w-52">
						<CrosshairMenuItem
							id={1}
							placed={hasC1}
							disabled={!canPlaceCrosshair}
							onClick={() => placeCrosshair(1, 'center')}
						/>
						<CrosshairMenuItem
							id={2}
							placed={hasC2}
							disabled={!canPlaceCrosshair}
							onClick={() => placeCrosshair(2, 'center')}
						/>
						<MenuItem
							className="w-full justify-start text-destructive data-highlighted:bg-destructive/10 data-highlighted:text-destructive"
							disabled={!hasCrosshairs}
							onClick={clearCrosshairs}
						>
							<X />
							Clear all
							<ShortcutKey action="clearCrosshairs" className="ml-auto" />
						</MenuItem>
					</MenuContent>
				</Menu>
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
			<TooltipContent>
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
		<MenuItem disabled={disabled} onClick={onClick}>
			<Crosshair />
			{placed ? `Center C${id}` : `Place C${id}`}
			<ShortcutKey action={id === 1 ? 'placeC1' : 'placeC2'} className="ml-auto" />
		</MenuItem>
	);
}
