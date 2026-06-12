<script lang="ts">
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Collapsible from '$lib/components/ui/collapsible/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import {
		dbcFilesFromDrop,
		dragLeftCurrentTarget,
		filesFromDrop,
		hasDraggedFiles
	} from '$lib/file-drop.js';
	import { dbcFiles } from '$lib/stores/dbc-files.svelte.js';
	import { plotData } from '$lib/stores/plot-data.svelte.js';
	import SearchForm from './search-form.svelte';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import XIcon from '@lucide/svelte/icons/x';
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';

	let dbcInput = $state<HTMLInputElement>();
	let signalSearch = $state('');
	let dbcDropActive = $state(false);
	let showActiveOnly = $state(false);
	let expandedDbcIds = new SvelteSet<string>();
	let expandedMessageKeys = new SvelteSet<string>();
	let sidebarFilter = $derived({
		query: signalSearch,
		activeOnly: showActiveOnly,
		isSignalSelected: (key: string) => plotData.isSignalSelected(key)
	});
	let isFiltering = $derived(dbcFiles.isSidebarFilterActive(sidebarFilter));
	let visibleDbcFiles = $derived(dbcFiles.visibleSidebarTree(sidebarFilter));

	const menuButtonClass =
		'flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-[calc(var(--radius-sm)+2px)] p-2 text-left text-xs text-popover-foreground transition-[background-color,color,box-shadow] hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden';
	const iconButtonClass =
		'flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color,box-shadow,scale] hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50';
	const closeButtonClass =
		'flex size-8 shrink-0 items-center justify-center rounded-md text-destructive transition-[background-color,color,box-shadow,scale] hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden active:scale-[0.96]';

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

<Popover.Content
	align="start"
	sideOffset={-32}
	class="relative grid h-[min(36rem,calc(100vh-5rem))] w-[min(26rem,calc(100vw-1rem))] -translate-x-2 -translate-y-2 grid-rows-[auto_minmax(0,1fr)] gap-3 overflow-hidden rounded-lg border border-border/70 bg-popover/90 p-4 pt-14 text-popover-foreground backdrop-blur-md"
	style="box-shadow: 0 1px 2px rgb(0 0 0 / 0.08)"
	ondragenter={handleDbcDrag}
	ondragover={handleDbcDrag}
	ondragleave={clearDbcDrag}
	ondrop={dropDbcs}
