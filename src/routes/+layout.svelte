<script lang="ts">
	import './layout.css';
	import { browser } from '$app/environment';
	import { isDark } from '$lib/stores/preferences.svelte.js';

	let { children } = $props();

	$effect(() => {
		if (!browser) return;
		document.documentElement.classList.toggle('dark', isDark());
	});
</script>

{@render children()}
