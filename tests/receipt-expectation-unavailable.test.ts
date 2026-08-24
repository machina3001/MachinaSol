import { expect, it } from 'vitest';
import { verifySolanaReceipt } from '../src/adapters/solana/receipts.js';
import { LiveRpcTransport } from '../src/transports/live-rpc.js';

const sig = '5HueCGU8rMjxEXxiPuD5BDuRaRj1hUXQG48GhYnjmQumooWcT3Yr4v7e1i4bnzK7t1Q7Fxx4E2VPu7Y9xV1r5fq';

it('marks Solana missing expected fields as unavailable mismatches', async () => {
  const result = await verifySolanaReceipt(sig, { fixture: true, expectation: { amount: '0.7', memo: 'missing', machineId: 'drone-9', sessionId: 'missing-session' } });
  expect(result.ok).toBe(true); if (!result.ok) return;
  expect(result.value.verified).toBe(false);
  expect(result.value.mismatchReasons).toEqual(expect.arrayContaining(['amount mismatch', 'memo mismatch', 'session id mismatch']));
});

it('reports a signature absent from the fixture source as not found', async () => {
  const result = await verifySolanaReceipt('4vJ9JU1bJJE96FbKmEvmiUCJFuFvdvJvJjyRSMqRbGnJ2rF7WdBjKFaKdVEJEqGqPjkSKtZKQhZhcWFxJvQnBqPr', { fixture: true });
  expect(result.ok).toBe(true); if (!result.ok) return;
  expect(result.value.found).toBe(false);
  expect(result.value.verified).toBe(false);
  expect(result.value.status).toBe('not_found');
});

it('throws on malformed JSON-RPC responses without result', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1 }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  await expect(new LiveRpcTransport('https://example.invalid').request('getVersion')).rejects.toThrow(/malformed JSON-RPC response/);
  globalThis.fetch = original;
});

it('throws JSON-RPC error messages', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'provider failed' } }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  await expect(new LiveRpcTransport('https://example.invalid').request('getVersion')).rejects.toThrow(/provider failed/);
  globalThis.fetch = original;
});

it('rejects unsupported Solana asset expectations instead of matching amount alone', async () => {
  const result = await verifySolanaReceipt(sig, { fixture: true, expectation: { amount: '0.5', asset: 'USDC' } });
  expect(result.ok).toBe(true); if (!result.ok) return;
  expect(result.value.verified).toBe(false);
  expect(result.value.mismatchReasons).toContain('asset USDC is not supported by native Solana SOL verification');
  expect(result.value.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'asset', source: 'unavailable', matched: false })]));
});

it('rejects malformed signatures and EVM-shaped ids as invalid input', async () => {
  const badSignature = await verifySolanaReceipt('not-a-signature', { fixture: true });
  expect(badSignature.ok).toBe(false);
  if (badSignature.ok) return;
  expect(badSignature.error.code).toBe('invalid_input');

  const evmHash = await verifySolanaReceipt('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', { fixture: true });
  expect(evmHash.ok).toBe(false);
  if (evmHash.ok) return;
  expect(evmHash.error.code).toBe('invalid_input');
});
