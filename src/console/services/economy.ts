/**
 * Application-facing jobs, settlements, and receipts adapter.
 *
 * The runtime currently exposes an in-process deterministic snapshot rather
 * than a persisted economy API.  This module is the single place where those
 * records are normalized for the console.  Most importantly, it only joins
 * records through explicit identifiers:
 *
 * - a machine is joined through `MachineWorkOrder.machineId`;
 * - an intent is joined through `MachineWorkOrder.settlementIntentId`;
 * - runtime events are joined through an explicit `jobId`/`workOrderId`
 *   payload field.
 *
 * Amounts, machines, memos, capabilities, or timestamps are never used to
 * guess provider, resource, settlement, proof, or receipt relationships.
 */

import { isSolanaSignature } from '../../adapters/solana/validation.js';
import { solanaTxUrl } from '../../adapters/solana/provider.js';
import type { MachineWorkOrder, WorkOrderStage } from '../../jobs/work-order.js';
import { fixtureData } from '../../transports/fixture.js';
import {
  RECEIPTS,
  fleetSnapshot,
  type FleetSnapshot,
  type MachineView,
} from '../data/fleet-snapshot.js';

export type EconomyRecordSource = 'sdk-deterministic' | 'repository-fixture';
export type EconomySettlementState = 'not-linked' | 'intent-prepared' | 'settled';
export type EconomyVerificationState = 'not-run';
export type SolanaExplorerCluster = 'mainnet-beta' | 'devnet' | 'testnet';

export interface EconomyMachineLink {
  machineId: string;
  label: string;
  role: string;
  status: string;
  owner: string;
  walletAddress: string;
}

export interface EconomySettlementTerms {
  chain: string;
  amount: string;
  asset: string;
  recipient: string;
}

export interface EconomyJob {
  jobId: string;
  status: WorkOrderStage;
  createdAt: string;
  updatedAt: string;
  /** The work-order model has no explicit started timestamp. */
  startedAt?: string | undefined;
  /** The current snapshot has no completed work order. */
  completedAt?: string | undefined;
  machine?: EconomyMachineLink | undefined;
  machineId?: string | undefined;
  requiredCapabilities: string[];
  telemetryRequired: boolean;
  proofRequired: boolean;
  expectedOutputs: string[];
  telemetryRef?: string | undefined;
  proofId?: string | undefined;
  resultRef?: string | undefined;
  settlementIntentId?: string | undefined;
  settlement: EconomySettlementTerms;
  settlementState: EconomySettlementState;
  source: 'sdk-deterministic';
  /** No resource request identifier is recorded by MachineWorkOrder. */
  resourceId?: string | undefined;
  /** No provider identifier is recorded by MachineWorkOrder. */
  providerId?: string | undefined;
}

export interface EconomySettlement {
  settlementId: string;
  recordKind: 'unsigned-intent';
  jobId?: string | undefined;
  machine?: EconomyMachineLink | undefined;
  machineId: string;
  providerId?: string | undefined;
  resourceId?: string | undefined;
  amount: string;
  token: string;
  chain: 'solana';
  status: 'unsigned';
  sourceAccount: string;
  recipient: string;
  policyId: string;
  sessionId: string;
  memo?: string | undefined;
  createdAt: string;
  signingMode: 'caller-wallet';
  broadcast: false;
  transactionSignature?: string | undefined;
  explorerUrl?: string | undefined;
  source: 'sdk-deterministic';
}

export interface EconomyReceipt {
  receiptId: string;
  jobId?: string | undefined;
  machine?: EconomyMachineLink | undefined;
  machineId: string;
  providerId?: string | undefined;
  resourceId?: string | undefined;
  settlementId?: string | undefined;
  verificationState: EconomyVerificationState;
  status: string;
  finality: string;
  workProofRef?: string | undefined;
  transactionSignature: string;
  timestamp?: string | undefined;
  amount: string;
  token: string;
  memo: string;
  sessionId?: string | undefined;
  slot: number;
  confirmations?: number | undefined;
  explorerUrl?: string | undefined;
  source: 'repository-fixture';
  liveConfirmation: false;
  explorerUnavailableReason: string;
}

