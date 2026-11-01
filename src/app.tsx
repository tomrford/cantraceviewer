import { AudioWaveform, CircleQuestionMark, Database, LoaderCircle } from 'lucide-react';
import { useEffect, useState, type ChangeEvent, type DragEvent } from 'react';
import { useStore } from 'zustand';
import { PlotToolbar } from '#lib/components/plot-toolbar.js';
import { SettingsDialog } from '#lib/components/settings-dialog.js';
import { ShortcutKey } from '#lib/components/shortcut-key.js';
import { SignalSelectorDialog } from '#lib/components/signal-selector-dialog.js';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle
} from '#lib/components/ui/alert-dialog.js';
import { Button } from '#lib/components/ui/button.js';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader } from '#lib/components/ui/empty.js';
import { PopoverTrigger } from '#lib/components/ui/popover.js';
import { Toaster } from '#lib/components/ui/sonner.js';
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger
} from '#lib/components/ui/tooltip.js';
import { Walkthrough } from '#lib/components/walkthrough.js';
import { deferredComponent } from '#lib/deferred-component.js';
import { DeferredFallback } from '#lib/components/deferred-fallback.js';
import {
	dragLeftCurrentTarget,
	filesFromDrop,
	hasDraggedFiles,
	traceFileFromDrop
} from '#lib/file-drop.js';
import { shortcutKeys } from '#lib/keyboard-shortcuts.js';
import {
	advanceWalkthrough,
	appShell,
	chooseTraceFile,
	connectAppShell,
	deriveShortcutState,
	handleDbcAdded,
	handleSignalToggle,
	openDemoTrace,
	openHelp,
	isTraceBusy,
	openTrace,
	runShortcut,
	setSignalSelectorOpen,
	startWalkthrough,
	TRACE_INPUT_ID
} from '#lib/stores/app-shell.js';
import { dbcFiles } from '#lib/stores/dbc-files.js';
import { plotData } from '#lib/stores/plot-data.js';
import { plotView } from '#lib/stores/plot-view.js';
import { isDark, preferences } from '#lib/stores/preferences.js';
import { clearTraceError, traceFile, type TraceFileEntry } from '#lib/stores/trace-file.js';
import { TRACE_FILE_ACCEPT, TRACE_FILE_FORMAT_NAMES } from '#lib/trace-file-types.js';
import { shouldShowWalkthrough, WALKTHROUGH_STEPS } from '#lib/walkthrough.js';

// Not needed for first paint (or the prerendered shell): loaded when a trace opens or a dialog
// first opens.
const SignalPlot = deferredComponent(
	() => {
		// SignalPlot imports ChartGPU only once mounted; fetch both now so the first plot waits on one
		// download hop, not two.
		void import('chartgpu').catch(() => undefined);
		return import('#lib/components/signal-plot.js').then((m) => m.SignalPlot);
	},
	(_props, failed) => <DeferredFallback label="Plot" failed={failed} />
);
const HelpDialog = deferredComponent(
	() => import('#lib/components/help-dialog.js').then((m) => m.HelpDialog),
	(props, failed) => <DeferredFallback label="Help" failed={failed} dialog={props} />
);
const CommandPalette = deferredComponent(
	() => import('#lib/components/command-palette.js').then((m) => m.CommandPalette),
	(props, failed) => <DeferredFallback label="Command palette" failed={failed} dialog={props} />
);

const SITE_TITLE = 'CAN Trace Viewer';
const LANDING_TITLE = 'Plot CAN bus logs in your browser';
const LANDING_DESCRIPTION = `Open an ${TRACE_FILE_FORMAT_NAMES} trace. Decode raw CAN with a DBC or plot native MF4 signals. Files stay on this device.`;

const squircleButtonClass =
	'flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground transition-[background-color,border-color,color,box-shadow,opacity,scale] hover:bg-sidebar-primary/90 focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-hidden active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50';
const titleButtonClass =
	'flex h-10 max-w-[min(28rem,calc(100vw-12rem))] items-center gap-2 rounded-lg border border-border/70 bg-muted px-4 text-sm font-medium text-foreground transition-[box-shadow,scale] hover:bg-muted/80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60';

