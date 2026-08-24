import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { verifySolanaReceipt } from '../src/adapters/solana/receipts.js';
import { buildSettlementIntent } from '../src/settlement/intents.js';
import { buildSolanaSettlementIntent } from '../src/adapters/solana/settlement-intents.js';
import { createMachineJob } from '../src/jobs/lifecycle.js';
import { evaluateMachineJobPolicy } from '../src/jobs/policy.js';
import { normalizeTelemetrySnapshot, telemetryIsUsable } from '../src/telemetry/snapshot.js';
import type { MachineIdentity } from '../src/machines/identity.js';
import type { MachineJobPolicy } from '../src/jobs/policy.js';

let server: http.Server | undefined;
afterEach(() => server?.close());
const sig = '5HueCGU8rMjxEXxiPuD5BDuRaRj1hUXQG48GhYnjmQumooWcT3Yr4v7e1i4bnzK7t1Q7Fxx4E2VPu7Y9xV1r5fq';
const fromSol = '11111111111111111111111111111111';
const toSol = 'Sysvar1111111111111111111111111111111111111';

function rpc(handler: (method: string, params: unknown[]) => unknown): Promise<string> {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => body += chunk);
      req.on('end', () => {
        const parsed = JSON.parse(body);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id ?? 1, result: handler(parsed.method, parsed.params ?? []) }));
      });
    }).listen(0, '127.0.0.1', () => {
      const address = server!.address();
      if (typeof address === 'object' && address) resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function solanaTx(preBalances: Array<string | number>, postBalances: Array<string | number>, logs: string[] = []) {
  return { slot: 44, meta: { err: null, preBalances, postBalances, logMessages: logs }, transaction: { message: { accountKeys: [fromSol, toSol] } } };
}

describe('Solana transfer evidence hardening', () => {
  it('verifies fee-aware SOL transfer recipient credit while sender pays fee', async () => {
    const url = await rpc((method) => method === 'getSignatureStatuses' ? { value: [{ slot: 44, confirmations: null, confirmationStatus: 'finalized', err: null }] } : solanaTx(['10000000000', '1000000000'], ['4999995000', '6000000000'], ['Program log: Memo: fee-aware']));
    const result = await verifySolanaReceipt(sig, { rpcUrl: url, expectation: { from: fromSol, to: toSol, amount: '5', memo: 'fee-aware' } });
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.value.verified).toBe(true);
    expect(result.value.evidence?.find((field) => field.field === 'amount')).toMatchObject({ source: 'balance_delta', actual: '5000000000', matched: true });
    expect(result.value.evidence?.find((field) => field.field === 'amount')?.detail).toContain('fee gap 5000');
  });

  it('rejects fee-aware transfer when expected amount differs', async () => {
    const url = await rpc((method) => method === 'getSignatureStatuses' ? { value: [{ slot: 44, confirmations: null, confirmationStatus: 'finalized', err: null }] } : solanaTx(['10000000000', '1000000000'], ['4999995000', '6000000000']));
    const result = await verifySolanaReceipt(sig, { rpcUrl: url, expectation: { from: fromSol, to: toSol, amount: '5.000001' } });
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.value.verified).toBe(false);
    expect(result.value.mismatchReasons).toContain('amount mismatch');
  });


  it('does not verify from-only expectation from account involvement alone', async () => {
    const url = await rpc((method) => method === 'getSignatureStatuses' ? { value: [{ slot: 44, confirmations: null, confirmationStatus: 'finalized', err: null }] } : solanaTx(['10', '20'], ['10', '20']));
    const result = await verifySolanaReceipt(sig, { rpcUrl: url, expectation: { from: fromSol } });
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.value.verified).toBe(false);
    expect(result.value.expectationsMatched).toBe(false);
    expect(result.value.mismatchReasons).toContain('transfer counterparty evidence unavailable');
    expect(result.value.evidence?.some((field) => field.field === 'from' && field.source === 'balance_delta' && field.matched)).toBe(false);
  });

  it('does not verify to-only expectation from account involvement alone', async () => {
    const url = await rpc((method) => method === 'getSignatureStatuses' ? { value: [{ slot: 44, confirmations: null, confirmationStatus: 'finalized', err: null }] } : solanaTx(['10', '20'], ['10', '20']));
    const result = await verifySolanaReceipt(sig, { rpcUrl: url, expectation: { to: toSol } });
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.value.verified).toBe(false);
    expect(result.value.expectationsMatched).toBe(false);
    expect(result.value.mismatchReasons).toContain('transfer counterparty evidence unavailable');
    expect(result.value.evidence?.some((field) => field.field === 'to' && field.source === 'balance_delta' && field.matched)).toBe(false);
  });

  it('does not verify recipient-only expectation from account involvement alone', async () => {
    const url = await rpc((method) => method === 'getSignatureStatuses' ? { value: [{ slot: 44, confirmations: null, confirmationStatus: 'finalized', err: null }] } : solanaTx(['10', '20'], ['10', '20']));
    const result = await verifySolanaReceipt(sig, { rpcUrl: url, expectation: { recipient: toSol } });
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.value.verified).toBe(false);
    expect(result.value.expectationsMatched).toBe(false);
    expect(result.value.mismatchReasons).toContain('transfer counterparty evidence unavailable');
    expect(result.value.evidence?.some((field) => field.field === 'to' && field.source === 'balance_delta' && field.matched)).toBe(false);
  });

  it('does not emit matched balance-delta account evidence when transfer evidence is unavailable', async () => {
    const url = await rpc((method) => method === 'getSignatureStatuses' ? { value: [{ slot: 44, confirmations: null, confirmationStatus: 'finalized', err: null }] } : solanaTx(['10', '20'], ['10', '20']));
    for (const expectation of [{ from: fromSol }, { to: toSol }, { recipient: toSol }, { from: fromSol, to: toSol }]) {
      const result = await verifySolanaReceipt(sig, { rpcUrl: url, expectation });
      expect(result.ok).toBe(true); if (!result.ok) continue;
      expect(result.value.verified).toBe(false);
      expect(result.value.expectationsMatched).toBe(false);
      expect(result.value.evidence?.some((field) => (field.field === 'from' || field.field === 'to') && field.source === 'balance_delta' && field.matched)).toBe(false);
    }
  });

  it('does not verify settlement from account involvement without transfer credit', async () => {
    const url = await rpc((method) => method === 'getSignatureStatuses' ? { value: [{ slot: 44, confirmations: null, confirmationStatus: 'finalized', err: null }] } : solanaTx(['10', '20'], ['10', '20']));
    const result = await verifySolanaReceipt(sig, { rpcUrl: url, expectation: { from: fromSol, to: toSol, amount: '5' } });
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.value.verified).toBe(false);
    expect(result.value.mismatchReasons).toEqual(expect.arrayContaining(['transfer direction evidence unavailable', 'expected amount unavailable in transaction']));
  });

  it('does not verify from/to-only expectations from account involvement alone', async () => {
    const url = await rpc((method) => method === 'getSignatureStatuses' ? { value: [{ slot: 44, confirmations: null, confirmationStatus: 'finalized', err: null }] } : solanaTx(['10', '20'], ['10', '20']));
    const result = await verifySolanaReceipt(sig, { rpcUrl: url, expectation: { from: fromSol, to: toSol } });
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.value.verified).toBe(false);
    expect(result.value.mismatchReasons).toContain('transfer direction evidence unavailable');
  });

  it('keeps unsafe numeric lamport values unavailable instead of rounded', async () => {
    const url = await rpc((method) => method === 'getSignatureStatuses' ? { value: [{ slot: 44, confirmations: null, confirmationStatus: 'finalized', err: null }] } : solanaTx([9007199254740993, 0], [9007199249740993, 5000000000]));
    const result = await verifySolanaReceipt(sig, { rpcUrl: url, expectation: { from: fromSol, to: toSol, amount: '5' } });
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.value.verified).toBe(false);
    expect(result.value.evidence?.find((field) => field.field === 'amount')).toMatchObject({ source: 'unavailable', matched: false });
  });
});

