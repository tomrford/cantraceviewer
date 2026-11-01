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
	shortcutKeys,
	shortcutLabel,
	type ShortcutAction,
	type ShortcutPlatform,
	type ShortcutState
} from '#lib/keyboard-shortcuts.js';

const groups = groupedShortcuts().map(({ group, actions }) => ({
	group,
	actions: actions.filter((action) => action !== 'showPalette')
}));

export function CommandPalette({
	open,
	onOpenChange,
	shortcutPlatform,
	state,
	onRun
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	shortcutPlatform: ShortcutPlatform;
	state: ShortcutState;
	onRun: (action: ShortcutAction) => void;
}) {
	function run(action: ShortcutAction): void {
		onOpenChange(false);
		onRun(action);
	}

	return (
		<CommandDialog open={open} onOpenChange={(next) => onOpenChange(next)}>
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
										<ShortcutKey keys={shortcutKeys(action, shortcutPlatform)} />
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
