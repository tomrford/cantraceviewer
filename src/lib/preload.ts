export function preloadAfterIdle(preload: () => void): void {
	if (typeof window === 'undefined') return;

	if ('requestIdleCallback' in window) {
		window.requestIdleCallback(preload, { timeout: 2_000 });
		return;
	}

	globalThis.setTimeout(preload, 0);
}
