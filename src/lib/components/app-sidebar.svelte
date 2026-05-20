<script lang="ts">
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import {
		dbcFilesFromDrop,
		dragLeftCurrentTarget,
		filesFromDrop,
		hasDraggedFiles
	} from '$lib/file-drop.js';
	import { rankedFuzzySearch } from '$lib/fuzzy-match.js';
	import { dbcFiles, type SidebarDbcSignal } from '$lib/stores/dbc-files.svelte.js';
	import { plotData } from '$lib/stores/plot-data.svelte.js';
	import SearchForm from './search-form.svelte';
	import * as Collapsible from '$lib/components/ui/collapsible/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import CircleHelpIcon from '@lucide/svelte/icons/circle-help';
	import GithubIcon from '@lucide/svelte/icons/github';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import type { ComponentProps } from 'svelte';

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: ComponentProps<typeof Sidebar.Root> = $props();
	let dbcInput: HTMLInputElement;
	let signalSearch = $state('');
	let dbcDropActive = $state(false);
	let helpOpen = $state(false);
	let showActiveOnly = $state(false);
	let expandedDbcIds = new SvelteSet<string>();
	let expandedMessageKeys = new SvelteSet<string>();
	let normalizedSignalSearch = $derived(signalSearch.trim().toLowerCase());
	let isSignalSearchActive = $derived(normalizedSignalSearch.length > 0);
	let isFiltering = $derived(isSignalSearchActive || showActiveOnly);
	let visibleDbcFiles = $derived.by(() =>
		dbcFiles.sidebarFiles
			.map((dbc) => {
				const signalsByMessage: Record<string, SidebarDbcSignal[]> = {};
				const visibleSignals = rankedFuzzySearch(
					dbc.messages.flatMap((message) =>
						message.signals
							.filter((signal) => !showActiveOnly || plotData.isSignalSelected(signal.key))
							.map((signal) => ({ messageKey: message.key, signal }))
					),
					normalizedSignalSearch,
					({ signal }) => signal.label
				);

				for (const { messageKey, signal } of visibleSignals) {
					signalsByMessage[messageKey] ??= [];
					signalsByMessage[messageKey].push(signal);
				}

				return {
					...dbc,
					messages: dbc.messages
						.map((message) => ({
							...message,
							signals: signalsByMessage[message.key] ?? []
						}))
						.filter((message) => message.signals.length > 0)
				};
			})
			.filter((dbc) => !isFiltering || dbc.messages.length > 0)
	);

	onMount(() => {
		void dbcFiles.loadLibrary();
	});

	async function selectDbcs(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		input.value = '';

		await addDbcFiles(files);
	}

	async function addDbcFiles(files: File[]) {
		if (files.length === 0) return;

		await dbcFiles.addFiles(files);
	}

	function handleDbcDrag(event: DragEvent) {
		if (!hasDraggedFiles(event)) return;

		event.preventDefault();
		dbcDropActive = true;
	}

	function clearDbcDrag(event: DragEvent) {
		if (!dragLeftCurrentTarget(event)) return;

		dbcDropActive = false;
	}

	async function dropDbcs(event: DragEvent) {
		event.preventDefault();
		dbcDropActive = false;
		await addDbcFiles(dbcFilesFromDrop(filesFromDrop(event)));
	}

	function isDbcExpanded(dbcId: string): boolean {
		if (isFiltering) return true;
		return expandedDbcIds.has(dbcId);
	}

	function setDbcExpanded(dbcId: string, open: boolean): void {
		if (open) {
			expandedDbcIds.add(dbcId);
		} else {
			expandedDbcIds.delete(dbcId);
		}
	}

	function isMessageExpanded(messageKey: string): boolean {
		if (isFiltering) return true;
		return expandedMessageKeys.has(messageKey);
	}

	function setMessageExpanded(messageKey: string, open: boolean): void {
		if (open) {
			expandedMessageKeys.add(messageKey);
		} else {
			expandedMessageKeys.delete(messageKey);
		}
	}

	async function removeDbc(dbcId: string): Promise<void> {
		expandedDbcIds.delete(dbcId);
		for (const message of dbcFiles.sidebarFiles.find((dbc) => dbc.id === dbcId)?.messages ?? []) {
			expandedMessageKeys.delete(message.key);
		}
		plotData.deselectDbcFile(dbcId);
		await dbcFiles.removeFile(dbcId);
	}
</script>

<Sidebar.Root
	bind:ref
	class={className}
	ondragenter={handleDbcDrag}
	ondragover={handleDbcDrag}
	ondragleave={clearDbcDrag}
	ondrop={dropDbcs}
	{...restProps}
