import {
	useDeferredValue,
	useEffect,
	useRef,
	useState,
	type DragEvent,
	type ReactNode
} from 'react';
import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useStore } from 'zustand';
import {
	Check,
	ChevronDown,
	ChevronRight,
	CircleAlert,
	ListFilter,
	LoaderCircle,
	Plus,
	Trash2,
	X
} from 'lucide-react';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle
} from '#lib/components/ui/alert-dialog.js';
import { Badge } from '#lib/components/ui/badge.js';
import { Checkbox } from '#lib/components/ui/checkbox.js';
import { Label } from '#lib/components/ui/label.js';
import { Popover, PopoverContent, PopoverTitle } from '#lib/components/ui/popover.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '#lib/components/ui/tooltip.js';
import { DbcInformation } from '#lib/components/dbc-information.js';
import { SearchForm } from '#lib/components/search-form.js';
import {
	dbcFilesFromDrop,
	dragLeftCurrentTarget,
	filesFromDrop,
	hasDraggedFiles
} from '#lib/file-drop.js';
import {
	flattenSelectorTree,
	visibleSelectorTree,
	type SelectorDbcFile,
	type SelectorListDbc,
	type SelectorListMessage,
	type SelectorListRow,
	type SelectorListSignal
} from '#lib/selector-list.js';
import { addDbcFiles, clearDbcError, dbcFiles } from '#lib/stores/dbc-files.js';
import {
	plotData,
	signalDecodeStatus,
	toggleSignal,
	type PlotDataState
} from '#lib/stores/plot-data.js';
import { onDbcRemoved } from '#lib/stores/session.js';
import { traceFile } from '#lib/stores/trace-file.js';
import { cn } from '#lib/utils.js';

type Expansion = { dbcIds: ReadonlySet<string>; messageKeys: ReadonlySet<string> };

const ROW_GAP_PX = 4;
const ROW_OVERSCAN = 8;
const LIST_PADDING_BOTTOM_PX = 16;

const iconButtonClass =
	'flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color,box-shadow,scale] hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50';
const filterButtonClass =
	'flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/70 text-muted-foreground transition-[background-color,border-color,color,box-shadow,scale] hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden active:scale-[0.96] data-[active=true]:border-sidebar-primary/60 data-[active=true]:bg-sidebar-primary/15 data-[active=true]:text-sidebar-primary';
const rowButtonClass =
	'flex w-full min-w-0 items-center gap-2 text-left text-xs text-popover-foreground transition-[background-color,color,box-shadow] hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden';

function selectorCatalogues(): SelectorDbcFile[] {
	return [
		...dbcFiles.getState().selectorFiles,
		...traceFile.getState().mf4SelectorIndexes.map((index) => index.dbc)
	];
}

function withExpanded(
	expansion: Expansion,
	dbcIds: readonly string[],
	messageKeys: readonly string[]
): Expansion {
	if (dbcIds.length === 0 && messageKeys.length === 0) return expansion;
	return {
		dbcIds: new Set([...expansion.dbcIds, ...dbcIds]),
		messageKeys: new Set([...expansion.messageKeys, ...messageKeys])
	};
}

function toggled(set: ReadonlySet<string>, key: string, open: boolean): ReadonlySet<string> {
	const next = new Set(set);
	if (open) next.add(key);
	else next.delete(key);
	return next;
}

function expandAllCatalogues(expansion: Expansion): Expansion {
	const catalogues = selectorCatalogues();
	return withExpanded(
		expansion,
		catalogues.map((dbc) => dbc.id),
		catalogues.flatMap((dbc) => dbc.messages.map((message) => message.key))
	);
}

/**
 * Signal selector popover. Owns the Popover root so it can keep the panel open on outside
 * presses; `children` must render the `PopoverTrigger`. Filter, expansion and scroll state
 * persist across open/close.
 */
