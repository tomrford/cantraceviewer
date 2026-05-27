import { z } from 'zod';

const DbcValueDescriptionSchema = z.object({
	rawValue: z.number(),
	label: z.string()
});

const DbcSignalSchema = z.object({
	name: z.string(),
	startBit: z.number(),
	bitLength: z.number(),
	endianness: z.string(),
	signedness: z.string(),
	factor: z.number(),
	offset: z.number(),
	minimum: z.number(),
	maximum: z.number(),
	unit: z.string(),
	valueType: z.string(),
	unsupportedMux: z.boolean(),
	receivers: z.array(z.string()),
	valueDescriptions: z.array(DbcValueDescriptionSchema)
});

const DbcMessageSchema = z.object({
	name: z.string(),
	dbcId: z.number(),
	canId: z.number(),
	isExtended: z.boolean(),
	isFd: z.boolean(),
	sizeBytes: z.number(),
	transmitter: z.string(),
	signals: z.array(DbcSignalSchema)
});

const ParsedDbcSchema = z.object({
	messages: z.array(DbcMessageSchema)
});

const TraceMetadataSchema = z.object({
	measurementStartMs: z.number().nullable(),
	validMessageCount: z.number(),
	durationNs: z.number().nullable()
});

export type DbcValueDescription = z.infer<typeof DbcValueDescriptionSchema>;
export type DbcSignal = z.infer<typeof DbcSignalSchema>;
export type DbcMessage = z.infer<typeof DbcMessageSchema>;
export type ParsedDbc = z.infer<typeof ParsedDbcSchema>;
export type TraceMetadata = z.infer<typeof TraceMetadataSchema>;

export function parseParsedDbc(value: unknown): ParsedDbc {
	return ParsedDbcSchema.parse(value);
}

export function parseTraceMetadata(value: unknown): TraceMetadata {
	return TraceMetadataSchema.parse(value);
}
