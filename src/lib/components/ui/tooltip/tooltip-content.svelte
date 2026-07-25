<script lang="ts">
	import { Tooltip as TooltipPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';
	import TooltipPortal from './tooltip-portal.svelte';
	import type { ComponentProps } from 'svelte';
	import type { WithoutChildrenOrChild } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		sideOffset = 0,
		side = 'top',
		children,
		arrowClasses,
		portalProps,
		...restProps
	}: TooltipPrimitive.ContentProps & {
		arrowClasses?: string;
		portalProps?: WithoutChildrenOrChild<ComponentProps<typeof TooltipPortal>>;
	} = $props();
</script>

<TooltipPortal {...portalProps}>
	<TooltipPrimitive.Content
		bind:ref
		data-slot="tooltip-content"
		{sideOffset}
		{side}
		class={cn(
			'z-50 inline-flex w-fit max-w-xs origin-(--bits-tooltip-content-transform-origin) items-start gap-1.5 rounded-md border border-border/70 bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md has-data-[slot=kbd-group]:pr-2 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
			className
		)}
		{...restProps}
	>
		{@render children?.()}
		<TooltipPrimitive.Arrow>
			{#snippet child({ props })}
				<div
					class={cn(
						'z-50 size-2.5 translate-y-[calc(-50%-2px)] rotate-45 rounded-[2px] border-border/70 bg-popover fill-popover',
						// Only the two edges facing away from the tooltip body are drawn, so the arrow
						// continues the body's border instead of outlining a floating square.
						'data-[side=top]:translate-x-1/2 data-[side=top]:translate-y-[calc(-50%+2px)] data-[side=top]:border-r data-[side=top]:border-b',
						'data-[side=bottom]:-translate-x-1/2 data-[side=bottom]:-translate-y-[calc(-50%+1px)] data-[side=bottom]:border-t data-[side=bottom]:border-l',
						'data-[side=right]:translate-x-[calc(50%+2px)] data-[side=right]:translate-y-1/2 data-[side=right]:border-b data-[side=right]:border-l',
						'data-[side=left]:-translate-y-[calc(50%-3px)] data-[side=left]:border-t data-[side=left]:border-r',
						arrowClasses
					)}
					{...props}
				></div>
			{/snippet}
		</TooltipPrimitive.Arrow>
	</TooltipPrimitive.Content>
</TooltipPortal>
