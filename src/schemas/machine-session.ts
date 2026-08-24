import type { MachineSession } from '../adapters/shared/types.js';
export function validateMachineSession(value: MachineSession): MachineSession {
  if (!value.sessionId || !value.walletAddress || !value.machineId || !value.operatorId || !value.policyProfileId) throw new Error('invalid machine session');
  return value;
}
