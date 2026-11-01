import { useEffect, useRef } from 'react';
import { Button } from '#lib/components/ui/button.js';
import { placeWalkthrough, type WalkthroughStep } from '#lib/walkthrough.js';

// Position and visibility are written straight to the panel so tracking the target
// on scroll/resize never re-renders.
export function Walkthrough({
	step,
	stepIndex,
	stepCount,
	onAdvance
}: {
	step: WalkthroughStep;
	stepIndex: number;
	stepCount: number;
	onAdvance: () => void;
}) {
	const panelRef = useRef<HTMLDivElement>(null);
	const { target: targetId, placement } = step;

	useEffect(() => {
		const panel = panelRef.current;
		if (!panel) return;
		panel.classList.add('opacity-0');
		const target = document.querySelector<HTMLElement>(`[data-walkthrough-target="${targetId}"]`);
		if (!target) return;

		function updatePosition(): void {
			if (!panel || !target) return;
			const panelBounds = panel.getBoundingClientRect();
			const { top, left } = placeWalkthrough(
				target.getBoundingClientRect(),
				{ width: panelBounds.width, height: panelBounds.height },
				{ width: window.innerWidth, height: window.innerHeight },
				placement
			);
			panel.style.top = `${top}px`;
			panel.style.left = `${left}px`;
			panel.classList.remove('opacity-0');
		}

		const resizeObserver = new ResizeObserver(updatePosition);
		resizeObserver.observe(target);
		resizeObserver.observe(panel);
		// Overlays that open with the step (the signal selector) move the target while they animate in.
		const events = ['resize', 'scroll', 'animationend', 'transitionend'] as const;
		for (const event of events) window.addEventListener(event, updatePosition, true);
		const animationFrame = requestAnimationFrame(() => {
			updatePosition();
			panel.focus({ preventScroll: true });
		});

		return () => {
			cancelAnimationFrame(animationFrame);
			resizeObserver.disconnect();
			for (const event of events) window.removeEventListener(event, updatePosition, true);
		};
	}, [targetId, placement]);

	return (
		<div
			ref={panelRef}
			className="fixed top-0 left-0 z-[80] grid w-[min(20rem,calc(100vw-1rem))] gap-3 rounded-lg border border-border/60 bg-popover/95 p-4 text-popover-foreground opacity-0 shadow-md backdrop-blur-md transition-opacity duration-100"
			// Non-modal floating panel; a native <dialog> brings UA positioning and top-layer behaviour.
			// oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
			role="dialog"
			aria-modal="false"
			aria-labelledby="walkthrough-title"
			aria-describedby="walkthrough-description"
			tabIndex={-1}
		>
			<div className="grid gap-1" aria-live="polite">
				<div className="text-xs text-muted-foreground">
					Step {stepIndex + 1} of {stepCount}
				</div>
				<h2 id="walkthrough-title" className="text-sm font-medium">
					{step.title}
				</h2>
				<p id="walkthrough-description" className="text-xs/relaxed text-muted-foreground">
					{step.description}
				</p>
			</div>

			<div className="flex justify-end">
				<Button className="h-10 px-3" onClick={onAdvance}>
					{stepIndex === stepCount - 1 ? 'Finish' : 'Next'}
				</Button>
			</div>
		</div>
	);
}
