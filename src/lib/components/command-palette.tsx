import { useStore } from 'zustand';
import {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandShortcut
} from '#lib/components/ui/command.js';
import { ShortcutKey } from '#lib/components/shortcut-key.js';
import {
	groupedShortcuts,
	shortcutEnabled,
	shortcutLabel,
	type ShortcutAction,
	type ShortcutState
} from '#lib/keyboard-shortcuts.js';
import { appStore, update } from '#lib/stores/store.js';

const groups = groupedShortcuts().map(({ group, actions }) => ({
	group,
	actions: actions.filter((action) => action !== 'showPalette')
}));

export function CommandPalette({
	state,
	onRun
}: {
	state: ShortcutState;
	onRun: (action: ShortcutAction) => void;
}) {
	const open = useStore(appStore, (s) => s.paletteOpen);

	function run(action: ShortcutAction): void {
		update({ paletteOpen: false });
		onRun(action);
	}

	return (
		<CommandDialog open={open} onOpenChange={(paletteOpen) => update({ paletteOpen })}>
			<Command>
				<CommandInput placeholder="Search for a command..." />
				<CommandList>
					<CommandEmpty>No matching command.</CommandEmpty>
					{groups.map(({ group, actions }) => (
						<CommandGroup key={group} heading={group}>
							{actions.map((action) => (
								<CommandItem
									key={action}
									value={shortcutLabel(action)}
									disabled={!shortcutEnabled(action, state)}
									onSelect={() => run(action)}
								>
									<span>{shortcutLabel(action)}</span>
									<CommandShortcut>
										<ShortcutKey action={action} />
									</CommandShortcut>
								</CommandItem>
							))}
						</CommandGroup>
					))}
				</CommandList>
			</Command>
		</CommandDialog>
	);
}
