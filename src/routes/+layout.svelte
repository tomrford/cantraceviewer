<script lang="ts">
	import './layout.css';
	import { browser } from '$app/environment';
	import { Toaster } from '$lib/components/ui/sonner/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { isDark } from '$lib/stores/preferences.svelte.js';

	let { children } = $props();

	$effect(() => {
		if (!browser) return;
		document.documentElement.classList.toggle('dark', isDark());
	});
</script>

<Tooltip.Provider delayDuration={500}>
	{@render children()}
</Tooltip.Provider>
<Toaster position="bottom-center" />
