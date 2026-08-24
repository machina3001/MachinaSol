import {
  address, appendTransactionMessageInstruction, assertIsFullySignedTransaction, blockhash,
  compileTransaction, createNoopSigner, createTransactionMessage, getBase64EncodedWireTransaction,
  getSignatureFromTransaction, getTransactionDecoder, pipe, setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Instruction,
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import { isSolanaAddress, isSolanaSignature } from '../../adapters/solana/validation.js';
import type { RpcTransport } from '../../transports/live-rpc.js';

export const MAX_SIGNED_TRANSACTION_BYTES = 1232;
export const DEFAULT_CONFIRMATION_TIMEOUT_MS = 120_000;

export type SolanaTransactionErrorCode =
  | 'INVALID_SETTLEMENT_ADDRESS' | 'INVALID_SETTLEMENT_AMOUNT' | 'INVALID_SETTLEMENT_REFERENCE' | 'INVALID_BLOCKHASH_RESPONSE'
  | 'BLOCKHEIGHT_UNAVAILABLE' | 'BLOCKHASH_EXPIRED' | 'SIGNED_TRANSACTION_TOO_LARGE'
  | 'INVALID_SIGNED_TRANSACTION' | 'TRANSACTION_MESSAGE_MISMATCH' | 'TRANSACTION_NOT_FULLY_SIGNED'
  | 'INVALID_TRANSACTION_SIGNATURE' | 'SIMULATION_REJECTED' | 'SIMULATION_UNAVAILABLE'
  | 'PREFLIGHT_REJECTED' | 'SUBMISSION_UNAVAILABLE' | 'INVALID_SUBMISSION_RESPONSE'
  | 'CONFIRMATION_UNAVAILABLE' | 'INVALID_CONFIRMATION_RESPONSE';

const SAFE_MESSAGES: Readonly<Record<SolanaTransactionErrorCode, string>> = {
  INVALID_SETTLEMENT_ADDRESS: 'settlement wallets are invalid',
  INVALID_SETTLEMENT_AMOUNT: 'settlement amount is invalid',
  INVALID_SETTLEMENT_REFERENCE: 'settlement reference is invalid',
  INVALID_BLOCKHASH_RESPONSE: 'Solana RPC returned an invalid blockhash response',
  BLOCKHEIGHT_UNAVAILABLE: 'current Solana block height is unavailable',
  BLOCKHASH_EXPIRED: 'the prepared transaction blockhash has expired; prepare a new transaction',
  SIGNED_TRANSACTION_TOO_LARGE: 'signed transaction exceeds the Solana packet size',
  INVALID_SIGNED_TRANSACTION: 'signed transaction is malformed',
  TRANSACTION_MESSAGE_MISMATCH: 'signed transaction does not match the server-prepared settlement',
  TRANSACTION_NOT_FULLY_SIGNED: 'transaction is not fully signed',
  INVALID_TRANSACTION_SIGNATURE: 'transaction signature is invalid',
  SIMULATION_REJECTED: 'Solana transaction simulation rejected the transaction',
  SIMULATION_UNAVAILABLE: 'Solana transaction simulation is temporarily unavailable',
  PREFLIGHT_REJECTED: 'Solana RPC preflight rejected the transaction',
  SUBMISSION_UNAVAILABLE: 'Solana transaction submission is temporarily unavailable',
  INVALID_SUBMISSION_RESPONSE: 'Solana RPC returned an invalid submission response',
  CONFIRMATION_UNAVAILABLE: 'Solana transaction status is temporarily unavailable',
  INVALID_CONFIRMATION_RESPONSE: 'Solana RPC returned an invalid transaction status response',
};

/** Client-safe error: message and code never include upstream response text or logs. */
export class SolanaTransactionError extends Error {
  constructor(
    readonly code: SolanaTransactionErrorCode,
    readonly retryable = false,
    cause?: unknown
  ) {
    super(SAFE_MESSAGES[code], cause === undefined ? undefined : { cause });
    this.name = 'SolanaTransactionError';
  }
}

interface LatestBlockhashResult { value?: { blockhash?: unknown; lastValidBlockHeight?: unknown }; }
interface SimulationRpcResult { value?: { err?: unknown; unitsConsumed?: unknown }; }
interface SignatureStatusesRpcResult { value?: readonly unknown[]; }

export interface PreparedTransaction { base64: string; lastValidBlockHeight: string; }
export interface SimulationSuccess { ok: true; unitsConsumed?: number; }
export type BlockhashValidity =
  | { status: 'valid'; currentBlockHeight: string; lastValidBlockHeight: string; remainingBlocks: string }
  | { status: 'expired'; currentBlockHeight: string; lastValidBlockHeight: string; expiredByBlocks: string };
export type TransactionConfirmation =
  | { state: 'pending'; visibility: 'not_found' | 'observed' }
  | { state: 'confirmed'; confirmationStatus: 'confirmed' | 'finalized' }
  | { state: 'failed'; errorCode: 'ON_CHAIN_FAILURE' };
export type TransactionLifecycleAssessment =
  | { state: 'pending'; retryAfterMs: number }
  | { state: 'timed_out'; errorCode: 'CONFIRMATION_TIMEOUT'; reconciliationRequired: true }
  | { state: 'dropped'; errorCode: 'TRANSACTION_DROPPED'; mayPrepareAgain: true }
  | { state: 'confirmed' }
  | { state: 'failed'; errorCode: 'ON_CHAIN_FAILURE' };

const errorText = (error: unknown): string => {
  if (error instanceof Error) return `${error.name} ${error.message}`.toLowerCase();
  try { return JSON.stringify(error).toLowerCase(); } catch { return ''; }
};
const isExpiredError = (error: unknown): boolean => {
  const text = errorText(error);
  return text.includes('blockhashnotfound') || text.includes('blockhash not found') ||
    text.includes('block height exceeded') || text.includes('blockhash expired');
};
const isPreflightError = (error: unknown): boolean => {
  const text = errorText(error);
  return text.includes('preflight') || text.includes('simulation failed') ||
    text.includes('instructionerror') || text.includes('instruction error');
};
const parseHeight = (value: unknown, code: 'INVALID_BLOCKHASH_RESPONSE' | 'BLOCKHEIGHT_UNAVAILABLE'): bigint => {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === 'string' && /^\d+$/u.test(value)) return BigInt(value);
  throw new SolanaTransactionError(code, code === 'BLOCKHEIGHT_UNAVAILABLE');
};

