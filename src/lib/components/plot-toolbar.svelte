<script lang="ts">
	import * as ButtonGroup from '$lib/components/ui/button-group/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Toggle } from '$lib/components/ui/toggle/index.js';
	import BoxSelectIcon from '@lucide/svelte/icons/box-select';
	import ExpandIcon from '@lucide/svelte/icons/expand';
	import ListIcon from '@lucide/svelte/icons/list';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SeparatorVerticalIcon from '@lucide/svelte/icons/separator-vertical';

	let {
		disabled,
		canResetZoom,
		boxZoomEnabled = $bindable(false),
		markerEnabled = $bindable(false),
		legendVisible = $bindable(true),
		onZoomIn,
		onZoomOut,
		onResetZoom
	}: {
		disabled?: boolean;
		canResetZoom?: boolean;
		boxZoomEnabled?: boolean;
		markerEnabled?: boolean;
		legendVisible?: boolean;
		onZoomIn: () => void;
		onZoomOut: () => void;
		onResetZoom: () => void;
	} = $props();

	const toolbarIconButtonClass =
		'border-input bg-transparent hover:bg-muted hover:text-foreground dark:bg-transparent dark:hover:bg-muted/50';
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
	<Toggle
		bind:pressed={markerEnabled}
		{disabled}
		variant="outline"
		size="default"
		aria-label={markerEnabled ? 'Hide x marker' : 'Show x marker'}
		title={markerEnabled ? 'Hide x marker' : 'Show x marker'}
	>
		<SeparatorVerticalIcon class="size-3.5" />
	</Toggle>
	<Toggle
		bind:pressed={legendVisible}
		{disabled}
		variant="outline"
		size="default"
		aria-label={legendVisible ? 'Hide legend' : 'Show legend'}
		title={legendVisible ? 'Hide legend' : 'Show legend'}
	>
		<ListIcon class="size-3.5" />
	</Toggle>
</ButtonGroup.Root>