export interface EconomyTelemetryLink {
  telemetryRef: string;
  machineId: string;
  observedAt: string;
  health: string;
  batteryPct?: number | undefined;
  signalPct?: number | undefined;
  progressPct?: number | undefined;
  diagnosticLevel: string;
  diagnosticMessages: string[];
}

export interface EconomyTimelineEvent {
  eventId: string;
  type: string;
  title: string;
  at: string;
  detail: string;
  tone: 'neutral' | 'active' | 'online' | 'degraded' | 'faulted';
  source: 'sdk-deterministic';
}

export interface EconomyJobDetail {
  job: EconomyJob;
  timeline: EconomyTimelineEvent[];
  telemetry?: EconomyTelemetryLink | undefined;
  linkedSettlement?: EconomySettlement | undefined;
  linkedReceipts: EconomyReceipt[];
}

export interface EconomyJobFilters {
  status?: WorkOrderStage | undefined;
  machineId?: string | undefined;
}

export interface ReceiptVerificationDefaults {
  signature: string;
  amount: string;
  memo: string;
  machineId: string;
  sessionId: string;
}

/** Capabilities the backing runtime actually supplies to these pages. */
export const ECONOMY_SUPPORT = {
  workOrders: true,
  unsignedSettlementIntents: true,
  repositoryReceiptFixtures: true,
  providerRelationships: false,
  resourceRelationships: false,
  receiptJobRelationships: false,
  settlementBroadcast: false,
  persistedHistory: false,
  workProofStore: false,
  verifiedClusterIdentity: false,
} as const;

const machineLink = (view: MachineView | undefined): EconomyMachineLink | undefined =>
  view
    ? {
        machineId: view.entry.machineId,
        label: view.label,
        role: view.entry.role,
        status: view.entry.status,
        owner: view.owner,
        walletAddress: view.entry.walletAddress,
      }
    : undefined;

const explicitIntentJobId = (snapshot: FleetSnapshot, intentId: string): string | undefined =>
  snapshot.workOrders.find((order) => order.settlementIntentId === intentId)?.workOrderId;

function settlementState(order: MachineWorkOrder): EconomySettlementState {
  if (order.stage === 'settled') return 'settled';
  return order.settlementIntentId ? 'intent-prepared' : 'not-linked';
}

function normalizeJob(snapshot: FleetSnapshot, order: MachineWorkOrder): EconomyJob {
  const machine = order.machineId
    ? machineLink(snapshot.machines.find((view) => view.entry.machineId === order.machineId))
    : undefined;

  return {
    jobId: order.workOrderId,
    status: order.stage,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    ...(order.machineId ? { machineId: order.machineId } : {}),
    ...(machine ? { machine } : {}),
    requiredCapabilities: [...order.requirement.capabilities],
    telemetryRequired: order.requirement.telemetryRequired === true,
    proofRequired: order.requirement.proofRequired === true,
    expectedOutputs: [...(order.requirement.expectedOutputs ?? [])],
    ...(order.telemetryRef ? { telemetryRef: order.telemetryRef } : {}),
    ...(order.proofId ? { proofId: order.proofId } : {}),
    ...(order.resultRef ? { resultRef: order.resultRef } : {}),
    ...(order.settlementIntentId ? { settlementIntentId: order.settlementIntentId } : {}),
    settlement: {
      chain: order.settlement.chain,
      amount: order.settlement.amount,
      asset: order.settlement.asset,
      recipient: order.settlement.recipient,
    },
    settlementState: settlementState(order),
    source: 'sdk-deterministic',
  };
}