>
	{#if dbcDropActive}
		<div
			class="pointer-events-none absolute inset-0 z-60 flex items-center justify-center bg-sidebar/25 text-sm font-medium text-sidebar-foreground backdrop-blur-[1px]"
		>
			Drop DBC files to add
		</div>
	{/if}
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
			<button
				type="button"
				class="flex size-8 shrink-0 items-center justify-center rounded-lg border border-sidebar-border text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-hidden data-[active=true]:border-emerald-500/40 data-[active=true]:bg-emerald-500/15 data-[active=true]:text-emerald-400"
				data-active={showActiveOnly}
				aria-pressed={showActiveOnly}
				aria-label={showActiveOnly ? 'Show all DBC signals' : 'Show selected DBC signals only'}
				title={showActiveOnly ? 'Show all DBC signals' : 'Show selected DBC signals only'}
				onclick={() => (showActiveOnly = !showActiveOnly)}
			>
				<CheckIcon class="size-4" />
			</button>
		</div>
	</Sidebar.Header>
	<Sidebar.Content>
		<Sidebar.Group class="px-4">
			<Sidebar.Menu>
				{#each visibleDbcFiles as dbc (dbc.id)}
					<Collapsible.Root
						open={isDbcExpanded(dbc.id)}
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
											aria-label={isDbcExpanded(dbc.id)
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
									{#each dbc.messages as message (message.key)}
										<Sidebar.MenuSubItem>
											<Collapsible.Root
												open={isMessageExpanded(message.key)}
												onOpenChange={(open) => setMessageExpanded(message.key, open)}
												class="group/message-collapsible"
											>
												<Collapsible.Trigger>
													{#snippet child({ props })}
														<button
															{...props}
															type="button"
															class="flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-hidden"
															aria-label={isMessageExpanded(message.key)
																? `Collapse ${message.name}`
																: `Expand ${message.name}`}
														>
															<span
																class="flex size-4 shrink-0 items-center justify-center text-sidebar-foreground/60"
															>
																<ChevronRightIcon
																	class="size-4 group-data-[state=open]/message-collapsible:hidden"
																/>
																<ChevronDownIcon
																	class="size-4 group-data-[state=closed]/message-collapsible:hidden"
																/>
															</span>
															<span class="truncate">{message.name}</span>
														</button>
													{/snippet}
												</Collapsible.Trigger>
												<Collapsible.Content>
													<Sidebar.MenuSub>
														{#each message.signals as signal (signal.key)}
															{@const isSelected = plotData.isSignalSelected(signal.key)}
															{@const decodeStatus = isSelected
																? plotData.signalDecodeStatus(signal.key)
																: null}
															{@const signalToggleId = `signal-toggle-${signal.key}`}
															<Sidebar.MenuSubItem>
																<Label
																	for={signalToggleId}
																	class="flex h-7 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 text-left text-xs font-normal text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
																>
																	<Checkbox
																		id={signalToggleId}
																		checked={isSelected}
																		aria-label={`Plot ${signal.label}`}
																		title={decodeStatus?.decodeError ?? undefined}
																		class="data-[error=true]:border-destructive/50 data-[error=true]:bg-destructive/10 data-[error=true]:text-destructive"
																		data-error={decodeStatus?.decodeError != null}
																		onCheckedChange={() => plotData.toggleSignal(signal.key)}
																	/>
																	<span class="flex min-w-0 flex-1 items-center gap-2">
																		<span class="truncate font-mono" title={signal.label}>
																			{signal.signalName}
																		</span>
																		{#if decodeStatus?.decodeError}
																			<CircleAlertIcon
																				class="size-3 shrink-0 text-destructive"
																				aria-label={decodeStatus.decodeError}
																			/>
																		{:else if decodeStatus?.isDecoding}
																			<LoaderCircleIcon
																				class="size-3 shrink-0 animate-spin text-sidebar-foreground/60"
																				aria-label="Decoding signal"
																			/>
																		{/if}
																	</span>
																</Label>
															</Sidebar.MenuSubItem>
														{/each}
													</Sidebar.MenuSub>
												</Collapsible.Content>
											</Collapsible.Root>
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
				<p>
					all files, preferences and saved settings are processed and stored solely in this
					browser's local storage. Nothing leaves your machine.
				</p>
				<p>
					Load one ASC, TRC, BLF, or MF4 trace, add one or more DBC files, then select decoded
					signals from the sidebar.
				</p>
				<p>
					Current support covers CAN trace plotting and a practical subset of DBC, using shared-axis
					line plots for selected signals.
				</p>
				<p>
					The source code is available on
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
