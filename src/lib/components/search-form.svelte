<script lang="ts">
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import type { WithElementRef } from '$lib/utils.js';
	import SearchIcon from '@lucide/svelte/icons/search';
	import type { HTMLFormAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		value = $bindable(''),
		placeholder = 'Search signals...',
		...restProps
	}: WithElementRef<HTMLFormAttributes> & {
		value?: string;
		placeholder?: string;
	} = $props();
</script>

<form bind:this={ref} onsubmit={(event) => event.preventDefault()} {...restProps}>
	<Sidebar.Group class="py-0">
		<Sidebar.GroupContent class="relative">
			<Label for="search" class="sr-only">Search</Label>
			<Sidebar.Input id="search" bind:value {placeholder} class="ps-8" />
			<SearchIcon
				class="pointer-events-none absolute inset-s-2 top-1/2 size-4 -translate-y-1/2 opacity-50 select-none"
			/>
		</Sidebar.GroupContent>
	</Sidebar.Group>
</form>
