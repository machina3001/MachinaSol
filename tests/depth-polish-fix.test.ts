import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { verifySolanaReceipt } from '../src/adapters/solana/receipts.js';
import { createMachineJob } from '../src/jobs/lifecycle.js';
import { evaluateMachineJobPolicy } from '../src/jobs/policy.js';
import { DEFAULT_POLICY_PROFILE, validatePolicyForIntent } from '../src/policy/profiles.js';
import { normalizeTelemetrySnapshot } from '../src/telemetry/snapshot.js';
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

function expectUnavailableFields(fields: unknown, names: string[]): void {
  const evidence = fields as Array<{ field: string; source: string; matched?: boolean }>;
  for (const name of names) {
    expect(evidence.find((field) => field.field === name || (name === 'to' && field.field === 'to'))).toMatchObject({ source: 'unavailable', matched: false });
  }
}

describe('depth polish fix pass receipt evidence', () => {
  it('marks truly absent Solana amount, memo, and metadata fields unavailable', async () => {
    const url = await rpc((method) => method === 'getSignatureStatuses' ? { value: [{ slot: 9, confirmations: null, confirmationStatus: 'finalized', err: null }] } : { slot: 9, meta: { err: null, preBalances: [10, 20], postBalances: [10, 20], logMessages: [] }, transaction: { message: { accountKeys: [fromSol, toSol] } } });
    const result = await verifySolanaReceipt(sig, { rpcUrl: url, expectation: { from: fromSol, to: toSol, amount: '0.5', memo: 'missing-memo', machineId: 'drone-missing', sessionId: 'session-missing' } });
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.value.verified).toBe(false);
    expectUnavailableFields(result.value.evidence, ['amount', 'memo', 'machineId', 'sessionId']);
    expect(result.value.mismatchReasons).toEqual(expect.arrayContaining(['expected amount unavailable in transaction', 'expected memo unavailable in transaction', 'expected machineId unavailable in transaction', 'expected sessionId unavailable in transaction']));
  });

  it('uses bigint-safe Solana lamport deltas for values above safe integer range', async () => {
    const preFrom = '9007199254740993123';
    const postFrom = '9007199254240993123';
    const preTo = '12000000000000000000';
    const postTo = '12000000000500000000';
    const url = await rpc((method) => method === 'getSignatureStatuses' ? { value: [{ slot: 11, confirmations: null, confirmationStatus: 'finalized', err: null }] } : { slot: 11, meta: { err: null, preBalances: [preFrom, preTo], postBalances: [postFrom, postTo], logMessages: ['Program log: Memo: precision-job'] }, transaction: { message: { accountKeys: [fromSol, toSol] } } });
    const result = await verifySolanaReceipt(sig, { rpcUrl: url, expectation: { from: fromSol, to: toSol, amount: '0.5', memo: 'precision-job' } });
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.value.verified).toBe(true);
    expect(result.value.evidence?.find((field) => field.field === 'amount')).toMatchObject({ source: 'balance_delta', actual: '500000000', matched: true });
  });

  it('keeps unsafe numeric Solana balances from verifying amount evidence', async () => {
    const url = await rpc((method) => method === 'getSignatureStatuses' ? { value: [{ slot: 12, confirmations: null, confirmationStatus: 'finalized', err: null }] } : { slot: 12, meta: { err: null, preBalances: [9007199254740993, 0], postBalances: [9007199254240993, 500000000], logMessages: [] }, transaction: { message: { accountKeys: [fromSol, toSol] } } });
    const result = await verifySolanaReceipt(sig, { rpcUrl: url, expectation: { from: fromSol, to: toSol, amount: '0.5' } });
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.value.verified).toBe(false);
    expect(result.value.evidence?.find((field) => field.field === 'amount')).toMatchObject({ source: 'unavailable', matched: false });
  });
});

describe('depth polish fix pass decimal policy comparisons', () => {
  it('rejects invalid job settlement decimals without floating point conversion', () => {
    expect(() => createMachineJob({ jobId: 'job-precision-1', machineId: 'robot-arm-17', requiredCapabilities: ['inspection'], chain: 'solana', settlementAmount: '0', recipient: toSol })).toThrow(/invalid settlement amount/);
    expect(() => createMachineJob({ jobId: 'job-precision-2', machineId: 'robot-arm-17', requiredCapabilities: ['inspection'], chain: 'solana', settlementAmount: '0.0000000001', recipient: toSol })).toThrow(/invalid settlement amount/);
  });

  it('compares machine job policy amounts as base units', () => {
    const machine: MachineIdentity = { machineId: 'robot-arm-17', walletAddress: fromSol, operatorId: 'ops', role: 'robot_arm', capabilities: ['inspection'] };
    const job = createMachineJob({ jobId: 'job-precision-3', machineId: 'robot-arm-17', requiredCapabilities: ['inspection'], chain: 'solana', settlementAmount: '0.100000002', settlementAsset: 'SOL', recipient: toSol });
    const telemetry = normalizeTelemetrySnapshot({ machineId: 'robot-arm-17', observedAt: '2026-07-14T00:00:00Z', batteryPct: 90, health: 'nominal' });
    const policy: MachineJobPolicy = { policyId: 'precision-policy', allowedChains: ['solana'], maxAmount: '0.100000001' };
    const decision = evaluateMachineJobPolicy(machine, job, telemetry, policy, new Date('2026-07-14T00:01:00Z'));
    expect(decision.accepted).toBe(false);
    expect(decision.reasons).toContain('settlement amount exceeds policy limit');
  });

  it('compares profile limits without Number precision loss', () => {
    const policy = { ...DEFAULT_POLICY_PROFILE, maxAmountPerIntent: '0.100000001' };
    expect(validatePolicyForIntent(policy, { chain: 'solana', asset: 'SOL', amount: '0.100000001', role: 'robot' })).not.toContain('amount exceeds policy limit 0.100000001');
    expect(validatePolicyForIntent(policy, { chain: 'solana', asset: 'SOL', amount: '0.100000002', role: 'robot' })).toContain('amount exceeds policy limit 0.100000001');
  });
});

