import type { RpcTransport } from '../../transports/live-rpc.js';

export type SolanaCluster = 'mainnet-beta' | 'devnet' | 'testnet' | 'custom';

/** Canonical public-cluster genesis identities published by Solana. */
export const KNOWN_SOLANA_GENESIS_HASHES: Readonly<Record<Exclude<SolanaCluster, 'custom'>, string>> = {
  'mainnet-beta': '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
  testnet: '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY',
};

export type SolanaNetworkErrorCode =
  | 'NETWORK_CONFIGURATION_INVALID'
  | 'CLUSTER_GENESIS_MISMATCH'
  | 'GENESIS_LOOKUP_UNAVAILABLE'
  | 'INVALID_GENESIS_RESPONSE'
  | 'NETWORK_MISMATCH';

const SAFE_MESSAGES: Readonly<Record<SolanaNetworkErrorCode, string>> = {
  NETWORK_CONFIGURATION_INVALID: 'Solana network configuration is incomplete',
  CLUSTER_GENESIS_MISMATCH: 'configured Solana cluster and genesis hash do not match',
  GENESIS_LOOKUP_UNAVAILABLE: 'Solana network identity is temporarily unavailable',
  INVALID_GENESIS_RESPONSE: 'Solana RPC returned an invalid network identity',
  NETWORK_MISMATCH: 'Solana network mismatch',
};

export class SolanaNetworkError extends Error {
  constructor(readonly code: SolanaNetworkErrorCode, readonly retryable = false, cause?: unknown) {
    super(SAFE_MESSAGES[code], cause === undefined ? undefined : { cause });
    this.name = 'SolanaNetworkError';
  }
}

export interface SolanaNetworkExpectation { cluster: SolanaCluster; expectedGenesisHash: string; }

/** Known labels are pinned to canonical hashes. Custom networks require an explicit hash. */
export function resolveSolanaNetworkExpectation(
  cluster: SolanaCluster | undefined,
  configuredGenesisHash: string | undefined
): SolanaNetworkExpectation {
  const label = cluster ?? 'custom';
  const configured = configuredGenesisHash?.trim();
  if (label === 'custom') {
    if (!configured) throw new SolanaNetworkError('NETWORK_CONFIGURATION_INVALID');
    return { cluster: label, expectedGenesisHash: configured };
  }
  const canonical = KNOWN_SOLANA_GENESIS_HASHES[label];
  if (configured && configured !== canonical) throw new SolanaNetworkError('CLUSTER_GENESIS_MISMATCH');
  return { cluster: label, expectedGenesisHash: canonical };
}

export interface VerifiedSolanaNetwork {
  verified: true;
  cluster: SolanaCluster;
  expectedGenesisHash: string;
  actualGenesisHash: string;
  verifiedAt: string;
}

/** Checks actual RPC genesis identity; a label alone is never runtime proof. */
export async function verifySolanaNetwork(
  transport: RpcTransport,
  expectationOrHash: SolanaNetworkExpectation | string,
  now = new Date()
): Promise<VerifiedSolanaNetwork> {
  const expectation = typeof expectationOrHash === 'string'
    ? resolveSolanaNetworkExpectation('custom', expectationOrHash)
    : resolveSolanaNetworkExpectation(expectationOrHash.cluster, expectationOrHash.expectedGenesisHash);
  let actual: unknown;
  try { actual = await transport.request<unknown>('getGenesisHash'); }
  catch (error) { throw new SolanaNetworkError('GENESIS_LOOKUP_UNAVAILABLE', true, error); }
  if (typeof actual !== 'string' || actual.trim() === '') throw new SolanaNetworkError('INVALID_GENESIS_RESPONSE');
  if (actual !== expectation.expectedGenesisHash) throw new SolanaNetworkError('NETWORK_MISMATCH');
  return {
    verified: true,
    cluster: expectation.cluster,
    expectedGenesisHash: expectation.expectedGenesisHash,
    actualGenesisHash: actual,
    verifiedAt: now.toISOString(),
  };
}
