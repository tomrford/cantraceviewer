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
import { runShortcut } from '#lib/stores/app-shell.js';

const groups = groupedShortcuts().map(({ group, actions }) => ({
	group,
	actions: actions.filter((action) => action !== 'showPalette')
}));

export function CommandPalette({
	open,
	onOpenChange,
	state
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	state: ShortcutState;
}) {
	function run(action: ShortcutAction): void {
		onOpenChange(false);
		runShortcut(action);
	}

	return (
		<CommandDialog open={open} onOpenChange={onOpenChange}>
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
