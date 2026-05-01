<script lang="ts">
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import AppSidebar from '$lib/components/app-sidebar.svelte';
	import SignalPlot from '$lib/components/signal-plot.svelte';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { plotData } from '$lib/stores/plot-data.svelte.js';
	import { traceFile } from '$lib/stores/trace-file.svelte.js';
	import type { TraceMetadata } from '$lib/wasm.js';
	import AudioWaveformIcon from '@lucide/svelte/icons/audio-waveform';
	import { onMount } from 'svelte';

	let traceInput = $state<HTMLInputElement>();
	let supportStatus = $state<'checking' | 'supported' | 'mobile' | 'webgpu'>('checking');
	let traceMetadataTitle = $derived(
		traceFile.entry ? formatTraceMetadata(traceFile.entry.metadata) : undefined
	);
	const siteTitle = 'CAN Trace Viewer';
	const siteDescription = 'Lightweight browser-based CAN trace plotting and analysis GUI.';
	const siteUrl = 'https://cantraceviewer.com/';

	onMount(() => {
		const mobileQuery = window.matchMedia('(max-width: 767px), (pointer: coarse)');
		if (mobileQuery.matches) {
			supportStatus = 'mobile';
			return;
		}

		if (!('gpu' in navigator)) {
			supportStatus = 'webgpu';
			return;
		}

		supportStatus = 'supported';
	});

	async function selectTrace(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0] ?? null;
		input.value = '';

		if (!file) return;
		if (await traceFile.openFile(file)) {
			plotData.clearSelectedSignals();
		}
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

	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content={siteTitle} />
	<meta name="twitter:description" content={siteDescription} />
</svelte:head>

{#if supportStatus === 'supported'}
	<Sidebar.Provider style="--sidebar-width: 24rem;">
		<AppSidebar />
		<Sidebar.Inset class="flex min-h-screen flex-col bg-background">
			<header class="flex h-16 shrink-0 items-center gap-2 border-b px-4">
				<Sidebar.Trigger
					class="-ms-1"
					aria-label="Show/hide DBC and signal selector"
					title="Show/hide DBC and signal selector"
				/>
				<Separator orientation="vertical" class="me-2 data-[orientation=vertical]:h-4" />
				<span class="min-w-0 truncate text-sm font-medium" title={traceMetadataTitle}
					>{traceFile.displayName}</span
				>
				{#if !traceFile.entry}
					<span class="ms-auto text-sm text-muted-foreground">Open a trace to get started -></span>
				{/if}
				<input
					bind:this={traceInput}
					class="hidden"
					type="file"
					accept=".asc"
					onchange={selectTrace}
				/>
				<button
					type="button"
					class={[
						'flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90 focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-hidden',
						traceFile.entry ? 'ms-auto' : ''
					]}
					aria-label="Load ASC trace"
					title="Load ASC trace"
					onclick={() => traceInput?.click()}
				>
					<AudioWaveformIcon class="size-4" />
				</button>
			</header>
			<SignalPlot />
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
{:else if supportStatus === 'mobile'}
	<main class="flex min-h-screen items-center justify-center bg-background px-6 text-center">
		<h1 class="text-base font-medium text-foreground">Not supported on mobile</h1>
	</main>
{:else if supportStatus === 'webgpu'}
	<main class="flex min-h-screen items-center justify-center bg-background px-6 text-center">
		<h1 class="text-base font-medium text-foreground">WebGPU is not supported in this browser</h1>
	</main>
{:else}
	<main class="min-h-screen bg-background" aria-label="Checking browser support">
		<span class="sr-only">Checking browser support</span>
	</main>
{/if}
