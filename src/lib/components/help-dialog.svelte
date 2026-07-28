<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import ShortcutKey from './shortcut-key.svelte';
	import {
		groupedShortcuts,
		shortcutKeys,
		shortcutLabel,
		type ShortcutPlatform
	} from '$lib/keyboard-shortcuts.js';
	import { TRACE_FILE_FORMAT_NAMES } from '$lib/trace-file-types.js';

	let {
		open = $bindable(false),
		shortcutPlatform,
		onStartWalkthrough
	}: {
		open?: boolean;
		shortcutPlatform: ShortcutPlatform;
		onStartWalkthrough: () => void;
	} = $props();

	const groups = groupedShortcuts();

	function startWalkthrough(): void {
		open = false;
		onStartWalkthrough();
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[85vh] gap-0 overflow-y-auto sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>CAN Trace Viewer</Dialog.Title>
			<Dialog.Description class="space-y-2 text-left text-pretty">
				<span class="block">
					All files, preferences and saved settings are processed and stored solely in this
					browser's local storage. Nothing leaves your machine.
				</span>
				<span class="block">
					Load one {TRACE_FILE_FORMAT_NAMES} trace, add one or more DBC files, then select decoded signals
					from the signal selector.
				</span>
				<span class="block">
					Current support covers CAN trace plotting and a practical subset of DBC. Signals share one
					time axis and start on one y axis; add more from the legend and drag signals between them
					when their scales do not sit well together.
				</span>
				<span class="block">
					The source code is available on
					<a
						href="https://github.com/tomrford/cantraceviewer"
						target="_blank"
						rel="noreferrer"
						class="underline underline-offset-2">GitHub</a
					>.
				</span>
			</Dialog.Description>
		</Dialog.Header>

		<div class="mt-6 grid gap-5">
			{#each groups as { group, actions } (group)}
				<div class="grid gap-1">
					<div class="text-xs font-medium text-muted-foreground">{group}</div>
					{#each actions as action (action)}
						<div class="flex items-center justify-between gap-4 py-1 text-sm">
							<span>{shortcutLabel(action)}</span>
							<ShortcutKey keys={shortcutKeys(action, shortcutPlatform)} />
						</div>
					{/each}
				</div>
			{/each}
		</div>

		<Dialog.Footer class="mt-6">
			<Dialog.Close
				class="flex h-9 items-center justify-center rounded-md border border-border/70 px-4 text-sm transition-[background-color,color,scale] hover:bg-accent hover:text-accent-foreground active:scale-[0.98]"
			>
				Close
			</Dialog.Close>
			<button
				type="button"
				class="flex h-9 items-center justify-center rounded-md bg-sidebar-primary px-4 text-sm font-medium text-sidebar-primary-foreground transition-[background-color,scale] hover:bg-sidebar-primary/90 active:scale-[0.98]"
				onclick={startWalkthrough}
			>
				Show quick tour
			</button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
