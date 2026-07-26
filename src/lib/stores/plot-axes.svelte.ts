import { MAX_Y_AXES, nextYAxisId, PRIMARY_Y_AXIS_ID, type YAxisId } from '$lib/plot-axes.js';
import { SvelteMap } from 'svelte/reactivity';

/**
 * Y axis layout for the plot: which axes exist, and which axis each selected
 * signal is drawn against.
 *
 * Assignments are keyed by signal key rather than held on the signal, so they
 * survive the decode-status rebuilds of `plotData.signals`. They are released
 * when a signal is deselected, alongside its colour, so the map never outlives
 * the selection and a signal returns rather than remembers. The axes themselves
 * stay: deselecting a signal does not tear down the layout it was part of.
 */
class PlotAxesStore {
	#ids = $state<YAxisId[]>([PRIMARY_Y_AXIS_ID]);
	#assignment = new SvelteMap<string, YAxisId>();

	get ids(): readonly YAxisId[] {
		return this.#ids;
	}

	get assignment(): ReadonlyMap<string, YAxisId> {
		return this.#assignment;
	}

	canAddAxis = $derived(this.#ids.length < MAX_Y_AXES);

	/** Appends an empty axis and returns its id, or null at the cap. */
	addAxis(): YAxisId | null {
		if (this.#ids.length >= MAX_Y_AXES) return null;
		const id = nextYAxisId(this.#ids);
		this.#ids = [...this.#ids, id];
		return id;
	}

	/** Removes an axis, returning its signals to the primary axis. */
	removeAxis(id: YAxisId): void {
		if (id === PRIMARY_Y_AXIS_ID || !this.#ids.includes(id)) return;
		this.#ids = this.#ids.filter((axisId) => axisId !== id);
		for (const [key, axisId] of this.#assignment) {
			if (axisId === id) this.#assignment.delete(key);
		}
	}

	assign(signalKey: string, axisId: YAxisId): void {
		if (!this.#ids.includes(axisId)) return;
		if (axisId === PRIMARY_Y_AXIS_ID) this.#assignment.delete(signalKey);
		else this.#assignment.set(signalKey, axisId);
	}

	/** Adds an axis holding just this signal. No-op at the cap. */
	assignToNewAxis(signalKey: string): void {
		const id = this.addAxis();
		if (id !== null) this.assign(signalKey, id);
	}

	/** Drops a deselected signal's assignment. Its axis stays. */
	release(signalKey: string): void {
		this.#assignment.delete(signalKey);
	}

	/** Drops every assignment, keeping the axes themselves. */
	releaseAll(): void {
		this.#assignment.clear();
	}

	reset(): void {
		this.#ids = [PRIMARY_Y_AXIS_ID];
		this.#assignment.clear();
	}
}

export const plotAxes = new PlotAxesStore();
