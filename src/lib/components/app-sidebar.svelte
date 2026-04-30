<script lang="ts">
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { dbcFiles } from '$lib/stores/dbc-files.svelte.js';
	import SearchForm from './search-form.svelte';
	import * as Collapsible from '$lib/components/ui/collapsible/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import FileUpIcon from '@lucide/svelte/icons/file-up';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import type { ComponentProps } from 'svelte';

	let { ref = $bindable(null), ...restProps }: ComponentProps<typeof Sidebar.Root> = $props();
	let traceInput: HTMLInputElement;
	let dbcInput: HTMLInputElement;
	let traceFileName = $state('Load trace');
	let signalSearch = $state('');
	let expandedDbcIds = $state<string[] | null>(null);
	let selectedSignalIds = $state<string[]>([]);
	let normalizedSignalSearch = $derived(signalSearch.trim().toLowerCase());
	let isSignalSearchActive = $derived(normalizedSignalSearch.length > 0);
	let visibleDbcFiles = $derived.by(() =>
		dbcFiles.sidebarFiles.map((dbc) => ({
			...dbc,
			signals: isSignalSearchActive
				? dbc.signals.filter((signal) => signal.toLowerCase().includes(normalizedSignalSearch))
				: dbc.signals
		}))
	);

	function selectTrace(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		traceFileName = input.files?.[0]?.name ?? 'Load trace';
		input.value = '';
	}

	async function selectDbcs(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		input.value = '';
		if (files.length === 0) return;

		await dbcFiles.addFiles(files);
	}

	function isDbcExpanded(dbcId: string, index: number): boolean {
		if (isSignalSearchActive) return true;
		if (expandedDbcIds === null) return index === 0;
		return expandedDbcIds.includes(dbcId);
	}

	function setDbcExpanded(dbcId: string, open: boolean): void {
		expandedDbcIds = arrayWith(expandedDbcIds ?? initialExpandedDbcIds(), dbcId, open);
	}

	function toggleSignal(signalId: string): void {
		selectedSignalIds = arrayWith(
			selectedSignalIds,
			signalId,
			!selectedSignalIds.includes(signalId)
		);
	}

	async function removeDbc(dbcId: string): Promise<void> {
		expandedDbcIds = (expandedDbcIds ?? initialExpandedDbcIds()).filter((id) => id !== dbcId);
		selectedSignalIds = selectedSignalIds.filter((signalId) => !signalId.startsWith(`${dbcId}:`));
		await dbcFiles.removeFile(dbcId);
	}

	function signalId(dbcId: string, signal: string): string {
		return `${dbcId}:${signal}`;
	}

	function arrayWith(values: string[], value: string, include: boolean): string[] {
		if (include) return values.includes(value) ? values : [...values, value];
		return values.filter((candidate) => candidate !== value);
	}

	function initialExpandedDbcIds(): string[] {
		return dbcFiles.sidebarFiles[0]?.id ? [dbcFiles.sidebarFiles[0].id] : [];
	}
</script>

<Sidebar.Root bind:ref {...restProps}>
	<Sidebar.Header>
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<input
					bind:this={traceInput}
					class="hidden"
					type="file"
					accept=".asc,.blf,.trc,text/plain"
					onchange={selectTrace}
				/>
				<Sidebar.MenuButton size="lg">
					{#snippet child({ props })}
						<button type="button" {...props} onclick={() => traceInput.click()}>
							<div
								class="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground"
							>
								<FileUpIcon class="size-4" />
							</div>
							<div class="flex flex-col gap-0.5 leading-none">
								<span class="font-medium">{traceFileName}</span>
								<span>Trace file</span>
							</div>
						</button>
					{/snippet}
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
		<SearchForm bind:value={signalSearch} />
	</Sidebar.Header>
	<Sidebar.Content>
		<Sidebar.Group class="px-4">
			<Sidebar.Menu>
				{#each visibleDbcFiles as dbc, index (dbc.id)}
					<Collapsible.Root
						open={isDbcExpanded(dbc.id, index)}
						onOpenChange={(open) => setDbcExpanded(dbc.id, open)}
						class="group/collapsible"
					>
						<Sidebar.MenuItem>
							<div class="group/dbc-row flex items-center gap-1">
								<Collapsible.Trigger>
									{#snippet child({ props })}
										<Sidebar.MenuButton
											{...props}
											class="min-w-0 flex-1"
											aria-label={isDbcExpanded(dbc.id, index)
												? `Collapse ${dbc.name}`
												: `Expand ${dbc.name}`}
										>
											<ChevronRightIcon
												class="text-sidebar-foreground/60 group-data-[state=open]/collapsible:hidden"
											/>
											<ChevronDownIcon
												class="text-sidebar-foreground/60 group-data-[state=closed]/collapsible:hidden"
											/>
											<span class="truncate">{dbc.name}</span>
										</Sidebar.MenuButton>
									{/snippet}
								</Collapsible.Trigger>
								<button
									type="button"
									class="flex size-7 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/50 opacity-70 hover:bg-sidebar-accent hover:text-destructive hover:opacity-100 focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-hidden"
									aria-label={`Delete ${dbc.name}`}
									onclick={() => removeDbc(dbc.id)}
								>
									<TrashIcon class="size-4" />
								</button>
							</div>
							<Collapsible.Content>
								<Sidebar.MenuSub>
									{#each dbc.signals as signal (signal)}
										<Sidebar.MenuSubItem>
											{@const id = signalId(dbc.id, signal)}
											<button
												type="button"
												class="flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-hidden"
												aria-pressed={selectedSignalIds.includes(id)}
												onclick={() => toggleSignal(id)}
											>
												<span
													class="flex size-4 shrink-0 items-center justify-center rounded border border-sidebar-border bg-sidebar text-sidebar-foreground/45 data-[selected=true]:border-sidebar-foreground/40 data-[selected=true]:bg-sidebar-accent data-[selected=true]:text-sidebar-foreground"
													data-selected={selectedSignalIds.includes(id)}
												>
													{#if selectedSignalIds.includes(id)}
														<CheckIcon class="size-3" />
													{/if}
												</span>
												<span class="truncate">{signal}</span>
											</button>
										</Sidebar.MenuSubItem>
									{/each}
								</Sidebar.MenuSub>
							</Collapsible.Content>
						</Sidebar.MenuItem>
					</Collapsible.Root>
				{/each}
			</Sidebar.Menu>
		</Sidebar.Group>
		<Sidebar.Group class="px-4">
			<input
				bind:this={dbcInput}
				class="hidden"
				type="file"
				accept=".dbc,text/plain"
				multiple
				onchange={selectDbcs}
			/>
			<Button
				class="w-full"
				type="button"
				disabled={dbcFiles.isLoading}
				onclick={() => dbcInput.click()}
			>
				<PlusIcon />
				{dbcFiles.isLoading ? 'Loading' : 'Add DBC'}
			</Button>
		</Sidebar.Group>
	</Sidebar.Content>
	<Sidebar.Rail />
</Sidebar.Root>

<AlertDialog.Root
	bind:open={() => dbcFiles.error !== null, (open) => !open && dbcFiles.clearError()}
>
	{#if dbcFiles.error}
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title>DBC upload failed</AlertDialog.Title>
				<AlertDialog.Description>{dbcFiles.error}</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Action onclick={() => dbcFiles.clearError()}>OK</AlertDialog.Action>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	{/if}
</AlertDialog.Root>
