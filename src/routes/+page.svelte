<script lang="ts">
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import AppSidebar from '$lib/components/app-sidebar.svelte';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { plotData } from '$lib/stores/plot-data.svelte.js';
	import { traceFile } from '$lib/stores/trace-file.svelte.js';
	import type { TraceMetadata } from '$lib/wasm.js';
	import AudioWaveformIcon from '@lucide/svelte/icons/audio-waveform';

	let traceInput: HTMLInputElement;
	let traceMetadataTitle = $derived(
		traceFile.entry ? formatTraceMetadata(traceFile.entry.metadata) : undefined
	);

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
	<title>CAN log viewer</title>
</svelte:head>

<Sidebar.Provider style="--sidebar-width: 24rem;">
	<AppSidebar />
	<Sidebar.Inset class="min-h-screen bg-background">
		<header class="flex h-16 shrink-0 items-center gap-2 border-b px-4">
			<Sidebar.Trigger
				class="-ms-1"
				aria-label="Show/hide DBC and signal selector"
				title="Show/hide DBC and signal selector"
			/>
			<Separator orientation="vertical" class="me-2 data-[orientation=vertical]:h-4" />
			{#if traceFile.entry}
				<span class="min-w-0 truncate text-sm font-medium" title={traceMetadataTitle}
					>{traceFile.displayName}</span
				>
			{:else}
				<span class="ms-auto text-sm text-muted-foreground">Upload a trace to get started -></span>
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
				onclick={() => traceInput.click()}
			>
				<AudioWaveformIcon class="size-4" />
			</button>
		</header>
	</Sidebar.Inset>
</Sidebar.Provider>

<AlertDialog.Root
	bind:open={() => traceFile.error !== null, (open) => !open && traceFile.clearError()}
>
	{#if traceFile.error}
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title>Trace upload failed</AlertDialog.Title>
				<AlertDialog.Description>{traceFile.error}</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Action onclick={() => traceFile.clearError()}>OK</AlertDialog.Action>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	{/if}
</AlertDialog.Root>
