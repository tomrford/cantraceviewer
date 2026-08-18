<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { placeWalkthrough, type WalkthroughStep } from '$lib/walkthrough.js';

	let {
		step,
		stepIndex,
		stepCount,
		onAdvance
	}: {
		step: WalkthroughStep;
		stepIndex: number;
		stepCount: number;
		onAdvance: () => void;
	} = $props();

	let panel = $state<HTMLDivElement>();
	let panelPosition = $state({ top: 0, left: 0 });
	let ready = $state(false);
	let isLastStep = $derived(stepIndex === stepCount - 1);

	$effect(() => {
		if (!panel) return;

		const target = document.querySelector<HTMLElement>(
			`[data-walkthrough-target="${step.target}"]`
		);
		if (!target) {
			ready = false;
			return;
		}
		const targetElement = target;

		let animationFrame: number | null = null;
		function updatePosition(): void {
			const targetBounds = targetElement.getBoundingClientRect();
			const panelBounds = panel?.getBoundingClientRect();
			if (!panelBounds) return;

			const targetRect = {
				top: targetBounds.top,
				right: targetBounds.right,
				bottom: targetBounds.bottom,
				left: targetBounds.left,
				width: targetBounds.width,
				height: targetBounds.height
			};
			panelPosition = placeWalkthrough(
				targetRect,
				{ width: panelBounds.width, height: panelBounds.height },
				{ width: window.innerWidth, height: window.innerHeight },
				step.placement
			);
			ready = true;
		}

		const resizeObserver = new ResizeObserver(updatePosition);
		resizeObserver.observe(targetElement);
		resizeObserver.observe(panel);
		window.addEventListener('resize', updatePosition);
		window.addEventListener('scroll', updatePosition, true);
		animationFrame = requestAnimationFrame(() => {
			updatePosition();
			panel?.focus({ preventScroll: true });
		});

		return () => {
			if (animationFrame !== null) cancelAnimationFrame(animationFrame);
			resizeObserver.disconnect();
			window.removeEventListener('resize', updatePosition);
			window.removeEventListener('scroll', updatePosition, true);
		};
	});
</script>

<div
	bind:this={panel}
	class="fixed z-[80] grid w-[min(20rem,calc(100vw-1rem))] gap-3 rounded-lg border border-border/60 bg-popover/95 p-4 text-popover-foreground shadow-md backdrop-blur-md transition-opacity duration-100"
	class:opacity-0={!ready}
	style:top={`${panelPosition.top}px`}
	style:left={`${panelPosition.left}px`}
	role="dialog"
	aria-modal="false"
	aria-labelledby="walkthrough-title"
	aria-describedby="walkthrough-description"
	tabindex="-1"
>
	<div class="grid gap-1" aria-live="polite">
		<div class="text-xs text-muted-foreground">Step {stepIndex + 1} of {stepCount}</div>
		<h2 id="walkthrough-title" class="text-sm font-medium">{step.title}</h2>
		<p id="walkthrough-description" class="text-xs/relaxed text-muted-foreground">
			{step.description}
		</p>
	</div>

	<div class="flex justify-end">
		<Button class="h-10 px-3" onclick={onAdvance}>
			{isLastStep ? 'Finish' : 'Next'}
		</Button>
	</div>
</div>
