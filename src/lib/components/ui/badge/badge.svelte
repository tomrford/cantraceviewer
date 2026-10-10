<script lang="ts">
	import type { Snippet } from 'svelte';
	let { children }: { children: Snippet } = $props();
</script>

<span class="rounded border px-1 text-[10px] font-medium" aria-hidden="true"
	>{@render children()}</span
>
