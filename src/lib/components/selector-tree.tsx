import { useDeferredValue, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useStore } from 'zustand';
import { ChevronDown, ChevronRight, CircleAlert, LoaderCircle, Trash2 } from 'lucide-react';
import { Badge } from '#lib/components/ui/badge.js';
import { Checkbox } from '#lib/components/ui/checkbox.js';
import { Label } from '#lib/components/ui/label.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '#lib/components/ui/tooltip.js';
import { DbcInformation } from '#lib/components/dbc-information.js';
import {
	flattenSelectorTree,
	visibleSelectorTree,
	type SelectorListDbc,
	type SelectorListMessage,
	type SelectorListRow,
	type SelectorListSignal
} from '#lib/selector-list.js';
import { dbcFiles } from '#lib/stores/dbc-files.js';
import { plotData, signalDecodeStatus, type PlotDataState } from '#lib/stores/plot-data.js';
import { traceFile } from '#lib/stores/trace-file.js';
import { cn } from '#lib/utils.js';

export type Expansion = { dbcIds: ReadonlySet<string>; messageKeys: ReadonlySet<string> };

const ROW_GAP_PX = 4;
const ROW_OVERSCAN = 8;
const LIST_PADDING_BOTTOM_PX = 16;

const rowButtonClass =
	'flex w-full min-w-0 items-center gap-2 text-left text-xs text-popover-foreground transition-[background-color,color,box-shadow] hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden';

type RowHandlers = {
	onExpandedChange: (kind: keyof Expansion, key: string, open: boolean) => void;
	onRemoveDbc: (dbcId: string) => void;
	onToggleSignal: (key: string) => void;
};

type ListProps = RowHandlers & {
	getInitialScrollTop: () => number;
	onScrollTopChange: (top: number) => void;
};

/** Signal selector list: derives the visible rows; mounted only while the panel is open. */
export function SelectorTree({
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
