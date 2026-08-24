import { describe, expect, it } from 'vitest';
import { generateKeyPairSigner } from '@solana/kit';
import {
  assessTransactionLifecycle,
  checkBlockhashValidity,
  getTransactionConfirmation,
  prepareSolTransfer,
  simulateSignedTransaction,
  SolanaTransactionError,
  submitSignedTransaction,
} from '../src/server/production/transactions.js';
import {
  KNOWN_SOLANA_GENESIS_HASHES,
  resolveSolanaNetworkExpectation,
  SolanaNetworkError,
  verifySolanaNetwork,
} from '../src/server/production/network.js';
import type { RpcTransport } from '../src/transports/live-rpc.js';

const SIGNATURE = '5HueCGU8rMjxEXxiPuD5BDuRaRj1hUXQG48GhYnjmQumooWcT3Yr4v7e1i4bnzK7t1Q7Fxx4E2VPu7Y9xV1r5fq';

class Rpc implements RpcTransport {
  readonly calls: Array<{ method: string; params: unknown[] }> = [];
  constructor(private readonly results: Record<string, unknown>) {}
  async request<T>(method: string, params: unknown[] = []): Promise<T> {
    this.calls.push({ method, params });
    const result = this.results[method];
    if (result instanceof Error) throw result;
    return result as T;
  }
}

describe('Solana network expectation hardening', () => {
  it('pins known labels and rejects a contradictory configured genesis hash', () => {
    expect(resolveSolanaNetworkExpectation('devnet', undefined)).toEqual({
      cluster: 'devnet', expectedGenesisHash: KNOWN_SOLANA_GENESIS_HASHES.devnet,
    });
    expect(() => resolveSolanaNetworkExpectation('mainnet-beta', 'attacker-hash')).toThrowError(
      expect.objectContaining({ code: 'CLUSTER_GENESIS_MISMATCH' })
    );
    expect(() => resolveSolanaNetworkExpectation('custom', undefined)).toThrowError(
      expect.objectContaining({ code: 'NETWORK_CONFIGURATION_INVALID' })
    );
  });

  it('returns a safe typed network mismatch without echoing provider identities', async () => {
    const expected = resolveSolanaNetworkExpectation('devnet', undefined);
    const promise = verifySolanaNetwork(new Rpc({ getGenesisHash: 'provider-secret-value' }), expected);
    await expect(promise).rejects.toMatchObject({ code: 'NETWORK_MISMATCH', retryable: false });
    await expect(promise).rejects.not.toThrow(/provider-secret-value|EtWTRAB/u);
  });
});