export function App() {
	const dark = useStore(preferences, isDark);
	const webgpuSupported = useStore(appShell, (s) => s.webgpuSupported);
	const title = useStore(traceFile, (s) =>
		s.entry ? `${s.displayName} | ${SITE_TITLE}` : SITE_TITLE
	);

	useEffect(() => connectAppShell(), []);
	useEffect(() => {
		document.title = title;
	}, [title]);

	return (
		<>
			<TooltipProvider delay={500}>
				<main className="hidden min-h-screen items-center justify-center bg-background px-6 text-center too-small:flex">
					<div className="max-w-md space-y-2">
						<h1 className="text-base font-medium text-foreground">{LANDING_TITLE}</h1>
						<p className="text-sm text-muted-foreground">{LANDING_DESCRIPTION}</p>
						<p className="text-sm text-muted-foreground">
							CAN Trace Viewer needs a viewport of at least 600 px wide and 500 px tall. It works
							best on desktop or tablet.
						</p>
					</div>
				</main>
				{webgpuSupported === false ? (
					<main className="flex min-h-screen items-center justify-center bg-background px-6 text-center too-small:hidden">
						<div className="max-w-sm space-y-2">
							<h1 className="text-base font-medium text-foreground">WebGPU required</h1>
							<p className="text-sm text-muted-foreground">
								This browser does not support WebGPU, so CAN Trace Viewer cannot render plots. Try a
								recent desktop browser with WebGPU enabled.
							</p>
						</div>
					</main>
				) : (
					<AppShell />
				)}
			</TooltipProvider>
			<Toaster position="bottom-center" theme={dark ? 'dark' : 'light'} />
		</>
	);
}

function AppShell() {
	const platform = useStore(appShell, (s) => s.shortcutPlatform);
	const openingTrace = useStore(appShell, (s) => s.openingTrace);
	const traceLoading = useStore(traceFile, (s) => s.isLoading);
	const traceBusy = openingTrace || traceLoading;
	const hasTrace = useStore(traceFile, (s) => s.entry !== null);
	const dropActive = useStore(appShell, (s) => s.traceDropActive);
	const traceError = useStore(traceFile, (s) => s.error);
	const stepId = useStore(appShell, (s) => s.walkthroughStepId);
	const signalSelectorOpen = useStore(appShell, (s) => s.signalSelectorOpen);
	const signalSearchFocusRequest = useStore(appShell, (s) => s.signalSearchFocusRequest);
	const settingsOpen = useStore(appShell, (s) => s.settingsOpen);
	const helpOpen = useStore(appShell, (s) => s.helpOpen);
	const paletteOpen = useStore(appShell, (s) => s.paletteOpen);
	const hasPlottable = useStore(plotData, (s) => s.hasPlottableSignals);
	const isFitAll = useStore(plotView, (s) => s.isFitAll);
	const canPlaceCrosshair = useStore(plotView, (s) => s.activeViewport !== null);
	const hasCrosshairs = useStore(plotView, (s) => s.crosshairs.length > 0);
	const shortcutState = deriveShortcutState({
		traceBusy,
		hasPlottable,
		isFitAll,
		canPlaceCrosshair,
		hasCrosshairs
	});
	const stepIndex = WALKTHROUGH_STEPS.findIndex((step) => step.id === stepId);
	// Dialogs mount on first open and stay mounted so their close animations run.
	const helpMounted = useOpenedOnce(helpOpen);
	const paletteMounted = useOpenedOnce(paletteOpen);

	useEffect(() => {
		if (traceBusy) void SignalPlot.preload().catch(() => undefined);
	}, [traceBusy]);

	const dragHandlers = {
		onDragEnter: handleTraceDrag,
		onDragOver: handleTraceDrag,
		onDragLeave: clearTraceDrag,
		onDrop: dropTrace
	};

	return (
		<div className="flex min-h-screen flex-col bg-background too-small:hidden">
			<header
				className="relative flex h-16 shrink-0 items-center justify-between gap-2 border-b px-4"
				aria-busy={traceBusy}
			>
				<div className="flex items-center">
					<SignalSelectorDialog
						open={signalSelectorOpen}
						onOpenChange={setSignalSelectorOpen}
						focusSearchRequest={signalSearchFocusRequest}
						onDbcAdded={handleDbcAdded}
						onSignalToggle={handleSignalToggle}
					>
						<Tooltip>
							<TooltipTrigger
								render={
									<PopoverTrigger
										className={squircleButtonClass}
										data-walkthrough-target="signal-selector"
										aria-label="Open signal selector"
									/>
								}
							>
								<Database className="size-4" />
							</TooltipTrigger>
							<TooltipContent sideOffset={6}>
								Signal selector
								<ShortcutKey keys={shortcutKeys('selectSignals', platform)} />
							</TooltipContent>
						</Tooltip>
					</SignalSelectorDialog>
				</div>

				<div className="pointer-events-none flex min-w-0 flex-1 items-center justify-center lg:absolute lg:inset-0 lg:px-20">
					<TraceButton traceBusy={traceBusy} />
				</div>

				<input
					id={TRACE_INPUT_ID}
					className="hidden"
					type="file"
					accept={TRACE_FILE_ACCEPT}
					disabled={traceBusy}
					onChange={selectTrace}
				/>

				<div className="flex items-center gap-2" data-walkthrough-target="plot-controls">
					<div className="flex items-center">
						<PlotToolbar
							disabled={shortcutState.plotControlsDisabled}
							shortcutPlatform={platform}
						/>
					</div>
					<SettingsDialog
						open={settingsOpen}
						onOpenChange={(settingsOpen) => appShell.setState({ settingsOpen })}
						shortcutPlatform={platform}
						onOpenHelp={openHelp}
						triggerClassName={squircleButtonClass}
					/>
				</div>
			</header>

			{hasTrace ? (
				<SignalPlot shortcutPlatform={platform} dropActive={dropActive} {...dragHandlers} />
			) : (
				<Landing traceBusy={traceBusy} dropActive={dropActive} {...dragHandlers} />
			)}

			<AlertDialog
				open={traceError !== null}
				onOpenChange={(open) => {
					if (!open) clearTraceError();
				}}
			>
				{traceError && (
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Trace failed to open</AlertDialogTitle>
							<AlertDialogDescription>{traceError}</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogAction onClick={clearTraceError}>OK</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				)}
			</AlertDialog>

			{stepIndex >= 0 && (
				<Walkthrough
					step={WALKTHROUGH_STEPS[stepIndex]}
					stepIndex={stepIndex}
					stepCount={WALKTHROUGH_STEPS.length}
					onAdvance={advanceWalkthrough}
				/>
			)}

			{helpMounted && (
				<HelpDialog
					open={helpOpen}
					onOpenChange={(helpOpen) => appShell.setState({ helpOpen })}
					shortcutPlatform={platform}
					onStartWalkthrough={startWalkthrough}
				/>
			)}
			{paletteMounted && (
				<CommandPalette
					open={paletteOpen}
					onOpenChange={(paletteOpen) => appShell.setState({ paletteOpen })}
					shortcutPlatform={platform}
					state={shortcutState}
					onRun={runShortcut}
				/>
			)}
		</div>
	);
}

