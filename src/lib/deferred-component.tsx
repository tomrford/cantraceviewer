import { useEffect, useSyncExternalStore, type ComponentType } from 'react';

export type DeferredComponent<P extends object> = ComponentType<P> & {
	/** Fetches the component's chunk; later calls share the first fetch. */
	preload: () => Promise<void>;
};

/**
 * A code-split component that renders nothing until its chunk has loaded, then renders the real
 * component in place. Unlike `lazy`, it never suspends: React throttles a suspended boundary's
 * reveal on a timer (300 ms, longer in background tabs), which delayed a trace's first plot and a
 * dialog's first open. `preload` early so the chunk is usually ready by first render.
 */
export function deferredComponent<P extends object>(
	importComponent: () => Promise<ComponentType<P>>
): DeferredComponent<P> {
	let loaded: ComponentType<P> | null = null;
	let pending: Promise<void> | null = null;
	const listeners = new Set<() => void>();

	function preload(): Promise<void> {
		pending ??= importComponent().then(
			(component) => {
				loaded = component;
				for (const listener of listeners) listener();
			},
			(error: unknown) => {
				// A later mount or preload retries the fetch.
				pending = null;
				throw error;
			}
		);
		return pending;
	}

	function subscribe(listener: () => void): () => void {
		listeners.add(listener);
		return () => listeners.delete(listener);
	}

	function Deferred(props: P) {
		const Component = useSyncExternalStore(
			subscribe,
			() => loaded,
			() => null
		);
		useEffect(() => {
			preload().catch((error: unknown) => console.error('Component failed to load.', error));
		}, []);
		if (Component === null) return null;
		// `Component` is the chunk's export: set once, so its identity never changes between renders.
		// oxlint-disable-next-line react/static-components
		return <Component {...props} />;
	}

	return Object.assign(Deferred, { preload });
}
