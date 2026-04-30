<script lang="ts">
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { dbcFiles } from '$lib/stores/dbc-files.svelte.js';
	import SearchForm from './search-form.svelte';
	import * as Collapsible from '$lib/components/ui/collapsible/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import FileUpIcon from '@lucide/svelte/icons/file-up';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import type { ComponentProps } from 'svelte';

	let { ref = $bindable(null), ...restProps }: ComponentProps<typeof Sidebar.Root> = $props();
	let traceInput: HTMLInputElement;
	let dbcInput: HTMLInputElement;
	let traceFileName = $state('Load trace');

	function selectTrace(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		traceFileName = input.files?.[0]?.name ?? 'Load trace';
		input.value = '';
	}

	async function selectDbcs(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		input.value = '';
		if (files.length === 0) return;

		await dbcFiles.addFiles(files);
	}
</script>

<Sidebar.Root bind:ref {...restProps}>
	<Sidebar.Header>
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<input
					bind:this={traceInput}
					class="hidden"
					type="file"
					accept=".asc,.blf,.trc,text/plain"
					onchange={selectTrace}
				/>
				<Sidebar.MenuButton size="lg">
					{#snippet child({ props })}
						<button type="button" {...props} onclick={() => traceInput.click()}>
							<div
								class="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground"
							>
								<FileUpIcon class="size-4" />
							</div>
							<div class="flex flex-col gap-0.5 leading-none">
								<span class="font-medium">{traceFileName}</span>
								<span>Trace file</span>
							</div>
						</button>
					{/snippet}
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
		<SearchForm />
	</Sidebar.Header>
	<Sidebar.Content>
		<Sidebar.Group>
			<Sidebar.Menu>
				{#each dbcFiles.sidebarFiles as dbc, index (dbc.id)}
					<Collapsible.Root open={index === 0} class="group/collapsible">
						<Sidebar.MenuItem>
							<Collapsible.Trigger>
								{#snippet child({ props })}
									<Sidebar.MenuButton {...props}>
										{dbc.name}
										<PlusIcon class="ms-auto group-data-[state=open]/collapsible:hidden" />
										<MinusIcon class="ms-auto group-data-[state=closed]/collapsible:hidden" />
									</Sidebar.MenuButton>
								{/snippet}
							</Collapsible.Trigger>
							<Collapsible.Content>
								<Sidebar.MenuSub>
									{#each dbc.signals as signal (signal)}
										<Sidebar.MenuSubItem>
											<Sidebar.MenuSubButton>
												{#snippet child({ props })}
													<a href="##" {...props}>{signal}</a>
												{/snippet}
											</Sidebar.MenuSubButton>
										</Sidebar.MenuSubItem>
									{/each}
								</Sidebar.MenuSub>
							</Collapsible.Content>
						</Sidebar.MenuItem>
					</Collapsible.Root>
				{/each}
			</Sidebar.Menu>
		</Sidebar.Group>
		<Sidebar.Group>
			<input
				bind:this={dbcInput}
				class="hidden"
				type="file"
				accept=".dbc,text/plain"
				multiple
				onchange={selectDbcs}
			/>
			<Button
				class="w-full"
				type="button"
				disabled={dbcFiles.isLoading}
				onclick={() => dbcInput.click()}
			>
				<PlusIcon />
				{dbcFiles.isLoading ? 'Loading' : 'Add DBC'}
			</Button>
		</Sidebar.Group>
	</Sidebar.Content>
	<Sidebar.Rail />
</Sidebar.Root>

<AlertDialog.Root
	bind:open={() => dbcFiles.error !== null, (open) => !open && dbcFiles.clearError()}
>
	{#if dbcFiles.error}
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title>DBC upload failed</AlertDialog.Title>
				<AlertDialog.Description>{dbcFiles.error}</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Action onclick={() => dbcFiles.clearError()}>OK</AlertDialog.Action>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	{/if}
</AlertDialog.Root>
