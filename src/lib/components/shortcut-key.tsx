import type { ComponentProps } from 'react';
import { cn } from '#lib/utils.js';

export function ShortcutKey({
	keys,
	className,
	...props
}: ComponentProps<'span'> & { keys: string[] }) {
	return (
		<span
			data-slot="kbd-group"
			className={cn('relative inline-flex shrink-0 items-center gap-0.5', className)}
			{...props}
		>
			{keys.map((key) => (
				<kbd
					key={key}
					data-slot="kbd"
					className="inline-flex h-4 min-w-4 items-center justify-center rounded-[4px] bg-current/12 px-1 font-mono text-[0.625rem] leading-none font-medium tracking-normal text-current"
				>
					{key}
				</kbd>
			))}
		</span>
	);
}
