<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import RendererSpikeStage from '$lib/components/renderer-spike-stage.svelte';
	import type { RendererId } from '$lib/renderer-spike/drivers.js';
	import { roundMs } from '$lib/renderer-spike/metrics.js';
	import { formatReport, runRendererSpike, type SuiteReport } from '$lib/renderer-spike/suite.js';
	import {
		SPIKE_POINTS_PER_SERIES,
		SPIKE_SERIES_COUNT,
		SPIKE_TOTAL_POINTS
	} from '$lib/renderer-spike/workload.js';

	let running = $state(false);
	let overlay = $state(true);
	let preview = $state<RendererId>('tanstack-canvas');
	let report = $state.raw<SuiteReport | null>(null);
	let error = $state<string | null>(null);
	let copied = $state(false);

	const previewOptions: { id: RendererId; label: string }[] = [
		{ id: 'chartgpu', label: 'ChartGPU' },
		{ id: 'tanstack-canvas', label: 'TanStack Canvas marks' },
		{ id: 'tanstack-svg', label: 'TanStack SVG' }
	];

	async function runSuite() {
		if (running) return;
		running = true;
		error = null;
		copied = false;
		try {
			report = await runRendererSpike();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			running = false;
		}
	}

	async function copyReport() {
		if (report === null) return;
		await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
		copied = true;
	}
</script>

<svelte:head>
	<title>Renderer spike</title>
</svelte:head>

<main class="mx-auto flex min-h-svh max-w-5xl flex-col gap-6 px-6 py-8">
	<header class="flex flex-col gap-2">
		<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Issue 148</p>
		<h1 class="text-xl font-semibold">TanStack Charts renderer spike</h1>
		<p class="max-w-3xl text-sm text-muted-foreground">
			Frozen workload: {SPIKE_SERIES_COUNT} series × {SPIKE_POINTS_PER_SERIES.toLocaleString()} points
			({SPIKE_TOTAL_POINTS.toLocaleString()} total), two y axes, stable series identity, 60 domain-only
			pans, 10 resizes, then destroy. Timed hosts are off-screen. The preview below is for overlay coexistence
			and a visual check. This route is not a product renderer.
		</p>
	</header>

	<div class="flex flex-wrap items-center gap-2">
		<Button onclick={runSuite} disabled={running}>
			{running ? 'Running…' : 'Run benchmark'}
		</Button>
		<Button variant="outline" onclick={copyReport} disabled={report === null}>
			{copied ? 'Copied' : 'Copy JSON'}
		</Button>
		<label class="flex items-center gap-2 text-sm">
			<input type="checkbox" bind:checked={overlay} />
			Plot overlay on preview
		</label>
	</div>

	{#if error}
		<p class="text-sm text-destructive">{error}</p>
	{/if}

	{#if report}
		<section class="flex flex-col gap-3">
			<h2 class="text-sm font-medium">Results</h2>
			<p class="text-xs text-muted-foreground">{report.userAgent}</p>
			<div class="overflow-x-auto rounded-md border">
				<table class="w-full text-left text-sm">
					<thead class="bg-muted/40 text-xs text-muted-foreground">
						<tr>
							<th class="px-3 py-2 font-medium">Renderer</th>
							<th class="px-3 py-2 font-medium">Scenario</th>
							<th class="px-3 py-2 font-medium">CPU median</th>
							<th class="px-3 py-2 font-medium">CPU p95</th>
							<th class="px-3 py-2 font-medium">Frame median</th>
							<th class="px-3 py-2 font-medium">Notes</th>
						</tr>
					</thead>
					<tbody>
						{#each report.results as result (result.renderer + result.scenario)}
							<tr class="border-t">
								<td class="px-3 py-2">{result.label}</td>
								<td class="px-3 py-2">{result.scenario}</td>
								{#if result.skipped}
									<td class="px-3 py-2 text-muted-foreground" colspan="3">{result.skipped}</td>
									<td class="px-3 py-2"></td>
								{:else}
									<td class="px-3 py-2 tabular-nums"
										>{result.cpu ? `${roundMs(result.cpu.medianMs)} ms` : '—'}</td
									>
									<td class="px-3 py-2 tabular-nums"
										>{result.cpu ? `${roundMs(result.cpu.p95Ms)} ms` : '—'}</td
									>
									<td class="px-3 py-2 tabular-nums">
										{result.frame ? `${roundMs(result.frame.medianMs)} ms` : '—'}
									</td>
									<td class="px-3 py-2 text-muted-foreground">
										{#if result.scene}
											{result.scene.polylines} lines, {result.scene.points} points, {result.scene
												.polylineVertices} vertices
										{/if}
									</td>
								{/if}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<pre class="overflow-x-auto rounded-md bg-muted/40 p-3 text-xs">{formatReport(report)}</pre>
		</section>
	{/if}

	<section class="flex flex-col gap-3">
		<div class="flex flex-wrap items-center gap-2">
			<h2 class="text-sm font-medium">Preview</h2>
			{#each previewOptions as option (option.id)}
				<Button
					size="sm"
					variant={preview === option.id ? 'default' : 'outline'}
					onclick={() => (preview = option.id)}
				>
					{option.label}
				</Button>
			{/each}
		</div>
		<div class="overflow-hidden rounded-md border">
			{#key preview}
				<RendererSpikeStage renderer={preview} {overlay} />
			{/key}
		</div>
	</section>
</main>
