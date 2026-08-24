import type { RuntimeChain } from '../adapters/shared/types.js';
import { decimalAmountGt, decimalAmountLte, decimalToBaseUnits } from './amounts.js';

export interface SettlementAmountLimit {
  chain: RuntimeChain;
  asset: string;
  amount: string;
  maxAmount: string;
  decimals?: number | undefined;
}

export interface SettlementAmountDecision {
  accepted: boolean;
  amountBaseUnits?: string | undefined;
  maxBaseUnits?: string | undefined;
  decimals: number;
  reasons: string[];
}

/** SPL USDC carries 6 decimals; native SOL is denominated in lamports at 9. */
export function decimalsForSettlement(_chain: RuntimeChain, asset?: string): number {
  return asset === 'USDC' ? 6 : 9;
}

export function evaluateSettlementAmountLimit(input: SettlementAmountLimit): SettlementAmountDecision {
  const decimals = input.decimals ?? decimalsForSettlement(input.chain, input.asset);
  const reasons: string[] = [];
  let amountBaseUnits: bigint | undefined;
  let maxBaseUnits: bigint | undefined;
  try { amountBaseUnits = decimalToBaseUnits(input.amount, decimals); } catch (cause) { reasons.push(cause instanceof Error ? cause.message : 'invalid amount'); }
  try { maxBaseUnits = decimalToBaseUnits(input.maxAmount, decimals); } catch (cause) { reasons.push(cause instanceof Error ? cause.message : 'invalid max amount'); }
  if (amountBaseUnits !== undefined && maxBaseUnits !== undefined && amountBaseUnits > maxBaseUnits) reasons.push(`amount exceeds policy limit ${input.maxAmount}`);
  return { accepted: reasons.length === 0, amountBaseUnits: amountBaseUnits?.toString(), maxBaseUnits: maxBaseUnits?.toString(), decimals, reasons };
}

export function assertAmountWithinLimit(input: SettlementAmountLimit): void {
  const decision = evaluateSettlementAmountLimit(input);
  if (!decision.accepted) throw new Error(decision.reasons.join('; '));
}

export function amountWithinLimit(amount: string, maxAmount: string, chain: RuntimeChain, asset?: string): boolean {
  const decimals = decimalsForSettlement(chain, asset);
  return decimalAmountLte(amount, maxAmount, decimals);
}

export function amountExceedsLimit(amount: string, maxAmount: string, chain: RuntimeChain, asset?: string): boolean {
  const decimals = decimalsForSettlement(chain, asset);
  return decimalAmountGt(amount, maxAmount, decimals);
}
