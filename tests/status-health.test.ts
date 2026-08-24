import { expect, it } from 'vitest';
import { checkChainStatus } from '../src/status/chain-status.js';
import { FixtureRpcTransport } from '../src/transports/fixture-rpc.js';

it('always reports the solana rail', async () => {
  const result = await checkChainStatus({ chain: 'solana', fixture: true });
  expect(result.chain).toBe('solana');
});

it('returns deterministic fixture health', async () => {
  const result = await checkChainStatus({ chain: 'solana', fixture: true });
  expect(result.ok).toBe(true);
  expect(result.mode).toBe('fixture');
  expect(result.rpcReachable).toBe(true);
  expect(result.latencyMs).toBe(0);
  expect(result.details.rpcUrl).toBe('fixture');
});

it('fixture RPC transport returns missing methods', async () => {
  const transport = new FixtureRpcTransport({ getVersion: { 'solana-core': '1.18.0' } });
  await expect(transport.request('missing')).rejects.toThrow(/missing/);
});

it('reports Solana live-read reachability without claiming cluster identity from getVersion alone', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { 'solana-core': '1.18.0', 'feature-set': 123 } }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  const result = await checkChainStatus({ chain: 'solana', rpcUrl: 'https://example.invalid', timeoutMs: 100 });
  globalThis.fetch = original;
  expect(result.ok).toBe(true);
  expect(result.rpcReachable).toBe(true);
  expect(result.chainMatched).toBe(false);
  expect(result.details.networkVerification).toBe('unavailable');
});
