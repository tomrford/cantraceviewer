<script lang="ts">
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import {
		legendOrderMode,
		themePreference,
		timestampMode,
		type LegendOrderMode,
		type ThemePreference,
		type TimestampMode
	} from '$lib/stores/preferences.svelte.js';
	import { onResetPersistentData } from '$lib/stores/session.js';
	import CircleHelpIcon from '@lucide/svelte/icons/circle-help';
	import GithubIcon from '@lucide/svelte/icons/github';
	import LaptopIcon from '@lucide/svelte/icons/laptop';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import SunIcon from '@lucide/svelte/icons/sun';
	import XIcon from '@lucide/svelte/icons/x';
	import type { Component } from 'svelte';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';

	let { onStartWalkthrough }: { onStartWalkthrough: () => void } = $props();
	let helpOpen = $state(false);
	const iconButtonClass =
		'flex size-8 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color,box-shadow,scale] hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden active:scale-[0.96]';
	const closeButtonClass =
		'flex size-8 items-center justify-center rounded-md text-destructive transition-[background-color,color,box-shadow,scale] hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden active:scale-[0.96]';

	const themeOptions: { value: ThemePreference; label: string; icon: Component }[] = [
		{ value: 'light', label: 'Light', icon: SunIcon },
		{ value: 'dark', label: 'Dark', icon: MoonIcon },
		{ value: 'system', label: 'System', icon: LaptopIcon }
	];

	const timestampOptions: { value: TimestampMode; label: string }[] = [
		{ value: 'relative', label: 'Relative' },
		{ value: 'absolute', label: 'Absolute' }
	];

	const legendOrderOptions: { value: LegendOrderMode; label: string; description: string }[] = [
		{
			value: 'selection',
			label: 'Selection order',
			description: 'Keep signals in the order you selected them'
		},
		{
			value: 'alphabetical',
			label: 'Alphabetical',
			description: 'Sort signals alphabetically by signal, then message'
		},
		{
			value: 'grouped',
			label: 'Grouped',
			description: 'Group by value table or unit, then scale'
		}
	];

	const selectedTimestampMode = $derived(timestampMode.current);
	const selectedLegendOrderMode = $derived(legendOrderMode.current);
	const selectedLegendOrderOption = $derived(
		legendOrderOptions.find((option) => option.value === selectedLegendOrderMode) ??
			legendOrderOptions[0]
	);
	async function resetPersistentData(): Promise<void> {
		await onResetPersistentData();
	}

	function startWalkthrough(): void {
		helpOpen = false;
		onStartWalkthrough();
	}

	function preventOpenAutoFocus(event: Event): void {
		event.preventDefault();
	}
</script>

<Popover.Content
	align="end"
	sideOffset={-32}
	interactOutsideBehavior="ignore"
	trapFocus={false}
	onOpenAutoFocus={preventOpenAutoFocus}
	class="relative grid w-[min(22rem,calc(100vw-1rem))] translate-x-2 -translate-y-2 gap-4 rounded-lg border border-border/70 bg-popover/90 p-4 pt-14 text-popover-foreground backdrop-blur-md"
	style="box-shadow: 0 1px 2px rgb(0 0 0 / 0.08)"