/** True from the first render where `open` is true onwards. */
function useOpenedOnce(open: boolean): boolean {
	const [opened, setOpened] = useState(open);
	if (open && !opened) setOpened(true);
	return opened;
}

function TraceButton({ traceBusy }: { traceBusy: boolean }) {
	const platform = useStore(appShell, (s) => s.shortcutPlatform);
	const displayName = useStore(traceFile, (s) => s.displayName);
	const entry = useStore(traceFile, (s) => s.entry);
	const metadata = entry ? formatTraceMetadata(entry) : null;

	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<button
						type="button"
						className={`${titleButtonClass} pointer-events-auto w-full lg:w-auto`}
						data-walkthrough-target="trace"
						disabled={traceBusy}
						aria-label={traceBusy ? 'Loading trace' : 'Load trace'}
						onClick={chooseTraceFile}
					/>
				}
			>
				<AudioWaveform className="size-4 shrink-0 text-sidebar-primary" />
				<span className="min-w-0 truncate text-sm font-medium">{displayName}</span>
				{traceBusy && (
					<>
						<LoaderCircle
							className="size-4 shrink-0 animate-spin text-muted-foreground"
							aria-hidden="true"
						/>
						<span className="sr-only">Loading trace</span>
					</>
				)}
			</TooltipTrigger>
			<TooltipContent sideOffset={6} className="flex-col items-stretch gap-1 pr-3">
				<span className="flex items-center gap-3">
					{traceBusy ? 'Loading trace' : 'Open trace'}
					{!traceBusy && (
						<ShortcutKey keys={shortcutKeys('openTrace', platform)} className="ml-auto" />
					)}
				</span>
				{metadata && <span className="whitespace-pre-line text-muted-foreground">{metadata}</span>}
			</TooltipContent>
		</Tooltip>
	);
}

