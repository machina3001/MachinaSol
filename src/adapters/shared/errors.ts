export class MachineFiRuntimeError extends Error { constructor(readonly code: string, detail: string, readonly cause?: unknown) { super(detail); this.name = 'MachineFiRuntimeError'; } }
