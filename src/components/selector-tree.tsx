import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronRight, CircleAlert, LoaderCircle, Trash2 } from 'lucide-react';
import { useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { DbcInformation } from '@/components/dbc-information';
import { SourceBadge } from '@/components/source-badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
	selectorRows,
	type SelectorDbcFile,
	type SelectorDbcMessage,
	type SelectorListRow,
	type SelectorListSignal
} from '@/lib/selector-list';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/store';

const ROW_GAP_PX = 4;
const ROW_OVERSCAN = 8;
const LIST_PADDING_BOTTOM_PX = 16;

const rowButtonClass =
	'flex min-w-0 items-center gap-2 rounded-md text-left text-xs text-popover-foreground transition-[background-color,color,box-shadow] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden';

type RowHandlers = {
	onExpandedChange: (key: string, open: boolean) => void;
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
	isExpanded,
	...listProps
}: ListProps & {
	query: string;
	activeOnly: boolean;
	hideUnavailable: boolean;
	isExpanded: (key: string) => boolean;
}) {
	const dbcIndexes = useAppStore((s) => s.selectorSearchIndexes);
	const mf4Indexes = useAppStore((s) => s.mf4SelectorIndexes);
	// Decode status only affects individual rows; filtering needs membership in selected-only mode.
	const selectedKeys = useAppStore(
		useShallow((s) => (activeOnly ? new Set(s.selected.keys()) : null))
	);
	const rows = selectorRows([...dbcIndexes, ...mf4Indexes], {
		query,
		activeOnly,
		hideUnavailable,
		isSignalSelected: (key) => selectedKeys?.has(key) ?? false,
		isExpanded
	});

	return <VirtualRows rows={rows} {...listProps} />;
}

/** Re-renders on scroll; only the rows in the virtual window are rendered. */
function VirtualRows({
	rows,
	getInitialScrollTop,
	onScrollTopChange,
	...handlers
}: ListProps & {
	rows: SelectorListRow[];
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
										row.kind === 'dbc' &&
											'group/row flex h-8 items-center gap-1 rounded-md transition-[background-color] hover:bg-accent',
										row.kind === 'message' && 'h-7 pl-6',
										row.kind === 'signal' && 'h-7 pl-12'
									)}
									style={{ transform: `translateY(${item.start}px)` }}
								>
									{row.kind === 'dbc' ? (
										<DbcRow dbc={row.dbc} expanded={row.expanded} {...handlers} />
									) : row.kind === 'message' ? (
										<MessageRow message={row.message} expanded={row.expanded} {...handlers} />
									) : (
										<SignalRow signal={row.signal} {...handlers} />
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

function DbcRow({
	dbc,
	expanded,
	onExpandedChange,
	onRemoveDbc
}: RowHandlers & { dbc: SelectorDbcFile; expanded: boolean }) {
	const file = useAppStore((s) => s.dbcFiles.find((entry) => entry.id === dbc.id));
	const Chevron = expanded ? ChevronDown : ChevronRight;

	return (
		<>
			<button
				type="button"
				className={cn(rowButtonClass, 'h-full flex-1 overflow-hidden px-2')}
				aria-expanded={expanded}
				aria-label={`${expanded ? 'Collapse' : 'Expand'} ${dbc.name}`}
				onClick={() => onExpandedChange(dbc.id, !expanded)}
			>
				<Chevron className="size-4 shrink-0 text-muted-foreground" />
				<span className={cn('min-w-0 truncate', dbc.transient && 'italic')}>{dbc.name}</span>
				{dbc.transient && (
					<span className="shrink-0 rounded border border-border/70 bg-muted px-1 py-0.5 text-[9px] leading-none font-medium text-muted-foreground not-italic">
						MF4
					</span>
				)}
			</button>
			{/* Hidden with opacity so keyboard users can still tab to them; always shown on touch. */}
			<div className="flex shrink-0 items-center gap-0.5 pr-0.5 opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 pointer-coarse:opacity-100">
				{file && <DbcInformation file={file} />}
				{!dbc.transient && (
					<Button
						variant="ghost-destructive"
						size="icon"
						aria-label={`Delete ${dbc.name}`}
						onClick={() => onRemoveDbc(dbc.id)}
					>
						<Trash2 />
					</Button>
				)}
			</div>
		</>
	);
}

function MessageRow({
	message,
	expanded,
	onExpandedChange
}: RowHandlers & { message: SelectorDbcMessage; expanded: boolean }) {
	const Chevron = expanded ? ChevronDown : ChevronRight;

	return (
		<button
			type="button"
			className={cn(rowButtonClass, 'h-7 w-full px-2 hover:bg-accent hover:text-accent-foreground')}
			aria-expanded={expanded}
			aria-label={`${expanded ? 'Collapse' : 'Expand'} ${message.name}${message.sourceLabel ?? ''}`}
			onClick={() => onExpandedChange(message.key, !expanded)}
		>
			<span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
				<Chevron className="size-4" />
			</span>
			<span className="truncate">{message.name}</span>
			{message.sourceBadges?.map((badge) => (
				<SourceBadge key={badge}>{badge}</SourceBadge>
			))}
		</button>
	);
}

function SignalRow({
	signal,
	onToggleSignal
}: RowHandlers & {
	signal: SelectorListSignal;
}) {
	const selected = useAppStore((s) => s.selected.get(signal.key));
	const isSelected = selected !== undefined;
	const decodeError = selected?.error ?? null;
	const reason = signal.unavailableReason;
	const toggleId = `signal-toggle-${signal.key}`;
	const showDecodeError = decodeError !== null;
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
					selected?.isDecoding && (
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
			<TooltipContent>{reason}</TooltipContent>
			<span id={`${toggleId}-reason`} className="sr-only">
				{reason}
			</span>
		</Tooltip>
	);
}
