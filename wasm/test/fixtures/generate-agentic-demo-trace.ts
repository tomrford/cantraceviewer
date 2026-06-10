/**
 * Regenerates wasm/test/fixtures/agentic-demo.asc from agentic-demo.dbc signal layouts.
 *
 * Usage: bun run wasm/test/fixtures/generate-agentic-demo-trace.ts
 */

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(scriptDir, 'agentic-demo.asc');

const DURATION_S = 25;
const STEP_S = 0.1;
const MEASUREMENT_START = 'Thu Apr 30 12:00:00.000 2026';

type SignalDef = {
	startBit: number;
	length: number;
	factor: number;
	offset: number;
	signed?: boolean;
};

type MessageDef = {
	canId: number;
	sizeBytes: number;
	signals: Record<string, SignalDef>;
};

const messages: Record<string, MessageDef> = {
	Heartbeat: {
		canId: 0x100,
		sizeBytes: 2,
		signals: {
			counter: { startBit: 0, length: 8, factor: 1, offset: 0 },
			mode: { startBit: 8, length: 8, factor: 1, offset: 0 }
		}
	},
	PowertrainStatus: {
		canId: 0x120,
		sizeBytes: 8,
		signals: {
			vehicle_speed: { startBit: 0, length: 16, factor: 0.1, offset: 0 },
			engine_rpm: { startBit: 16, length: 16, factor: 1, offset: 0 },
			throttle: { startBit: 32, length: 8, factor: 0.5, offset: 0 },
			coolant_temp: { startBit: 40, length: 8, factor: 1, offset: -40 }
		}
	},
	BatteryStatus: {
		canId: 0x200,
		sizeBytes: 8,
		signals: {
			soc: { startBit: 0, length: 8, factor: 0.5, offset: 0 },
			pack_voltage: { startBit: 8, length: 16, factor: 0.01, offset: 0 },
			pack_current: { startBit: 24, length: 16, factor: 0.1, offset: 0, signed: true },
			cell_temp_max: { startBit: 40, length: 8, factor: 1, offset: -40 }
		}
	},
	BrakeSystem: {
		canId: 0x220,
		sizeBytes: 6,
		signals: {
			brake_pressure_front: { startBit: 0, length: 16, factor: 0.01, offset: 0 },
			brake_pressure_rear: { startBit: 16, length: 16, factor: 0.01, offset: 0 },
			abs_active: { startBit: 32, length: 1, factor: 1, offset: 0 },
			brake_pedal: { startBit: 40, length: 8, factor: 0.5, offset: 0 }
		}
	},
	SteeringAngle: {
		canId: 0x240,
		sizeBytes: 4,
		signals: {
			steering_angle: { startBit: 0, length: 16, factor: 0.1, offset: 0, signed: true },
			steering_rate: { startBit: 16, length: 16, factor: 0.01, offset: 0, signed: true }
		}
	},
	VehicleDynamics: {
		canId: 0x260,
		sizeBytes: 8,
		signals: {
			lateral_accel: { startBit: 0, length: 16, factor: 0.001, offset: 0, signed: true },
			longitudinal_accel: { startBit: 16, length: 16, factor: 0.001, offset: 0, signed: true },
			yaw_rate: { startBit: 32, length: 16, factor: 0.01, offset: 0, signed: true },
			road_grade: { startBit: 48, length: 8, factor: 0.5, offset: 0, signed: true }
		}
	}
};

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function noise(seed: number): number {
	const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
	return (x - Math.floor(x)) * 2 - 1;
}

function physicalToRaw(physical: number, signal: SignalDef): number {
	const raw = Math.round((physical - signal.offset) / signal.factor);
	const maxRaw = (1 << signal.length) - 1;
	if (signal.signed) {
		const minSigned = -(1 << (signal.length - 1));
		const maxSigned = (1 << (signal.length - 1)) - 1;
		return clamp(raw, minSigned, maxSigned);
	}
	return clamp(raw, 0, maxRaw);
}

