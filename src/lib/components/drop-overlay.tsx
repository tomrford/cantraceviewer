import type { ComponentProps } from 'react';
import { cn } from '#lib/utils.js';

/** Covers the nearest positioned ancestor while files are dragged over it. */
export function DropOverlay({ className, ...props }: ComponentProps<'div'>) {
	return (
		<div
			className={cn(
				'pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/25 text-sm font-medium text-foreground backdrop-blur-[1px]',
				className
			)}
			{...props}
		/>
	);
}
