import type { RuntimeChain } from '../../adapters/shared/types.js';
import { checkChainStatus } from '../../status/chain-status.js';
export function status(chain: RuntimeChain, options: { fixture?: boolean | undefined; rpcUrl?: string | undefined; timeoutMs?: number | undefined } = {}) { return checkChainStatus({ chain, ...options }); }