describe('Solana settlement failure hardening', () => {
  it('commits the trusted settlement reference so equal transfers cannot reuse one signature', async () => {
    const source = await generateKeyPairSigner();
    const recipient = await generateKeyPairSigner();
    const rpc = new Rpc({
      getLatestBlockhash: {
        value: { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 123 },
      },
    });
    const first = await prepareSolTransfer(
      rpc,
      source.address,
      recipient.address,
      500_000_000n,
      'settlement-a'
    );
    const second = await prepareSolTransfer(
      rpc,
      source.address,
      recipient.address,
      500_000_000n,
      'settlement-b'
    );
    expect(first.base64).not.toBe(second.base64);
    expect(first.lastValidBlockHeight).toBe('123');
    expect(second.lastValidBlockHeight).toBe('123');
  });

  it('checks current block height and returns reusable validity details', async () => {
    await expect(checkBlockhashValidity(new Rpc({ getBlockHeight: 100 }), '110')).resolves.toEqual({
      status: 'valid', currentBlockHeight: '100', lastValidBlockHeight: '110', remainingBlocks: '10',
    });
    await expect(checkBlockhashValidity(new Rpc({ getBlockHeight: 111 }), '110')).resolves.toEqual({
      status: 'expired', currentBlockHeight: '111', lastValidBlockHeight: '110', expiredByBlocks: '1',
    });
  });

  it('simulates explicitly before submission and keeps validator preflight enabled', async () => {
    const rpc = new Rpc({
      getBlockHeight: 100,
      simulateTransaction: { value: { err: null, unitsConsumed: 42 } },
      sendTransaction: SIGNATURE,
    });
    await expect(submitSignedTransaction(rpc, new Uint8Array([1, 2, 3]), { lastValidBlockHeight: '110' })).resolves.toBe(SIGNATURE);
    expect(rpc.calls.map(({ method }) => method)).toEqual(['getBlockHeight', 'simulateTransaction', 'sendTransaction']);
    expect(rpc.calls[1]?.params[1]).toMatchObject({ sigVerify: true, replaceRecentBlockhash: false });
    expect(rpc.calls[2]?.params[1]).toMatchObject({ skipPreflight: false, preflightCommitment: 'confirmed' });
  });

  it('classifies simulation and preflight failures without leaking upstream details', async () => {
    const simulated = simulateSignedTransaction(new Rpc({
      simulateTransaction: { value: { err: { InstructionError: [0, 'operator-private-detail'] } } },
    }), new Uint8Array([1]));
    await expect(simulated).rejects.toMatchObject({ code: 'SIMULATION_REJECTED', retryable: false });
    await expect(simulated).rejects.not.toThrow(/operator-private-detail/u);

    const preflight = submitSignedTransaction(new Rpc({
      simulateTransaction: { value: { err: null } },
      sendTransaction: new Error('Transaction simulation failed: upstream-private-log'),
    }), new Uint8Array([1]));
    await expect(preflight).rejects.toMatchObject({ code: 'PREFLIGHT_REJECTED', retryable: false });
    await expect(preflight).rejects.not.toThrow(/upstream-private-log/u);
  });

  it('classifies blockhash expiration reported during simulation or preflight', async () => {
    await expect(simulateSignedTransaction(new Rpc({
      simulateTransaction: { value: { err: 'BlockhashNotFound: validator-private-detail' } },
    }), new Uint8Array([1]))).rejects.toMatchObject({ code: 'BLOCKHASH_EXPIRED', retryable: false });

    const preflight = submitSignedTransaction(new Rpc({
      simulateTransaction: { value: { err: null } },
      sendTransaction: new Error('block height exceeded; upstream-private-detail'),
    }), new Uint8Array([1]));
    await expect(preflight).rejects.toMatchObject({ code: 'BLOCKHASH_EXPIRED', retryable: false });
    await expect(preflight).rejects.not.toThrow(/upstream-private-detail/u);
  });

  it('blocks an expired transaction before simulation or send', async () => {
    const rpc = new Rpc({ getBlockHeight: 12, simulateTransaction: { value: { err: null } }, sendTransaction: SIGNATURE });
    await expect(submitSignedTransaction(rpc, new Uint8Array([1]), { lastValidBlockHeight: '11' })).rejects.toMatchObject({
      code: 'BLOCKHASH_EXPIRED',
    });
    expect(rpc.calls.map(({ method }) => method)).toEqual(['getBlockHeight']);
  });

  it('distinguishes pending, timeout, and provably dropped observations', () => {
    const confirmation = { state: 'pending', visibility: 'not_found' } as const;
    expect(assessTransactionLifecycle({
      confirmation, submittedAt: '2026-01-01T00:00:00.000Z', now: '2026-01-01T00:00:01.000Z', pendingTimeoutMs: 10_000,
    })).toEqual({ state: 'pending', retryAfterMs: 5_000 });
    expect(assessTransactionLifecycle({
      confirmation, submittedAt: '2026-01-01T00:00:00.000Z', now: '2026-01-01T00:00:11.000Z', pendingTimeoutMs: 10_000,
    })).toEqual({ state: 'timed_out', errorCode: 'CONFIRMATION_TIMEOUT', reconciliationRequired: true });
    expect(assessTransactionLifecycle({
      confirmation, submittedAt: '2026-01-01T00:00:00.000Z', blockhashValidity: {
        status: 'expired', currentBlockHeight: '12', lastValidBlockHeight: '11', expiredByBlocks: '1',
      },
    })).toEqual({ state: 'dropped', errorCode: 'TRANSACTION_DROPPED', mayPrepareAgain: true });
    expect(assessTransactionLifecycle({
      confirmation: { state: 'pending', visibility: 'observed' },
      submittedAt: '2026-01-01T00:00:00.000Z',
      now: '2026-01-01T00:00:01.000Z',
      blockhashValidity: { status: 'expired', currentBlockHeight: '12', lastValidBlockHeight: '11', expiredByBlocks: '1' },
    })).toEqual({ state: 'pending', retryAfterMs: 5_000 });
  });

  it('maps signature status responses without inferring confirmation', async () => {
    await expect(getTransactionConfirmation(new Rpc({
      getSignatureStatuses: { value: [null] },
    }), SIGNATURE)).resolves.toEqual({ state: 'pending', visibility: 'not_found' });
    await expect(getTransactionConfirmation(new Rpc({
      getSignatureStatuses: { value: [{ err: null, confirmationStatus: 'processed' }] },
    }), SIGNATURE)).resolves.toEqual({ state: 'pending', visibility: 'observed' });
    await expect(getTransactionConfirmation(new Rpc({
      getSignatureStatuses: { value: [{ err: { InstructionError: [0, 'private'] }, confirmationStatus: 'confirmed' }] },
    }), SIGNATURE)).resolves.toEqual({ state: 'failed', errorCode: 'ON_CHAIN_FAILURE' });
    await expect(getTransactionConfirmation(new Rpc({
      getSignatureStatuses: { value: [{ err: null, confirmationStatus: 'finalized' }] },
    }), SIGNATURE)).resolves.toEqual({ state: 'confirmed', confirmationStatus: 'finalized' });
  });

  it('uses the exported safe error class for RPC outages', async () => {
    const promise = simulateSignedTransaction(new Rpc({ simulateTransaction: new Error('secret endpoint outage') }), new Uint8Array([1]));
    await expect(promise).rejects.toBeInstanceOf(SolanaTransactionError);
    await expect(promise).rejects.toMatchObject({ code: 'SIMULATION_UNAVAILABLE', retryable: true });
    expect(SolanaNetworkError).toBeTypeOf('function');
  });
});
