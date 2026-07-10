<script lang="ts">
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import PlotToolbar from '$lib/components/plot-toolbar.svelte';
	import SettingsDialog from '$lib/components/settings-dialog.svelte';
	import SignalPlot from '$lib/components/signal-plot.svelte';
	import SignalSelectorDialog from '$lib/components/signal-selector-dialog.svelte';
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
	import { dbcFiles } from '$lib/stores/dbc-files.svelte.js';
	import { plotData } from '$lib/stores/plot-data.svelte.js';
	import { onTraceOpened } from '$lib/stores/session.js';
	import { traceFile } from '$lib/stores/trace-file.svelte.js';
	import { TRACE_FILE_ACCEPT } from '$lib/trace-file-types.js';
	import type { TraceMetadata } from '$lib/wasm.js';
	import AudioWaveformIcon from '@lucide/svelte/icons/audio-waveform';
	import CogIcon from '@lucide/svelte/icons/cog';
	import DatabaseIcon from '@lucide/svelte/icons/database';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import XIcon from '@lucide/svelte/icons/x';
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
	const pageTitle = 'Free online CAN trace viewer for ASC, TRC and BLF logs';
	const siteDescription =
		'Plot and decode ASC, TRC, and BLF CAN bus logs in your browser. Free and open source; files stay on your device with no upload, account, or subscription.';
	const siteUrl = 'https://cantraceviewer.com/';
	const landingTitle = 'Plot CAN bus logs in your browser';
	const landingDescription =
		'Open an ASC, TRC, or BLF trace and use a DBC to plot decoded signals. Free and open source; files stay on this device with no upload, account, or subscription.';
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
				browserRequirements: 'WebGPU support and a viewport of at least 600 by 600 pixels',
				softwareRequirements: 'WebGPU',
				isAccessibleForFree: true,
				offers: {
					'@type': 'Offer',
					price: 0
				},
				codeRepository: 'https://github.com/tomrford/cantraceviewer',
				license: 'https://github.com/tomrford/cantraceviewer/blob/main/LICENSE.md',
				featureList: [
					'Plot ASC, PCAN TRC 1.x and 2.x, and BLF CAN logs',
					'Decode CAN signals with DBC files',
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
		void dbcFiles.loadLibrary();
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
	<title>{pageTitle}</title>
	<meta name="description" content={siteDescription} />
	<meta name="theme-color" content="#09090b" />
	<link rel="canonical" href={siteUrl} />

	<meta property="og:type" content="website" />
	<meta property="og:site_name" content={siteTitle} />
	<meta property="og:title" content={pageTitle} />
	<meta property="og:description" content={siteDescription} />
	<meta property="og:url" content={siteUrl} />
	<meta property="og:image" content="https://cantraceviewer.com/og-image.png" />
	<meta property="og:image:alt" content="CAN Trace Viewer plotting decoded CAN bus signals" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />

	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={pageTitle} />
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
	<div class="app-shell flex min-h-screen flex-col bg-background">
		<header
			class="relative flex h-16 shrink-0 items-center justify-between gap-2 border-b px-4"
			aria-busy={traceFile.isLoading}
		>
			<div class="flex items-center">
				<Popover.Root>
					<Popover.Trigger
						class={squircleButtonClass}
						aria-label="Open signal selector"
						title="Signal selector"
					>
						<DatabaseIcon class="size-4" />
					</Popover.Trigger>
					<SignalSelectorDialog />
				</Popover.Root>
			</div>

			<div
				class="pointer-events-none flex min-w-0 flex-1 items-center justify-center lg:absolute lg:inset-0 lg:px-20"
			>
				<button
					type="button"
					class="{titleButtonClass} pointer-events-auto w-full lg:w-auto"
					disabled={traceFile.isLoading}
					aria-label={traceFile.isLoading ? 'Loading trace' : 'Load trace'}
					title={traceMetadataTitle ?? (traceFile.isLoading ? 'Loading trace' : 'Load trace')}
					onclick={() => traceInput?.click()}
				>
					<AudioWaveformIcon class="size-4 shrink-0 text-sidebar-primary" />
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
				</button>
			</div>

			<input
				bind:this={traceInput}
				class="hidden"
				type="file"
				accept={TRACE_FILE_ACCEPT}
				disabled={traceFile.isLoading}
				onchange={selectTrace}
			/>

			<div class="flex items-center gap-2">
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
					<Popover.Trigger class={squircleButtonClass} aria-label="Open settings" title="Settings">
						<CogIcon class="size-4" />
					</Popover.Trigger>
					<SettingsDialog />
				</Popover.Root>
			</div>
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
						<h1 class="font-heading text-base font-medium tracking-tight">{landingTitle}</h1>
						<Empty.Description>{landingDescription}</Empty.Description>
					</Empty.Header>
					<Empty.Content>
						<Button size="lg" disabled={traceFile.isLoading} onclick={() => traceInput?.click()}>
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
