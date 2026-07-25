<script lang="ts">
	import * as Command from '$lib/components/ui/command/index.js';
	import ShortcutKey from './shortcut-key.svelte';
	import {
		groupedShortcuts,
		shortcutEnabled,
		shortcutKeys,
		shortcutLabel,
		type ShortcutAction,
		type ShortcutPlatform,
		type ShortcutState
	} from '$lib/keyboard-shortcuts.js';

	let {
		open = $bindable(false),
		shortcutPlatform,
		state,
		onRun
	}: {
		open?: boolean;
		shortcutPlatform: ShortcutPlatform;
		state: ShortcutState;
		onRun: (action: ShortcutAction) => void;
	} = $props();

	// The palette lists what you can do now, so it omits the command that opened it.
	const groups = groupedShortcuts().map(({ group, actions }) => ({
		group,
		actions: actions.filter((action) => action !== 'showPalette')
	}));

	function run(action: ShortcutAction): void {
		open = false;
		onRun(action);
	}
</script>

<Command.Dialog bind:open>
	<Command.Input placeholder="Search for a command..." />
	<Command.List>
		<Command.Empty>No matching command.</Command.Empty>
		{#each groups as { group, actions } (group)}
			<Command.Group heading={group}>
				{#each actions as action (action)}
					<Command.Item
						value={shortcutLabel(action)}
						disabled={!shortcutEnabled(action, state)}
						onSelect={() => run(action)}
					>
						<span>{shortcutLabel(action)}</span>
						<Command.Shortcut>
							<ShortcutKey keys={shortcutKeys(action, shortcutPlatform)} />
						</Command.Shortcut>
					</Command.Item>
				{/each}
			</Command.Group>
		{/each}
	</Command.List>
</Command.Dialog>
