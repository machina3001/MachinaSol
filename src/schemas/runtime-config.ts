import type { ProviderConfig } from '../adapters/shared/types.js';
export function normalizeRuntimeConfig(config: ProviderConfig): ProviderConfig { return { timeoutMs: 12000, ...config }; }
