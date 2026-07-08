<script lang="ts">
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import AppSidebar from '$lib/components/app-sidebar.svelte';
	import PlotToolbar from '$lib/components/plot-toolbar.svelte';
	import SettingsDialog from '$lib/components/settings-dialog.svelte';
	import SignalPlot from '$lib/components/signal-plot.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Empty from '$lib/components/ui/empty/index.js';
	import {
		dragLeftCurrentTarget,
		filesFromDrop,
		hasDraggedFiles,
		traceFileFromDrop
	} from '$lib/file-drop.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { PlotViewportState } from '$lib/plot-viewport-state.svelte.js';
	import { plotData } from '$lib/stores/plot-data.svelte.js';
	import { sidebarOpen } from '$lib/stores/preferences.svelte.js';
	import { onTraceOpened } from '$lib/stores/session.js';
	import { traceFile } from '$lib/stores/trace-file.svelte.js';
	import { TRACE_FILE_ACCEPT } from '$lib/trace-file-types.js';
	import type { TraceMetadata } from '$lib/wasm.js';
	import AudioWaveformIcon from '@lucide/svelte/icons/audio-waveform';
	import CogIcon from '@lucide/svelte/icons/cog';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import { onMount } from 'svelte';

	let traceInput = $state<HTMLInputElement>();
	let traceDropActive = $state(false);
	let webgpuSupported = $state<boolean | null>(null);
	let markerEnabled = $state(false);
	let markerX = $state<number | null>(null);
	let boxZoomEnabled = $state(false);
	let legendVisible = $state(true);
	const plotViewport = new PlotViewportState();
	const plotControlsDisabled = $derived(!plotData.hasPlottableSignals || traceFile.isLoading);
	const canResetZoom = $derived(plotData.hasPlottableSignals && !plotViewport.isFitAll);
	let traceMetadataTitle = $derived(
		traceFile.entry ? formatTraceMetadata(traceFile.entry.metadata) : undefined
	);
	const siteTitle = 'CAN Trace Viewer';
	const siteDescription = 'Lightweight browser-based CAN trace plotting and analysis GUI.';
	const siteUrl = 'https://cantraceviewer.com/';

	onMount(() => {
		webgpuSupported = 'gpu' in navigator;
	});

	async function selectTrace(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0] ?? null;
		input.value = '';

		await openTraceFile(file);
	}

	async function openTraceFile(file: File | null) {
		if (!file || traceFile.isLoading) return;
		if (await traceFile.openFile(file)) {
			onTraceOpened();
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

	function formatTraceMetadata(metadata: TraceMetadata): string {
		const start = metadata.measurementStartMs
			? new Date(metadata.measurementStartMs).toLocaleString()
			: 'Not available';
		const duration =
			metadata.durationNs === null ? 'Not available' : formatDuration(metadata.durationNs);

		return [
			`Start: ${start}`,
			`Valid messages: ${metadata.validMessageCount.toLocaleString()}`,
			`Duration: ${duration}`
		].join('\n');
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

<svelte:head>
	<title>{siteTitle}</title>
	<meta name="description" content={siteDescription} />
	<meta name="theme-color" content="#09090b" />
	<link rel="canonical" href={siteUrl} />

	<meta property="og:type" content="website" />
	<meta property="og:site_name" content={siteTitle} />
	<meta property="og:title" content={siteTitle} />
	<meta property="og:description" content={siteDescription} />
	<meta property="og:url" content={siteUrl} />
	<meta property="og:image" content="https://cantraceviewer.com/og-image.png" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />

	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={siteTitle} />
	<meta name="twitter:description" content={siteDescription} />
	<meta name="twitter:image" content="https://cantraceviewer.com/og-image.png" />
</svelte:head>

<main
	class="viewport-gate flex min-h-screen items-center justify-center bg-background px-6 text-center"
>
	<div class="max-w-sm space-y-2">
		<h1 class="text-base font-medium text-foreground">Screen too small</h1>
		<p class="text-sm text-muted-foreground">
			CAN Trace Viewer needs a viewport of at least 600 px in both width and height. It works best
			on desktop or tablet.
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
	<div class="app-shell">
		<Sidebar.Provider
			style="--sidebar-width: 24rem;"
			open={sidebarOpen.current}
			onOpenChange={(open) => (sidebarOpen.current = open)}
		>
			<AppSidebar />
			<Sidebar.Inset class="flex min-h-screen flex-col bg-background">
				<header
					class="flex h-16 shrink-0 items-center gap-2 border-b px-4"
					aria-busy={traceFile.isLoading}
				>
					<Sidebar.Trigger
						class="-ms-1 transition-[background-color,border-color,color,box-shadow,opacity,scale] active:scale-[0.96]"
						aria-label="Show/hide DBC and signal selector"
						title="Show/hide DBC and signal selector"
					/>
					<Separator orientation="vertical" class="me-2 data-[orientation=vertical]:h-4" />
					<span class="min-w-0 truncate text-sm font-medium" title={traceMetadataTitle}
						>{traceFile.displayName}</span
					>
					{#if traceFile.isLoading}
						<LoaderCircleIcon
							class="size-4 shrink-0 animate-spin text-muted-foreground"
							aria-hidden="true"
						/>
						<span class="sr-only">Loading trace</span>
					{/if}
					<input
						bind:this={traceInput}
						class="hidden"
						type="file"
						accept={TRACE_FILE_ACCEPT}
						disabled={traceFile.isLoading}
						onchange={selectTrace}
					/>
					{#if traceFile.entry}
						<button
							type="button"
							class="flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground transition-[background-color,border-color,color,box-shadow,opacity,scale] hover:bg-sidebar-primary/90 focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-hidden active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50"
							disabled={traceFile.isLoading}
							aria-label={traceFile.isLoading ? 'Loading trace' : 'Load trace'}
							title={traceFile.isLoading ? 'Loading trace' : 'Load trace'}
							onclick={() => traceInput?.click()}
						>
							<AudioWaveformIcon class="size-4" />
						</button>
					{/if}
					<span class="ms-auto"></span>
					{#if traceFile.entry}
						<PlotToolbar
							disabled={plotControlsDisabled}
							{canResetZoom}
							bind:boxZoomEnabled
							bind:markerEnabled
							bind:legendVisible
							onZoomIn={() => plotViewport.zoomBy(0.5)}
							onZoomOut={() => plotViewport.zoomBy(2)}
							onResetZoom={() => plotViewport.reset()}
						/>
					{/if}
					<Popover.Root>
						<Popover.Trigger
							class="flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground transition-[background-color,border-color,color,box-shadow,opacity,scale] hover:bg-sidebar-primary/90 focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-hidden active:scale-[0.96]"
							aria-label="Open settings"
							title="Settings"
						>
							<CogIcon class="size-4" />
						</Popover.Trigger>
						<SettingsDialog />
					</Popover.Root>
				</header>
				{#if traceFile.entry}
					<SignalPlot
						viewport={plotViewport}
						bind:markerEnabled
						bind:markerX
						bind:boxZoomEnabled
						bind:legendVisible
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
								<Empty.Title>Open a trace</Empty.Title>
								<Empty.Description>
									Load an ASC, TRC, or BLF file to start plotting decoded CAN signals.
								</Empty.Description>
							</Empty.Header>
							<Empty.Content>
								<Button
									size="lg"
									disabled={traceFile.isLoading}
									onclick={() => traceInput?.click()}
								>
									{#if traceFile.isLoading}
										<LoaderCircleIcon data-icon="inline-start" class="size-4 animate-spin" />
										Loading trace...
									{:else}
										<AudioWaveformIcon data-icon="inline-start" class="size-4" />
										Open trace
									{/if}
								</Button>
							</Empty.Content>
						</Empty.Root>
					</section>
				{/if}
			</Sidebar.Inset>
		</Sidebar.Provider>

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
	</div>
{/if}

<style>
	.viewport-gate {
		display: none;
	}

	@media (max-width: 599px), (max-height: 599px) {
		.viewport-gate {
			display: flex;
		}

		.webgpu-gate,
		.app-shell {
			display: none;
		}
	}
</style>
