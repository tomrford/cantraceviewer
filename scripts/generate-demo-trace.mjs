import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const template = await readFile(
	new URL('../wasm/tests/fixtures/mf4/decoded-channels.mf4', import.meta.url)
);
assert.equal(template.length, 1544);
assert.equal(template.toString('ascii', 0, 16), 'MDF     4.10    ');
for (const [offset, id, length, links] of [
	[64, '##HD', 104, 6],
	[248, '##DT', 96, 0],
	[584, '##DG', 64, 4],
	[1440, '##CG', 104, 6]
]) {
	assert.equal(template.toString('ascii', offset, offset + 4), id);
	assert.equal(template.readBigUInt64LE(offset + 8), BigInt(length));
	assert.equal(template.readBigUInt64LE(offset + 16), BigInt(links));
}
assert.equal(template.readBigUInt64LE(88), 584n);
assert.equal(template.readBigUInt64LE(616), 1440n);
assert.equal(template.readBigUInt64LE(624), 248n);
assert.equal(template.readBigUInt64LE(1520), 3n);
assert.equal(template.readUInt32LE(1536), 24);
for (const [offset, byteOffset] of [
	[712, 0],
	[952, 8],
	[1192, 16]
]) {
	assert.equal(template.toString('ascii', offset, offset + 4), '##CN');
	assert.equal(template.readBigUInt64LE(offset + 16), 8n);
	assert.equal(template[offset + 90], 4);
	assert.equal(template.readUInt32LE(offset + 92), byteOffset);
	assert.equal(template.readUInt32LE(offset + 96), 64);
}

const profile = [
	[0, 0, 800],
	[50, 25, 2800],
	[51, 25.5, 1600],
	[100, 50, 2600],
	[101, 50.3, 1700],
	[200, 80, 2400],
	[300, 80, 2400],
	[350, 100, 3200],
	[351, 100, 2300],
	[400, 100, 2300],
	[500, 60, 1700],
	[600, 30, 1400],
	[650, 0, 800],
	[700, 0, 800],
	[800, 50, 2600],
	[801, 49.5, 1700],
	[900, 0, 800]
];
const samples = 901;
const data = Buffer.alloc(24 + samples * 24);
data.write('##DT');
data.writeBigUInt64LE(BigInt(data.length), 8);
let segment = 0;
for (let sample = 0; sample < samples; sample++) {
	while (sample > profile[segment + 1][0]) segment++;
	const [start, speed, rpm] = profile[segment];
	const [end, nextSpeed, nextRpm] = profile[segment + 1];
	const ratio = (sample - start) / (end - start);
	const offset = 24 + sample * 24;
	data.writeDoubleLE(sample / 10, offset);
	data.writeDoubleLE(speed + (nextSpeed - speed) * ratio, offset + 8);
	data.writeDoubleLE(rpm + (nextRpm - rpm) * ratio, offset + 16);
}

template.writeBigUInt64LE(BigInt(template.length), 624);
template.writeBigUInt64LE(BigInt(samples), 1520);
template.write('CTVdemo ', 16, 'ascii');
template.writeBigUInt64LE(0n, 96);
template.writeBigUInt64LE(0n, 1504);
template.fill(0, 368, 528);
template.fill(0, 1432, 1440);
await writeFile(new URL('../static/example.mf4', import.meta.url), Buffer.concat([template, data]));