describe('depth polish fix pass reusable finality and limit helpers', () => {
  it('normalizes Solana finality without inventing deeper status', async () => {
    const { normalizeSolanaFinality } = await import('../src/adapters/shared/finality.js');
    expect(normalizeSolanaFinality('processed', true)).toBe('processed');
    expect(normalizeSolanaFinality(undefined, true)).toBe('confirmed');
    expect(normalizeSolanaFinality(undefined, false)).toBe('pending');
  });

  it('evaluates settlement limits with rail decimals and base-unit outputs', async () => {
    const { evaluateSettlementAmountLimit, amountWithinLimit, amountExceedsLimit } = await import('../src/settlement/policy-limits.js');
    const accepted = evaluateSettlementAmountLimit({ chain: 'solana', asset: 'SOL', amount: '0.000000001', maxAmount: '0.000000001' });
    expect(accepted).toMatchObject({ accepted: true, amountBaseUnits: '1', maxBaseUnits: '1', decimals: 9 });
    const rejected = evaluateSettlementAmountLimit({ chain: 'solana', asset: 'SOL', amount: '0.100000002', maxAmount: '0.100000001' });
    expect(rejected.accepted).toBe(false);
    expect(rejected.reasons).toContain('amount exceeds policy limit 0.100000001');
    expect(amountWithinLimit('1.000001', '1.000001', 'solana', 'USDC')).toBe(true);
    expect(amountExceedsLimit('1.000002', '1.000001', 'solana', 'USDC')).toBe(true);
  });
});

describe('depth polish fix pass receipt expectation summary helper', () => {
  it('summarizes unavailable expected fields for SDK callers', async () => {
    const { summarizeReceiptExpectationEvidence, receiptEvidenceCoverageLabel } = await import('../src/adapters/shared/expectation-summary.js');
    const url = await rpc((method) => method === 'getSignatureStatuses' ? { value: [{ slot: 13, confirmations: null, confirmationStatus: 'finalized', err: null }] } : { slot: 13, meta: { err: null, preBalances: [1, 1], postBalances: [1, 1], logMessages: [] }, transaction: { message: { accountKeys: [fromSol, toSol] } } });
    const expectation = { amount: '0.5', memo: 'memo-missing', machineId: 'machine-missing', sessionId: 'session-missing' };
    const result = await verifySolanaReceipt(sig, { rpcUrl: url, expectation });
    expect(result.ok).toBe(true); if (!result.ok) return;
    const summary = summarizeReceiptExpectationEvidence(expectation, result.value.evidence ?? []);
    expect(summary.matched).toBe(false);
    expect(summary.unavailableFields.sort()).toEqual(['amount', 'machineId', 'memo', 'sessionId'].sort());
    expect(summary.nativeFields).toEqual([]);
    expect(summary.fixtureFields).toEqual([]);
    expect(receiptEvidenceCoverageLabel(summary)).toBe('unavailable');
  });

  it('separates native transaction amount evidence from fixture envelope metadata', async () => {
    const { summarizeReceiptExpectationEvidence } = await import('../src/adapters/shared/expectation-summary.js');
    const expectation = { amount: '0.5', memo: 'job:drone-inspection-9', machineId: 'drone-9', sessionId: 'mfi_solana_fixture_session' };
    const result = await verifySolanaReceipt(sig, { fixture: true, expectation });
    expect(result.ok).toBe(true); if (!result.ok) return;
    const summary = summarizeReceiptExpectationEvidence(expectation, result.value.evidence ?? []);
    expect(summary.matched).toBe(true);
    expect(summary.fixtureFields.sort()).toEqual(['amount', 'machineId', 'memo', 'sessionId'].sort());
    expect(summary.nativeFields).toEqual([]);
    const { receiptEvidenceCoverageLabel } = await import('../src/adapters/shared/expectation-summary.js');
    expect(receiptEvidenceCoverageLabel(summary)).toBe('complete');
  });

  it('throws a compact unavailable-field error for failed expectations', async () => {
    const { assertExpectedFieldsAvailable } = await import('../src/adapters/shared/expectation-summary.js');
    const result = await verifySolanaReceipt(sig, { fixture: false, rpcUrl: await rpc((method) => method === 'getSignatureStatuses' ? { value: [{ slot: 13, confirmations: null, confirmationStatus: 'finalized', err: null }] } : { slot: 13, meta: { err: null, preBalances: [1, 1], postBalances: [1, 1], logMessages: [] }, transaction: { message: { accountKeys: [fromSol, toSol] } } }), expectation: { amount: '0.5', memo: 'missing' } });
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(() => assertExpectedFieldsAvailable({ amount: '0.5', memo: 'missing' }, result.value.evidence ?? [])).toThrow(/unavailable: amount, memo/);
  });
});
