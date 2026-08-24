import {
  MACHINE_SESSION_ROLES,
  type MachineRole,
  type RuntimeChain,
  type MachineSession,
} from '../../adapters/shared/types.js';
import { createMachineSession } from '../../sessions/session.js';
import { FIXTURE_TIMESTAMP } from '../../fixtures/deterministic.js';

function sessionRole(value: string | undefined): MachineRole | undefined {
  if (value === undefined) return undefined;
  if ((MACHINE_SESSION_ROLES as readonly string[]).includes(value)) return value as MachineRole;
  throw new Error(`invalid machine session role: expected one of ${MACHINE_SESSION_ROLES.join(', ')}`);
}

export function pair(input: { chain: RuntimeChain; fixture?: boolean | undefined; machineId?: string | undefined; machineLabel?: string | undefined; wallet?: string | undefined; operator?: string | undefined; policy?: string | undefined; role?: string | undefined; now?: string }): MachineSession {
  const fixtureWallet = '11111111111111111111111111111111';
  const role = sessionRole(input.role);
  return createMachineSession({ chain: input.chain, walletAddress: input.wallet ?? (input.fixture ? fixtureWallet : ''), machineId: input.machineId ?? (input.fixture ? `fixture-${input.chain}-machine` : ''), machineLabel: input.machineLabel, operatorId: input.operator ?? (input.fixture ? 'fixture-operator' : ''), policyProfileId: input.policy ?? 'standard-machine-policy', mode: input.fixture ? 'fixture' : 'live-read', nonce: input.fixture ? `fixture:${input.chain}:${input.machineId ?? 'machine'}` : undefined, now: input.now ?? (input.fixture ? FIXTURE_TIMESTAMP : undefined), metadata: role ? { role } : undefined });
}