function normalizeSettlement(snapshot: FleetSnapshot): EconomySettlement {
  const intent = snapshot.intent;
  const machine = machineLink(snapshot.machines.find((view) => view.entry.machineId === intent.machineId));
  const jobId = explicitIntentJobId(snapshot, intent.intentId);

  return {
    settlementId: intent.intentId,
    recordKind: 'unsigned-intent',
    ...(jobId ? { jobId } : {}),
    ...(machine ? { machine } : {}),
    machineId: intent.machineId,
    amount: intent.amount,
    token: intent.asset,
    chain: intent.chain,
    status: 'unsigned',
    sourceAccount: intent.source,
    recipient: intent.recipient,
    policyId: intent.policyId,
    sessionId: intent.sessionId,
    ...(intent.memo ? { memo: intent.memo } : {}),
    createdAt: intent.createdAt,
    signingMode: intent.signingMode,
    broadcast: intent.broadcast,
    source: 'sdk-deterministic',
  };
}

function normalizeReceipt(snapshot: FleetSnapshot, receipt: (typeof RECEIPTS)[number]): EconomyReceipt {
  const machine = machineLink(snapshot.machines.find((view) => view.entry.machineId === receipt.machineId));

  return {
    receiptId: receipt.signature,
    ...(machine ? { machine } : {}),
    machineId: receipt.machineId,
    verificationState: 'not-run',
    status: receipt.status,
    finality: receipt.finality,
    transactionSignature: receipt.signature,
    amount: receipt.amount,
    token: receipt.asset,
    memo: receipt.memo,
    sessionId: receipt.sessionId,
    slot: receipt.slot,
    confirmations: receipt.confirmations,
    source: 'repository-fixture',
    liveConfirmation: false,
    explorerUnavailableReason:
      'This receipt comes from the repository fixture and no Solana cluster identity was verified.',
  };
}

const primitivePayloadSummary = (payload: Record<string, unknown>): string => {
  const parts = Object.entries(payload)
    .filter(([, value]) => value === null || ['string', 'number', 'boolean'].includes(typeof value))
    .slice(0, 6)
    .map(([key, value]) => `${key}=${String(value)}`);
  return parts.join(' · ') || 'No scalar payload fields';
};

