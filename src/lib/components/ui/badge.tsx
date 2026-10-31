import type { ReactNode } from 'react';

function Badge({ children }: { children: ReactNode }) {
	return (
		<span className="rounded border px-1 text-[10px] font-medium" aria-hidden="true">
			{children}
		</span>
	);
}

export { Badge };
