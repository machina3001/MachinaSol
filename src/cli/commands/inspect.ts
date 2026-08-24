import type { RuntimeChain } from '../../adapters/shared/types.js';
import { SOLANA_PUBLIC_RPC } from '../../adapters/solana/provider.js';

export function inspect(_chain: RuntimeChain = 'solana') {
  return {
    chain: 'solana',
    rpcEnv: 'MACHINEFI_SOLANA_RPC_URL',
    // There is no bundled default endpoint; an RPC URL must be supplied for live-read.
    defaultRpcUrl: SOLANA_PUBLIC_RPC || null,
    explorer: 'https://explorer.solana.com'
  };
}
