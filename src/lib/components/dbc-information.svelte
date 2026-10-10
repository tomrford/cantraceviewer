<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import InfoIcon from '@lucide/svelte/icons/info';
	import type { DbcFileEntry } from '$lib/stores/dbc-files.svelte.js';

	let { file }: { file: DbcFileEntry } = $props();
	let signalCount = $derived(
		file.catalog.messages.reduce((count, message) => count + message.signals.length, 0)
	);
	let hasOmissions = $derived(
		file.warnings.some((warning) => warning.category === 'omitted-feature')
	);
</script>

<Dialog.Root>
	<DialogPrimitive.Trigger
		class="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-70 hover:bg-accent hover:text-accent-foreground hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
		aria-label={`Information about ${file.name}`}
	>
		<InfoIcon class="size-4" />
	</DialogPrimitive.Trigger>
	<Dialog.Content class="sm:max-w-xl">
		<Dialog.Header>
			<Dialog.Title class="pr-8 break-words">{file.name}</Dialog.Title>
			<Dialog.Description>
				{#if hasOmissions}Partially loaded: some DBC features were omitted.
				{:else if file.warnings.length}Loaded with warnings.
				{:else}Loaded successfully.{/if}
			</Dialog.Description>
		</Dialog.Header>
		<dl class="grid grid-cols-3 gap-4">
			<div>
				<dt class="text-muted-foreground">Loaded messages</dt>
				<dd class="text-base font-medium">{file.catalog.messages.length}</dd>
			</div>
			<div>
				<dt class="text-muted-foreground">Loaded signals</dt>
				<dd class="text-base font-medium">{signalCount}</dd>
			</div>
			<div>
				<dt class="text-muted-foreground">Warnings</dt>
				<dd class="text-base font-medium">{file.warnings.length}</dd>
			</div>
		</dl>
		{#if file.warnings.length}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard users must be able to scroll the warnings) -->
			<div
				class="max-h-[50vh] overflow-auto rounded-md border border-border"
				tabindex="0"
				role="region"
				aria-label="DBC warnings"
			>
				<table class="w-full text-left">
					<thead class="sticky top-0 bg-popover"
						><tr
							><th class="p-2 font-medium">Line:column</th><th class="p-2 font-medium">Record</th
							><th class="p-2 font-medium">Warning</th></tr
						></thead
					>
					<tbody>
						{#each file.warnings as warning (warning)}
							<tr class="border-t border-border"
								><td class="p-2 align-top tabular-nums">{warning.line}:{warning.column}</td><td
									class="p-2 align-top font-mono">{warning.keyword}</td
								><td class="p-2 align-top">{warning.message}</td></tr
							>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
