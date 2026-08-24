import { expect, it } from 'vitest';
import { createMachineSession, deriveSessionId, validateWalletForRail } from '../src/sessions/session.js';
import { pair } from '../src/cli/commands/pair.js';

it('creates deterministic fixture sessions from machine, operator, policy, and nonce', () => {
  const session = createMachineSession({ chain: 'solana', walletAddress: '11111111111111111111111111111111', machineId: 'drone-9', operatorId: 'ops-alpha', policyProfileId: 'field-policy', mode: 'fixture', nonce: 'fixed', now: '2026-07-14T00:00:00Z', metadata: { role: 'drone', capabilities: ['inspection'] } });
  expect(session.sessionId).toBe(deriveSessionId({ chain: 'solana', walletAddress: '11111111111111111111111111111111', machineId: 'drone-9', operatorId: 'ops-alpha', policyProfileId: 'field-policy', nonce: 'fixed', createdAt: '2026-07-14T00:00:00Z' }));
  expect(session.metadata?.role).toBe('drone');
});

it('keeps fixture pairing deterministic when the caller does not supply a clock', () => {
  const input = {
    chain: 'solana' as const,
    fixture: true,
    machineId: 'drone-9',
    wallet: '11111111111111111111111111111111',
    operator: 'flight-ops',
  };
  const first = pair(input);
  const second = pair(input);
  expect(second).toEqual(first);
  expect(first.createdAt).toBe('2026-07-14T00:00:00.000Z');
});

it('rejects malformed Solana wallets', () => {
  expect(() => validateWalletForRail('solana', 'not-an-address')).toThrow(/invalid Solana/);
  // An EVM-shaped address is not valid base58 and must be rejected outright.
  expect(() => validateWalletForRail('solana', '0x1111111111111111111111111111111111111111')).toThrow(/invalid Solana/);
  // Correct alphabet but the wrong byte length.
  expect(() => validateWalletForRail('solana', '1111')).toThrow(/invalid Solana/);
});

it('requires non-empty machine and operator ids', () => {
  expect(() => createMachineSession({ chain: 'solana', walletAddress: '11111111111111111111111111111111', machineId: '', operatorId: 'ops' })).toThrow(/machineId/);
  expect(() => createMachineSession({ chain: 'solana', walletAddress: '11111111111111111111111111111111', machineId: 'drone-9', operatorId: '' })).toThrow(/operatorId/);
});

it('bounds and validates session registration identifiers and timestamps', () => {
  const base = {
    chain: 'solana' as const,
    walletAddress: '11111111111111111111111111111111',
    operatorId: 'ops',
  };
  expect(() => createMachineSession({ ...base, machineId: 'Drone 9' })).toThrow(/invalid machine id/);
  expect(() => createMachineSession({ ...base, machineId: 'drone-9', operatorId: 'x'.repeat(129) })).toThrow(/at most 128/);
  expect(() => createMachineSession({ ...base, machineId: 'drone-9', now: 'not-a-date' })).toThrow(/ISO timestamp/);
});