function setSignal(payload: number[], signal: SignalDef, physical: number): void {
	let raw = physicalToRaw(physical, signal);
	if (signal.signed && raw < 0) {
		raw = (1 << signal.length) + raw;
	}

	for (let bit = 0; bit < signal.length; bit++) {
		const bitIndex = signal.startBit + bit;
		const byteIndex = Math.floor(bitIndex / 8);
		const bitInByte = bitIndex % 8;
		const bitValue = (raw >> bit) & 1;
		if (bitValue) {
			payload[byteIndex] |= 1 << bitInByte;
		} else {
			payload[byteIndex] &= ~(1 << bitInByte);
		}
	}
}

function encodeMessage(
	message: MessageDef,
	values: Record<string, number>
): number[] {
	const payload = new Array<number>(message.sizeBytes).fill(0);
	for (const [name, physical] of Object.entries(values)) {
		const signal = message.signals[name];
		if (!signal) {
			throw new Error(`Unknown signal ${name}`);
		}
		setSignal(payload, signal, physical);
	}
	return payload;
}

function formatCanId(canId: number): string {
	return canId.toString(16).toUpperCase();
}

function formatPayload(payload: number[]): string {
	return payload.map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
}

function ascLine(timestampS: number, canId: number, payload: number[]): string {
	return `${timestampS.toFixed(6)} 1 ${formatCanId(canId)} Rx d ${payload.length} ${formatPayload(payload)}`;
}

const anchorPowertrain: Array<{ t: number; speed: number; throttle: number; coolant: number }> = [
	{ t: 0.01, speed: 100, throttle: 40, coolant: 80 },
	{ t: 0.11, speed: 123.4, throttle: 50, coolant: 90 },
	{ t: 0.21, speed: 150, throttle: 60, coolant: 100 }
];

function anchorPowertrainSample(t: number): { speed: number; throttle: number; coolant: number } | null {
	for (const point of anchorPowertrain) {
		if (Math.abs(t - point.t) < 1e-9) {
			return { speed: point.speed, throttle: point.throttle, coolant: point.coolant };
		}
	}
	return null;
}

function sampleAt(t: number, index: number) {
	const ramp = clamp(t / 8, 0, 1);
	const cruise = t >= 8 && t < 14 ? 1 : 0;
	const brakeEvent = t >= 14 && t < 16 ? 1 : 0;
	const recovery = t >= 16 ? 1 : 0;
	const anchor = anchorPowertrainSample(t);

	const vehicleSpeed =
		anchor?.speed ??
		(45 +
			ramp * 28 +
			cruise * 6 +
			recovery * 4 * Math.sin((t - 16) * 0.9) +
			noise(index) * 0.8);

	const throttle =
		anchor?.throttle ??
		(brakeEvent
			? clamp(55 - (t - 14) * 25, 5, 55)
			: clamp(28 + ramp * 18 + Math.sin(t * 0.55) * 8 + noise(index + 1) * 2, 5, 75));

	const engineRpm =
		800 +
		vehicleSpeed * 32 +
		throttle * 12 +
		Math.sin(t * 1.7) * 180 +
		noise(index + 2) * 40;

	const coolantTemp =
		anchor?.coolant ?? 78 + vehicleSpeed * 0.08 + throttle * 0.05 + noise(index + 3) * 0.4;

	const soc =
		82 -
		ramp * 3.5 -
		brakeEvent * 1.2 +
		recovery * 0.8 +
		Math.sin(t * 0.25) * 1.5 +
		noise(index + 4) * 0.3;

	const packVoltage = 385 + soc * 0.04 + noise(index + 5) * 0.2;
	const packCurrent = brakeEvent ? -85 - (t - 14) * 20 : 15 + throttle * 0.6 + noise(index + 6) * 3;
	const cellTempMax = 28 + vehicleSpeed * 0.04 + Math.abs(packCurrent) * 0.02;

	const brakePedal = brakeEvent ? clamp((t - 14) * 50, 0, 65) : 0;
	const brakePressureFront = brakeEvent
		? clamp(8 + (t - 14) * 38 + noise(index + 7) * 0.5, 0, 95)
		: Math.max(0, Math.sin(t * 2.4 + 1) * 2 + noise(index + 7) * 0.4);
	const brakePressureRear = brakePressureFront * (0.82 + noise(index + 8) * 0.02);
	const absActive = brakeEvent && t > 14.4 ? 1 : 0;

	const steeringAngle =
		Math.sin(t * 0.42) * 18 +
		Math.sin(t * 1.3) * 4 +
		(brakeEvent ? (t - 14) * 3 : 0) +
		noise(index + 9) * 0.6;
	const steeringRate = Math.cos(t * 0.42) * 7 + noise(index + 10) * 0.4;

	const lateralAccel =
		Math.sin(t * 0.42) * 0.35 + Math.sin(t * 2.1) * 0.08 + noise(index + 11) * 0.02;
	const longitudinalAccel = brakeEvent
		? -0.45 - (t - 14) * 0.15
		: 0.08 + ramp * 0.05 + Math.sin(t * 0.55) * 0.04 + noise(index + 12) * 0.015;
	const yawRate = steeringAngle * 0.12 + noise(index + 13) * 0.5;
	const roadGrade = Math.sin(t * 0.18) * 4 + noise(index + 14) * 0.3;

	return {
		vehicleSpeed,
		throttle,
		engineRpm,
		coolantTemp,
		soc,
		packVoltage,
		packCurrent,
		cellTempMax,
		brakePedal,
		brakePressureFront,
		brakePressureRear,
		absActive,
		steeringAngle,
		steeringRate,
		lateralAccel,
		longitudinalAccel,
		yawRate,
		roadGrade
	};
}

