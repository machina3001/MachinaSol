import type { ReceiptExpectation } from './types.js';
import type { EvidenceSource, ReceiptEvidenceField } from './evidence.js';

export interface FieldEvidenceSummary {
  field: string;
  expected: boolean;
  observed: boolean;
  matched: boolean;
  source: EvidenceSource | 'missing';
  native: boolean;
  envelope: boolean;
  unavailable: boolean;
  detail?: string | undefined;
}

export interface ReceiptExpectationSummary {
  matched: boolean;
  unavailableFields: string[];
  mismatchedFields: string[];
  nativeFields: string[];
  envelopeFields: string[];
  fixtureFields: string[];
  fieldSummaries: FieldEvidenceSummary[];
}

const nativeSources = new Set<EvidenceSource>(['native_receipt', 'transaction', 'log_event', 'memo_log', 'balance_delta']);
const envelopeSources = new Set<EvidenceSource>(['machinefi_envelope']);
const fixtureSources = new Set<EvidenceSource>(['fixture']);

export function expectedReceiptFieldNames(expectation: ReceiptExpectation = {}): string[] {
  const names: string[] = [];
  if (expectation.status) names.push('status');
  if (expectation.from) names.push('from');
  if (expectation.to || expectation.recipient) names.push('to');
  if (expectation.amount) names.push('amount');
  if (expectation.memo) names.push('memo');
  if (expectation.machineId) names.push('machineId');
  if (expectation.sessionId) names.push('sessionId');
  return names;
}

function canonicalFieldName(field: string): string {
  if (field === 'accountInvolvement') return 'accountInvolvement';
  if (field === 'recipient') return 'to';
  return field;
}

function fieldSummary(name: string, evidenceFields: ReceiptEvidenceField[]): FieldEvidenceSummary {
  const evidence = evidenceFields.find((field) => canonicalFieldName(field.field) === name);
  if (!evidence) return { field: name, expected: true, observed: false, matched: false, source: 'missing', native: false, envelope: false, unavailable: true };
  const source = evidence.source;
  return {
    field: name,
    expected: true,
    observed: source !== 'unavailable',
    matched: evidence.matched !== false,
    source,
    native: nativeSources.has(source),
    envelope: envelopeSources.has(source),
    unavailable: source === 'unavailable',
    detail: evidence.detail
  };
}

export function summarizeReceiptExpectationEvidence(expectation: ReceiptExpectation, evidenceFields: ReceiptEvidenceField[]): ReceiptExpectationSummary {
  const names = expectedReceiptFieldNames(expectation);
  const fieldSummaries = names.map((name) => fieldSummary(name, evidenceFields));
  return {
    matched: fieldSummaries.every((field) => field.matched && !field.unavailable),
    unavailableFields: fieldSummaries.filter((field) => field.unavailable).map((field) => field.field),
    mismatchedFields: fieldSummaries.filter((field) => !field.matched && !field.unavailable).map((field) => field.field),
    nativeFields: fieldSummaries.filter((field) => field.native).map((field) => field.field),
    envelopeFields: fieldSummaries.filter((field) => field.envelope).map((field) => field.field),
    fixtureFields: fieldSummaries.filter((field) => fixtureSources.has(field.source as EvidenceSource)).map((field) => field.field),
    fieldSummaries
  };
}

export function assertExpectedFieldsAvailable(expectation: ReceiptExpectation, evidenceFields: ReceiptEvidenceField[]): void {
  const summary = summarizeReceiptExpectationEvidence(expectation, evidenceFields);
  if (!summary.matched) {
    const unavailable = summary.unavailableFields.length ? `unavailable: ${summary.unavailableFields.join(', ')}` : '';
    const mismatched = summary.mismatchedFields.length ? `mismatched: ${summary.mismatchedFields.join(', ')}` : '';
    throw new Error([unavailable, mismatched].filter(Boolean).join('; ') || 'receipt expectations not satisfied');
  }
}

export function receiptEvidenceCoverageRatio(summary: ReceiptExpectationSummary): number {
  if (summary.fieldSummaries.length === 0) return 1;
  const satisfied = summary.fieldSummaries.filter((field) => field.matched && !field.unavailable).length;
  return satisfied / summary.fieldSummaries.length;
}

export function receiptEvidenceCoverageLabel(summary: ReceiptExpectationSummary): 'complete' | 'partial' | 'unavailable' {
  const ratio = receiptEvidenceCoverageRatio(summary);
  if (ratio === 1) return 'complete';
  if (ratio === 0) return 'unavailable';
  return 'partial';
}
