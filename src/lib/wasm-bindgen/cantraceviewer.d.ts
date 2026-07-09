/* tslint:disable */
/* eslint-disable */

/**
 * Parsed DBC model owned by WebAssembly.
 */
export class Dbc {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Return the browser catalog projection as JSON.
     */
    catalogJson(): string;
    /**
     * Decode one selected signal as packed parallel time/value arrays.
     */
    decodeSignal(trace: Trace, can_id: number, is_extended: boolean, size_bytes: number, signal_name: string): Float64Array;
    /**
     * Parse DBC text and retain the decoded model for subsequent signal work.
     */
    static parse(input: string): Dbc;
}

/**
 * Stable error object thrown by fallible generated JavaScript bindings.
 */
export class DecoderError {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly code: string;
    readonly message: string;
}

/**
 * Parsed trace model owned by WebAssembly.
 */
export class Trace {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    static parseAsc(input: Uint8Array): Trace;
    static parseBlf(input: Uint8Array): Trace;
    static parseTrc(input: Uint8Array): Trace;
    readonly durationNs: number | undefined;
    readonly measurementStartMs: number | undefined;
    readonly skippedLineCount: number;
    readonly validMessageCount: number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_dbc_free: (a: number, b: number) => void;
    readonly __wbg_decodererror_free: (a: number, b: number) => void;
    readonly __wbg_trace_free: (a: number, b: number) => void;
    readonly decodererror_code: (a: number, b: number) => void;
    readonly decodererror_message: (a: number, b: number) => void;
    readonly wasmdbc_catalogJson: (a: number, b: number) => void;
    readonly wasmdbc_decodeSignal: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly wasmdbc_parse: (a: number, b: number, c: number) => void;
    readonly wasmtrace_durationNs: (a: number, b: number) => void;
    readonly wasmtrace_measurementStartMs: (a: number, b: number) => void;
    readonly wasmtrace_parseAsc: (a: number, b: number, c: number) => void;
    readonly wasmtrace_parseBlf: (a: number, b: number, c: number) => void;
    readonly wasmtrace_parseTrc: (a: number, b: number, c: number) => void;
    readonly wasmtrace_skippedLineCount: (a: number) => number;
    readonly wasmtrace_validMessageCount: (a: number) => number;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export2: (a: number, b: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number, d: number) => number;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
