<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Table from '$lib/components/ui/table';
	import { parseDbcText, type ParsedDbc } from '$lib/dbc-wasm';

	let fileInput: HTMLInputElement;
	let fileName = $state('');
	let dbc = $state<ParsedDbc | null>(null);
	let error = $state('');
	let loading = $state(false);

	let signalCount = $derived(
		dbc?.messages.reduce((total, message) => total + message.signals.length, 0) ?? 0
	);

	async function openFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];

		if (!file) return;

		loading = true;
		error = '';
		fileName = file.name;
		dbc = null;

		try {
			dbc = await parseDbcText(await file.text());
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'DBC parse failed';
		} finally {
			loading = false;
			input.value = '';
		}
	}
</script>

<svelte:head>
	<title>DBC demo</title>
</svelte:head>

<main class="min-h-screen bg-background text-foreground">
	<section class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
		<header class="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
			<div>
				<p class="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
					WASM parse flow
				</p>
				<h1 class="mt-2 text-2xl font-semibold">DBC viewer demo</h1>
			</div>

			<div class="flex items-center gap-3">
				<input
					bind:this={fileInput}
					class="hidden"
					type="file"
					accept=".dbc,text/plain"
					onchange={openFile}
				/>
				<Button type="button" onclick={() => fileInput.click()} disabled={loading}>
					{loading ? 'Parsing...' : 'Open DBC'}
				</Button>
			</div>
		</header>

		{#if error}
			<p class="border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
				{error}
			</p>
		{/if}

		{#if dbc}
			<div class="grid grid-cols-3 gap-3 text-sm">
				<div class="border px-3 py-2">
					<p class="text-muted-foreground">File</p>
					<p class="mt-1 truncate font-medium">{fileName}</p>
				</div>
				<div class="border px-3 py-2">
					<p class="text-muted-foreground">Messages</p>
					<p class="mt-1 font-medium">{dbc.messages.length}</p>
				</div>
				<div class="border px-3 py-2">
					<p class="text-muted-foreground">Signals</p>
					<p class="mt-1 font-medium">{signalCount}</p>
				</div>
			</div>

			<Table.Root class="text-sm">
				<Table.Header>
					<Table.Row>
						<Table.Head>Name</Table.Head>
						<Table.Head>DBC ID</Table.Head>
						<Table.Head>CAN ID</Table.Head>
						<Table.Head>Bytes</Table.Head>
						<Table.Head>Transmitter</Table.Head>
						<Table.Head>Signals</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each dbc.messages as message (message.dbcId)}
						<Table.Row>
							<Table.Cell class="font-medium">{message.name}</Table.Cell>
							<Table.Cell>{message.dbcId}</Table.Cell>
							<Table.Cell>{message.canId}</Table.Cell>
							<Table.Cell>{message.sizeBytes}</Table.Cell>
							<Table.Cell>{message.transmitter}</Table.Cell>
							<Table.Cell>
								<div class="flex max-w-xl flex-wrap gap-1">
									{#each message.signals as signal (signal.name)}
										<span class="border bg-muted px-1.5 py-0.5 text-xs">{signal.name}</span>
									{/each}
								</div>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{:else if !loading}
			<div
				class="flex min-h-72 items-center justify-center border border-dashed text-sm text-muted-foreground"
			>
				Open a .dbc file to parse it through the Zig WASM module.
			</div>
		{/if}
	</section>
</main>