export async function prepareSolTransfer(
  transport: RpcTransport,
  sourceWallet: string,
  recipientWallet: string,
  amountLamports: bigint,
  settlementReference: string
): Promise<PreparedTransaction> {
  if (!isSolanaAddress(sourceWallet) || !isSolanaAddress(recipientWallet)) {
    throw new SolanaTransactionError('INVALID_SETTLEMENT_ADDRESS');
  }
  if (amountLamports <= 0n) throw new SolanaTransactionError('INVALID_SETTLEMENT_AMOUNT');
  const reference = settlementReference.trim();
  if (!/^[A-Za-z0-9:_-]{1,128}$/u.test(reference)) {
    throw new SolanaTransactionError('INVALID_SETTLEMENT_REFERENCE');
  }
  let latest: LatestBlockhashResult;
  try {
    latest = await transport.request<LatestBlockhashResult>('getLatestBlockhash', [{ commitment: 'confirmed' }]);
  } catch (error) {
    throw new SolanaTransactionError('INVALID_BLOCKHASH_RESPONSE', true, error);
  }
  const value = latest.value;
  if (!value || typeof value.blockhash !== 'string' || value.blockhash.trim() === '') {
    throw new SolanaTransactionError('INVALID_BLOCKHASH_RESPONSE');
  }
  const lastValid = parseHeight(value.lastValidBlockHeight, 'INVALID_BLOCKHASH_RESPONSE');
  try {
    const source = address(sourceWallet);
    const recipient = address(recipientWallet);
    // The trusted settlement identifier is committed to the signed message.
    // Equal source/recipient/amount transfers prepared under the same blockhash
    // must still produce different message bytes and signatures.
    const memoInstruction: Instruction = {
      programAddress: address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
      data: Uint8Array.from(Buffer.from(`machinefi:settlement:${reference}`, 'utf8')),
    };
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (item) => setTransactionMessageFeePayer(source, item),
      (item) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash(value.blockhash as string), lastValidBlockHeight: lastValid }, item),
      (item) => appendTransactionMessageInstruction(memoInstruction, item),
      (item) => appendTransactionMessageInstruction(
        getTransferSolInstruction({ source: createNoopSigner(source), destination: recipient, amount: amountLamports }), item
      )
    );
    return { base64: getBase64EncodedWireTransaction(compileTransaction(message)), lastValidBlockHeight: lastValid.toString() };
  } catch (error) {
    throw new SolanaTransactionError('INVALID_BLOCKHASH_RESPONSE', false, error);
  }
}