describe('policy and telemetry hardening', () => {
  const machine: MachineIdentity = { machineId: 'robot-arm-17', walletAddress: fromSol, operatorId: 'ops', role: 'robot_arm', capabilities: ['inspection', 'delivery'] };
  const policy: MachineJobPolicy = { policyId: 'policy-1', allowedChains: ['solana'], maxAmount: '10', allowedCapabilities: ['inspection'], minBatteryPct: 20 };
  const job = createMachineJob({ jobId: 'job-policy-1', machineId: 'robot-arm-17', requiredCapabilities: ['delivery'], chain: 'solana', settlementAmount: '1', settlementAsset: 'SOL', recipient: toSol });

  it('enforces policy allowedCapabilities', () => {
    const telemetry = normalizeTelemetrySnapshot({ machineId: 'robot-arm-17', observedAt: '2026-07-14T00:00:00Z', batteryPct: 90, health: 'nominal' });
    const decision = evaluateMachineJobPolicy(machine, job, telemetry, policy, new Date('2026-07-14T00:01:00Z'));
    expect(decision.accepted).toBe(false);
    expect(decision.reasons).toContain('capability not allowed by policy');
  });

  it('rejects telemetry from a different machine', () => {
    const telemetry = normalizeTelemetrySnapshot({ machineId: 'sensor-99', observedAt: '2026-07-14T00:00:00Z', batteryPct: 90, health: 'nominal' });
    const decision = evaluateMachineJobPolicy(machine, { ...job, requiredCapabilities: ['inspection'] }, telemetry, policy, new Date('2026-07-14T00:01:00Z'));
    expect(decision.accepted).toBe(false);
    expect(decision.reasons).toContain('telemetry machine mismatch');
  });

  it('rejects future telemetry timestamps as unusable', () => {
    const telemetry = normalizeTelemetrySnapshot({ machineId: 'robot-arm-17', observedAt: '2026-07-14T00:10:00Z', batteryPct: 90, health: 'nominal' });
    expect(telemetryIsUsable(telemetry, new Date('2026-07-14T00:01:00Z'))).toBe(false);
  });

  it('rejects non-finite location and pose values', () => {
    expect(() => normalizeTelemetrySnapshot({ machineId: 'robot-arm-17', observedAt: '2026-07-14T00:00:00Z', health: 'nominal', location: { lat: Number.NaN, lon: 1 } })).toThrow(/latitude/);
    expect(() => normalizeTelemetrySnapshot({ machineId: 'robot-arm-17', observedAt: '2026-07-14T00:00:00Z', health: 'nominal', location: { lat: 1, lon: Number.NaN } })).toThrow(/longitude/);
    expect(() => normalizeTelemetrySnapshot({ machineId: 'robot-arm-17', observedAt: '2026-07-14T00:00:00Z', health: 'nominal', pose: { x: Number.NaN, y: 0 } })).toThrow(/pose.x/);
    expect(() => normalizeTelemetrySnapshot({ machineId: 'robot-arm-17', observedAt: '2026-07-14T00:00:00Z', health: 'nominal', pose: { x: 0, y: 0, yawDeg: Infinity } })).toThrow(/pose.yawDeg/);
  });
});

