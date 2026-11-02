import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { Check, ListFilter, Plus, Search, X } from 'lucide-react';
import { useDeferredValue, useId, useRef, useState, type ReactNode, type RefObject } from 'react';

import { DropOverlay } from '#lib/components/drop-overlay.js';
import { ErrorDialog } from '#lib/components/error-dialog.js';
import { PanelHeader } from '#lib/components/panel-header.js';
import { SelectorTree } from '#lib/components/selector-tree.js';
import { Button } from '#lib/components/ui/button.js';
import { Dialog, DialogClose, DialogPortal, DialogTitle } from '#lib/components/ui/dialog.js';
import { Input } from '#lib/components/ui/input.js';
import { Label } from '#lib/components/ui/label.js';
import { ToggleGroup } from '#lib/components/ui/toggle-group.js';
import { Toggle } from '#lib/components/ui/toggle.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '#lib/components/ui/tooltip.js';
import { dbcFilesFromDrop } from '#lib/file-drop.js';
import { panelShadow } from '#lib/panel-shadow.js';
import {
	advanceWalkthroughAfterDbcAdded,
	advanceWalkthroughAfterSignalToggle,
	setSignalSelectorOpen
} from '#lib/stores/app-shell.js';
import { addDbcFiles, clearDbcError } from '#lib/stores/dbc-files.js';
import { toggleSignal } from '#lib/stores/plot-data.js';
import { deleteDbc } from '#lib/stores/session.js';
import { appStore, useAppStore } from '#lib/stores/store.js';
import { useFileDrop } from '#lib/use-file-drop.js';

function withKey(keys: ReadonlySet<string>, key: string, present: boolean): ReadonlySet<string> {
	const next = new Set(keys);
	if (present) next.add(key);
	else next.delete(key);
	return next;
}

/**
 * Signal selector sheet. A non-modal dialog that stays open on outside presses, so signals can be
 * ticked while the plot stays interactive behind it; `children` must render the `DialogTrigger`.
 * Filter, expansion and scroll state persist across open/close.
 */