>
	<div
		class="absolute top-[6.5px] right-[7px] left-[7px] grid h-8 grid-cols-[1fr_auto_1fr] items-center"
	>
		<div class="flex items-center gap-1">
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<button
							{...props}
							type="button"
							class={iconButtonClass}
							aria-label="Open help"
							onclick={() => (helpOpen = true)}
						>
							<CircleHelpIcon class="size-4" />
						</button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content sideOffset={6}>Help</Tooltip.Content>
			</Tooltip.Root>
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<a
							{...props}
							href="https://github.com/tomrford/cantraceviewer"
							target="_blank"
							rel="noreferrer"
							class={iconButtonClass}
							aria-label="Open source code on GitHub"
						>
							<GithubIcon class="size-4" />
						</a>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content sideOffset={6}>Source code</Tooltip.Content>
			</Tooltip.Root>
		</div>
		<Popover.Title class="text-center">Settings</Popover.Title>
		<Popover.Close class="{closeButtonClass} justify-self-end" aria-label="Close settings">
			<XIcon class="size-4" />
		</Popover.Close>
	</div>

	<div class="grid gap-2">
		<div class="text-xs font-medium text-muted-foreground">Theme</div>
		<div class="grid grid-cols-3 gap-2">
			{#each themeOptions as option (option.value)}
				{@const Icon = option.icon}
				<button
					type="button"
					class="flex h-16 flex-col items-center justify-center gap-1 rounded-md border border-border/70 text-xs transition-[background-color,border-color,color,box-shadow,scale] hover:bg-accent hover:text-accent-foreground active:scale-[0.96] data-[selected=true]:border-sidebar-primary/60 data-[selected=true]:bg-sidebar-primary/15 data-[selected=true]:text-sidebar-primary"
					data-selected={themePreference.current === option.value}
					aria-pressed={themePreference.current === option.value}
					onclick={() => (themePreference.current = option.value)}
				>
					<Icon class="size-4" />
					<span>{option.label}</span>
				</button>
			{/each}
		</div>
	</div>

	<label class="grid gap-2">
		<span class="text-xs font-medium text-muted-foreground">X-axis timestamps</span>
		<Select.Root
			type="single"
			value={selectedTimestampMode}
			onValueChange={(value: string) => (timestampMode.current = value as TimestampMode)}
		>
			<Select.Trigger class="w-full">
				<span>{timestampMode.current === 'absolute' ? 'Absolute' : 'Relative'}</span>
			</Select.Trigger>
			<Select.Content>
				{#each timestampOptions as option (option.value)}
					<Select.Item value={option.value} label={option.label} />
				{/each}
			</Select.Content>
		</Select.Root>
	</label>

	<label class="grid gap-2">
		<span class="text-xs font-medium text-muted-foreground">Legend order</span>
		<Select.Root
			type="single"
			value={selectedLegendOrderMode}
			onValueChange={(value: string) => (legendOrderMode.current = value as LegendOrderMode)}
		>
			<Select.Trigger class="w-full">
				<span>{selectedLegendOrderOption.label}</span>
			</Select.Trigger>
			<Select.Content>
				{#each legendOrderOptions as option (option.value)}
					<Select.Item value={option.value} label={option.label} />
				{/each}
			</Select.Content>
		</Select.Root>
		<p class="text-xs text-muted-foreground">{selectedLegendOrderOption.description}</p>
	</label>

	<div class="grid gap-2 border-t pt-4">
		<div class="text-xs font-medium text-muted-foreground">Persistent data</div>
		<p class="text-xs text-muted-foreground">
			Clears saved DBC files and browser preferences. Loaded traces stay in memory until you close
			the tab.
		</p>
		<button
			type="button"
			class="flex h-10 items-center justify-center gap-2 rounded-md border border-destructive/40 px-3 text-sm text-destructive transition-[background-color,border-color,color,box-shadow,scale] hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-hidden active:scale-[0.96]"
			onclick={resetPersistentData}
		>
			<RotateCcwIcon class="size-4" />
			<span>Reset persistent data</span>
		</button>
	</div>
</Popover.Content>

<AlertDialog.Root bind:open={helpOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>CAN Trace Viewer</AlertDialog.Title>
			<AlertDialog.Description class="space-y-2 text-left text-pretty">
				<p>
					All files, preferences and saved settings are processed and stored solely in this
					browser's local storage. Nothing leaves your machine.
				</p>
				<p>
					Load one ASC, TRC, or BLF trace, add one or more DBC files, then select decoded signals
					from the signal selector.
				</p>
				<p>
					Current support covers CAN trace plotting and a practical subset of DBC, using shared-axis
					line plots for selected signals.
				</p>
				<p>
					The source code is available on
					<a href="https://github.com/tomrford/cantraceviewer" target="_blank" rel="noreferrer">
						GitHub</a
					>.
				</p>
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel onclick={() => (helpOpen = false)}>Close</AlertDialog.Cancel>
			<AlertDialog.Action onclick={startWalkthrough}>Show quick tour</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
