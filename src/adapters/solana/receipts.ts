import { getFixtureReceipt } from '../../transports/fixture.js';
import { err, ok, type RuntimeResult } from '../shared/result.js';
import type { ReceiptExpectation, ReceiptVerification } from '../shared/types.js';
import { evidence, splitEvidence, type ReceiptEvidenceField } from '../shared/evidence.js';
import { baseUnitsEqualDecimal, subtractBaseUnits } from '../../settlement/amounts.js';
import { createSolanaTransport, type SolanaProviderOptions } from './provider.js';
import { isSolanaAddress, isSolanaSignature } from './validation.js';
import { finalityMeetsMinimum, normalizeSolanaFinality } from '../shared/finality.js';
interface StatusValue { slot?: number; confirmationStatus?: 'processed' | 'confirmed' | 'finalized'; err?: unknown; confirmations?: number | null; }
interface SolanaTransaction { slot?: number; blockTime?: number | null; meta?: { err?: unknown; preBalances?: Array<number | string>; postBalances?: Array<number | string>; logMessages?: string[] | null } | null; transaction?: { message?: { accountKeys?: Array<string | { pubkey?: string }> } }; memo?: string | undefined; machineId?: string | undefined; sessionId?: string; amount?: string; }
export interface SolanaVerifyOptions extends SolanaProviderOptions { fixture?: boolean | undefined; searchTransactionHistory?: boolean | undefined; expectation?: ReceiptExpectation | undefined; minimumFinality?: 'processed' | 'confirmed' | 'finalized' | undefined; }
function accountKeys(tx: SolanaTransaction): string[] { return (tx.transaction?.message?.accountKeys ?? []).map((key) => typeof key === 'string' ? key : key.pubkey ?? '').filter(Boolean); }
function memoFromLogs(tx: SolanaTransaction | undefined): string | undefined { return tx?.meta?.logMessages?.map((line) => /Memo(?: \(len \d+\))?:\s*(.+)$/i.exec(line)?.[1]?.trim()).find(Boolean); }
interface SolTransferEvidence { senderDebit: bigint; recipientCredit: bigint; feeGap: bigint; }
function solTransferEvidence(tx: SolanaTransaction, from?: string, to?: string): SolTransferEvidence | undefined { const keys = accountKeys(tx); const pre = tx.meta?.preBalances; const post = tx.meta?.postBalances; if (!pre || !post || !from || !to || from === to) return undefined; const fromIndex = keys.indexOf(from); const toIndex = keys.indexOf(to); if (fromIndex < 0 || toIndex < 0) return undefined; try { const senderDebit = subtractBaseUnits(pre[fromIndex]!, post[fromIndex]!); const recipientCredit = subtractBaseUnits(post[toIndex]!, pre[toIndex]!); if (senderDebit > 0n && recipientCredit > 0n && senderDebit >= recipientCredit) return { senderDebit, recipientCredit, feeGap: senderDebit - recipientCredit }; return undefined; } catch { return undefined; } }
function compareExpectation(tx: SolanaTransaction | undefined, status: 'success' | 'failed' | 'pending', expectation?: ReceiptExpectation, fixture?: boolean): { matched: boolean; reasons: string[]; fields: ReceiptEvidenceField[] } {
  const reasons: string[] = [];
  const fields: ReceiptEvidenceField[] = [evidence('status','native_receipt',{ actual: status, matched: !expectation?.status || expectation.status === status })];
  if (!expectation) return { matched: true, reasons, fields };
  const keys = tx ? accountKeys(tx) : [];
  if (expectation.status && expectation.status !== status) reasons.push(`status expected ${expectation.status} got ${status}`);
  const expectedTo = expectation.to ?? expectation.recipient;
  const transfer = tx ? solTransferEvidence(tx, expectation.from, expectedTo) : undefined;
  const hasTransferCounterparty = Boolean(expectation.from && expectedTo);
  const addReason = (reason: string) => { if (!reasons.includes(reason)) reasons.push(reason); };
  if (expectation.from) {
    if (!tx) { reasons.push('expected from unavailable in transaction'); fields.push(evidence('from','unavailable',{ expected: expectation.from, matched: false })); }
    else if (!keys.includes(expectation.from)) { reasons.push('from account not found in transaction'); fields.push(evidence('accountInvolvement','transaction',{ expected: expectation.from, matched: false, detail: 'account involvement only, not transfer settlement' })); }
    else if (!hasTransferCounterparty) { addReason('transfer counterparty evidence unavailable'); fields.push(evidence('accountInvolvement','transaction',{ expected: expectation.from, matched: false, detail: 'account involvement only, not transfer settlement' })); }
    else if (!transfer) { addReason('transfer direction evidence unavailable'); fields.push(evidence('accountInvolvement','transaction',{ expected: expectation.from, matched: false, detail: 'account involvement only, not transfer settlement' })); }
    else { fields.push(evidence('from','balance_delta',{ expected: expectation.from, matched: true, detail: 'sender debit supports transfer direction' })); }
  }
  if (expectedTo) {
    if (!tx) { reasons.push('expected recipient unavailable in transaction'); fields.push(evidence('to','unavailable',{ expected: expectedTo, matched: false })); }
    else if (!keys.includes(expectedTo)) { reasons.push('recipient account not found in transaction'); fields.push(evidence('accountInvolvement','transaction',{ expected: expectedTo, matched: false, detail: 'account involvement only, not transfer settlement' })); }
    else if (!hasTransferCounterparty) { addReason('transfer counterparty evidence unavailable'); fields.push(evidence('accountInvolvement','transaction',{ expected: expectedTo, matched: false, detail: 'account involvement only, not transfer settlement' })); }
    else if (!transfer) { addReason('transfer direction evidence unavailable'); fields.push(evidence('accountInvolvement','transaction',{ expected: expectedTo, matched: false, detail: 'account involvement only, not transfer settlement' })); }
    else { fields.push(evidence('to','balance_delta',{ expected: expectedTo, matched: true, detail: 'recipient credit supports transfer direction' })); }
  }
  if (expectation.asset) {
    const matched = expectation.asset.toUpperCase() === 'SOL';
    if (!matched) reasons.push(`asset ${expectation.asset} is not supported by native Solana SOL verification`);
    fields.push(evidence('asset', matched ? 'balance_delta' : 'unavailable', { expected: expectation.asset, actual: 'SOL', matched, detail: matched ? 'native SOL evidence uses lamport balance deltas' : 'SPL-token or program-specific asset evidence is not available in this verifier' }));
  }
  if (expectation.amount) {
    if (transfer !== undefined) { const matched = baseUnitsEqualDecimal(transfer.recipientCredit, expectation.amount, 9); if (!matched) reasons.push('amount mismatch'); fields.push(evidence('amount','balance_delta',{ expected: expectation.amount, actual: transfer.recipientCredit.toString(), matched, detail: `SOL recipient credit in lamports; sender debit ${transfer.senderDebit.toString()}; fee gap ${transfer.feeGap.toString()}` })); }
    else if (fixture && tx?.amount !== undefined) { const matched = tx.amount === expectation.amount; if (!matched) reasons.push('amount mismatch'); fields.push(evidence('amount','fixture',{ expected: expectation.amount, actual: tx.amount, matched, detail: 'fixture envelope amount, not reconstructed transfer evidence' })); }
    else { reasons.push('expected amount unavailable in transaction'); fields.push(evidence('amount','unavailable',{ expected: expectation.amount, matched: false, detail: 'transfer/balance-delta evidence unavailable' })); }
  }
  const memo = memoFromLogs(tx) ?? tx?.memo;
  if (expectation.memo) { if (!memo) { reasons.push('expected memo unavailable in transaction'); fields.push(evidence('memo','unavailable',{ expected: expectation.memo, matched: false })); } else { const matched = memo === expectation.memo; if (!matched) reasons.push('memo mismatch'); fields.push(evidence('memo', memoFromLogs(tx) ? 'memo_log' : fixture ? 'fixture' : 'machinefi_envelope', { expected: expectation.memo, actual: memo, matched })); } }
  for (const [field, actual] of [['machineId', tx?.machineId], ['sessionId', tx?.sessionId]] as const) { const expected = expectation[field]; if (!expected) continue; if (actual === undefined) { reasons.push(`expected ${field} unavailable in transaction`); fields.push(evidence(field,'unavailable',{ expected, matched: false })); } else { const matched = actual === expected; if (!matched) reasons.push(`${field === 'machineId' ? 'machine id' : 'session id'} mismatch`); fields.push(evidence(field, fixture ? 'fixture' : 'machinefi_envelope', { expected, actual, matched })); } }
  return { matched: reasons.length === 0, reasons, fields };
}
export async function verifySolanaReceipt(signature: string, options: SolanaVerifyOptions = {}): Promise<RuntimeResult<ReceiptVerification>> {
  if (!isSolanaSignature(signature)) return err('invalid_input', 'Invalid Solana signature');
  if (options.expectation?.from && !isSolanaAddress(options.expectation.from)) return err('invalid_input', 'Invalid expected from account');
  if (options.expectation?.to && !isSolanaAddress(options.expectation.to)) return err('invalid_input', 'Invalid expected to account');
  try {
    if (options.fixture) {
      const fixture = getFixtureReceipt('solana', signature) as (StatusValue & SolanaTransaction & { status: string; id: string }) | undefined;
      if (!fixture) return ok({ chain: 'solana', id: signature, found: false, verified: false, chainMatched: true, status: 'not_found' });
      const status: 'success' | 'failed' = fixture.status === 'success' && !fixture.err ? 'success' : 'failed';
      const expectation = compareExpectation(fixture, status, options.expectation, true);
      const finality = normalizeSolanaFinality(fixture.confirmationStatus, true);
      const minimumFinality = options.minimumFinality ?? 'confirmed';
      const finalityMatched = finalityMeetsMinimum(finality, minimumFinality);
      const mismatchReasons = finalityMatched
        ? expectation.reasons
        : [...expectation.reasons, `minimum finality ${minimumFinality} not reached (${finality})`];
      return ok({ chain: 'solana', id: signature, found: true, verified: status === 'success' && expectation.matched && finalityMatched, chainMatched: true, status, statusMatched: !options.expectation?.status || options.expectation.status === status, expectationsMatched: expectation.matched, mismatchReasons, finality, confirmations: fixture.confirmations ?? undefined, block: fixture.slot, raw: fixture, evidence: expectation.fields, settlementEvidence: splitEvidence(expectation.fields) });
    }
    const transport = createSolanaTransport(options);
    const statuses = await transport.request<{ value: Array<StatusValue | null> }>('getSignatureStatuses', [[signature], { searchTransactionHistory: options.searchTransactionHistory ?? true }]);
    const statusValue = statuses.value[0];
    if (!statusValue) return ok({ chain: 'solana', id: signature, found: false, verified: false, chainMatched: true, status: 'not_found' });
    const tx = await transport.request<SolanaTransaction | null>('getTransaction', [signature, { encoding: 'json', commitment: options.commitment ?? 'confirmed', maxSupportedTransactionVersion: 0 }]);
    const status: 'success' | 'failed' | 'pending' = statusValue.err || tx?.meta?.err ? 'failed' : tx ? 'success' : 'pending';
    const expectation = compareExpectation(tx ?? undefined, status, options.expectation, false);
    const finality = normalizeSolanaFinality(statusValue.confirmationStatus, Boolean(tx));
    const minimumFinality = options.minimumFinality ?? 'confirmed';
    const finalityMatched = finalityMeetsMinimum(finality, minimumFinality);
    const mismatchReasons = finalityMatched
      ? expectation.reasons
      : [...expectation.reasons, `minimum finality ${minimumFinality} not reached (${finality})`];
    // The RPC methods above prove transaction status but not cluster identity.
    // Withhold an explorer URL rather than defaulting an arbitrary/fixture RPC
    // to Solana mainnet. Callers may construct one only after verifying cluster.
    return ok({ chain: 'solana', id: signature, found: true, verified: status === 'success' && expectation.matched && finalityMatched, chainMatched: true, status, statusMatched: !options.expectation?.status || options.expectation.status === status, expectationsMatched: expectation.matched, mismatchReasons, finality, confirmations: statusValue.confirmations ?? undefined, raw: tx ?? statusValue, evidence: expectation.fields, settlementEvidence: splitEvidence(expectation.fields), ...(tx?.slot ?? statusValue.slot ? { block: tx?.slot ?? statusValue.slot } : {}) });
  } catch (cause) { return err('rpc_error', 'Solana receipt lookup failed', cause); }
}