export function SignalSelectorDialog({
	open,
	onOpenChange,
	focusSearchRequest = 0,
	onDbcAdded,
	onSignalToggle,
	children
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	focusSearchRequest?: number;
	onDbcAdded?: () => void;
	onSignalToggle?: () => void;
	children: ReactNode;
}) {
	const dbcInput = useRef<HTMLInputElement>(null);
	const scrollTop = useRef(0);
	const [searchForm, setSearchForm] = useState<HTMLFormElement | null>(null);
	const [search, setSearch] = useState('');
	const [activeOnly, setActiveOnly] = useState(false);
	const [hideUnavailable, setHideUnavailable] = useState(false);
	const [dropActive, setDropActive] = useState(false);
	const [expansion, setExpansion] = useState<Expansion>(() => ({
		dbcIds: new Set(),
		messageKeys: new Set()
	}));
	const isLoading = useStore(dbcFiles, (s) => s.isLoading);
	const dbcError = useStore(dbcFiles, (s) => s.error);
	const filtering = search.trim().length > 0 || activeOnly;

	// While filtering, catalogues that appear (e.g. a DBC added mid-search) open expanded.
	useEffect(() => {
		if (!filtering) return;
		let seenDbcIds = new Set<string>();
		let seenMessageKeys = new Set<string>();
		const expandUnseen = (initial: boolean) => {
			const catalogues = selectorCatalogues();
			const dbcIds = catalogues.map((dbc) => dbc.id);
			const messageKeys = catalogues.flatMap((dbc) => dbc.messages.map((message) => message.key));
			if (!initial) {
				const newDbcIds = dbcIds.filter((id) => !seenDbcIds.has(id));
				const newMessageKeys = messageKeys.filter((key) => !seenMessageKeys.has(key));
				setExpansion((current) => withExpanded(current, newDbcIds, newMessageKeys));
			}
			seenDbcIds = new Set(dbcIds);
			seenMessageKeys = new Set(messageKeys);
		};
		expandUnseen(true);
		const unsubscribes = [
			dbcFiles.subscribe(() => expandUnseen(false)),
			traceFile.subscribe(() => expandUnseen(false))
		];
		return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
	}, [filtering]);

	useEffect(() => {
		if (focusSearchRequest === 0 || searchForm === null) return;
		const frame = requestAnimationFrame(() => searchForm.querySelector('input')?.focus());
		return () => cancelAnimationFrame(frame);
	}, [focusSearchRequest, searchForm]);

	function handleOpenChange(next: boolean, details: PopoverPrimitive.Root.ChangeEventDetails) {
		if (!next && (details.reason === 'outside-press' || details.reason === 'focus-out')) {
			details.cancel();
			return;
		}
		onOpenChange(next);
	}

	function changeSearch(value: string) {
		if (value.trim().length > 0 && search.trim().length === 0) setExpansion(expandAllCatalogues);
		setSearch(value);
	}

	function toggleActiveOnly() {
		if (!activeOnly) setExpansion(expandAllCatalogues);
		setActiveOnly(!activeOnly);
	}

	async function addFiles(files: File[]) {
		if (files.length === 0) return;
		const previousCount = dbcFiles.getState().files.length;
		await addDbcFiles(files);
		if (dbcFiles.getState().files.length > previousCount) onDbcAdded?.();
	}

	function handleDrag(event: DragEvent<HTMLDivElement>) {
		if (!hasDraggedFiles(event)) return;
		event.preventDefault();
		setDropActive(true);
	}

	function handleDragLeave(event: DragEvent<HTMLDivElement>) {
		if (dragLeftCurrentTarget(event)) setDropActive(false);
	}

	function handleDrop(event: DragEvent<HTMLDivElement>) {
		event.preventDefault();
		setDropActive(false);
		void addFiles(dbcFilesFromDrop(filesFromDrop(event)));
	}

	function setExpanded(kind: keyof Expansion, key: string, isOpen: boolean) {
		setExpansion((current) => ({ ...current, [kind]: toggled(current[kind], key, isOpen) }));
	}

	async function removeDbc(dbcId: string) {
		const messageKeys = new Set(
			dbcFiles
				.getState()
				.selectorFiles.find((dbc) => dbc.id === dbcId)
				?.messages.map((message) => message.key)
		);
		setExpansion((current) => ({
			dbcIds: toggled(current.dbcIds, dbcId, false),
			messageKeys: new Set([...current.messageKeys].filter((key) => !messageKeys.has(key)))
		}));
		await onDbcRemoved(dbcId);
	}

	function handleToggleSignal(key: string) {
		void toggleSignal(key);
		onSignalToggle?.();
	}

	const addDbcLabel = isLoading ? 'Loading DBC' : 'Add DBC';
	const activeOnlyLabel = activeOnly ? 'Show all DBC signals' : 'Show selected DBC signals only';
	const unavailableLabel = hideUnavailable
		? 'Show unavailable signals'
		: 'Hide unavailable signals';

	return (
		<>
			<Popover open={open} onOpenChange={handleOpenChange}>
				{children}
				<PopoverContent
					data-walkthrough-target="signal-selector-panel"
					align="start"
					sideOffset={-32}
					initialFocus={false}
					className="relative grid h-[calc(100vh-1rem)] w-[min(26rem,calc(100vw-1rem))] -translate-x-2 -translate-y-2 grid-rows-[auto_minmax(0,1fr)] gap-3 overflow-hidden rounded-lg border border-border/70 bg-popover/90 p-4 pt-14 text-popover-foreground backdrop-blur-md"
					style={{ boxShadow: '0 1px 2px rgb(0 0 0 / 0.08)' }}
					onDragEnter={handleDrag}
					onDragOver={handleDrag}
					onDragLeave={handleDragLeave}
					onDrop={handleDrop}
				>
					{dropActive && (
						<div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-popover/25 text-sm font-medium text-foreground backdrop-blur-[1px]">
							Drop DBC files to add
						</div>
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

					<div className="absolute top-[6.5px] right-[7px] left-[7px] grid h-8 grid-cols-[1fr_auto_1fr] items-center">
						<PopoverPrimitive.Close
							className="flex size-8 shrink-0 items-center justify-center rounded-md text-destructive transition-[background-color,color,box-shadow,scale] hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden active:scale-[0.96]"
							aria-label="Close signal selector"
						>
							<X className="size-4" />
						</PopoverPrimitive.Close>
						<PopoverTitle className="text-center">Signal Selector</PopoverTitle>
						<Tooltip>
							<TooltipTrigger
								render={
									<button
										type="button"
										data-walkthrough-target="add-dbc"
										className={cn(iconButtonClass, 'justify-self-end')}
										disabled={isLoading}
										aria-label={addDbcLabel}
										onClick={() => dbcInput.current?.click()}
									/>
								}
							>
								<Plus className="size-4" />
							</TooltipTrigger>
							<TooltipContent sideOffset={6}>{addDbcLabel}</TooltipContent>
						</Tooltip>
					</div>

					<div className="flex items-center gap-2">
						<SearchForm
							ref={setSearchForm}
							className="min-w-0 flex-1"
							value={search}
							onValueChange={changeSearch}
							placeholder="Filter signals..."
						/>
						<Tooltip>
							<TooltipTrigger
								render={
									<button
										type="button"
										className={filterButtonClass}
										data-active={activeOnly}
										aria-pressed={activeOnly}
										aria-label={activeOnlyLabel}
										onClick={toggleActiveOnly}
									/>
								}
							>
								<Check className="size-4" />
							</TooltipTrigger>
							<TooltipContent sideOffset={6}>{activeOnlyLabel}</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger
								render={
									<button
										type="button"
										className={filterButtonClass}
										data-active={hideUnavailable}
										aria-pressed={hideUnavailable}
										aria-label={unavailableLabel}
										onClick={() => setHideUnavailable(!hideUnavailable)}
									/>
								}
							>
								<ListFilter className="size-4" />
							</TooltipTrigger>
							<TooltipContent sideOffset={6}>{unavailableLabel}</TooltipContent>
						</Tooltip>
					</div>

					<SelectorTree
						query={search}
						activeOnly={activeOnly}
						hideUnavailable={hideUnavailable}
						expansion={expansion}
						getInitialScrollTop={() => scrollTop.current}
						onScrollTopChange={(top) => (scrollTop.current = top)}
						onExpandedChange={setExpanded}
						onRemoveDbc={(id) => void removeDbc(id)}
						onToggleSignal={handleToggleSignal}
					/>
				</PopoverContent>
			</Popover>

			<AlertDialog
				open={dbcError !== null}
				onOpenChange={(isOpen) => {
					if (!isOpen) clearDbcError();
				}}
			>
				{dbcError !== null && (
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>DBC failed to open</AlertDialogTitle>
							<AlertDialogDescription>{dbcError}</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogAction onClick={clearDbcError}>OK</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				)}
			</AlertDialog>
		</>
	);
}

type RowHandlers = {
	onExpandedChange: (kind: keyof Expansion, key: string, open: boolean) => void;
	onRemoveDbc: (dbcId: string) => void;
	onToggleSignal: (key: string) => void;
};

type ListProps = RowHandlers & {
	getInitialScrollTop: () => number;
	onScrollTopChange: (top: number) => void;
};

/** Derives the visible rows; mounted only while the panel is open. */
function SelectorTree({
	query,
	activeOnly,
	hideUnavailable,
	expansion,
	...listProps
}: ListProps & {
	query: string;
	activeOnly: boolean;
	hideUnavailable: boolean;
	expansion: Expansion;
}) {
	const deferredQuery = useDeferredValue(query);
	const dbcIndexes = useStore(dbcFiles, (s) => s.selectorSearchIndexes);
	const mf4Indexes = useStore(traceFile, (s) => s.mf4SelectorIndexes);
	const selected = useStore(plotData, (s) => s.selected);
	const rows = flattenSelectorTree(
		visibleSelectorTree([...dbcIndexes, ...mf4Indexes], {
			query: deferredQuery,
			activeOnly,
			hideUnavailable,
			isSignalSelected: (key) => selected.has(key),
			expandedDbcIds: expansion.dbcIds,
			expandedMessageKeys: expansion.messageKeys
		})
	);

	return <VirtualRows rows={rows} selected={selected} {...listProps} />;
}

/** Re-renders on scroll; only the rows in the virtual window are rendered. */
function VirtualRows({
	rows,
	selected,
	getInitialScrollTop,
	onScrollTopChange,
	...handlers
}: ListProps & {
	rows: SelectorListRow[];
	selected: PlotDataState['selected'];
}) {
	'use no memo';
	const scroller = useRef<HTMLDivElement>(null);
	// oxlint-disable-next-line react/incompatible-library -- this component opts out of the compiler
	const virtualizer = useVirtualizer({
		count: rows.length,
		getScrollElement: () => scroller.current,
		estimateSize: (index) => (rows[index]?.kind === 'dbc' ? 32 : 28),
		getItemKey: (index) => rows[index]?.key ?? index,
		overscan: ROW_OVERSCAN,
		gap: ROW_GAP_PX,
		initialOffset: getInitialScrollTop
	});
	const totalSize = virtualizer.getTotalSize();
	const viewportHeight = virtualizer.scrollRect?.height;
	const overflows =
		viewportHeight !== undefined && totalSize + LIST_PADDING_BOTTOM_PX > viewportHeight + 1;

	return (
		<div className="relative min-h-0">
			<div
				ref={scroller}
				className={cn(
					'h-full [scrollbar-gutter:stable] overflow-y-auto pb-4 [--scroll-fade-size:2rem]',
					overflows && 'scroll-fade'
				)}
				onScroll={(event) => onScrollTopChange(event.currentTarget.scrollTop)}
			>
				<div className="relative w-full" style={{ height: totalSize }}>
					<ul className="absolute top-0 right-0 left-0 w-full min-w-0">
						{virtualizer.getVirtualItems().map((item) => {
							const row = rows[item.index];
							if (!row) return null;
							return (
								<li
									key={item.key}
									data-index={item.index}
									ref={virtualizer.measureElement}
									className={cn(
										'absolute top-0 left-0 w-full',
										row.kind === 'dbc' && 'flex h-8 items-center gap-1',
										row.kind === 'message' && 'h-7 pl-6',
										row.kind === 'signal' && 'h-7 pl-12'
									)}
									style={{ transform: `translateY(${item.start}px)` }}
								>
									{row.kind === 'dbc' ? (
										<DbcRow dbc={row.dbc} {...handlers} />
									) : row.kind === 'message' ? (
										<MessageRow message={row.message} {...handlers} />
									) : (
										<SignalRow
											signal={row.signal}
											isSelected={selected.has(row.signal.key)}
											{...signalDecodeStatus(row.signal.key, selected)}
											{...handlers}
										/>
									)}
								</li>
							);
						})}
					</ul>
				</div>
			</div>
		</div>
	);
}

function DbcRow({ dbc, onExpandedChange, onRemoveDbc }: RowHandlers & { dbc: SelectorListDbc }) {
	const file = useStore(dbcFiles, (s) =>
		dbc.kind === 'dbc' ? s.files.find((entry) => entry.id === dbc.id) : undefined
	);
	const Chevron = dbc.expanded ? ChevronDown : ChevronRight;

	return (
		<>
			<button
				type="button"
				className={cn(
					rowButtonClass,
					'h-full flex-1 overflow-hidden rounded-[calc(var(--radius-sm)+2px)] p-2 py-0'
				)}
				aria-expanded={dbc.expanded}
				aria-label={`${dbc.expanded ? 'Collapse' : 'Expand'} ${dbc.name}`}
				onClick={() => onExpandedChange('dbcIds', dbc.id, !dbc.expanded)}
			>
				<Chevron className="size-4 shrink-0 text-muted-foreground" />
				<span className={cn('min-w-0 truncate', dbc.transient && 'italic')}>{dbc.name}</span>
				{dbc.transient && (
					<span className="shrink-0 rounded border border-border/70 bg-muted px-1 py-0.5 text-[9px] leading-none font-medium text-muted-foreground not-italic">
						MF4
					</span>
				)}
			</button>
			{file && <DbcInformation file={file} />}
			{!dbc.transient && dbc.kind === 'dbc' && (
				<button
					type="button"
					className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-70 transition-[background-color,color,box-shadow,opacity,scale] hover:bg-accent hover:text-destructive hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden active:scale-[0.96]"
					aria-label={`Delete ${dbc.name}`}
					onClick={() => onRemoveDbc(dbc.id)}
				>
					<Trash2 className="size-4" />
				</button>
			)}
		</>
	);
}

function MessageRow({ message, onExpandedChange }: RowHandlers & { message: SelectorListMessage }) {
	const Chevron = message.expanded ? ChevronDown : ChevronRight;

	return (
		<button
			type="button"
			className={cn(rowButtonClass, 'h-7 rounded-md px-2')}
			aria-expanded={message.expanded}
			aria-label={`${message.expanded ? 'Collapse' : 'Expand'} ${message.name}${message.sourceLabel ?? ''}`}
			onClick={() => onExpandedChange('messageKeys', message.key, !message.expanded)}
		>
			<span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
				<Chevron className="size-4" />
			</span>
			<span className="truncate">{message.name}</span>
			{message.sourceBadges?.map((badge) => (
				<Badge key={badge}>{badge}</Badge>
			))}
		</button>
	);
}

function SignalRow({
	signal,
	isSelected,
	isDecoding,
	decodeError,
	onToggleSignal
}: RowHandlers & {
	signal: SelectorListSignal;
	isSelected: boolean;
	isDecoding: boolean;
	decodeError: string | null;
}) {
	const reason = signal.unavailableReason;
	const toggleId = `signal-toggle-${signal.key}`;
	const showDecodeError = isSelected && decodeError !== null;
	const labelProps = {
		tabIndex: reason ? 0 : undefined,
		'aria-label': reason ? `${signal.label}: ${reason}` : undefined,
		htmlFor: toggleId,
		className: cn(
			'flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs font-normal text-popover-foreground transition-[background-color,color,box-shadow] hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden',
			reason ? 'cursor-default opacity-50' : 'cursor-pointer'
		)
	};
	const content = (
		<>
			<Checkbox
				id={toggleId}
				checked={isSelected}
				disabled={!!reason && !isSelected}
				aria-describedby={reason ? `${toggleId}-reason` : undefined}
				aria-label={`Plot ${signal.label}`}
				title={showDecodeError ? decodeError : undefined}
				className="data-[error=true]:border-destructive/50 data-[error=true]:bg-destructive/10 data-[error=true]:text-destructive data-checked:border-sidebar-primary data-checked:bg-sidebar-primary data-checked:text-sidebar-primary-foreground"
				data-error={showDecodeError}
				onCheckedChange={() => onToggleSignal(signal.key)}
			/>
			<span className="flex min-w-0 flex-1 items-center gap-2">
				<span className="truncate font-mono" title={signal.label}>
					{signal.signalName}
				</span>
				{showDecodeError ? (
					<CircleAlert className="size-3 shrink-0 text-destructive" aria-label={decodeError} />
				) : (
					isSelected &&
					isDecoding && (
						<LoaderCircle
							className="size-3 shrink-0 animate-spin text-muted-foreground"
							aria-label="Decoding signal"
						/>
					)
				)}
			</span>
		</>
	);

	if (!reason) return <Label {...labelProps}>{content}</Label>;

	return (
		<Tooltip>
			<TooltipTrigger render={<Label {...labelProps} />}>{content}</TooltipTrigger>
			<TooltipContent sideOffset={6}>{reason}</TooltipContent>
			<span id={`${toggleId}-reason`} className="sr-only">
				{reason}
			</span>
		</Tooltip>
	);
}