export function inspectSignedTransaction(signedBase64: string, expectedUnsignedBase64: string): { signature: string; bytes: Uint8Array } {
  if (signedBase64.length > Math.ceil(MAX_SIGNED_TRANSACTION_BYTES * 4 / 3) + 8) {
    throw new SolanaTransactionError('SIGNED_TRANSACTION_TOO_LARGE');
  }
  const bytes = Buffer.from(signedBase64, 'base64');
  if (bytes.length === 0) throw new SolanaTransactionError('INVALID_SIGNED_TRANSACTION');
  if (bytes.length > MAX_SIGNED_TRANSACTION_BYTES) throw new SolanaTransactionError('SIGNED_TRANSACTION_TOO_LARGE');
  let signed: ReturnType<ReturnType<typeof getTransactionDecoder>['decode']>;
  let unsigned: ReturnType<ReturnType<typeof getTransactionDecoder>['decode']>;
  try {
    const decoder = getTransactionDecoder();
    signed = decoder.decode(bytes);
    unsigned = decoder.decode(Buffer.from(expectedUnsignedBase64, 'base64'));
  } catch (error) {
    throw new SolanaTransactionError('INVALID_SIGNED_TRANSACTION', false, error);
  }
  if (!Buffer.from(signed.messageBytes).equals(Buffer.from(unsigned.messageBytes))) {
    throw new SolanaTransactionError('TRANSACTION_MESSAGE_MISMATCH');
  }
  try { assertIsFullySignedTransaction(signed); }
  catch (error) { throw new SolanaTransactionError('TRANSACTION_NOT_FULLY_SIGNED', false, error); }
  const signature = String(getSignatureFromTransaction(signed));
  if (!isSolanaSignature(signature)) throw new SolanaTransactionError('INVALID_TRANSACTION_SIGNATURE');
  return { signature, bytes: Uint8Array.from(bytes) };
}

/** Queries current chain height; wall-clock time is not used to infer blockhash validity. */
export async function checkBlockhashValidity(transport: RpcTransport, lastValidBlockHeight: string | bigint): Promise<BlockhashValidity> {
  const lastValid = parseHeight(typeof lastValidBlockHeight === 'bigint' ? lastValidBlockHeight.toString() : lastValidBlockHeight, 'INVALID_BLOCKHASH_RESPONSE');
  let raw: unknown;
  try { raw = await transport.request<unknown>('getBlockHeight', [{ commitment: 'confirmed' }]); }
  catch (error) { throw new SolanaTransactionError('BLOCKHEIGHT_UNAVAILABLE', true, error); }
  const current = parseHeight(raw, 'BLOCKHEIGHT_UNAVAILABLE');
  return current > lastValid
    ? { status: 'expired', currentBlockHeight: current.toString(), lastValidBlockHeight: lastValid.toString(), expiredByBlocks: (current - lastValid).toString() }
    : { status: 'valid', currentBlockHeight: current.toString(), lastValidBlockHeight: lastValid.toString(), remainingBlocks: (lastValid - current).toString() };
}

/** Explicit signature-verifying simulation without replacing the prepared blockhash. */
export async function simulateSignedTransaction(transport: RpcTransport, bytes: Uint8Array): Promise<SimulationSuccess> {
  let result: SimulationRpcResult;
  try {
    result = await transport.request<SimulationRpcResult>('simulateTransaction', [Buffer.from(bytes).toString('base64'), {
      encoding: 'base64', commitment: 'confirmed', sigVerify: true, replaceRecentBlockhash: false,
    }]);
  } catch (error) {
    if (isExpiredError(error)) throw new SolanaTransactionError('BLOCKHASH_EXPIRED', false, error);
    throw new SolanaTransactionError('SIMULATION_UNAVAILABLE', true, error);
  }
  if (!result.value || !Object.prototype.hasOwnProperty.call(result.value, 'err')) {
    throw new SolanaTransactionError('SIMULATION_UNAVAILABLE', true);
  }
  if (result.value.err !== null) {
    if (isExpiredError(result.value.err)) throw new SolanaTransactionError('BLOCKHASH_EXPIRED');
    throw new SolanaTransactionError('SIMULATION_REJECTED');
  }
  const units = result.value.unitsConsumed;
  return typeof units === 'number' && Number.isSafeInteger(units) && units >= 0 ? { ok: true, unitsConsumed: units } : { ok: true };
}

export interface SubmitTransactionOptions { lastValidBlockHeight?: string | bigint; }

