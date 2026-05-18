<script lang="ts">
	import {
		settings,
		type ThemePreference,
		type TimestampMode
	} from '$lib/stores/settings.svelte.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
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

	function setTimestampMode(mode: TimestampMode): void {
		settings.setTimestampMode(mode);
	}
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
					data-selected={settings.theme === option.value}
					aria-pressed={settings.theme === option.value}
					onclick={() => settings.setTheme(option.value)}
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
			value={settings.timestampMode}
			onValueChange={(value: string) => setTimestampMode(value as TimestampMode)}
		>
			<Select.Trigger class="w-full">
				<span>{settings.timestampMode === 'absolute' ? 'Absolute' : 'Relative'}</span>
			</Select.Trigger>
			<Select.Content>
				<Select.Item value="relative" label="Relative" />
				<Select.Item value="absolute" label="Absolute" />
			</Select.Content>
		</Select.Root>
	</label>
</Popover.Content>
