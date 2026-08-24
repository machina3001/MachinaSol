import type { RuntimeChain, MachineRole } from '../adapters/shared/types.js';
import { assertPositiveDecimalAmount } from '../settlement/amounts.js';
import { amountExceedsLimit } from '../settlement/policy-limits.js';

export interface PolicyProfile {
  policyId: string;
  displayName: string;
  allowedRails: RuntimeChain[];
  allowedAssets: string[];
  maxAmountPerIntent: string;
  maxSessionBudget?: string;
  machineRoles: MachineRole[];
  capabilityTags: string[];
}

export const DEFAULT_POLICY_PROFILE: PolicyProfile = {
  policyId: 'standard-machine-policy',
  displayName: 'Standard machine runtime policy',
  allowedRails: ['solana'],
  allowedAssets: ['SOL', 'USDC'],
  maxAmountPerIntent: '1000',
  maxSessionBudget: '5000',
  machineRoles: ['robot', 'drone', 'sensor', 'edge-node'],
  capabilityTags: ['telemetry', 'receipt-verification', 'caller-wallet-settlement']
};

export function validatePolicyForIntent(policy: PolicyProfile, input: { chain: RuntimeChain; asset: string; amount: string; role?: MachineRole }): string[] {
  const reasons: string[] = [];
  let amountValid = true;
  try { assertPositiveDecimalAmount(input.amount, 9); } catch { amountValid = false; }
  if (!policy.allowedRails.includes(input.chain)) reasons.push(`rail ${input.chain} is not allowed by policy ${policy.policyId}`);
  if (!policy.allowedAssets.includes(input.asset)) reasons.push(`asset ${input.asset} is not allowed by policy ${policy.policyId}`);
  if (!amountValid) reasons.push('amount must be greater than zero');
  if (amountValid && amountExceedsLimit(input.amount, policy.maxAmountPerIntent, input.chain, input.asset)) reasons.push(`amount exceeds policy limit ${policy.maxAmountPerIntent}`);
  if (input.role && !policy.machineRoles.includes(input.role)) reasons.push(`machine role ${input.role} is not allowed`);
  return reasons;
}
