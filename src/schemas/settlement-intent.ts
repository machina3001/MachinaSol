import type { SettlementIntent } from '../adapters/shared/types.js';
export function assertSettlementIntent(value: SettlementIntent): SettlementIntent {
  if (value.signingMode !== 'caller-wallet') throw new Error('settlement intent must use caller-wallet signing');
  if (value.broadcast !== false) throw new Error('settlement intent must not broadcast');
  if (!value.intentId || !value.machineId || !value.sessionId || !value.policyId) throw new Error('settlement intent missing runtime fields');
  return value;
}
