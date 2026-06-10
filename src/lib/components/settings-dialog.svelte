<script lang="ts">
	import * as Popover from '$lib/components/ui/popover/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import {
		legendOrderMode,
		resetPreferences,
		themePreference,
		timestampMode,
		type LegendOrderMode,
		type ThemePreference,
		type TimestampMode
	} from '$lib/stores/preferences.svelte.js';
	import { dbcFiles } from '$lib/stores/dbc-files.svelte.js';
	import { plotData } from '$lib/stores/plot-data.svelte.js';
	import LaptopIcon from '@lucide/svelte/icons/laptop';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import SunIcon from '@lucide/svelte/icons/sun';
	import XIcon from '@lucide/svelte/icons/x';
	import type { Component } from 'svelte';

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
			description: 'Sort signals alphabetically by message and name'
		},
		{
			value: 'grouped',
			label: 'Grouped',
			description: 'Group by unit, then scale, then alphabetically'
		}
	];

	const selectedTimestampMode = $derived(timestampMode.current);
	const selectedLegendOrderMode = $derived(legendOrderMode.current);
	const selectedLegendOrderOption = $derived(
		legendOrderOptions.find((option) => option.value === selectedLegendOrderMode) ??
			legendOrderOptions[0]
	);

	async function resetPersistentData(): Promise<void> {
		plotData.clearSelectedSignals();
		resetPreferences();
		await dbcFiles.resetLibrary();
	}
</script>

<Popover.Content
	align="end"
	sideOffset={-32}
	class="grid w-[min(22rem,calc(100vw-1rem))] translate-x-2 -translate-y-2 gap-4 rounded-lg border bg-popover/90 p-4 text-popover-foreground backdrop-blur-md"
	style="box-shadow: 0 1px 2px rgb(0 0 0 / 0.08)"
>
	<Popover.Close
		class="absolute top-[6.5px] right-[7px] flex size-8 items-center justify-center text-sidebar-foreground/60 transition-colors hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-hidden"
		aria-label="Close settings"
	>
		<XIcon class="size-4" />
	</Popover.Close>
	<Popover.Header>
		<Popover.Title>Settings</Popover.Title>
	</Popover.Header>

	<div class="grid gap-2">
		<div class="text-xs font-medium text-muted-foreground">Theme</div>
		<div class="grid grid-cols-3 gap-2">
			{#each themeOptions as option (option.value)}
				{@const Icon = option.icon}
				<button
					type="button"
					class="flex h-16 flex-col items-center justify-center gap-1 rounded-md border text-xs transition-colors hover:bg-accent hover:text-accent-foreground data-[selected=true]:border-emerald-500/60 data-[selected=true]:bg-emerald-500/15 data-[selected=true]:text-emerald-500"
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
			class="flex h-10 items-center justify-center gap-2 rounded-md border border-destructive/40 px-3 text-sm text-destructive transition-colors hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-hidden"
			onclick={resetPersistentData}
		>
			<RotateCcwIcon class="size-4" />
			<span>Reset persistent data</span>
		</button>
	</div>
</Popover.Content>
