<script lang="ts">
	import * as ButtonGroup from '$lib/components/ui/button-group/index.js';
	import { Button, buttonVariants } from '$lib/components/ui/button/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { Toggle } from '$lib/components/ui/toggle/index.js';
	import {
		crosshairById,
		setCrosshair,
		type CrosshairId,
		type PlotCrosshair
	} from '$lib/plot-crosshair.js';
	import { viewportCenter, type PlotViewport } from '$lib/plot-viewport.js';
	import { shortcutLabel, shortcutTitle, type ShortcutPlatform } from '$lib/keyboard-shortcuts.js';
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
		shortcutPlatform,
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
		shortcutPlatform: ShortcutPlatform;
		onZoomIn: () => void;
		onZoomOut: () => void;
		onResetZoom: () => void;
	} = $props();
	const c1 = $derived(crosshairById(crosshairs, 1));
	const c2 = $derived(crosshairById(crosshairs, 2));

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
		title={shortcutTitle('Zoom in', 'zoomIn', shortcutPlatform)}
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
		title={shortcutTitle('Zoom out', 'zoomOut', shortcutPlatform)}
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
		title={shortcutTitle('Zoom to full extent', 'resetZoom', shortcutPlatform)}
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
		title={shortcutTitle(
			boxZoomEnabled ? 'Use drag pan' : 'Use box zoom',
			'toggleBoxZoom',
			shortcutPlatform
		)}
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
				{c1 === null ? 'Place C1' : 'Center C1'}
				<span class="ml-auto text-[0.625rem] text-muted-foreground">
					{shortcutLabel('placeC1', shortcutPlatform)}
				</span>
			</Popover.Close>
			<Popover.Close
				class={cn(buttonVariants({ variant: 'ghost' }), 'w-full justify-start')}
				disabled={viewport === null}
				onclick={() => placeCrosshair(2)}
			>
				<CrosshairIcon />
				{c2 === null ? 'Place C2' : 'Center C2'}
				<span class="ml-auto text-[0.625rem] text-muted-foreground">
					{shortcutLabel('placeC2', shortcutPlatform)}
				</span>
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
		{disabled}
		variant="outline"
		size="default"
		aria-label={legendVisible ? 'Hide legend' : 'Show legend'}
		title={shortcutTitle(
			legendVisible ? 'Hide legend' : 'Show legend',
			'toggleLegend',
			shortcutPlatform
		)}
	>
		<ListIcon class="size-3.5" />
	</Toggle>
</ButtonGroup.Root>
