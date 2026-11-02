import type { CSSProperties, ReactNode } from 'react';

/** Inline so it also replaces the ring that `PopoverContent` draws through `box-shadow`. */
export const panelShadow: CSSProperties = { boxShadow: '0 1px 2px rgb(0 0 0 / 0.08)' };

/** Header row of a floating panel, offset so its icon buttons land exactly on the panel's trigger. */
export function PanelHeader({ children }: { children: ReactNode }) {
	return (
		<div className="absolute top-[6.5px] right-[7px] left-[7px] grid h-8 grid-cols-[1fr_auto_1fr] items-center">
			{children}
		</div>
	);
}