function timelineFor(snapshot: FleetSnapshot, order: MachineWorkOrder): EconomyTimelineEvent[] {
  const events: EconomyTimelineEvent[] = [
    {
      eventId: `work-order:${order.workOrderId}:created`,
      type: 'work-order.record.created',
      title: 'Work-order record created',
      at: order.createdAt,
      detail: `initial record · current snapshot stage ${order.stage}`,
      tone: 'neutral',
      source: 'sdk-deterministic',
    },
  ];

  if (order.updatedAt !== order.createdAt) {
    events.push({
      eventId: `work-order:${order.workOrderId}:updated:${order.updatedAt}`,
      type: 'work-order.record.updated',
      title: 'Work-order record last updated',
      at: order.updatedAt,
      detail: `current snapshot stage ${order.stage}; intermediate transition times are not retained`,
      tone:
        order.stage === 'failed'
          ? 'faulted'
          : order.stage === 'settled'
            ? 'online'
            : order.stage === 'queued'
              ? 'neutral'
              : 'active',
      source: 'sdk-deterministic',
    });
  }

  for (const event of snapshot.events) {
    const explicitJobId = event.payload['jobId'] ?? event.payload['workOrderId'];
    if (explicitJobId !== order.workOrderId) continue;
    events.push({
      eventId: event.eventId,
      type: event.type,
      title: event.type,
      at: event.occurredAt,
      detail: primitivePayloadSummary(event.payload),
      tone: event.type === 'receipt.verified'
        ? event.payload['verified'] === true
          ? 'online'
          : event.payload['verified'] === false
            ? 'faulted'
            : 'neutral'
        : event.type === 'policy.checked'
          ? event.payload['accepted'] === true
            ? 'online'
            : event.payload['accepted'] === false
              ? 'faulted'
              : 'neutral'
          : event.type === 'settlement.intent.created'
            ? 'active'
            : 'neutral',
      source: 'sdk-deterministic',
    });
  }

  return events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** Returns normalized work orders, optionally filtered by actual fields. */
export function economyJobs(filters: EconomyJobFilters = {}): EconomyJob[] {
  const snapshot = fleetSnapshot();
  return snapshot.workOrders
    .map((order) => normalizeJob(snapshot, order))
    .filter((job) => !filters.status || job.status === filters.status)
    .filter((job) => !filters.machineId || job.machineId === filters.machineId);
}

/** Looks up one normalized work order. */
export function economyJob(jobId: string): EconomyJob | undefined {
  return economyJobs().find((job) => job.jobId === jobId);
}

/** The current runtime exposes one unsigned intent and no settlement history. */
export function economySettlements(): EconomySettlement[] {
  const snapshot = fleetSnapshot();
  return [normalizeSettlement(snapshot)];
}

/** Repository fixture receipts, clearly separated from live confirmations. */
export function economyReceipts(): EconomyReceipt[] {
  const snapshot = fleetSnapshot();
  return RECEIPTS.map((receipt) => normalizeReceipt(snapshot, receipt));
}

/**
 * Returns every detail relationship that can be proven through an explicit id.
 * The current fixture has no work-order-to-receipt field, so linkedReceipts is
 * intentionally empty even where amount, machine, or memo values resemble a
 * job or intent.
 */
export function economyJobDetail(jobId: string): EconomyJobDetail | undefined {
  const snapshot = fleetSnapshot();
  const order = snapshot.workOrders.find((candidate) => candidate.workOrderId === jobId);
  if (!order) return undefined;

  const job = normalizeJob(snapshot, order);
  const telemetry = order.telemetryRef
    ? snapshot.machines
        .filter(
          (view) =>
            view.telemetry.telemetryRef === order.telemetryRef &&
            order.machineId !== undefined &&
            view.entry.machineId === order.machineId
        )
        .map<EconomyTelemetryLink>((view) => ({
          telemetryRef: order.telemetryRef!,
          machineId: view.entry.machineId,
          observedAt: view.telemetry.observedAt,
          health: view.telemetry.health,
          ...(view.telemetry.batteryPct === undefined ? {} : { batteryPct: view.telemetry.batteryPct }),
          ...(view.telemetry.signalPct === undefined ? {} : { signalPct: view.telemetry.signalPct }),
          ...(view.telemetry.progressPct === undefined ? {} : { progressPct: view.telemetry.progressPct }),
          diagnosticLevel: view.diagnostics.level,
          diagnosticMessages: [...view.diagnostics.messages],
        }))[0]
    : undefined;
  const linkedSettlement = order.settlementIntentId
    ? economySettlements().find((settlement) => settlement.settlementId === order.settlementIntentId)
    : undefined;

  return {
    job,
    timeline: timelineFor(snapshot, order),
    ...(telemetry ? { telemetry } : {}),
    ...(linkedSettlement ? { linkedSettlement } : {}),
    linkedReceipts: [],
  };
}

/** Values carried by the committed fixture for the existing verify form. */
export function receiptVerificationDefaults(): ReceiptVerificationDefaults | undefined {
  const record = fixtureData.solana.receipts[0];
  if (!record) return undefined;
  return {
    signature: record.id,
    amount: record.amount,
    memo: record.memo,
    machineId: record.machineId,
    sessionId: record.sessionId,
  };
}

/**
 * Produces a Solana explorer URL only when both the cluster and the fact that
 * the evidence came from a live read are known.  Fixture signatures therefore
 * never receive an explorer link that could imply mainnet confirmation.
 */
export function genuineSolanaExplorerUrl(
  signature: string,
  cluster: SolanaExplorerCluster | undefined,
  liveEvidence: boolean
): string | undefined {
  if (!liveEvidence || !cluster || !isSolanaSignature(signature)) return undefined;
  return solanaTxUrl(signature, cluster === 'mainnet-beta' ? undefined : cluster);
}