function generateAsc(): string {
	const lines: string[] = [
		`date ${MEASUREMENT_START}`,
		'base hex timestamps absolute',
		'internal events logged',
		`Begin Triggerblock ${MEASUREMENT_START}`
	];

	let index = 0;
	for (let t = 0; t <= DURATION_S + 1e-9; t += STEP_S, index++) {
		const sampleTime = t + 0.01;
		const sample = sampleAt(sampleTime, index);
		const heartbeat = encodeMessage(messages.Heartbeat, {
			counter: index % 256,
			mode: sampleTime < 8 ? 1 : sampleTime < 16 ? 2 : 3
		});
		const powertrain = encodeMessage(messages.PowertrainStatus, {
			vehicle_speed: sample.vehicleSpeed,
			engine_rpm: sample.engineRpm,
			throttle: sample.throttle,
			coolant_temp: sample.coolantTemp
		});
		const battery = encodeMessage(messages.BatteryStatus, {
			soc: sample.soc,
			pack_voltage: sample.packVoltage,
			pack_current: sample.packCurrent,
			cell_temp_max: sample.cellTempMax
		});
		const brakes = encodeMessage(messages.BrakeSystem, {
			brake_pressure_front: sample.brakePressureFront,
			brake_pressure_rear: sample.brakePressureRear,
			abs_active: sample.absActive,
			brake_pedal: sample.brakePedal
		});
		const steering = encodeMessage(messages.SteeringAngle, {
			steering_angle: sample.steeringAngle,
			steering_rate: sample.steeringRate
		});
		const dynamics = encodeMessage(messages.VehicleDynamics, {
			lateral_accel: sample.lateralAccel,
			longitudinal_accel: sample.longitudinalAccel,
			yaw_rate: sample.yawRate,
			road_grade: sample.roadGrade
		});

		lines.push(ascLine(t, messages.Heartbeat.canId, heartbeat));
		lines.push(ascLine(t + 0.01, messages.PowertrainStatus.canId, powertrain));
		lines.push(ascLine(t + 0.02, messages.BatteryStatus.canId, battery));
		lines.push(ascLine(t + 0.03, messages.BrakeSystem.canId, brakes));
		lines.push(ascLine(t + 0.04, messages.SteeringAngle.canId, steering));
		lines.push(ascLine(t + 0.05, messages.VehicleDynamics.canId, dynamics));
	}

	lines.push('End TriggerBlock');
	return `${lines.join('\n')}\n`;
}

writeFileSync(outputPath, generateAsc(), 'utf8');
console.log(`Wrote ${outputPath}`);
