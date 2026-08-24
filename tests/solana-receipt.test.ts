import { expect, it } from 'vitest';
import { verifySolanaReceipt } from '../src/adapters/solana/receipts.js';
import { decodeBase58, isSolanaAddress, isSolanaSignature } from '../src/adapters/solana/validation.js';
import { FixtureRpcTransport } from '../src/transports/fixture-rpc.js';

const sig = '5HueCGU8rMjxEXxiPuD5BDuRaRj1hUXQG48GhYnjmQumooWcT3Yr4v7e1i4bnzK7t1Q7Fxx4E2VPu7Y9xV1r5fq';

it('decodes Solana public keys to expected byte lengths', () => {
  expect(decodeBase58('11111111111111111111111111111111')).toHaveLength(32);
  expect(isSolanaAddress('11111111111111111111111111111111')).toBe(true);
});

it('decodes Solana signatures to 64 bytes', () => {
  expect(isSolanaSignature(sig)).toBe(true);
  expect(() => decodeBase58('0bad')).toThrow(/base58/);
});

it('rejects oversized Solana values before base58 decoding', () => {
  expect(isSolanaAddress('1'.repeat(45))).toBe(false);
  expect(isSolanaSignature('1'.repeat(89))).toBe(false);
  expect(isSolanaSignature('1'.repeat(50_000))).toBe(false);
});

it('does not verify fixture account involvement without transfer evidence', async () => {
  const result = await verifySolanaReceipt(sig, { fixture: true, expectation: { from: '11111111111111111111111111111111', to: 'Sysvar1111111111111111111111111111111111111', memo: 'job:drone-inspection-9', machineId: 'drone-9', sessionId: 'mfi_solana_fixture_session' } });
  expect(result.ok).toBe(true); if (!result.ok) return;
  expect(result.value.verified).toBe(false);
  expect(result.value.finality).toBe('finalized');
  expect(result.value.mismatchReasons).toContain('transfer direction evidence unavailable');
});

it('returns missing expected accounts', async () => {
  const result = await verifySolanaReceipt(sig, { fixture: true, expectation: { to: 'Config1111111111111111111111111111111111111' } });
  expect(result.ok && result.value.expectationsMatched).toBe(false);
});

it('handles null status responses', async () => {
  const transport = new FixtureRpcTransport({ getSignatureStatuses: { value: [null] } });
  const result = await verifySolanaReceipt(sig, { transport });
  expect(result.ok && result.value.status).toBe('not_found');
});

it('requires confirmed finality by default before reporting verified', async () => {
  const transport = new FixtureRpcTransport({
    getSignatureStatuses: { value: [{ slot: 9, confirmationStatus: 'processed', confirmations: 0, err: null }] },
    getTransaction: { slot: 9, meta: { err: null }, transaction: { message: { accountKeys: [] } } },
  });
  const result = await verifySolanaReceipt(sig, { transport });
  expect(result.ok && result.value.verified).toBe(false);
  expect(result.ok && result.value.mismatchReasons).toContain('minimum finality confirmed not reached (processed)');

  const processedAllowed = await verifySolanaReceipt(sig, { transport, minimumFinality: 'processed' });
  expect(processedAllowed.ok && processedAllowed.value.verified).toBe(true);
});