/** Simulates first, retains validator preflight, and never treats submission as confirmation. */
export async function submitSignedTransaction(
  transport: RpcTransport, bytes: Uint8Array, options: SubmitTransactionOptions = {}
): Promise<string> {
  if (options.lastValidBlockHeight !== undefined) {
    const validity = await checkBlockhashValidity(transport, options.lastValidBlockHeight);
    if (validity.status === 'expired') throw new SolanaTransactionError('BLOCKHASH_EXPIRED');
  }
  await simulateSignedTransaction(transport, bytes);
  let signature: unknown;
  try {
    signature = await transport.request<unknown>('sendTransaction', [Buffer.from(bytes).toString('base64'), {
      encoding: 'base64', preflightCommitment: 'confirmed', skipPreflight: false, maxRetries: 3,
    }]);
  } catch (error) {
    if (isExpiredError(error)) throw new SolanaTransactionError('BLOCKHASH_EXPIRED', false, error);
    if (isPreflightError(error)) throw new SolanaTransactionError('PREFLIGHT_REJECTED', false, error);
    throw new SolanaTransactionError('SUBMISSION_UNAVAILABLE', true, error);
  }
  if (typeof signature !== 'string' || !isSolanaSignature(signature)) throw new SolanaTransactionError('INVALID_SUBMISSION_RESPONSE');
  return signature;
}

export async function getTransactionConfirmation(transport: RpcTransport, signature: string): Promise<TransactionConfirmation> {
  if (!isSolanaSignature(signature)) throw new SolanaTransactionError('INVALID_TRANSACTION_SIGNATURE');
  let result: SignatureStatusesRpcResult;
  try {
    result = await transport.request<SignatureStatusesRpcResult>('getSignatureStatuses', [[signature], { searchTransactionHistory: true }]);
  } catch (error) {
    throw new SolanaTransactionError('CONFIRMATION_UNAVAILABLE', true, error);
  }
  if (!Array.isArray(result.value) || result.value.length !== 1) throw new SolanaTransactionError('INVALID_CONFIRMATION_RESPONSE', true);
  const status = result.value[0];
  if (status === null) return { state: 'pending', visibility: 'not_found' };
  if (typeof status !== 'object' || status === undefined) throw new SolanaTransactionError('INVALID_CONFIRMATION_RESPONSE', true);
  const record = status as { err?: unknown; confirmationStatus?: unknown };
  if (record.err !== null && record.err !== undefined) return { state: 'failed', errorCode: 'ON_CHAIN_FAILURE' };
  if (record.confirmationStatus === 'confirmed' || record.confirmationStatus === 'finalized') {
    return { state: 'confirmed', confirmationStatus: record.confirmationStatus };
  }
  return { state: 'pending', visibility: 'observed' };
}

/** Timeout is unknown/reconcilable; only not-found plus expired is classified as dropped. */
export function assessTransactionLifecycle(input: {
  confirmation: TransactionConfirmation;
  submittedAt: string | Date;
  now?: string | Date;
  pendingTimeoutMs?: number;
  blockhashValidity?: BlockhashValidity;
}): TransactionLifecycleAssessment {
  if (input.confirmation.state === 'confirmed') return { state: 'confirmed' };
  if (input.confirmation.state === 'failed') return { state: 'failed', errorCode: 'ON_CHAIN_FAILURE' };
  if (input.confirmation.visibility === 'not_found' && input.blockhashValidity?.status === 'expired') {
    return { state: 'dropped', errorCode: 'TRANSACTION_DROPPED', mayPrepareAgain: true };
  }
  const submittedAt = new Date(input.submittedAt).getTime();
  const now = input.now === undefined ? Date.now() : new Date(input.now).getTime();
  const timeout = input.pendingTimeoutMs ?? DEFAULT_CONFIRMATION_TIMEOUT_MS;
  if (!Number.isFinite(submittedAt) || !Number.isFinite(now) || !Number.isSafeInteger(timeout) || timeout <= 0) {
    throw new TypeError('transaction lifecycle timing inputs are invalid');
  }
  const elapsed = Math.max(0, now - submittedAt);
  return elapsed >= timeout
    ? { state: 'timed_out', errorCode: 'CONFIRMATION_TIMEOUT', reconciliationRequired: true }
    : { state: 'pending', retryAfterMs: Math.min(5_000, timeout - elapsed) };
}

/** Compatibility wrapper; new callers should retain the richer confirmation result. */
export async function confirmationState(transport: RpcTransport, signature: string): Promise<'pending' | 'confirmed' | 'failed'> {
  return (await getTransactionConfirmation(transport, signature)).state;
}
