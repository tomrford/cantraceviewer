import type { ReactNode } from 'react';

export function SourceBadge({ children }: { children: ReactNode }) {
	return (
		<span className="rounded border px-1 text-[10px] font-medium" aria-hidden="true">
			{children}
		</span>
	);
}