describe('settlement intent nonce and precision hardening', () => {
  const base = { chain: 'solana' as const, source: fromSol, recipient: toSol, amount: '1', asset: 'SOL', machineId: 'robot-arm-17', sessionId: 'session-1', policyId: 'policy-1', now: '2026-07-14T00:00:00Z' };

  it('uses nondeterministic default nonces and intent ids', () => {
    const a = buildSettlementIntent(base);
    const b = buildSettlementIntent(base);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.intentId).not.toBe(b.intentId);
  });

  it('preserves explicit nonce determinism', () => {
    const a = buildSettlementIntent({ ...base, nonce: 'explicit-nonce' });
    const b = buildSettlementIntent({ ...base, nonce: 'explicit-nonce' });
    expect(a.nonce).toBe('explicit-nonce');
    expect(a.intentId).toBe(b.intentId);
  });

  it('enforces Solana SOL and USDC decimal precision', () => {
    expect(() => buildSolanaSettlementIntent({ source: fromSol, recipient: toSol, amount: '0.0000000001', asset: 'SOL', machineId: 'drone-9', sessionId: 'session-1', policyId: 'policy-1' })).toThrow(/more than 9 decimal/);
    expect(buildSolanaSettlementIntent({ source: fromSol, recipient: toSol, amount: '0.000001', asset: 'USDC', machineId: 'drone-9', sessionId: 'session-1', policyId: 'policy-1' }).amount).toBe('0.000001');
    expect(() => buildSolanaSettlementIntent({ source: fromSol, recipient: toSol, amount: '0.0000001', asset: 'USDC', machineId: 'drone-9', sessionId: 'session-1', policyId: 'policy-1' })).toThrow(/more than 6 decimal/);
  });

});