export function SignalSelectorDialog({
	searchInputRef,
	children
}: {
	searchInputRef: RefObject<HTMLInputElement | null>;
	children: ReactNode;
}) {
	const open = useAppStore((s) => s.signalSelectorOpen);
	const searchId = useId();
	const dbcInput = useRef<HTMLInputElement>(null);
	const scrollTop = useRef(0);
	const [search, setSearch] = useState('');
	const [activeOnly, setActiveOnly] = useState(false);
	const [hideUnavailable, setHideUnavailable] = useState(false);
	const [expansion, setExpansion] = useState<ReadonlySet<string>>(() => new Set());
	const [collapsedWhileFiltering, setCollapsedWhileFiltering] = useState<ReadonlySet<string>>(
		() => new Set()
	);
	const isLoading = useAppStore((s) => s.dbcLoading);
	const dbcError = useAppStore((s) => s.dbcError);
	// The list follows the deferred query, so typing stays responsive on large catalogues.
	const query = useDeferredValue(search);
	const filtering = query.trim().length > 0 || activeOnly;
	const isExpanded = filtering
		? (key: string) => !collapsedWhileFiltering.has(key)
		: (key: string) => expansion.has(key);

	function changeSearch(value: string) {
		setSearch(value);
		if (value.trim().length === 0 && !activeOnly) setCollapsedWhileFiltering(new Set());
	}

	function toggleActiveOnly() {
		setActiveOnly(!activeOnly);
		if (activeOnly && search.trim().length === 0) setCollapsedWhileFiltering(new Set());
	}

	async function addFiles(files: File[]) {
		if (files.length === 0) return;
		const previousCount = appStore.getState().dbcFiles.length;
		await addDbcFiles(files);
		if (appStore.getState().dbcFiles.length > previousCount) advanceWalkthroughAfterDbcAdded();
	}

	const { dropActive, dropHandlers } = useFileDrop((files) => {
		void addFiles(dbcFilesFromDrop(files));
	});

	function setExpanded(key: string, isOpen: boolean) {
		if (filtering) setCollapsedWhileFiltering((current) => withKey(current, key, !isOpen));
		else setExpansion((current) => withKey(current, key, isOpen));
	}

	async function removeDbc(dbcId: string) {
		const dbc = appStore.getState().selectorFiles.find((file) => file.id === dbcId);
		const removed = new Set([dbcId, ...(dbc?.messages ?? []).map((message) => message.key)]);
		const withoutRemoved = (current: ReadonlySet<string>) =>
			new Set([...current].filter((key) => !removed.has(key)));
		setExpansion(withoutRemoved);
		setCollapsedWhileFiltering(withoutRemoved);
		await deleteDbc(dbcId);
	}

	function handleToggleSignal(key: string) {
		void toggleSignal(key);
		advanceWalkthroughAfterSignalToggle();
	}

	const addDbcLabel = isLoading ? 'Loading DBC' : 'Add DBC';
	const filterValues = [
		...(activeOnly ? ['active'] : []),
		...(hideUnavailable ? ['available'] : [])
	];

	function changeFilters(values: string[]) {
		if (values.includes('active') !== activeOnly) toggleActiveOnly();
		setHideUnavailable(values.includes('available'));
	}

	const activeOnlyLabel = activeOnly ? 'Show all DBC signals' : 'Show selected DBC signals only';
	const unavailableLabel = hideUnavailable
		? 'Show unavailable signals'
		: 'Hide unavailable signals';

	return (
		<>
			<Dialog
				open={open}
				onOpenChange={setSignalSelectorOpen}
				modal={false}
				disablePointerDismissal
			>
				{children}
				<DialogPortal>
					<DialogPrimitive.Popup
						data-walkthrough-target="signal-selector-panel"
						aria-modal="false"
						// Touch keeps the default so opening the panel does not raise the on-screen keyboard.
						initialFocus={(type) => (type === 'touch' ? true : searchInputRef.current)}
						// Overlays its trigger: the close button lands exactly where the trigger sits.
						className="fixed top-2 left-2 z-50 grid h-[calc(100vh-1rem)] w-[min(26rem,calc(100vw-1rem))] origin-top-left grid-rows-[auto_minmax(0,1fr)] gap-3 overflow-hidden rounded-lg border border-border/70 bg-popover/90 p-4 pt-14 text-xs text-popover-foreground outline-hidden backdrop-blur-md duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
						style={panelShadow}
						{...dropHandlers}
					>
						{dropActive && (
							<DropOverlay className="rounded-lg bg-popover/25">Drop DBC files to add</DropOverlay>
						)}

						<input
							ref={dbcInput}
							className="hidden"
							type="file"
							accept=".dbc,text/plain"
							multiple
							onChange={(event) => {
								const files = Array.from(event.currentTarget.files ?? []);
								event.currentTarget.value = '';
								void addFiles(files);
							}}
						/>

						<PanelHeader>
							<DialogClose
								render={<Button variant="ghost" size="icon-lg" />}
								aria-label="Close signal selector"
							>
								<X className="size-4" />
							</DialogClose>
							<DialogTitle className="text-center">Signal Selector</DialogTitle>
							<Tooltip>
								<TooltipTrigger
									render={
										<Button
											data-walkthrough-target="add-dbc"
											variant="ghost"
											size="icon-lg"
											className="justify-self-end"
											disabled={isLoading}
											aria-label={addDbcLabel}
											onClick={() => dbcInput.current?.click()}
										/>
									}
								>
									<Plus className="size-4" />
								</TooltipTrigger>
								<TooltipContent>{addDbcLabel}</TooltipContent>
							</Tooltip>
						</PanelHeader>

						<div className="flex items-center gap-2">
							<div className="relative min-w-0 flex-1">
								<Label htmlFor={searchId} className="sr-only">
									Search
								</Label>
								<Input
									ref={searchInputRef}
									id={searchId}
									value={search}
									onChange={(event) => changeSearch(event.currentTarget.value)}
									placeholder="Filter signals..."
									className="ps-8"
								/>
								<Search className="pointer-events-none absolute inset-s-2 top-1/2 size-4 -translate-y-1/2 opacity-50 select-none" />
							</div>
							<ToggleGroup
								multiple
								aria-label="Signal filters"
								value={filterValues}
								onValueChange={changeFilters}
							>
								<Tooltip>
									<TooltipTrigger
										render={
											<Toggle
												value="active"
												variant="outline"
												size="lg"
												className="size-8 px-0"
												aria-label={activeOnlyLabel}
											/>
										}
									>
										<Check className="size-4" />
									</TooltipTrigger>
									<TooltipContent>{activeOnlyLabel}</TooltipContent>
								</Tooltip>
								<Tooltip>
									<TooltipTrigger
										render={
											<Toggle
												value="available"
												variant="outline"
												size="lg"
												className="size-8 px-0"
												aria-label={unavailableLabel}
											/>
										}
									>
										<ListFilter className="size-4" />
									</TooltipTrigger>
									<TooltipContent>{unavailableLabel}</TooltipContent>
								</Tooltip>
							</ToggleGroup>
						</div>

						<SelectorTree
							query={query}
							activeOnly={activeOnly}
							hideUnavailable={hideUnavailable}
							isExpanded={isExpanded}
							getInitialScrollTop={() => scrollTop.current}
							onScrollTopChange={(top) => (scrollTop.current = top)}
							onExpandedChange={setExpanded}
							onRemoveDbc={(id) => void removeDbc(id)}
							onToggleSignal={handleToggleSignal}
						/>
					</DialogPrimitive.Popup>
				</DialogPortal>
			</Dialog>

			<ErrorDialog title="DBC failed to open" message={dbcError} onDismiss={clearDbcError} />
		</>
	);
}
