<script lang="ts">
	import { cn } from '$lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		shortcut,
		class: className,
		...restProps
	}: HTMLAttributes<HTMLElement> & { shortcut: string } = $props();
</script>

<kbd
	data-slot="kbd"
	class={cn(
		'inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] border border-border/80 bg-muted/80 px-1.5 font-mono text-[0.625rem] leading-none font-medium tracking-normal text-muted-foreground shadow-[inset_0_-1px_0_color-mix(in_oklab,var(--border)_80%,transparent)]',
		className
	)}
	{...restProps}
>
	{shortcut}
</kbd>
