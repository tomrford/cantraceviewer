<script lang="ts">
	import {
		settings,
		type ThemePreference,
		type TimestampMode
	} from '$lib/stores/settings.svelte.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import LaptopIcon from '@lucide/svelte/icons/laptop';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import SunIcon from '@lucide/svelte/icons/sun';
	import type { Component } from 'svelte';

	let { open = $bindable(false) }: { open: boolean } = $props();

	const themeOptions: { value: ThemePreference; label: string; icon: Component }[] = [
		{ value: 'light', label: 'Light', icon: SunIcon },
		{ value: 'dark', label: 'Dark', icon: MoonIcon },
		{ value: 'system', label: 'System', icon: LaptopIcon }
	];

	function setTimestampMode(mode: TimestampMode): void {
		settings.setTimestampMode(mode);
	}
</script>

{#if open}
	<div class="fixed inset-0 z-50">
		<button
			type="button"
			class="absolute inset-0 bg-background/70 backdrop-blur-sm"
			aria-label="Close settings"
			onclick={() => (open = false)}
		></button>
		<div
			class="absolute top-20 right-4 grid w-[min(22rem,calc(100vw-2rem))] gap-4 rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg"
			role="dialog"
			aria-modal="true"
			aria-labelledby="settings-title"
			tabindex="-1"
		>
			<div>
				<h2 id="settings-title" class="text-sm font-medium">Settings</h2>
			</div>

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
		</div>
	</div>
{/if}
