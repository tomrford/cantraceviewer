import { AudioWaveform, CircleQuestionMark, Database, LoaderCircle } from 'lucide-react';
import { useEffect, useRef, type ChangeEvent, type ComponentProps } from 'react';

import { CommandPalette } from '@/components/command-palette';
import { DropOverlay } from '@/components/drop-overlay';
import { ErrorDialog } from '@/components/error-dialog';
import { HelpDialog } from '@/components/help-dialog';
import { PlotToolbar } from '@/components/plot-toolbar';
import { SettingsPopover } from '@/components/settings-popover';
import { ShortcutKey } from '@/components/shortcut-key';
import { SignalPlot } from '@/components/signal-plot';
import { SignalSelectorDialog } from '@/components/signal-selector-dialog';
import { Button } from '@/components/ui/button';
import { DialogTrigger } from '@/components/ui/dialog';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader } from '@/components/ui/empty';
import { Toaster } from '@/components/ui/sonner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Walkthrough } from '@/components/walkthrough';
import { useAppShortcuts } from '@/hooks/use-app-shortcuts';
import { useFileDrop } from '@/hooks/use-file-drop';
import { traceFileFromDrop } from '@/lib/file-drop';
import { TRACE_FILE_ACCEPT, TRACE_FILE_FORMAT_NAMES } from '@/lib/trace-file-types';
import { countSignals, useBrowserValue } from '@/lib/utils';
import { shouldShowWalkthrough } from '@/lib/walkthrough';
import { openDemoTrace, openTraceFile, startWalkthrough } from '@/store/app-shell';
import type { TraceFileEntry } from '@/store/derive';
import { isDark } from '@/store/preferences';
import { useAppStore } from '@/store/store';
import { clearTraceError } from '@/store/trace-file';

const SITE_TITLE = 'CAN Trace Viewer';
const LANDING_TITLE = 'Plot CAN bus logs in your browser';
const LANDING_DESCRIPTION = `Open an ${TRACE_FILE_FORMAT_NAMES} trace. Decode raw CAN with a DBC or plot native MF4 signals. Files stay on this device.`;

export function App() {
	const dark = useAppStore(isDark);
	// The prerender assumes support, so browsers with WebGPU never see the required screen.
	const webgpuSupported = useBrowserValue(() => 'gpu' in navigator, true);
	const title = useAppStore((s) => (s.trace ? `${s.traceName} | ${SITE_TITLE}` : SITE_TITLE));

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
				{webgpuSupported ? (
					<AppShell />
				) : (
					<main className="flex min-h-screen items-center justify-center bg-background px-6 text-center too-small:hidden">
						<div className="max-w-sm space-y-2">
							<h1 className="text-base font-medium text-foreground">WebGPU required</h1>
							<p className="text-sm text-muted-foreground">
								This browser does not support WebGPU, so CAN Trace Viewer cannot render plots. Try a
								recent desktop browser with WebGPU enabled.
							</p>
						</div>
					</main>
				)}
			</TooltipProvider>
			<Toaster position="bottom-center" theme={dark ? 'dark' : 'light'} />
		</>
	);
}

function AppShell() {
	const traceInput = useRef<HTMLInputElement>(null);
	const signalSearchInput = useRef<HTMLInputElement>(null);
	const openingTrace = useAppStore((s) => s.openingTrace);
	const hasTrace = useAppStore((s) => s.trace !== null);
	const traceError = useAppStore((s) => s.traceError);
	const hasPlottable = useAppStore((s) => s.hasPlottableSignals);
	const isFitAll = useAppStore((s) => s.isFitAll);
	const canPlaceCrosshair = useAppStore((s) => s.activeViewport !== null);
	const hasCrosshairs = useAppStore((s) => s.crosshairs.length > 0);
	const shortcutState = {
		openingTrace,
		plotControlsDisabled: !hasPlottable || openingTrace,
		canResetZoom: hasPlottable && !isFitAll,
		canPlaceCrosshair,
		hasCrosshairs
	};

	function chooseTraceFile() {
		traceInput.current?.click();
	}

	const runShortcut = useAppShortcuts(shortcutState, {
		openTrace: chooseTraceFile,
		focusSignalSearch: () => signalSearchInput.current?.focus()
	});

	const { dropActive: traceDragged, dropHandlers } = useFileDrop((files) => {
		void openTraceFile(traceFileFromDrop(files));
	});
	// A drop while a trace opens is still handled, but does not advertise itself.
	const dropActive = traceDragged && !openingTrace;

	return (
		<div className="flex min-h-screen flex-col bg-background too-small:hidden">
			<header
				className="relative flex h-16 shrink-0 items-center justify-between gap-2 border-b px-4"
				aria-busy={openingTrace}
			>
				<div className="flex items-center">
					<SignalSelectorDialog searchInputRef={signalSearchInput}>
						<Tooltip>
							<TooltipTrigger
								render={
									<DialogTrigger
										render={<Button size="icon-lg" />}
										data-walkthrough-target="signal-selector"
										aria-label="Open signal selector"
									/>
								}
							>
								<Database className="size-4" />
							</TooltipTrigger>
							<TooltipContent>
								Signal selector
								<ShortcutKey action="selectSignals" />
							</TooltipContent>
						</Tooltip>
					</SignalSelectorDialog>
				</div>

				<div className="pointer-events-none flex min-w-0 flex-1 items-center justify-center lg:absolute lg:inset-0 lg:px-20">
					<TraceButton openingTrace={openingTrace} onOpenTrace={chooseTraceFile} />
				</div>

				<input
					ref={traceInput}
					className="hidden"
					type="file"
					accept={TRACE_FILE_ACCEPT}
					disabled={openingTrace}
					onChange={selectTrace}
				/>

				<div className="flex items-center gap-2" data-walkthrough-target="plot-controls">
					<div className="flex items-center">
						<PlotToolbar disabled={shortcutState.plotControlsDisabled} />
					</div>
					<SettingsPopover />
				</div>
			</header>

			{hasTrace ? (
				<SignalPlot dropActive={dropActive} {...dropHandlers} />
			) : (
				<Landing
					openingTrace={openingTrace}
					dropActive={dropActive}
					onOpenTrace={chooseTraceFile}
					{...dropHandlers}
				/>
			)}

			<ErrorDialog title="Trace failed to open" message={traceError} onDismiss={clearTraceError} />

			<Walkthrough />

			<HelpDialog />
			<CommandPalette state={shortcutState} onRun={runShortcut} />
		</div>
	);
}

