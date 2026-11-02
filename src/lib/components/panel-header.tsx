import type { ReactNode } from 'react';

/** Header row of a floating panel, offset so its icon buttons land exactly on the panel's trigger. */
export function PanelHeader({ children }: { children: ReactNode }) {
	return (
		<div className="absolute top-[6.5px] right-[7px] left-[7px] grid h-8 grid-cols-[1fr_auto_1fr] items-center">
			{children}
		</div>
	);
}
