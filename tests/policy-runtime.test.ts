import { expect, it } from 'vitest';
import { createRuntimeEvent } from '../src/policy/events.js';
import { DEFAULT_POLICY_PROFILE, validatePolicyForIntent } from '../src/policy/profiles.js';

it('accepts allowed machine rail, role, asset, and amount', () => {
  expect(validatePolicyForIntent(DEFAULT_POLICY_PROFILE, { chain: 'solana', asset: 'SOL', amount: '0.5', role: 'drone' })).toEqual([]);
});

it('returns policy mismatches for asset and budget', () => {
  const reasons = validatePolicyForIntent(DEFAULT_POLICY_PROFILE, { chain: 'solana', asset: 'DOGE', amount: '100000', role: 'robot' });
  expect(reasons.join(' ')).toContain('asset DOGE');
  expect(reasons.join(' ')).toContain('exceeds');
});

it('creates typed runtime events for audit trails', () => {
  const event = createRuntimeEvent({ eventId: 'evt_1', type: 'settlement.intent.created', machineId: 'robot-arm-17', sessionId: 'session-1', occurredAt: '2026-07-14T00:00:00Z', payload: { amount: '1.25' } });
  expect(event.type).toBe('settlement.intent.created');
  expect(event.payload.amount).toBe('1.25');
});
