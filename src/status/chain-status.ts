import type { ChainStatusResult, RuntimeChain } from '../adapters/shared/types.js';
import { createSolanaTransport, solanaRpcUrl } from '../adapters/solana/provider.js';

const nowMs = () => Date.now();

export async function checkChainStatus(input: { chain: RuntimeChain; fixture?: boolean | undefined; rpcUrl?: string | undefined; timeoutMs?: number | undefined }): Promise<ChainStatusResult> {
  const started = nowMs();
  if (input.fixture) {
    return { ok: true, mode: 'fixture', chain: 'solana', chainMatched: true, rpcReachable: true, latencyMs: 0, details: { version: 'fixture-solana-1.18', rpcUrl: 'fixture' } };
  }
  try {
    const transport = createSolanaTransport({ rpcUrl: input.rpcUrl ?? solanaRpcUrl(), timeoutMs: input.timeoutMs });
    const version = await transport.request<{ 'solana-core'?: string; 'feature-set'?: number }>('getVersion', []);
    return { ok: true, mode: 'live-read', chain: 'solana', chainMatched: false, rpcReachable: true, latencyMs: nowMs() - started, details: { version, networkVerification: 'unavailable', reason: 'Solana getVersion proves RPC reachability but does not identify mainnet/devnet/testnet/private cluster' } };
  } catch (cause) {
    return { ok: false, mode: 'live-read', chain: 'solana', chainMatched: false, rpcReachable: false, latencyMs: nowMs() - started, details: {}, error: cause instanceof Error ? cause.message : 'status check failed' };
  }
}
