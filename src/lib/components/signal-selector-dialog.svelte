<script lang="ts">
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { flattenSelectorTree, windowSelectorRows } from '$lib/selector-list.js';
	import {
		dbcFilesFromDrop,
		dragLeftCurrentTarget,
		filesFromDrop,
		hasDraggedFiles
	} from '$lib/file-drop.js';
	import { dbcFiles } from '$lib/stores/dbc-files.svelte.js';
	import { plotData } from '$lib/stores/plot-data.svelte.js';
	import { traceFile } from '$lib/stores/trace-file.svelte.js';
	import { onDbcRemoved } from '$lib/stores/session.js';
	import SearchForm from './search-form.svelte';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import XIcon from '@lucide/svelte/icons/x';
	import { SvelteSet } from 'svelte/reactivity';

	let {
		focusSearchRequest = 0,
		onDbcAdded,
		onSignalToggle
	}: {
		focusSearchRequest?: number;
		onDbcAdded?: () => void;
		onSignalToggle?: () => void;
	} = $props();
	let dbcInput = $state<HTMLInputElement>();
	let signalSearchForm = $state<HTMLFormElement | null>(null);
	let signalListScroller = $state<HTMLDivElement>();
	let signalListContent = $state<HTMLDivElement>();
	let listScrollTop = $state(0);
	let listViewportHeight = $state(0);
	let signalSearch = $state('');
	let dbcDropActive = $state(false);
	let showActiveOnly = $state(false);
	let signalListOverflows = $state(false);
	let expandedDbcIds = new SvelteSet<string>();
	let expandedMessageKeys = new SvelteSet<string>();
	// The popover content unmounts while closed; this component instance does not,
	// so filter/expansion state carries across reopens. Scroll position is DOM
	// state and needs saving explicitly.
	let savedScrollTop = 0;
	// The browser clamps scrollTop writes while the list is below its final
	// height; restoring must not let that clamped value echo back into
	// savedScrollTop, so the restore stays pending until it sticks.
	let pendingScrollRestore: number | null = null;
	let clampedScrollRestore = 0;
	let selectorFilter = $derived({
		query: signalSearch,
		activeOnly: showActiveOnly,
		isSignalSelected: (key: string) => plotData.isSignalSelected(key),
		expandedDbcIds,
		expandedMessageKeys
	});
	let visibleDbcFiles = $derived(
		dbcFiles.visibleSelectorTree(selectorFilter, traceFile.mf4SelectorIndexes)
	);
	let selectorRows = $derived(flattenSelectorTree(visibleDbcFiles));
	let selectorWindow = $derived(
		windowSelectorRows(selectorRows, listScrollTop, listViewportHeight)
	);

	const menuButtonClass =
		'flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-[calc(var(--radius-sm)+2px)] p-2 text-left text-xs text-popover-foreground transition-[background-color,color,box-shadow] hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden';
	const iconButtonClass =
		'flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color,box-shadow,scale] hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50';
	const closeButtonClass =
		'flex size-8 shrink-0 items-center justify-center rounded-md text-destructive transition-[background-color,color,box-shadow,scale] hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden active:scale-[0.96]';

	$effect(() => {
		if (focusSearchRequest === 0 || signalSearchForm === null) return;
		const frame = requestAnimationFrame(() => {
			signalSearchForm?.querySelector<HTMLInputElement>('input')?.focus();
		});
		return () => cancelAnimationFrame(frame);
	});

	function preventOpenAutoFocus(event: Event): void {
		event.preventDefault();
	}

	$effect(() => {
		if (!signalListScroller || !signalListContent) return;

		const resizeObserver = new ResizeObserver(handleSignalListResize);
		resizeObserver.observe(signalListScroller);
		resizeObserver.observe(signalListContent);
		listViewportHeight = signalListScroller.clientHeight;
		pendingScrollRestore = savedScrollTop;
		restoreScrollPosition();

		return () => resizeObserver.disconnect();
	});

	async function selectDbcs(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		input.value = '';

		await addDbcFiles(files);
	}

	async function addDbcFiles(files: File[]) {
		if (files.length === 0) return;

		const previousFileCount = dbcFiles.files.length;
		await dbcFiles.addFiles(files);
		if (dbcFiles.files.length > previousFileCount) onDbcAdded?.();
	}

	function toggleSignal(signalKey: string): void {
		plotData.toggleSignal(signalKey);
		onSignalToggle?.();
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

	function setDbcExpanded(dbcId: string, open: boolean): void {
		if (open) {
			expandedDbcIds.add(dbcId);
		} else {
			expandedDbcIds.delete(dbcId);
		}
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
		for (const message of dbcFiles.selectorFiles.find((dbc) => dbc.id === dbcId)?.messages ?? []) {
			expandedMessageKeys.delete(message.key);
		}
		await onDbcRemoved(dbcId);
	}

	function updateSignalListOverflow(): void {
		if (!signalListScroller) {
			signalListOverflows = false;
			return;
		}

		listViewportHeight = signalListScroller.clientHeight;
		signalListOverflows = signalListScroller.scrollHeight > signalListScroller.clientHeight + 1;
	}

	function handleSignalListResize(): void {
		updateSignalListOverflow();
		restoreScrollPosition();
	}

	function handleListScroll(): void {
		if (signalListScroller) listScrollTop = signalListScroller.scrollTop;
		persistScrollPosition();
	}

	function restoreScrollPosition(): void {
		if (pendingScrollRestore === null || !signalListScroller) return;

		signalListScroller.scrollTop = pendingScrollRestore;
		listScrollTop = signalListScroller.scrollTop;
		if (signalListScroller.scrollTop === pendingScrollRestore) {
			pendingScrollRestore = null;
		} else {
			clampedScrollRestore = signalListScroller.scrollTop;
		}
	}

	function persistScrollPosition(): void {
		if (!signalListScroller) return;
		if (pendingScrollRestore !== null) {
			// Scroll events at the clamped offset are echoes of our own restore
			// writes; anything else is the user scrolling, and they win.
			if (signalListScroller.scrollTop === clampedScrollRestore) return;
			pendingScrollRestore = null;
		}

		savedScrollTop = signalListScroller.scrollTop;
	}
</script>

<Popover.Content
	data-walkthrough-target="signal-selector-panel"
	align="start"
	sideOffset={-32}
	interactOutsideBehavior="ignore"
	trapFocus={false}
	onOpenAutoFocus={preventOpenAutoFocus}
	class="relative grid h-[calc(100vh-1rem)] w-[min(26rem,calc(100vw-1rem))] -translate-x-2 -translate-y-2 grid-rows-[auto_minmax(0,1fr)] gap-3 overflow-hidden rounded-lg border border-border/70 bg-popover/90 p-4 pt-14 text-popover-foreground backdrop-blur-md"
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
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<button
						{...props}
						type="button"
						data-walkthrough-target="add-dbc"
						class="{iconButtonClass} justify-self-end"
						disabled={dbcFiles.isLoading}
						aria-label={dbcFiles.isLoading ? 'Loading DBC' : 'Add DBC'}
						onclick={() => dbcInput?.click()}
					>
						<PlusIcon class="size-4" />
					</button>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content sideOffset={6}>
				{dbcFiles.isLoading ? 'Loading DBC' : 'Add DBC'}
			</Tooltip.Content>
		</Tooltip.Root>
	</div>

	<div class="flex items-center gap-2">
		<SearchForm
			bind:ref={signalSearchForm}
			class="min-w-0 flex-1"
			bind:value={signalSearch}
			placeholder="Filter signals..."
		/>
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<button
						{...props}
						type="button"
						class="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/70 text-muted-foreground transition-[background-color,border-color,color,box-shadow,scale] hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden active:scale-[0.96] data-[active=true]:border-sidebar-primary/60 data-[active=true]:bg-sidebar-primary/15 data-[active=true]:text-sidebar-primary"
						data-active={showActiveOnly}
						aria-pressed={showActiveOnly}
						aria-label={showActiveOnly ? 'Show all DBC signals' : 'Show selected DBC signals only'}
						onclick={() => (showActiveOnly = !showActiveOnly)}
					>
						<CheckIcon class="size-4" />
					</button>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content sideOffset={6}>
				{showActiveOnly ? 'Show all DBC signals' : 'Show selected DBC signals only'}
			</Tooltip.Content>
		</Tooltip.Root>
	</div>

	<div class="relative min-h-0">
		<div
			bind:this={signalListScroller}
			class="h-full [scrollbar-gutter:stable] overflow-y-auto pb-4 [--scroll-fade-size:2rem]"
			class:scroll-fade={signalListOverflows}
			onscroll={handleListScroll}
		>
			<div
				bind:this={signalListContent}
				class="relative w-full"
				style="height: {selectorWindow.totalHeight}px"
			>
				<ul
					class="absolute right-0 left-0 flex w-full min-w-0 flex-col gap-1"
					style="top: {selectorWindow.startOffset}px"
				>
					{#each selectorWindow.rows as row (row.key)}
						{#if row.kind === 'dbc'}
							<li class="flex h-8 items-center gap-1">
								<button
									type="button"
									class="{menuButtonClass} h-full min-w-0 flex-1 py-0"
									aria-expanded={row.dbc.expanded}
									aria-label={row.dbc.expanded
										? `Collapse ${row.dbc.name}`
										: `Expand ${row.dbc.name}`}
									onclick={() => setDbcExpanded(row.dbc.id, !row.dbc.expanded)}
								>
									{#if row.dbc.expanded}
										<ChevronDownIcon class="size-4 shrink-0 text-muted-foreground" />
									{:else}
										<ChevronRightIcon class="size-4 shrink-0 text-muted-foreground" />
									{/if}
									<span class="min-w-0 truncate" class:italic={row.dbc.transient}
										>{row.dbc.name}</span
									>
									{#if row.dbc.transient}
										<span
											class="shrink-0 rounded border border-border/70 bg-muted px-1 py-0.5 text-[9px] leading-none font-medium text-muted-foreground not-italic"
											>MF4</span
										>
									{/if}
								</button>
								{#if !row.dbc.transient && row.dbc.kind === 'dbc'}
									<button
										type="button"
										class="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-70 transition-[background-color,color,box-shadow,opacity,scale] hover:bg-accent hover:text-destructive hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden active:scale-[0.96]"
										aria-label={`Delete ${row.dbc.name}`}
										onclick={() => removeDbc(row.dbc.id)}
									>
										<TrashIcon class="size-4" />
									</button>
								{/if}
							</li>
						{:else if row.kind === 'message'}
							<li class="h-7 pl-6">
								<button
									type="button"
									class="flex h-7 w-full min-w-0 items-center gap-2 rounded-md border-s border-border px-2 text-left text-xs text-popover-foreground transition-[background-color,color,box-shadow] hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
									aria-expanded={row.message.expanded}
									aria-label={row.message.expanded
										? `Collapse ${row.message.name}`
										: `Expand ${row.message.name}`}
									onclick={() => setMessageExpanded(row.message.key, !row.message.expanded)}
								>
									<span
										class="flex size-4 shrink-0 items-center justify-center text-muted-foreground"
									>
										{#if row.message.expanded}
											<ChevronDownIcon class="size-4" />
										{:else}
											<ChevronRightIcon class="size-4" />
										{/if}
									</span>
									<span class="truncate">{row.message.name}</span>
								</button>
							</li>
						{:else}
							{@const isSelected = plotData.isSignalSelected(row.signal.key)}
							{@const decodeStatus = isSelected
								? plotData.signalDecodeStatus(row.signal.key)
								: null}
							{@const signalToggleId = `signal-toggle-${row.signal.key}`}
							<li class="h-7 pl-12">
								<Label
									for={signalToggleId}
									class="flex h-7 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md border-s border-border px-2 text-left text-xs font-normal text-popover-foreground transition-[background-color,color,box-shadow] hover:bg-accent hover:text-accent-foreground"
								>
									<Checkbox
										id={signalToggleId}
										checked={isSelected}
										aria-label={`Plot ${row.signal.label}`}
										title={decodeStatus?.decodeError ?? undefined}
										class="data-[error=true]:border-destructive/50 data-[error=true]:bg-destructive/10 data-[error=true]:text-destructive data-checked:border-sidebar-primary data-checked:bg-sidebar-primary data-checked:text-sidebar-primary-foreground"
										data-error={decodeStatus?.decodeError != null}
										onCheckedChange={() => toggleSignal(row.signal.key)}
									/>
									<span class="flex min-w-0 flex-1 items-center gap-2">
										<span class="truncate font-mono" title={row.signal.label}>
											{row.signal.signalName}
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
						{/if}
					{/each}
				</ul>
			</div>
		</div>
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
