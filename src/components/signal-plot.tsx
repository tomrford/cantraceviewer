import {
	BoxSelect,
	Copy,
	Crosshair,
	Download,
	Expand,
	Minus,
	Plus,
	RotateCcw,
	X
} from 'lucide-react';
import { useEffect, useRef, useState, useTransition, type ComponentProps } from 'react';

import { DropOverlay } from '@/components/drop-overlay';
import { PlotCrosshairOverlay } from '@/components/plot-crosshair-overlay';
import { PlotInteraction } from '@/components/plot-interaction';
import { ShortcutKey } from '@/components/shortcut-key';
import { SignalPlotAxes } from '@/components/signal-plot-axes';
import { SignalPlotLegend } from '@/components/signal-plot-legend';
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuShortcut,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger
} from '@/components/ui/context-menu';
import type { ShortcutAction } from '@/lib/keyboard-shortcuts';
import { mountChart, type RendererState } from '@/lib/plot/plot-chart';
import type { CrosshairId } from '@/lib/plot/plot-crosshair';
import { exportPlotImage, type ImageDestination } from '@/lib/plot/plot-image-export';
import type { PlotPoint } from '@/lib/plot/plot-viewport';
import { cn } from '@/lib/utils';
import { clearSelectedSignals } from '@/store/plot-data';
import {
	clearCrosshairs,
	deleteCrosshair,
	resetZoom,
	toggleBoxZoom,
	upsertCrosshair,
	zoomIn,
	zoomOut
} from '@/store/plot-view';
import { useAppStore } from '@/store/store';

const EMPTY_MESSAGE = 'Select signals from the signal selector to view them.';

type ContextTarget = { point: PlotPoint | null; crosshairId: CrosshairId | null };

/**
 * The ChartGPU plot with its overlays. Chart options are pushed from store subscriptions on one
 * animation frame, outside React rendering; React renders only discrete plot state.
 */
