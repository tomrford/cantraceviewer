<script lang="ts">
	import * as ButtonGroup from '$lib/components/ui/button-group/index.js';
	import { Button, buttonVariants } from '$lib/components/ui/button/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { Toggle } from '$lib/components/ui/toggle/index.js';
	import { setCrosshair, type CrosshairId, type PlotCrosshair } from '$lib/plot-crosshair.js';
	import { viewportCenter, type PlotViewport } from '$lib/plot-viewport.js';
	import { cn } from '$lib/utils.js';
	import BoxSelectIcon from '@lucide/svelte/icons/box-select';
	import CrosshairIcon from '@lucide/svelte/icons/crosshair';
	import ExpandIcon from '@lucide/svelte/icons/expand';
	import ListIcon from '@lucide/svelte/icons/list';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';

	let {
		disabled,
		canResetZoom,
		viewport,
		boxZoomEnabled = $bindable(false),
		crosshairs = $bindable<PlotCrosshair[]>([]),
		legendVisible = $bindable(true),
		onZoomIn,
		onZoomOut,
		onResetZoom
	}: {
		disabled?: boolean;
		canResetZoom?: boolean;
		viewport: PlotViewport | null;
		boxZoomEnabled?: boolean;
		crosshairs?: PlotCrosshair[];
		legendVisible?: boolean;
		onZoomIn: () => void;
		onZoomOut: () => void;
		onResetZoom: () => void;
	} = $props();

	const toolbarIconButtonClass =
		'border-input bg-transparent hover:bg-muted hover:text-foreground dark:bg-transparent dark:hover:bg-muted/50';

	function placeCrosshair(id: CrosshairId) {
		if (viewport !== null) {
			crosshairs = setCrosshair(crosshairs, { id, ...viewportCenter(viewport) });
		}
	}
</script>

<ButtonGroup.Root aria-label="Plot zoom controls">
	<Button
		variant="outline"
		size="icon"
		class={toolbarIconButtonClass}
		aria-label="Zoom in"
		title="Zoom in"
		{disabled}
		onclick={onZoomIn}
	>
		<PlusIcon class="size-3.5" />
	</Button>
	<Button
		variant="outline"
		size="icon"
		class={toolbarIconButtonClass}
		aria-label="Zoom out"
		title="Zoom out"
		{disabled}
		onclick={onZoomOut}
	>
		<MinusIcon class="size-3.5" />
	</Button>
	<Button
		variant="outline"
		size="icon"
		class={toolbarIconButtonClass}
		aria-label="Zoom to full extent"
		title="Zoom to full extent"
		disabled={disabled || !canResetZoom}
		onclick={onResetZoom}
	>
		<ExpandIcon class="size-3.5" />
	</Button>
</ButtonGroup.Root>
<ButtonGroup.Root aria-label="Plot display controls">
	<Toggle
		bind:pressed={boxZoomEnabled}
		{disabled}
		variant="outline"
		size="default"
		aria-label={boxZoomEnabled ? 'Use drag pan' : 'Use box zoom'}
		title={boxZoomEnabled ? 'Use drag pan' : 'Use box zoom'}
	>
		<BoxSelectIcon class="size-3.5" />
	</Toggle>
	<Popover.Root>
		<Popover.Trigger
			class={cn(
				buttonVariants({ variant: 'outline', size: 'default' }),
				toolbarIconButtonClass,
				crosshairs.length > 0 && 'bg-muted text-foreground'
			)}
			{disabled}
			aria-label="Manage crosshairs"
			title="Crosshairs"
		>
			<CrosshairIcon class="size-3.5" />
		</Popover.Trigger>
		<Popover.Content align="end" class="w-52 gap-1 p-1.5">
			<Popover.Close
				class={cn(buttonVariants({ variant: 'ghost' }), 'w-full justify-start')}
				disabled={viewport === null}
				onclick={() => placeCrosshair(1)}
			>
				<CrosshairIcon />
				Place C1
			</Popover.Close>
			<Popover.Close
				class={cn(buttonVariants({ variant: 'ghost' }), 'w-full justify-start')}
				disabled={viewport === null}
				onclick={() => placeCrosshair(2)}
			>
				<CrosshairIcon />
				Place C2
			</Popover.Close>
			<Popover.Close
				class={cn(
					buttonVariants({ variant: 'ghost' }),
					'w-full justify-start text-destructive hover:bg-destructive/10 hover:text-destructive'
				)}
				disabled={crosshairs.length === 0}
				onclick={() => (crosshairs = [])}
			>
				<XIcon />
				Clear all
			</Popover.Close>
		</Popover.Content>
	</Popover.Root>
	<Toggle
		bind:pressed={legendVisible}
		variant="outline"
		size="default"
		aria-label={legendVisible ? 'Hide legend' : 'Show legend'}
		title={legendVisible ? 'Hide legend' : 'Show legend'}
	>
		<ListIcon class="size-3.5" />
	</Toggle>
</ButtonGroup.Root>