>
	{#if dbcDropActive}
		<div
			class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-popover/25 text-sm font-medium text-foreground backdrop-blur-[1px]"
		>
			Drop DBC files to add
		</div>
	{/if}

	<input
		bind:this={dbcInput}
		class="hidden"
		type="file"
		accept=".dbc,text/plain"
		multiple
		onchange={selectDbcs}
	/>

	<div
		class="absolute top-[6.5px] right-[7px] left-[7px] grid h-8 grid-cols-[1fr_auto_1fr] items-center"
	>
		<Popover.Close class={closeButtonClass} aria-label="Close signal selector">
			<XIcon class="size-4" />
		</Popover.Close>
		<Popover.Title class="text-center">Signal Selector</Popover.Title>
		<button
			type="button"
			class="{iconButtonClass} justify-self-end"
			disabled={dbcFiles.isLoading}
			aria-label={dbcFiles.isLoading ? 'Loading DBC' : 'Add DBC'}
			title={dbcFiles.isLoading ? 'Loading DBC' : 'Add DBC'}
			onclick={() => dbcInput?.click()}
		>
			<PlusIcon class="size-4" />
		</button>
	</div>

	<div class="flex items-center gap-2">
		<SearchForm
			class="min-w-0 flex-1"
			bind:value={signalSearch}
			placeholder="Filter DBC signals..."
		/>
		<button
			type="button"
			class="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/70 text-muted-foreground transition-[background-color,border-color,color,box-shadow,scale] hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden active:scale-[0.96] data-[active=true]:border-sidebar-primary/60 data-[active=true]:bg-sidebar-primary/15 data-[active=true]:text-sidebar-primary"
			data-active={showActiveOnly}
			aria-pressed={showActiveOnly}
			aria-label={showActiveOnly ? 'Show all DBC signals' : 'Show selected DBC signals only'}
			title={showActiveOnly ? 'Show all DBC signals' : 'Show selected DBC signals only'}
			onclick={() => (showActiveOnly = !showActiveOnly)}
		>
			<CheckIcon class="size-4" />
		</button>
	</div>

	<div class="relative min-h-0">
		<div class="h-full overflow-y-auto pb-4">
			<ul class="flex w-full min-w-0 flex-col gap-1">
				{#each visibleDbcFiles as dbc (dbc.id)}
					<li>
						<Collapsible.Root
							open={isDbcExpanded(dbc.id)}
							onOpenChange={(open) => setDbcExpanded(dbc.id, open)}
							class="group/collapsible"
						>
							<div class="group/dbc-row flex items-center gap-1">
								<Collapsible.Trigger>
									{#snippet child({ props })}
										<button
											{...props}
											type="button"
											class="{menuButtonClass} min-w-0 flex-1"
											aria-label={isDbcExpanded(dbc.id)
												? `Collapse ${dbc.name}`
												: `Expand ${dbc.name}`}
										>
											<ChevronRightIcon
												class="size-4 shrink-0 text-muted-foreground group-data-[state=open]/collapsible:hidden"
											/>
											<ChevronDownIcon
												class="size-4 shrink-0 text-muted-foreground group-data-[state=closed]/collapsible:hidden"
											/>
											<span class="truncate">{dbc.name}</span>
										</button>
									{/snippet}
								</Collapsible.Trigger>
								<button
									type="button"
									class="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-70 transition-[background-color,color,box-shadow,opacity,scale] hover:bg-accent hover:text-destructive hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden active:scale-[0.96]"
									aria-label={`Delete ${dbc.name}`}
									onclick={() => removeDbc(dbc.id)}
								>
									<TrashIcon class="size-4" />
								</button>
							</div>
							<Collapsible.Content>
								<ul
									class="mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-s border-border px-2.5 py-0.5"
								>
									{#each dbc.messages as message (message.key)}
										<li>
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
															class="flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs text-popover-foreground transition-[background-color,color,box-shadow] hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
															aria-label={isMessageExpanded(message.key)
																? `Collapse ${message.name}`
																: `Expand ${message.name}`}
														>
															<span
																class="flex size-4 shrink-0 items-center justify-center text-muted-foreground"
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
													<ul
														class="mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-s border-border px-2.5 py-0.5"
													>
														{#each message.signals as signal (signal.key)}
															{@const isSelected = plotData.isSignalSelected(signal.key)}
															{@const decodeStatus = isSelected
																? plotData.signalDecodeStatus(signal.key)
																: null}
															{@const signalToggleId = `signal-toggle-${signal.key}`}
															<li>
																<Label
																	for={signalToggleId}
																	class="flex h-7 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 text-left text-xs font-normal text-popover-foreground transition-[background-color,color,box-shadow] hover:bg-accent hover:text-accent-foreground"
																>
																	<Checkbox
																		id={signalToggleId}
																		checked={isSelected}
																		aria-label={`Plot ${signal.label}`}
																		title={decodeStatus?.decodeError ?? undefined}
																		class="data-[error=true]:border-destructive/50 data-[error=true]:bg-destructive/10 data-[error=true]:text-destructive data-checked:border-sidebar-primary data-checked:bg-sidebar-primary data-checked:text-sidebar-primary-foreground"
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
																				class="size-3 shrink-0 animate-spin text-muted-foreground"
																				aria-label="Decoding signal"
																			/>
																		{/if}
																	</span>
																</Label>
															</li>
														{/each}
													</ul>
												</Collapsible.Content>
											</Collapsible.Root>
										</li>
									{/each}
								</ul>
							</Collapsible.Content>
						</Collapsible.Root>
					</li>
				{/each}
			</ul>
		</div>
		<div
			class="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-b from-transparent to-popover"
		></div>
	</div>
</Popover.Content>

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