export function SignalPlot({
	dropActive = false,
	className,
	...props
}: ComponentProps<'section'> & { dropActive?: boolean }) {
	const rootRef = useRef<HTMLElement>(null);
	const surfaceRef = useRef<HTMLDivElement>(null);
	const [renderer, setRenderer] = useState<RendererState>({ status: 'loading' });
	const [contextTarget, setContextTarget] = useState<ContextTarget | null>(null);
	const [imageExportBusy, startImageExport] = useTransition();

	const hasPlottableSignals = useAppStore((s) => s.hasPlottableSignals);
	const hasSelectedSignals = useAppStore((s) => s.selected.size > 0);
	const dataReady = useAppStore((s) => s.plotModel.fullDomain !== null);
	const isFitAll = useAppStore((s) => s.isFitAll);
	const hasCrosshairs = useAppStore((s) => s.crosshairs.length > 0);
	const boxZoomEnabled = useAppStore((s) => s.boxZoomEnabled);
	const legendVisible = useAppStore((s) => s.legendVisible);
	// A remembered point is meaningless once nothing is plotted.
	const contextMenu = hasPlottableSignals ? contextTarget : null;
	const removableCrosshair = contextMenu?.crosshairId ?? null;
	const hasData = hasPlottableSignals && dataReady;
	const rendererMessage =
		renderer.status === 'loading'
			? hasData
				? 'Starting plot renderer…'
				: null
			: renderer.status === 'error'
				? renderer.message
				: null;

	useEffect(() => {
		const root = rootRef.current;
		const surface = surfaceRef.current;
		if (root === null || surface === null) return;
		return mountChart(root, surface, setRenderer);
	}, []);

	function rememberContextMenuPoint(
		point: PlotPoint | null,
		crosshairId: CrosshairId | null = null
	) {
		setContextTarget({ point, crosshairId });
	}

	function placeCrosshairAtContextPoint(id: CrosshairId) {
		if (contextMenu?.point) upsertCrosshair({ id, ...contextMenu.point });
	}

	function exportCurrentView(destination: ImageDestination) {
		const root = rootRef.current;
		if (root !== null) startImageExport(() => exportPlotImage(root, destination));
	}

	return (
		<section
			ref={rootRef}
			className={cn(
				// Isolated so the z-indexes below stay under modal backdrops, which have none of their own.
				'relative isolate min-h-0 flex-1 overflow-hidden bg-background',
				dropActive && 'outline-2 -outline-offset-2 outline-emerald-500/70',
				className
			)}
			{...props}
		>
			{dropActive && (
				<DropOverlay data-export-ignore className="z-60">
					Drop trace to open
				</DropOverlay>
			)}
			<div ref={surfaceRef} className="absolute inset-0" aria-label="Selected signal plot" />

			{hasPlottableSignals && (
				<ContextMenu>
					<PlotInteraction plotSurface={surfaceRef} onContextMenuPoint={rememberContextMenuPoint}>
						<PlotCrosshairOverlay id={1} onContextMenuPoint={rememberContextMenuPoint} />
						<PlotCrosshairOverlay id={2} onContextMenuPoint={rememberContextMenuPoint} />
					</PlotInteraction>
					<ContextMenuContent className="w-52">
						<ContextMenuItem onClick={zoomIn}>
							<Plus />
							Zoom in
							<MenuShortcut action="zoomIn" />
						</ContextMenuItem>
						<ContextMenuItem onClick={zoomOut}>
							<Minus />
							Zoom out
							<MenuShortcut action="zoomOut" />
						</ContextMenuItem>
						<ContextMenuItem disabled={isFitAll} onClick={resetZoom}>
							<Expand />
							Zoom to full extent
							<MenuShortcut action="resetZoom" />
						</ContextMenuItem>
						<ContextMenuSeparator />
						<ContextMenuSub>
							<ContextMenuSubTrigger>
								<Crosshair />
								Crosshairs
							</ContextMenuSubTrigger>
							<ContextMenuSubContent className="w-44">
								{([1, 2] as const).map((id) => (
									<ContextMenuItem
										key={id}
										disabled={!contextMenu?.point}
										onClick={() => placeCrosshairAtContextPoint(id)}
									>
										<Crosshair />
										Place C{id}
										<MenuShortcut action={id === 1 ? 'placeC1' : 'placeC2'} />
									</ContextMenuItem>
								))}
								<ContextMenuItem disabled={!hasCrosshairs} onClick={clearCrosshairs}>
									<X />
									Clear all
									<MenuShortcut action="clearCrosshairs" />
								</ContextMenuItem>
							</ContextMenuSubContent>
						</ContextMenuSub>
						{removableCrosshair !== null && (
							<ContextMenuItem onClick={() => deleteCrosshair(removableCrosshair)}>
								<X />
								Remove C{removableCrosshair}
							</ContextMenuItem>
						)}
						<ContextMenuItem onClick={toggleBoxZoom}>
							<BoxSelect />
							{boxZoomEnabled ? 'Use drag pan' : 'Use box zoom'}
							<MenuShortcut action="toggleBoxZoom" />
						</ContextMenuItem>
						<ContextMenuSeparator />
						<ContextMenuItem disabled={imageExportBusy} onClick={() => exportCurrentView('copy')}>
							<Copy />
							Copy image
						</ContextMenuItem>
						<ContextMenuItem disabled={imageExportBusy} onClick={() => exportCurrentView('save')}>
							<Download />
							Save image
						</ContextMenuItem>
						<ContextMenuSeparator />
						<ContextMenuItem
							disabled={!hasSelectedSignals}
							variant="destructive"
							onClick={clearSelectedSignals}
						>
							<RotateCcw />
							Clear selected signals
						</ContextMenuItem>
					</ContextMenuContent>
				</ContextMenu>
			)}

			{hasData && renderer.status === 'ready' && (
				<SignalPlotAxes generateTicks={renderer.generateTicks} />
			)}

			{hasPlottableSignals && legendVisible && <SignalPlotLegend />}

			{(rendererMessage !== null || !hasData) && (
				<div
					role={
						rendererMessage === null ? undefined : renderer.status === 'error' ? 'alert' : 'status'
					}
					className="absolute inset-0 z-30 flex items-center justify-center px-6 text-center text-sm text-muted-foreground"
				>
					{rendererMessage ?? EMPTY_MESSAGE}
				</div>
			)}
		</section>
	);
}

function MenuShortcut({ action }: { action: ShortcutAction }) {
	return (
		<ContextMenuShortcut>
			<ShortcutKey action={action} />
		</ContextMenuShortcut>
	);
}
