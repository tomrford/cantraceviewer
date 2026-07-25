<script lang="ts">
	import { cn } from '$lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		keys,
		class: className,
		...restProps
	}: HTMLAttributes<HTMLElement> & { keys: string[] } = $props();
</script>

<!-- Chips derive their colours from currentColor so they read correctly on both normal and
     inverted surfaces (tooltips) without needing a per-surface variant. -->
<span
	data-slot="kbd-group"
	class={cn('relative inline-flex shrink-0 items-center gap-0.5', className)}
	{...restProps}
>
	{#each keys as key (key)}
		<kbd
			data-slot="kbd"
			class="inline-flex h-4 min-w-4 items-center justify-center rounded-[4px] bg-current/12 px-1 font-mono text-[0.625rem] leading-none font-medium tracking-normal text-current"
		>
			{key}
		</kbd>
	{/each}
</span>
