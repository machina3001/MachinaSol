import { createHash, randomUUID } from 'node:crypto';
import type { SettlementIntent, RuntimeChain } from '../adapters/shared/types.js';
import { normalizeDecimalAmount, decimalToBaseUnits } from './amounts.js';
import { decimalsForSettlement } from './policy-limits.js';
import { assertSolanaAddress } from '../adapters/solana/validation.js';
import { validateMachineId } from '../machines/identity.js';

export interface BuildSettlementIntentInput {
  chain: RuntimeChain;
  source: string;
  recipient: string;
  amount: string;
  asset?: string | undefined;
  machineId: string;
  sessionId: string;
  policyId: string;
  memo?: string | undefined;
  reference?: string | undefined;
  nonce?: string | undefined;
  expiresAt?: string | undefined;
  now?: string | undefined;
  metadata?: Record<string, string | number | boolean>;
}

export const normalizeAmount = normalizeDecimalAmount;
export const SOLANA_SETTLEMENT_ASSETS = ['SOL', 'USDC'] as const;

function cleanRequired(value: string, field: string, maxLength: number): string {
  const cleaned = value.trim();
  if (!cleaned) throw new Error(`${field} is required`);
  if (cleaned.length > maxLength) throw new Error(`${field} must be at most ${maxLength} characters`);
  return cleaned;
}

function cleanOptional(value: string | undefined, field: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  const cleaned = value.trim();
  if (!cleaned) return undefined;
  if (cleaned.length > maxLength) throw new Error(`${field} must be at most ${maxLength} characters`);
  return cleaned;
}

function validTimestamp(value: string, field: string): string {
  const cleaned = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T/u.test(cleaned) || !Number.isFinite(Date.parse(cleaned))) {
    throw new Error(`${field} must be a valid ISO timestamp`);
  }
  return cleaned;
}

function validateRailAssetAmount(chain: RuntimeChain, asset: string, amount: string): string {
  const normalized = normalizeDecimalAmount(amount);
  decimalToBaseUnits(normalized, decimalsForSettlement(chain, asset));
  return normalized;
}

function assertRailAddress(_chain: RuntimeChain, value: string, label: string): void {
  assertSolanaAddress(value, label);
}

export function buildSettlementIntent(input: BuildSettlementIntentInput): SettlementIntent {
  const source = input.source.trim();
  const recipient = input.recipient.trim();
  assertRailAddress(input.chain, source, 'source');
  assertRailAddress(input.chain, recipient, 'recipient');
  const asset = (input.asset ?? 'SOL').trim().toUpperCase();
  if (!(SOLANA_SETTLEMENT_ASSETS as readonly string[]).includes(asset)) {
    throw new Error(`unsupported Solana settlement asset: ${asset || '(empty)'}`);
  }
  const amount = validateRailAssetAmount(input.chain, asset, input.amount);
  const machineId = cleanRequired(input.machineId, 'machineId', 64);
  validateMachineId(machineId);
  const sessionId = cleanRequired(input.sessionId, 'sessionId', 128);
  const policyId = cleanRequired(input.policyId, 'policyId', 128);
  const memo = cleanOptional(input.memo, 'memo', 512);
  const reference = cleanOptional(input.reference, 'reference', 256);
  const nonce = cleanOptional(input.nonce, 'nonce', 256) ?? randomUUID();
  const createdAt = input.now === undefined ? new Date().toISOString() : validTimestamp(input.now, 'now');
  const expiresAt = input.expiresAt === undefined ? undefined : validTimestamp(input.expiresAt, 'expiresAt');
  if (expiresAt !== undefined && Date.parse(expiresAt) <= Date.parse(createdAt)) {
    throw new Error('expiresAt must be later than createdAt');
  }
  const idSeed = [input.chain, source, recipient, amount, asset, machineId, sessionId, policyId, nonce].join('|');
  const intentId = `intent_${createHash('sha256').update(idSeed).digest('hex').slice(0, 24)}`;
  return {
    intentId,
    chain: input.chain,
    source,
    recipient,
    asset,
    amount,
    machineId,
    sessionId,
    policyId,
    ...(memo ? { memo } : {}),
    ...(reference ? { reference } : {}),
    nonce,
    ...(expiresAt ? { expiresAt } : {}),
    createdAt,
    signingMode: 'caller-wallet',
    broadcast: false,
    ...(input.metadata ? { metadata: input.metadata } : {})
  };
}
