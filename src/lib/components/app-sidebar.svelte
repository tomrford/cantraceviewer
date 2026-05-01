<script lang="ts">
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { dbcFiles } from '$lib/stores/dbc-files.svelte.js';
	import { plotData } from '$lib/stores/plot-data.svelte.js';
	import SearchForm from './search-form.svelte';
	import * as Collapsible from '$lib/components/ui/collapsible/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import CircleHelpIcon from '@lucide/svelte/icons/circle-help';
	import GithubIcon from '@lucide/svelte/icons/github';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import type { ComponentProps } from 'svelte';

	let { ref = $bindable(null), ...restProps }: ComponentProps<typeof Sidebar.Root> = $props();
	let dbcInput: HTMLInputElement;
	let signalSearch = $state('');
	let helpOpen = $state(false);
	let expandedDbcIds = $state<string[] | null>(null);
	let normalizedSignalSearch = $derived(signalSearch.trim().toLowerCase());
	let isSignalSearchActive = $derived(normalizedSignalSearch.length > 0);
	let visibleDbcFiles = $derived.by(() =>
		dbcFiles.sidebarFiles.map((dbc) => ({
			...dbc,
			signals: isSignalSearchActive
				? dbc.signals.filter((signal) =>
						signal.label.toLowerCase().includes(normalizedSignalSearch)
					)
				: dbc.signals
		}))
	);

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

	async function removeDbc(dbcId: string): Promise<void> {
		expandedDbcIds = (expandedDbcIds ?? initialExpandedDbcIds()).filter((id) => id !== dbcId);
		plotData.deselectDbcFile(dbcId);
		await dbcFiles.removeFile(dbcId);
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
	<Sidebar.Header class="px-4 pt-4">
		<input
			bind:this={dbcInput}
			class="hidden"
			type="file"
			accept=".dbc,text/plain"
			multiple
			onchange={selectDbcs}
		/>
		<div class="flex items-center gap-2">
			<button
				type="button"
				class="flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90 focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50"
				disabled={dbcFiles.isLoading}
				aria-label={dbcFiles.isLoading ? 'Loading DBC' : 'Add DBC'}
				title={dbcFiles.isLoading ? 'Loading DBC' : 'Add DBC'}
				onclick={() => dbcInput.click()}
			>
				<PlusIcon class="size-4" />
			</button>
			<SearchForm
				class="min-w-0 flex-1"
				bind:value={signalSearch}
				placeholder="Filter DBC signals..."
			/>
		</div>
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
									{#each dbc.signals as signal (signal.key)}
										<Sidebar.MenuSubItem>
											<button
												type="button"
												class="flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-hidden"
												aria-pressed={plotData.isSignalSelected(signal.key)}
												onclick={() => plotData.toggleSignal(signal.key)}
											>
												<span
													class="flex size-4 shrink-0 items-center justify-center rounded border border-sidebar-border bg-sidebar text-sidebar-foreground/45 data-[selected=true]:border-sidebar-foreground/40 data-[selected=true]:bg-sidebar-accent data-[selected=true]:text-sidebar-foreground"
													data-selected={plotData.isSignalSelected(signal.key)}
												>
													{#if plotData.isSignalSelected(signal.key)}
														<CheckIcon class="size-3" />
													{/if}
												</span>
												<span class="truncate">{signal.label}</span>
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
	</Sidebar.Content>
	<Sidebar.Footer class="flex-row items-center gap-1 px-4 pb-4">
		<button
			type="button"
			class="flex size-7 items-center justify-center rounded-md text-sidebar-foreground/55 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-hidden"
			aria-label="Open help"
			title="Help"
			onclick={() => (helpOpen = true)}
		>
			<CircleHelpIcon class="size-4" />
		</button>
		<a
			href="https://github.com/tomrford/cantraceviewer"
			target="_blank"
			rel="noreferrer"
			class="flex size-7 items-center justify-center rounded-md text-sidebar-foreground/55 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-hidden"
			aria-label="Open source code on GitHub"
			title="Source code"
		>
			<GithubIcon class="size-4" />
		</a>
	</Sidebar.Footer>
	<Sidebar.Rail />
</Sidebar.Root>

<AlertDialog.Root bind:open={helpOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>CAN Trace Viewer</AlertDialog.Title>
			<AlertDialog.Description class="space-y-2 text-left text-pretty">
				<p>Files stay local in your browser. The app does not upload traces or DBC files.</p>
				<p>
					Load one Vector ASCII trace, add one or more DBC files, then select decoded signals from
					the sidebar.
				</p>
				<p>
					Current support is intentionally narrow: ASC traces, a practical subset of DBC, and
					shared-axis line plots for selected signals.
				</p>
				<p>
					Source code is available on
					<a href="https://github.com/tomrford/cantraceviewer" target="_blank" rel="noreferrer">
						GitHub</a
					>.
				</p>
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Action onclick={() => (helpOpen = false)}>Close</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root
	bind:open={() => dbcFiles.error !== null, (open) => !open && dbcFiles.clearError()}
>
	{#if dbcFiles.error}
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title>DBC failed to open</AlertDialog.Title>
				<AlertDialog.Description>{dbcFiles.error}</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Action onclick={() => dbcFiles.clearError()}>OK</AlertDialog.Action>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	{/if}
</AlertDialog.Root>
