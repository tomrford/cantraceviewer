<script lang="ts">
	import * as Popover from '$lib/components/ui/popover/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import {
		themePreference,
		timestampMode,
		type ThemePreference,
		type TimestampMode
	} from '$lib/stores/preferences.svelte.js';
	import LaptopIcon from '@lucide/svelte/icons/laptop';
	import MoonIcon from '@lucide/svelte/icons/moon';
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

	const selectedTimestampMode = $derived(timestampMode.current);
</script>

<Popover.Content
	align="end"
	sideOffset={-32}
	class="grid w-[min(22rem,calc(100vw-1rem))] translate-x-2 -translate-y-2 gap-4 rounded-lg border bg-popover/80 p-4 text-popover-foreground shadow-lg backdrop-blur-md"
>
	<Popover.Close
		class="absolute top-2 right-2 flex size-8 items-center justify-center text-sidebar-foreground/60 transition-colors hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-hidden"
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
</Popover.Content>
