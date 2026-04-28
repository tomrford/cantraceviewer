<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Table from '$lib/components/ui/table';
	import * as Tabs from '$lib/components/ui/tabs';
	import { parseDbcText, type DbcSignal, type ParsedDbc } from '$lib/dbc-wasm';

	type SignalRow = {
		key: string;
		messageName: string;
		dbcId: number;
		canId: number;
		signal: DbcSignal;
	};

	let fileInput: HTMLInputElement;
	let fileName = $state('');
	let dbc = $state<ParsedDbc | null>(null);
	let error = $state('');
	let loading = $state(false);

	let signalCount = $derived(
		dbc?.messages.reduce((total, message) => total + message.signals.length, 0) ?? 0
	);
	let signalRows = $derived(
		dbc?.messages.flatMap((message) =>
			message.signals.map((signal) => ({
				key: `${message.dbcId}:${signal.name}`,
				messageName: message.name,
				dbcId: message.dbcId,
				canId: message.canId,
				signal
			}))
		) satisfies SignalRow[] | undefined
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

			<Tabs.Root value="messages">
				<Tabs.List>
					<Tabs.Trigger value="messages">Messages</Tabs.Trigger>
					<Tabs.Trigger value="signals">Signals</Tabs.Trigger>
				</Tabs.List>

				<Tabs.Content value="messages" class="border">
					<Table.Root class="text-sm">
						<Table.Header>
							<Table.Row>
								<Table.Head>Name</Table.Head>
								<Table.Head>DBC ID</Table.Head>
								<Table.Head>CAN ID</Table.Head>
								<Table.Head>Format</Table.Head>
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
									<Table.Cell>
										{message.isExtended ? 'extended' : 'standard'}{message.isFd ? ' FD' : ''}
									</Table.Cell>
									<Table.Cell>{message.sizeBytes}</Table.Cell>
									<Table.Cell>{message.transmitter}</Table.Cell>
									<Table.Cell>{message.signals.length}</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</Tabs.Content>

				<Tabs.Content value="signals" class="border">
					<Table.Root class="text-sm">
						<Table.Header>
							<Table.Row>
								<Table.Head>Signal</Table.Head>
								<Table.Head>Message</Table.Head>
								<Table.Head>CAN ID</Table.Head>
								<Table.Head>Bits</Table.Head>
								<Table.Head>Type</Table.Head>
								<Table.Head>Scale</Table.Head>
								<Table.Head>Range</Table.Head>
								<Table.Head>Unit</Table.Head>
								<Table.Head>Receivers</Table.Head>
								<Table.Head>Values</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each signalRows ?? [] as row (row.key)}
								<Table.Row>
									<Table.Cell class="font-medium">{row.signal.name}</Table.Cell>
									<Table.Cell>{row.messageName}</Table.Cell>
									<Table.Cell>{row.canId}</Table.Cell>
									<Table.Cell>{row.signal.startBit}|{row.signal.bitLength}</Table.Cell>
									<Table.Cell>{row.signal.endianness} {row.signal.signedness}</Table.Cell>
									<Table.Cell>{row.signal.factor}, {row.signal.offset}</Table.Cell>
									<Table.Cell>{row.signal.minimum}..{row.signal.maximum}</Table.Cell>
									<Table.Cell>{row.signal.unit || '-'}</Table.Cell>
									<Table.Cell>{row.signal.receivers.join(', ') || '-'}</Table.Cell>
									<Table.Cell>
										{#if row.signal.valueDescriptions.length}
											{row.signal.valueDescriptions.length}
										{:else}
											-
										{/if}
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</Tabs.Content>
			</Tabs.Root>
		{:else if !loading}
			<div
				class="flex min-h-72 items-center justify-center border border-dashed text-sm text-muted-foreground"
			>
				Open a .dbc file to parse it through the Zig WASM module.
			</div>
		{/if}
	</section>
</main>
