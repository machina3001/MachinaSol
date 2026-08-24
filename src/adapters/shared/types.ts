/** Solana is the only supported settlement rail. */
export type RuntimeChain = 'solana';
export type RuntimeMode = 'fixture' | 'live-read';
import type { ReceiptEvidenceField, SettlementEvidence } from './evidence.js';
/** Roles accepted by a runtime machine session. */
export const MACHINE_SESSION_ROLES = ['robot', 'drone', 'sensor', 'edge-node', 'vehicle', 'other'] as const;
export type MachineRole = (typeof MACHINE_SESSION_ROLES)[number];

export interface MachineMetadata {
  role?: MachineRole | undefined;
  capabilities?: string[] | undefined;
  locationHint?: string | undefined;
  model?: string | undefined;
}

export interface MachineSession {
  sessionId: string;
  chain: RuntimeChain;
  walletAddress: string;
  machineId: string;
  machineLabel?: string | undefined;
  operatorId: string;
  policyProfileId: string;
  createdAt: string;
  updatedAt: string;
  mode: RuntimeMode;
  nonce: string;
  metadata?: MachineMetadata | undefined;
}

export interface ProviderConfig { chain: RuntimeChain; rpcUrl?: string | undefined; fixture?: boolean | undefined; timeoutMs?: number | undefined; }

export interface ReceiptExpectation {
  status?: 'success' | 'failed' | 'pending' | undefined;
  from?: string | undefined;
  to?: string | undefined;
  recipient?: string | undefined;
  amount?: string | undefined;
  asset?: string | undefined;
  memo?: string | undefined;
  sessionId?: string | undefined;
  machineId?: string | undefined;
}

export interface ReceiptVerification {
  chain: RuntimeChain;
  id: string;
  found: boolean;
  verified?: boolean | undefined;
  chainMatched?: boolean | undefined;
  status: 'success' | 'failed' | 'pending' | 'not_found';
  statusMatched?: boolean | undefined;
  expectationsMatched?: boolean | undefined;
  mismatchReasons?: string[] | undefined;
  finality?: 'finalized' | 'confirmed' | 'processed' | 'pending' | 'unknown' | undefined;
  confirmations?: number | undefined;
  block?: string | number | undefined;
  explorerUrl?: string | undefined;
  raw?: unknown;
  evidence?: ReceiptEvidenceField[] | undefined;
  settlementEvidence?: SettlementEvidence | undefined;
}


export interface SettlementIntent {
  intentId: string;
  chain: RuntimeChain;
  source: string;
  recipient: string;
  asset: string;
  amount: string;
  machineId: string;
  sessionId: string;
  policyId: string;
  memo?: string | undefined;
  reference?: string | undefined;
  nonce: string;
  expiresAt?: string | undefined;
  createdAt: string;
  signingMode: 'caller-wallet';
  broadcast: false;
  metadata?: Record<string, string | number | boolean>;
}

export interface ChainStatusResult {
  ok: boolean;
  mode: RuntimeMode;
  chain: RuntimeChain;
  chainMatched: boolean;
  rpcReachable: boolean;
  latencyMs: number;
  details: Record<string, unknown>;
  error?: string | undefined;
}
