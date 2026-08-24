import { createHash, randomUUID } from 'node:crypto';
import type { MachineMetadata, MachineSession, RuntimeChain, RuntimeMode } from '../adapters/shared/types.js';
import { isSolanaAddress } from '../adapters/solana/validation.js';
import { validateMachineId } from '../machines/identity.js';

export interface CreateMachineSessionInput {
  chain: RuntimeChain;
  walletAddress: string;
  machineId: string;
  operatorId: string;
  policyProfileId?: string | undefined;
  machineLabel?: string | undefined;
  mode?: RuntimeMode | undefined;
  nonce?: string | undefined;
  now?: string | undefined;
  metadata?: MachineMetadata | undefined;
}

const clean = (value: string, field: string, maxLength = 128): string => {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required`);
  if (trimmed.length > maxLength) throw new Error(`${field} must be at most ${maxLength} characters`);
  return trimmed;
};

const optionalText = (value: string | undefined, field: string, maxLength: number): string | undefined => {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > maxLength) throw new Error(`${field} must be at most ${maxLength} characters`);
  return trimmed;
};

const timestamp = (value: string | undefined): string => {
  if (value === undefined) return new Date().toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T/u.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error('now must be a valid ISO timestamp');
  }
  return value;
};

export function validateWalletForRail(_chain: RuntimeChain, walletAddress: string): void {
  if (!isSolanaAddress(walletAddress)) throw new Error('invalid Solana wallet address');
}

export function deriveSessionId(input: Pick<CreateMachineSessionInput, 'chain' | 'walletAddress' | 'machineId' | 'operatorId'> & { policyProfileId: string; nonce: string; createdAt: string }): string {
  const seed = [input.chain, input.walletAddress, input.machineId, input.operatorId, input.policyProfileId, input.nonce, input.createdAt].join('|');
  return `mfi_${input.chain}_${createHash('sha256').update(seed).digest('hex').slice(0, 24)}`;
}

export function createMachineSession(input: CreateMachineSessionInput): MachineSession {
  const chain = input.chain;
  const walletAddress = clean(input.walletAddress, 'walletAddress');
  validateWalletForRail(chain, walletAddress);
  const machineId = clean(input.machineId, 'machineId', 64);
  validateMachineId(machineId);
  const operatorId = clean(input.operatorId, 'operatorId');
  const policyProfileId = clean(input.policyProfileId ?? 'standard-machine-policy', 'policyProfileId');
  const machineLabel = optionalText(input.machineLabel, 'machineLabel', 128);
  const suppliedNonce = optionalText(input.nonce, 'nonce', 256);
  const nonce = suppliedNonce ?? (input.mode === 'fixture' ? `${machineId}:${operatorId}:fixture` : randomUUID());
  const createdAt = timestamp(input.now);
  const sessionId = deriveSessionId({ chain, walletAddress, machineId, operatorId, policyProfileId, nonce, createdAt });
  return {
    sessionId,
    chain,
    walletAddress,
    machineId,
    ...(machineLabel ? { machineLabel } : {}),
    operatorId,
    policyProfileId,
    createdAt,
    updatedAt: createdAt,
    mode: input.mode ?? 'live-read',
    nonce,
    ...(input.metadata ? { metadata: input.metadata } : {})
  };
}
