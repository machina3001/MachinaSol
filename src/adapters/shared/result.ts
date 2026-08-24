export type RuntimeResult<T> = { ok: true; value: T } | { ok: false; error: RuntimeError };
export type RuntimeErrorCode = 'invalid_input' | 'not_found' | 'rpc_error' | 'unsupported_chain' | 'fixture_missing';
export interface RuntimeError { code: RuntimeErrorCode; detail: string; cause?: unknown; }
export const ok = <T>(value: T): RuntimeResult<T> => ({ ok: true, value });
export const err = <T = never>(code: RuntimeErrorCode, detail: string, cause?: unknown): RuntimeResult<T> => ({ ok: false, error: { code, detail, cause } });
