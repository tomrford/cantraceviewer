<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import InfoIcon from '@lucide/svelte/icons/info';
	import type { DbcFileEntry } from '$lib/stores/dbc-files.svelte.js';
	import type { DbcDiagnostic } from '$lib/wasm.js';

	let { file }: { file: DbcFileEntry } = $props();
	let signalCount = $derived(
		file.catalog.messages.reduce((count, message) => count + message.signals.length, 0)
	);
	let warnings = $derived(
		file.warnings.filter((warning) => warning.category !== 'unsupported-record')
	);
	let hasOmissions = $derived(warnings.some((warning) => warning.category === 'omitted-feature'));

	function warningMessage(warning: DbcDiagnostic): string {
		const subject =
			warning.keyword === 'VAL_'
				? 'Value labels'
				: warning.keyword === 'SIG_VALTYPE_'
					? 'Numeric-type declarations'
					: 'Frame-format declarations';
		switch (warning.message) {
			case 'Unknown message; attachment was ignored.':
			case 'Unknown message; frame-format attachment was ignored.':
				return `${subject} reference a message that is not defined.`;
			case 'Unknown signal; attachment was ignored.':
				return `${subject} reference a signal that is not defined.`;
			case 'Unknown value table; attachment was ignored.':
				return 'Value labels reference a table that is not defined.';
			case 'Independent signal container is omitted from the viewer catalogue.':
				return 'Standalone signals are not available for plotting.';
			case 'Integer signal or multiplex selector wider than 64 bits is omitted from the viewer catalogue.':
				return 'Signal cannot be plotted: it or its multiplex selector is wider than 64 bits.';
			case 'Signal requires transport reassembly or a payload longer than 64 bytes.':
				return 'Signal cannot be decoded from raw CAN frames: it needs transport reassembly or more than 64 bytes.';
			case 'Incompatible inherited frame format was ignored.':
				return 'Default frame format conflicts with this message and could not be applied.';
			default:
				return warning.message;
		}
	}
</script>

<Dialog.Root>
	<DialogPrimitive.Trigger
		class="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-70 hover:bg-accent hover:text-accent-foreground hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
		aria-label={`Information about ${file.name}`}
	>
		<InfoIcon class="size-4" />
	</DialogPrimitive.Trigger>
	<Dialog.Content class="max-h-[85vh] overflow-y-auto sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title class="pr-8 break-words">{file.name}</Dialog.Title>
			<Dialog.Description class={warnings.length ? '' : 'sr-only'}>
				{#if hasOmissions}Some signals or decoding settings could not be used.
				{:else if warnings.length}Some DBC definitions could not be applied.
				{:else}DBC file information.{/if}
			</Dialog.Description>
		</Dialog.Header>
		<dl class="space-y-1 text-muted-foreground">
			<div class="flex justify-between gap-4">
				<dt class="text-muted-foreground">Loaded messages</dt>
				<dd class="tabular-nums">{file.catalog.messages.length}</dd>
			</div>
			<div class="flex justify-between gap-4">
				<dt class="text-muted-foreground">Loaded signals</dt>
				<dd class="tabular-nums">{signalCount}</dd>
			</div>
		</dl>
		{#if warnings.length}
			<h3 class="font-medium">
				{warnings.length}
				{warnings.length === 1 ? 'warning' : 'warnings'}
			</h3>
			<!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard users must be able to scroll the warnings) -->
			<div class="max-h-[30vh] overflow-auto" tabindex="0" role="region" aria-label="DBC warnings">
				<ul class="space-y-2">
					{#each warnings as warning (warning)}
						<li class="flex gap-3">
							<span class="shrink-0 text-muted-foreground tabular-nums">Line {warning.line}</span>
							<span>{warningMessage(warning)}</span>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