function TraceButton({
	openingTrace,
	onOpenTrace
}: {
	openingTrace: boolean;
	onOpenTrace: () => void;
}) {
	const displayName = useAppStore((s) => s.traceName);
	const entry = useAppStore((s) => s.trace);
	const metadata = entry ? formatTraceMetadata(entry) : null;

	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						variant="secondary"
						size="lg"
						className="pointer-events-auto w-full max-w-[min(28rem,calc(100vw-12rem))] shrink justify-start lg:w-auto"
						data-walkthrough-target="trace"
						disabled={openingTrace}
						aria-label={openingTrace ? 'Loading trace' : 'Load trace'}
						onClick={onOpenTrace}
					/>
				}
			>
				<AudioWaveform className="size-4 shrink-0 text-sidebar-primary" />
				<span className="min-w-0 truncate">{displayName}</span>
				{openingTrace && (
					<LoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground" />
				)}
			</TooltipTrigger>
			<TooltipContent className="flex-col items-stretch gap-1 pr-3">
				<span className="flex items-center gap-3">
					{openingTrace ? 'Loading trace' : 'Open trace'}
					{!openingTrace && <ShortcutKey action="openTrace" className="ml-auto" />}
				</span>
				{metadata && <span className="whitespace-pre-line text-muted-foreground">{metadata}</span>}
			</TooltipContent>
		</Tooltip>
	);
}

function Landing({
	openingTrace,
	dropActive,
	onOpenTrace,
	...props
}: ComponentProps<'section'> & {
	openingTrace: boolean;
	dropActive: boolean;
	onOpenTrace: () => void;
}) {
	const hasLoadedLibrary = useAppStore((s) => s.hasLoadedLibrary);
	const walkthroughVersion = useAppStore((s) => s.walkthroughVersion);
	const stepId = useAppStore((s) => s.walkthroughStepId);
	const invitationVisible =
		hasLoadedLibrary && stepId === null && shouldShowWalkthrough(walkthroughVersion);

	return (
		// Drop target for trace files; the visible controls cover keyboard use.
		// oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
		<section
			className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-background p-6"
			aria-label="Trace loading"
			aria-busy={openingTrace}
			{...props}
		>
			{dropActive && <DropOverlay>Drop trace to open</DropOverlay>}
			<Empty className="max-w-md border-0">
				<EmptyHeader>
					<h1 className="font-heading text-base font-medium tracking-tight">{LANDING_TITLE}</h1>
					<EmptyDescription>{LANDING_DESCRIPTION}</EmptyDescription>
				</EmptyHeader>
				<EmptyContent className="max-w-none flex-row flex-wrap justify-center">
					<Button size="lg" disabled={openingTrace} onClick={onOpenTrace}>
						{openingTrace ? (
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
						disabled={openingTrace}
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

function selectTrace(event: ChangeEvent<HTMLInputElement>): void {
	const input = event.currentTarget;
	const file = input.files?.[0] ?? null;
	input.value = '';
	void openTraceFile(file);
}

function formatTraceMetadata(trace: TraceFileEntry): string {
	const { metadata } = trace;
	const start = metadata.measurementStartMs
		? new Date(metadata.measurementStartMs).toLocaleString()
		: 'Not available';
	const duration =
		metadata.durationNs === null ? 'Not available' : formatDuration(metadata.durationNs);

	const nativeSignalCount = countSignals(trace.mf4Catalog?.groups ?? []);
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
