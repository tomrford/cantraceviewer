/**
 * Largest-triangle-three-buckets downsampling over columnar series data.
 * Samples the index range [start, end) of the source columns without copying
 * the input; always keeps the range's first and last points.
 */
export function lttbSample(
	x: Float64Array<ArrayBufferLike>,
	y: Float64Array<ArrayBufferLike>,
	start: number,
	end: number,
	target: number
): { x: Float64Array; y: Float64Array } {
	const length = end - start;
	const count = Math.max(2, Math.floor(target));
	if (length <= count) {
		return { x: x.slice(start, end), y: y.slice(start, end) };
	}

	const outX = new Float64Array(count);
	const outY = new Float64Array(count);
	outX[0] = x[start];
	outY[0] = y[start];

	const bucketSize = (length - 2) / (count - 2);
	let selected = start;

	for (let bucket = 0; bucket < count - 2; bucket++) {
		const bucketStart = start + 1 + Math.floor(bucket * bucketSize);
		const bucketEnd = Math.min(start + 1 + Math.floor((bucket + 1) * bucketSize), end - 1);

		// Average of the following bucket forms the third triangle vertex.
		const nextStart = bucketEnd;
		const nextEnd = Math.min(start + 1 + Math.floor((bucket + 2) * bucketSize), end - 1);
		const nextLength = Math.max(1, nextEnd - nextStart);
		let avgX = 0;
		let avgY = 0;
		for (let i = nextStart; i < nextStart + nextLength; i++) {
			avgX += x[i];
			avgY += y[i];
		}
		avgX /= nextLength;
		avgY /= nextLength;

		const anchorX = x[selected];
		const anchorY = y[selected];
		let maxArea = -1;
		let chosen = bucketStart;
		for (let i = bucketStart; i < bucketEnd; i++) {
			const area = Math.abs(
				(anchorX - avgX) * (y[i] - anchorY) - (anchorX - x[i]) * (avgY - anchorY)
			);
			if (area > maxArea) {
				maxArea = area;
				chosen = i;
			}
		}

		outX[bucket + 1] = x[chosen];
		outY[bucket + 1] = y[chosen];
		selected = chosen;
	}

	outX[count - 1] = x[end - 1];
	outY[count - 1] = y[end - 1];
	return { x: outX, y: outY };
}
