import type { RuntimeChain } from '../../adapters/shared/types.js';
import { buildSettlementIntent } from '../../settlement/intents.js';
import { FIXTURE_TIMESTAMP } from '../../fixtures/deterministic.js';
export function buildIntent(input: { chain: RuntimeChain; source: string; recipient: string; amount: string; asset?: string | undefined; machineId: string; sessionId: string; policyId: string; memo?: string | undefined; reference?: string | undefined; fixture?: boolean; now?: string | undefined }) {
  return buildSettlementIntent({
    ...input,
    nonce: input.fixture ? `fixture:${input.machineId}:${input.sessionId}` : undefined,
    now: input.now ?? (input.fixture ? FIXTURE_TIMESTAMP : undefined),
  });
}
