<script lang="ts">
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import PlotToolbar from '$lib/components/plot-toolbar.svelte';
	import CommandPalette from '$lib/components/command-palette.svelte';
	import HelpDialog from '$lib/components/help-dialog.svelte';
	import SettingsDialog from '$lib/components/settings-dialog.svelte';
	import SignalPlot from '$lib/components/signal-plot.svelte';
	import SignalSelectorDialog from '$lib/components/signal-selector-dialog.svelte';
	import ShortcutKey from '$lib/components/shortcut-key.svelte';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import Walkthrough from '$lib/components/walkthrough.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Empty from '$lib/components/ui/empty/index.js';
	import {
		dragLeftCurrentTarget,
		filesFromDrop,
		hasDraggedFiles,
		traceFileFromDrop
	} from '$lib/file-drop.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { PlotViewportState } from '$lib/plot-viewport-state.svelte.js';
	import {
		setCrosshair,
		type CrosshairId,
		type LegendCrosshairMode,
		type PlotCrosshair
	} from '$lib/plot-crosshair.js';
	import { dataPointAtRatio, viewportCenter } from '$lib/plot-viewport.js';
	import type { PlotRatioPoint } from '$lib/plot-geometry.js';
	import {
		detectShortcutPlatform,
		overridesBrowserShortcut,
		shortcutEnabled,
		shortcutFromEvent,
		shortcutKeys,
		shortcutSuppressedBySurface,
		type ShortcutAction,
		type ShortcutPlatform,
		type ShortcutState
	} from '$lib/keyboard-shortcuts.js';
	import { dbcFiles } from '$lib/stores/dbc-files.svelte.js';
	import { plotData } from '$lib/stores/plot-data.svelte.js';
	import { onTraceOpened } from '$lib/stores/session.js';
	import { traceFile, type TraceFileEntry } from '$lib/stores/trace-file.svelte.js';
	import { TRACE_FILE_ACCEPT } from '$lib/trace-file-types.js';
	import AudioWaveformIcon from '@lucide/svelte/icons/audio-waveform';
	import CogIcon from '@lucide/svelte/icons/cog';
	import CircleHelpIcon from '@lucide/svelte/icons/circle-help';
	import DatabaseIcon from '@lucide/svelte/icons/database';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import XIcon from '@lucide/svelte/icons/x';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import { walkthroughVersion } from '$lib/stores/preferences.svelte.js';
	import {
		adjacentWalkthroughStep,
		shouldShowWalkthrough,
		WALKTHROUGH_STEPS,
		WALKTHROUGH_VERSION,
		type WalkthroughStep
	} from '$lib/walkthrough.js';
	import { onMount, tick } from 'svelte';

	let traceInput = $state<HTMLInputElement>();
	let traceDropActive = $state(false);
	let webgpuSupported = $state<boolean | null>(null);
	let crosshairs = $state<PlotCrosshair[]>([]);
	let legendCrosshairMode = $state<LegendCrosshairMode>('c1');
	let boxZoomEnabled = $state(false);
	let legendVisible = $state(true);
	let legendSelectOpen = $state(false);
	let crosshairMenuOpen = $state(false);
	let signalSelectorOpen = $state(false);
	let settingsOpen = $state(false);
	let helpOpen = $state(false);
	let paletteOpen = $state(false);
	let signalSearchFocusRequest = $state(0);
	let plotPointerRatio = $state<PlotRatioPoint | null>(null);
	let shortcutPlatform = $state<ShortcutPlatform>('other');
	let walkthroughStepId = $state<WalkthroughStep['id'] | null>(null);
	const plotViewport = new PlotViewportState();
	const plotControlsDisabled = $derived(!plotData.hasPlottableSignals || traceFile.isLoading);
	const canResetZoom = $derived(plotData.hasPlottableSignals && !plotViewport.isFitAll);
	const shortcutState = $derived<ShortcutState>({
		traceLoading: traceFile.isLoading,
		plotControlsDisabled,
		canResetZoom,
		canPlaceCrosshair: plotViewport.activeViewport !== null
	});
	let traceMetadataTitle = $derived(
		traceFile.entry ? formatTraceMetadata(traceFile.entry) : undefined
	);
	const siteTitle = 'CAN Trace Viewer';
	let browserTitle = $derived(
		traceFile.entry ? `${traceFile.displayName} | ${siteTitle}` : siteTitle
	);
	let walkthroughStep = $derived(
		WALKTHROUGH_STEPS.find((step) => step.id === walkthroughStepId) ?? null
	);
	let walkthroughStepIndex = $derived(
		walkthroughStepId === null
			? -1
			: WALKTHROUGH_STEPS.findIndex((step) => step.id === walkthroughStepId)
	);
	let walkthroughInvitationVisible = $derived(
		dbcFiles.hasLoadedLibrary &&
			walkthroughStepId === null &&
			shouldShowWalkthrough(walkthroughVersion.current)
	);
	const shareTitle = 'CAN Trace Viewer — Plot and decode ASC, TRC, BLF and MF4 logs';
	const siteDescription =
		'Plot ASC, TRC, BLF and MF4 vehicle data in your browser. Decode raw CAN with DBC files or plot native MF4 channels; files stay on your device.';
	const siteUrl = 'https://cantraceviewer.com/';
	const landingTitle = 'Plot CAN bus logs in your browser';
	const landingDescription =
		'Open an ASC, TRC, BLF or MF4 trace. Decode raw CAN with a DBC or plot native MF4 signals. Files stay on this device.';
	const structuredData = {
		'@context': 'https://schema.org',
		'@graph': [
			{
				'@type': 'WebSite',
				'@id': `${siteUrl}#website`,
				url: siteUrl,
				name: siteTitle,
				description: siteDescription
			},
			{
				'@type': 'WebApplication',
				'@id': `${siteUrl}#application`,
				url: siteUrl,
				name: siteTitle,
				description: siteDescription,
				applicationCategory: 'UtilitiesApplication',
				operatingSystem: 'Any operating system with a WebGPU-capable browser',
				browserRequirements: 'WebGPU support and a viewport of at least 600 by 500 pixels',
				softwareRequirements: 'WebGPU',
				isAccessibleForFree: true,
				offers: {
					'@type': 'Offer',
					price: 0
				},
				codeRepository: 'https://github.com/tomrford/cantraceviewer',
				license: 'https://github.com/tomrford/cantraceviewer/blob/main/LICENSE.md',
				featureList: [
					'Plot ASC, PCAN TRC 1.x and 2.x, BLF, and MF4 data',
					'Decode CAN signals with DBC files',
					'Plot native decoded MF4 measurement channels',
					'Process files locally in the browser'
				]
			}
		]
	};
	const squircleButtonClass =
		'flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground transition-[background-color,border-color,color,box-shadow,opacity,scale] hover:bg-sidebar-primary/90 focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-hidden active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50';
	const titleButtonClass =
		'flex h-10 max-w-[min(28rem,calc(100vw-12rem))] items-center gap-2 rounded-lg border border-border/70 bg-muted px-4 text-sm font-medium text-foreground transition-[box-shadow,scale] hover:bg-muted/80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60';

	onMount(() => {
		webgpuSupported = 'gpu' in navigator;
		shortcutPlatform = detectShortcutPlatform();
		void dbcFiles.loadLibrary();
	});

	function handleShortcut(event: KeyboardEvent): void {
		const action = shortcutFromEvent(event, shortcutPlatform);
		if (action === null) return;

		// Claim browser-bound chords as soon as they match. Declining later without this lets the
		// browser run its own default — Cmd+O opens its file dialog, which downloads any trace it
		// cannot render instead of loading it.
		if (overridesBrowserShortcut(action)) event.preventDefault();

		if (shortcutSuppressedBySurface(event.target)) return;
		if (!shortcutEnabled(action, shortcutState)) return;

		runShortcut(action);
		event.preventDefault();
	}

	/** The one place an action happens, whether it came from a key or the command palette. */
	function runShortcut(action: ShortcutAction): void {
		switch (action) {
			case 'openTrace':
				traceInput?.click();
				break;
			case 'selectSignals':
				void focusSignalSearch();
				break;
			case 'showPalette':
				openPalette();
				break;
			case 'openSettings':
				handleSignalSelectorOpen(false);
				settingsOpen = true;
				break;
			case 'showHelp':
				openHelp();
				break;
			case 'zoomIn':
				plotViewport.zoomBy(0.5);
				break;
			case 'zoomOut':
				plotViewport.zoomBy(2);
				break;
			case 'resetZoom':
				plotViewport.reset();
				break;
			case 'toggleBoxZoom':
				boxZoomEnabled = !boxZoomEnabled;
				break;
			case 'toggleLegend':
				legendVisible = !legendVisible;
				break;
			case 'placeC1':
				placeCrosshair(1);
				break;
			case 'placeC2':
				placeCrosshair(2);
				break;
		}
	}

	async function focusSignalSearch(): Promise<void> {
		settingsOpen = false;
		// Route through the open handler rather than assigning: it is the setter half of the
		// popover's binding, so opening by shortcut has to run it to stay indistinguishable
		// from opening by click — the walkthrough advances from there.
		handleSignalSelectorOpen(true);
		await tick();
		signalSearchFocusRequest += 1;
	}

	// Falls back to the viewport centre when the pointer is off the plot, which is where the
	// toolbar already places crosshairs — and the only sensible anchor from the palette.
	function placeCrosshair(id: CrosshairId): void {
		const activeViewport = plotViewport.activeViewport;
		if (activeViewport === null) return;
		crosshairs = setCrosshair(crosshairs, {
			id,
			...(plotPointerRatio === null
				? viewportCenter(activeViewport)
				: dataPointAtRatio(activeViewport, plotPointerRatio))
		});
	}

	async function startWalkthrough(): Promise<void> {
		await showWalkthroughStep('trace');
	}

	function openHelp(): void {
		settingsOpen = false;
		helpOpen = true;
	}

	function openPalette(): void {
		settingsOpen = false;
		handleSignalSelectorOpen(false);
		paletteOpen = true;
	}

	// The legend's mode select sits under the toolbar, so opening the crosshair menu on top of it
	// would leave two overlapping menus.
	function handleCrosshairMenuOpen(open: boolean): void {
		crosshairMenuOpen = open;
		if (open) legendSelectOpen = false;
	}

	function handleSignalSelectorOpen(open: boolean): void {
		signalSelectorOpen = open;
		if (open && walkthroughStepId === 'library') {
			void showWalkthroughStep('add-dbc');
		} else if (!open && (walkthroughStepId === 'add-dbc' || walkthroughStepId === 'signals')) {
			void showWalkthroughStep('library');
		}
	}

	function handleDbcAdded(): void {
		if (walkthroughStepId === 'add-dbc') void showWalkthroughStep('signals');
	}

	function handleSignalToggle(): void {
		if (walkthroughStepId === 'signals') void showWalkthroughStep('controls');
	}

	async function showWalkthroughStep(stepId: WalkthroughStep['id']): Promise<void> {
		walkthroughStepId = null;
		settingsOpen = false;
		signalSelectorOpen = stepId === 'add-dbc' || stepId === 'signals';
		await tick();
		walkthroughStepId = stepId;
	}

	async function advanceWalkthrough(): Promise<void> {
		if (!walkthroughStepId) return;
		const nextStep = adjacentWalkthroughStep(walkthroughStepId, 1);
		if (!nextStep) {
			finishWalkthrough();
			return;
		}
		await showWalkthroughStep(nextStep.id);
	}

	function finishWalkthrough(): void {
		walkthroughVersion.current = WALKTHROUGH_VERSION;
		walkthroughStepId = null;
		signalSelectorOpen = false;
	}

	async function selectTrace(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0] ?? null;
		input.value = '';

		await openTraceFile(file);
	}

	async function openTraceFile(file: File | null) {
		if (!file || traceFile.isLoading) return;
		if (await traceFile.openFile(file)) {
			await onTraceOpened();
			if (walkthroughStepId === 'trace') await showWalkthroughStep('library');
		}
	}

	function handleTraceDrag(event: DragEvent) {
		if (!hasDraggedFiles(event)) return;

		event.preventDefault();
		if (traceFile.isLoading) return;

		traceDropActive = true;
	}

	function clearTraceDrag(event: DragEvent) {
		if (!dragLeftCurrentTarget(event)) return;

		traceDropActive = false;
	}

	async function dropTrace(event: DragEvent) {
		event.preventDefault();
		traceDropActive = false;
		await openTraceFile(traceFileFromDrop(filesFromDrop(event)));
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
</script>

<svelte:window onkeydown={handleShortcut} />

<svelte:head>
	<title>{browserTitle}</title>
	<meta name="description" content={siteDescription} />
	<meta name="theme-color" content="#09090b" />
	<link rel="canonical" href={siteUrl} />

	<meta property="og:type" content="website" />
	<meta property="og:site_name" content={siteTitle} />
	<meta property="og:title" content={shareTitle} />
	<meta property="og:description" content={siteDescription} />
	<meta property="og:url" content={siteUrl} />
	<meta property="og:image" content="https://cantraceviewer.com/og-image.png" />
	<meta property="og:image:alt" content="CAN Trace Viewer plotting decoded CAN bus signals" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />

	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={shareTitle} />
	<meta name="twitter:description" content={siteDescription} />
	<meta name="twitter:image" content="https://cantraceviewer.com/og-image.png" />
	<meta name="twitter:image:alt" content="CAN Trace Viewer plotting decoded CAN bus signals" />

	<svelte:element this={'script'} type="application/ld+json">
		{JSON.stringify(structuredData)}
	</svelte:element>
</svelte:head>

<main
	class="viewport-gate flex min-h-screen items-center justify-center bg-background px-6 text-center"
>
	<div class="max-w-md space-y-2">
		<h1 class="text-base font-medium text-foreground">{landingTitle}</h1>
		<p class="text-sm text-muted-foreground">{landingDescription}</p>
		<p class="text-sm text-muted-foreground">
			CAN Trace Viewer needs a viewport of at least 600 px wide and 500 px tall. It works best on
			desktop or tablet.
		</p>
	</div>
</main>

{#if webgpuSupported === false}
	<main
		class="webgpu-gate flex min-h-screen items-center justify-center bg-background px-6 text-center"
	>
		<div class="max-w-sm space-y-2">
			<h1 class="text-base font-medium text-foreground">WebGPU required</h1>
			<p class="text-sm text-muted-foreground">
				This browser does not support WebGPU, so CAN Trace Viewer cannot render plots. Try a recent
				desktop browser with WebGPU enabled.
			</p>
		</div>
	</main>
{:else}
	<div class="app-shell flex min-h-screen flex-col bg-background">
		<header
			class="relative flex h-16 shrink-0 items-center justify-between gap-2 border-b px-4"
			aria-busy={traceFile.isLoading}
		>
			<div class="flex items-center">
				<Popover.Root bind:open={() => signalSelectorOpen, handleSignalSelectorOpen}>
					<Tooltip.Root>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<Popover.Trigger
									{...props}
									class={squircleButtonClass}
									data-walkthrough-target="signal-selector"
									aria-label="Open signal selector"
								>
									<DatabaseIcon class="size-4" />
								</Popover.Trigger>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content sideOffset={6}>
							Signal selector
							<ShortcutKey keys={shortcutKeys('selectSignals', shortcutPlatform)} />
						</Tooltip.Content>
					</Tooltip.Root>
					<SignalSelectorDialog
						focusSearchRequest={signalSearchFocusRequest}
						onDbcAdded={handleDbcAdded}
						onSignalToggle={handleSignalToggle}
					/>
				</Popover.Root>
			</div>

			<div
				class="pointer-events-none flex min-w-0 flex-1 items-center justify-center lg:absolute lg:inset-0 lg:px-20"
			>
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<button
								{...props}
								type="button"
								class="{titleButtonClass} pointer-events-auto w-full lg:w-auto"
								data-walkthrough-target="trace"
								disabled={traceFile.isLoading}
								aria-label={traceFile.isLoading ? 'Loading trace' : 'Load trace'}
								onclick={() => traceInput?.click()}
							>
								<AudioWaveformIcon class="size-4 shrink-0 text-sidebar-primary" />
								<span class="min-w-0 truncate text-sm font-medium">{traceFile.displayName}</span>
								{#if traceFile.isLoading}
									<LoaderCircleIcon
										class="size-4 shrink-0 animate-spin text-muted-foreground"
										aria-hidden="true"
									/>
									<span class="sr-only">Loading trace</span>
								{/if}
							</button>
						{/snippet}
					</Tooltip.Trigger>
					<!-- Action and shortcut share one row so the chip always has a single-line partner;
					     trace details sit underneath as secondary text. -->
					<Tooltip.Content sideOffset={6} class="flex-col items-stretch gap-1 pr-3">
						<span class="flex items-center gap-3">
							{traceFile.isLoading ? 'Loading trace' : 'Open trace'}
							{#if !traceFile.isLoading}
								<ShortcutKey keys={shortcutKeys('openTrace', shortcutPlatform)} class="ml-auto" />
							{/if}
						</span>
						{#if traceMetadataTitle}
							<span class="whitespace-pre-line text-muted-foreground">{traceMetadataTitle}</span>
						{/if}
					</Tooltip.Content>
				</Tooltip.Root>
			</div>

			<input
				bind:this={traceInput}
				class="hidden"
				type="file"
				accept={TRACE_FILE_ACCEPT}
				disabled={traceFile.isLoading}
				onchange={selectTrace}
			/>

			<div class="flex items-center gap-2" data-walkthrough-target="plot-controls">
				<div class="flex items-center">
					<PlotToolbar
						disabled={plotControlsDisabled}
						{canResetZoom}
						viewport={plotViewport.activeViewport}
						bind:boxZoomEnabled
						bind:crosshairs
						bind:crosshairMenuOpen={() => crosshairMenuOpen, handleCrosshairMenuOpen}
						bind:legendVisible
						{shortcutPlatform}
						onZoomIn={() => plotViewport.zoomBy(0.5)}
						onZoomOut={() => plotViewport.zoomBy(2)}
						onResetZoom={() => plotViewport.reset()}
					/>
				</div>
				<Popover.Root bind:open={settingsOpen}>
					<Tooltip.Root>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<Popover.Trigger {...props} class={squircleButtonClass} aria-label="Open settings">
									<CogIcon class="size-4" />
								</Popover.Trigger>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content sideOffset={6}>
							Settings
							<ShortcutKey keys={shortcutKeys('openSettings', shortcutPlatform)} />
						</Tooltip.Content>
					</Tooltip.Root>
					<SettingsDialog {shortcutPlatform} onOpenHelp={openHelp} />
				</Popover.Root>
			</div>
		</header>
		{#if traceFile.entry}
			<SignalPlot
				viewport={plotViewport}
				bind:crosshairs
				bind:legendCrosshairMode
				bind:boxZoomEnabled
				bind:legendVisible
				bind:legendSelectOpen
				bind:pointerRatio={plotPointerRatio}
				{shortcutPlatform}
				dropActive={traceDropActive}
				ondragenter={handleTraceDrag}
				ondragover={handleTraceDrag}
				ondragleave={clearTraceDrag}
				ondrop={dropTrace}
			/>
		{:else}
			<section
				class="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-background p-6"
				aria-label="Trace loading"
				aria-busy={traceFile.isLoading}
				ondragenter={handleTraceDrag}
				ondragover={handleTraceDrag}
				ondragleave={clearTraceDrag}
				ondrop={dropTrace}
			>
				{#if traceDropActive}
					<div
						class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/25 text-sm font-medium text-foreground backdrop-blur-[1px]"
					>
						Drop trace to open
					</div>
				{/if}
				<Empty.Root class="max-w-md border-0">
					<Empty.Header>
						<h1 class="font-heading text-base font-medium tracking-tight">{landingTitle}</h1>
						<Empty.Description>{landingDescription}</Empty.Description>
					</Empty.Header>
					<Empty.Content class="max-w-none flex-row justify-center">
						<Button size="lg" disabled={traceFile.isLoading} onclick={() => traceInput?.click()}>
							{#if traceFile.isLoading}
								<LoaderCircleIcon data-icon="inline-start" class="size-4 animate-spin" />
								Loading trace...
							{:else}
								<AudioWaveformIcon data-icon="inline-start" class="size-4" />
								Open trace
							{/if}
						</Button>
						{#if walkthroughInvitationVisible}
							<Button variant="outline" size="lg" onclick={() => void startWalkthrough()}>
								<CircleHelpIcon data-icon="inline-start" class="size-4" />
								First time? Take a tour
							</Button>
						{/if}
					</Empty.Content>
				</Empty.Root>
			</section>
		{/if}

		{#if traceFile.warning}
			<div
				class="fixed top-3 right-3 z-50 flex max-w-sm items-start gap-2 rounded-md border border-amber-400/40 bg-amber-50 px-3 py-2 text-xs/relaxed text-amber-950 shadow-sm dark:border-amber-400/30 dark:bg-amber-950/80 dark:text-amber-100"
				role="status"
			>
				<TriangleAlertIcon class="mt-0.5 size-4 shrink-0" />
				<p class="min-w-0 flex-1">{traceFile.warning}</p>
				<Button
					variant="ghost"
					size="icon"
					class="-mt-1 -mr-1 size-6 shrink-0 text-current hover:bg-amber-950/10 dark:hover:bg-amber-100/10"
					aria-label="Dismiss trace warning"
					onclick={() => traceFile.clearWarning()}
				>
					<XIcon class="size-3.5" />
				</Button>
			</div>
		{/if}

		<AlertDialog.Root
			bind:open={() => traceFile.error !== null, (open) => !open && traceFile.clearError()}
		>
			{#if traceFile.error}
				<AlertDialog.Content>
					<AlertDialog.Header>
						<AlertDialog.Title>Trace failed to open</AlertDialog.Title>
						<AlertDialog.Description>{traceFile.error}</AlertDialog.Description>
					</AlertDialog.Header>
					<AlertDialog.Footer>
						<AlertDialog.Action onclick={() => traceFile.clearError()}>OK</AlertDialog.Action>
					</AlertDialog.Footer>
				</AlertDialog.Content>
			{/if}
		</AlertDialog.Root>

		{#if walkthroughStep}
			<Walkthrough
				step={walkthroughStep}
				stepIndex={walkthroughStepIndex}
				stepCount={WALKTHROUGH_STEPS.length}
				onAdvance={() => void advanceWalkthrough()}
			/>
		{/if}

		<HelpDialog
			bind:open={helpOpen}
			{shortcutPlatform}
			onStartWalkthrough={() => void startWalkthrough()}
		/>

		<CommandPalette
			bind:open={paletteOpen}
			{shortcutPlatform}
			state={shortcutState}
			onRun={runShortcut}
		/>
	</div>
{/if}

<style>
	.viewport-gate {
		display: none;
	}

	@media (max-width: 599px), (max-height: 499px) {
		.viewport-gate {
			display: flex;
		}

		.webgpu-gate,
		.app-shell {
			display: none;
		}
	}
</style>
