import { expect, it } from 'vitest';
import { buildSettlementIntent, normalizeAmount } from '../src/settlement/intents.js';
import { assertSettlementIntent } from '../src/schemas/settlement-intent.js';
import { buildIntent } from '../src/cli/commands/intent.js';

it('builds unsigned caller-wallet settlement intents with runtime fields', () => {
  const intent = buildSettlementIntent({ chain: 'solana', source: '11111111111111111111111111111111', recipient: 'Sysvar1111111111111111111111111111111111111', amount: '1.25', asset: 'SOL', machineId: 'drone-9', sessionId: 'session-1', policyId: 'standard-machine-policy', nonce: 'fixed', now: '2026-07-14T00:00:00Z' });
  expect(intent.intentId).toMatch(/^intent_/);
  expect(intent.broadcast).toBe(false);
  expect(intent.signingMode).toBe('caller-wallet');
  expect(assertSettlementIntent(intent)).toEqual(intent);
});

it('keeps fixture intent output deterministic when the caller does not supply a clock', () => {
  const input = {
    chain: 'solana' as const,
    source: '11111111111111111111111111111111',
    recipient: 'Sysvar1111111111111111111111111111111111111',
    amount: '0.5',
    machineId: 'drone-9',
    sessionId: 'mfi_solana_fixture_session',
    policyId: 'standard-machine-policy',
    fixture: true,
  };
  const first = buildIntent(input);
  const second = buildIntent(input);
  expect(second).toEqual(first);
  expect(first.createdAt).toBe('2026-07-14T00:00:00.000Z');
});

it('defaults the asset to SOL', () => {
  const intent = buildSettlementIntent({ chain: 'solana', source: '11111111111111111111111111111111', recipient: 'Sysvar1111111111111111111111111111111111111', amount: '0.5', machineId: 'drone-9', sessionId: 'session-1', policyId: 'standard-machine-policy', nonce: 'fixed' });
  expect(intent.asset).toBe('SOL');
});

it('rejects unsupported Solana settlement asset labels', () => {
  expect(() => buildSettlementIntent({ chain: 'solana', source: '11111111111111111111111111111111', recipient: 'Sysvar1111111111111111111111111111111111111', amount: '1', asset: 'ETH', machineId: 'drone-9', sessionId: 'session-1', policyId: 'standard-machine-policy' })).toThrow(/unsupported Solana settlement asset/);
});

it('normalizes and bounds runtime relationship fields', () => {
  const intent = buildSettlementIntent({
    chain: 'solana',
    source: ' 11111111111111111111111111111111 ',
    recipient: ' Sysvar1111111111111111111111111111111111111 ',
    amount: '1',
    machineId: ' drone-9 ',
    sessionId: ' session-1 ',
    policyId: ' policy-1 ',
    memo: ' memo ',
    nonce: ' fixed ',
    now: '2026-07-14T00:00:00Z',
  });
  expect(intent).toMatchObject({
    source: '11111111111111111111111111111111',
    machineId: 'drone-9',
    sessionId: 'session-1',
    policyId: 'policy-1',
    memo: 'memo',
    nonce: 'fixed',
  });
  expect(() => buildSettlementIntent({
    chain: 'solana',
    source: '11111111111111111111111111111111',
    recipient: 'Sysvar1111111111111111111111111111111111111',
    amount: '1',
    machineId: 'INVALID ID',
    sessionId: 'session-1',
    policyId: 'policy-1',
  })).toThrow(/invalid machine id/);
  expect(() => buildSettlementIntent({
    chain: 'solana',
    source: '11111111111111111111111111111111',
    recipient: 'Sysvar1111111111111111111111111111111111111',
    amount: '1',
    machineId: 'drone-9',
    sessionId: 'session-1',
    policyId: 'policy-1',
    now: 'not-a-date',
  })).toThrow(/valid ISO timestamp/);
});

it('rejects amounts finer than lamport precision', () => {
  expect(() => buildSettlementIntent({ chain: 'solana', source: '11111111111111111111111111111111', recipient: 'Sysvar1111111111111111111111111111111111111', amount: '0.0000000001', machineId: 'drone-9', sessionId: 'session-1', policyId: 'standard-machine-policy' })).toThrow(/more than 9 decimal places/);
});

it('rejects zero and negative amounts', () => {
  expect(() => normalizeAmount('0')).toThrow(/greater than zero/);
  expect(() => normalizeAmount('-1')).toThrow(/positive decimal/);
});

it('rejects malformed recipient addresses', () => {
  expect(() => buildSettlementIntent({ chain: 'solana', source: '11111111111111111111111111111111', recipient: 'bad', amount: '1', machineId: 'm', sessionId: 's', policyId: 'p' })).toThrow(/invalid Solana recipient/);
});

it('rejects EVM-shaped source addresses', () => {
  expect(() => buildSettlementIntent({ chain: 'solana', source: '0x1111111111111111111111111111111111111111', recipient: 'Sysvar1111111111111111111111111111111111111', amount: '1', machineId: 'm', sessionId: 's', policyId: 'p' })).toThrow(/invalid Solana source/);
});
