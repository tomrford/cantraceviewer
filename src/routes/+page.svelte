<script lang="ts">
	import AppSidebar from '$lib/components/app-sidebar.svelte';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
</script>

<svelte:head>
	<title>CAN log viewer</title>
</svelte:head>

<Sidebar.Provider style="--sidebar-width: 24rem;">
	<AppSidebar />
	<Sidebar.Inset class="min-h-screen bg-background">
		<header class="flex h-16 shrink-0 items-center gap-2 border-b px-4">
			<Sidebar.Trigger class="-ms-1" />
			<Separator orientation="vertical" class="me-2 data-[orientation=vertical]:h-4" />
		</header>
	</Sidebar.Inset>
</Sidebar.Provider>
