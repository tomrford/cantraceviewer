/** React HMR boundaries can replace dependencies without running their dispose callbacks. */
export function ownHmrSubscriptions(
	hot: NonNullable<ImportMeta['hot']>,
	unsubscribes: (() => void)[]
): void {
	// hot.data survives these transitive replacements; detach the previous module's listeners.
	hot.data.disconnectStoreSubscriptions?.();
	const disconnect = () => {
		for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
	};
	hot.data.disconnectStoreSubscriptions = disconnect;
	hot.dispose(disconnect);
}