function Landing({
	traceBusy,
	dropActive,
	...dragHandlers
}: {
	traceBusy: boolean;
	dropActive: boolean;
	onDragEnter: (event: DragEvent) => void;
	onDragOver: (event: DragEvent) => void;
	onDragLeave: (event: DragEvent) => void;
	onDrop: (event: DragEvent) => void;
}) {
	const hasLoadedLibrary = useStore(dbcFiles, (s) => s.hasLoadedLibrary);
	const walkthroughVersion = useStore(preferences, (s) => s.walkthroughVersion);
	const stepId = useStore(appShell, (s) => s.walkthroughStepId);
	const invitationVisible =
		hasLoadedLibrary && stepId === null && shouldShowWalkthrough(walkthroughVersion);

	return (
		// Drop target for trace files; the visible controls cover keyboard use.
		// oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
		<section
			className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-background p-6"
			aria-label="Trace loading"
			aria-busy={traceBusy}
			{...dragHandlers}
		>
			{dropActive && (
				<div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/25 text-sm font-medium text-foreground backdrop-blur-[1px]">
					Drop trace to open
				</div>
			)}
			<Empty className="max-w-md border-0">
				<EmptyHeader>
					<h1 className="font-heading text-base font-medium tracking-tight">{LANDING_TITLE}</h1>
					<EmptyDescription>{LANDING_DESCRIPTION}</EmptyDescription>
				</EmptyHeader>
				<EmptyContent className="max-w-none flex-row flex-wrap justify-center">
					<Button size="lg" disabled={traceBusy} onClick={chooseTraceFile}>
						{traceBusy ? (
							<>
								<LoaderCircle data-icon="inline-start" className="size-4 animate-spin" />
								Loading trace...
							</>
						) : (
							<>
								<AudioWaveform data-icon="inline-start" className="size-4" />
								Open trace
							</>
						)}
					</Button>
					<Button
						variant="outline"
						size="lg"
						disabled={traceBusy}
						onClick={() => void openDemoTrace()}
					>
						Open demo trace
					</Button>
					{invitationVisible && (
						<Button variant="outline" size="lg" onClick={startWalkthrough}>
							<CircleQuestionMark data-icon="inline-start" className="size-4" />
							First time? Take a tour
						</Button>
					)}
				</EmptyContent>
			</Empty>
		</section>
	);
}

function handleTraceDrag(event: DragEvent): void {
	if (!hasDraggedFiles(event)) return;
	event.preventDefault();
	if (!isTraceBusy()) appShell.setState({ traceDropActive: true });
}

function clearTraceDrag(event: DragEvent): void {
	if (dragLeftCurrentTarget(event)) appShell.setState({ traceDropActive: false });
}

function dropTrace(event: DragEvent): void {
	event.preventDefault();
	appShell.setState({ traceDropActive: false });
	void openTrace(traceFileFromDrop(filesFromDrop(event)));
}

function selectTrace(event: ChangeEvent<HTMLInputElement>): void {
	const input = event.currentTarget;
	const file = input.files?.[0] ?? null;
	input.value = '';
	void openTrace(file);
}

function formatTraceMetadata(trace: TraceFileEntry): string {
	const { metadata } = trace;
	const start = metadata.measurementStartMs
		? new Date(metadata.measurementStartMs).toLocaleString()
		: 'Not available';
	const duration =
		metadata.durationNs === null ? 'Not available' : formatDuration(metadata.durationNs);

	const nativeSignalCount =
		trace.mf4Catalog?.groups.reduce((count, group) => count + group.signals.length, 0) ?? 0;
	const details = [`Start: ${start}`];
	if (trace.hasRawFrames || nativeSignalCount === 0) {
		details.push(`Valid CAN messages: ${metadata.validMessageCount.toLocaleString()}`);
	}
	if (nativeSignalCount > 0) {
		details.push(`Native MF4 signals: ${nativeSignalCount.toLocaleString()}`);
	}
	details.push(`Duration: ${duration}`);
	return details.join('\n');
}

function formatDuration(durationNs: number): string {
	const totalSeconds = durationNs / 1_000_000_000;
	if (totalSeconds < 1) return `${(durationNs / 1_000_000).toFixed(3)} ms`;
	if (totalSeconds < 60) return `${totalSeconds.toFixed(3)} s`;

	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds - minutes * 60;
	if (minutes < 60) return `${minutes}m ${seconds.toFixed(3)}s`;

	const hours = Math.floor(minutes / 60);
	return `${hours}h ${minutes % 60}m ${seconds.toFixed(3)}s`;
}
