/**
 * Application-facing runtime and telemetry adapter.
 *
 * The console deliberately consumes this normalized model instead of importing
 * session, work-order, policy, settlement, or telemetry SDK types in its page
 * components. The current repository only exposes an in-process deterministic
 * snapshot; it has no runtime streaming endpoint, history store, or network
 * reachability record. Those limitations are carried explicitly in the model.
 */

import {
  RECEIPTS,
  fleetSnapshot,
  type FleetSnapshot,
  type MachineView,
} from '../data/fleet-snapshot.js';

export type RuntimeConnectionState = 'live' | 'delayed' | 'offline' | 'unknown';
export type RuntimeNetworkState = 'connected' | 'disconnected' | 'unknown';
export type RuntimeSeverity = 'ok' | 'active' | 'warning' | 'error' | 'neutral';

export interface RuntimeConnection {
  /** Derived from the recorded telemetry observation age; it is not a socket state. */
  state: RuntimeConnectionState;
  observationAgeMinutes?: number | undefined;
  /** The actual telemetry observation timestamp. */
  lastObservedAt?: string | undefined;
  reason: string;
}

export interface RuntimeTelemetry {
  observedAt: string;
  health: 'nominal' | 'degraded' | 'faulted' | 'offline';
  batteryPct?: number | undefined;
  signalPct?: number | undefined;
  progressPct?: number | undefined;
  location?: { lat: number; lon: number; altitudeM?: number | undefined } | undefined;
  pose?: { x: number; y: number; z?: number | undefined; yawDeg?: number | undefined } | undefined;
  telemetryRef?: string | undefined;
  diagnosticLevel: 'ok' | 'warn' | 'error' | 'stale';
  diagnosticMessages: string[];
}

export interface RuntimeSessionRecord {
  sessionId: string;
  machineId: string;
  operatorId: string;
  chain: string;
  mode: 'fixture' | 'live-read';
  policyProfileId: string;
  createdAt: string;
  updatedAt: string;
  /** Legitimately derived against the snapshot's fixed generation time. */
  durationSeconds?: number | undefined;
  /** The SDK session model has no lifecycle/status field. */
  statusAvailable: false;
}

export interface RuntimeJobRecord {
  workOrderId: string;
  machineId?: string | undefined;
  stage: string;
  requiredCapabilities: string[];
  telemetryRequired: boolean;
  proofRequired: boolean;
  createdAt: string;
  updatedAt: string;
  telemetryRef?: string | undefined;
  proofId?: string | undefined;
  settlementIntentId?: string | undefined;
  resultRef?: string | undefined;
  amount: string;
  asset: string;
  rail: string;
}

export interface RuntimePolicyRecord {
  policyId: string;
  displayName: string;
  allowedRails: string[];
  allowedAssets: string[];
  maxAmountPerIntent: string;
  maxSessionBudget?: string | undefined;
  machineRoles: string[];
  capabilityTags: string[];
}

export interface RuntimeSettlementRecord {
  intentId: string;
  machineId: string;
  sessionId: string;
  rail: string;
  amount: string;
  asset: string;
  createdAt: string;
  signingMode: 'caller-wallet';
  broadcast: false;
  status: 'unsigned';
}

export interface RuntimeProofRecord {
  proofId: string;
  workOrderId: string;
}

export interface RuntimeReceiptRecord {
  id: string;
  machineId: string;
  status: string;
  verificationState: 'not-run';
  finality: string;
  source: 'fixture';
}

export interface RuntimeEventRecord {
  eventId: string;
  machineId: string;
  occurredAt: string;
  type: string;
  source: 'runtime-event' | 'telemetry-snapshot';
  payloadSummary: string;
  severity: RuntimeSeverity;
}

export interface RuntimeMachineRecord {
  machineId: string;
  label: string;
  role: string;
  runtimeStatus: string;
  network: { rail: string; state: RuntimeNetworkState; reason: string };
  connection: RuntimeConnection;
  lastRuntimeActivityAt?: string | undefined;
  telemetry: RuntimeTelemetry;
  session?: RuntimeSessionRecord | undefined;
  jobs: RuntimeJobRecord[];
  activeJob?: RuntimeJobRecord | undefined;
  policy?: RuntimePolicyRecord | undefined;
  settlements: RuntimeSettlementRecord[];
  proofs: RuntimeProofRecord[];
  receipts: RuntimeReceiptRecord[];
  events: RuntimeEventRecord[];
}

export interface RuntimeConsoleModel {
  generatedAt: string;
  sourceMode: 'fixture' | 'live-read';
  machines: RuntimeMachineRecord[];
  recentEvents: RuntimeEventRecord[];
  support: {
    realtimeUpdates: false;
    telemetryHistory: false;
    networkReachability: false;
    sessionControl: false;
    runtimeEvents: true;
    telemetrySnapshots: true;
  };
}

export type RuntimeConsoleState =
  | { status: 'loading' }
  | { status: 'unavailable'; reason: string }
  | { status: 'error'; message: string }
  | { status: 'empty'; generatedAt?: string | undefined }
  | { status: 'ready'; data: RuntimeConsoleModel };

export type RuntimeMachineState =
  | Exclude<RuntimeConsoleState, { status: 'ready' }>
  | { status: 'not-found'; machineId: string }
  | { status: 'ready'; data: RuntimeMachineRecord; console: RuntimeConsoleModel };

const MAX_RECENT_EVENTS = 40;

const validTimestamp = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const latestTimestamp = (values: Array<string | undefined>): string | undefined => {
  const timestamps = values
    .map((value) => ({ value, time: validTimestamp(value) }))
    .filter((entry): entry is { value: string; time: number } => entry.value !== undefined && entry.time !== undefined)
    .sort((a, b) => b.time - a.time);
  return timestamps[0]?.value;
};

function connectionFor(view: MachineView, generatedAt: string): RuntimeConnection {
  const generated = validTimestamp(generatedAt);
  const observed = validTimestamp(view.telemetry.observedAt);
  if (generated === undefined || observed === undefined || observed > generated) {
    return { state: 'unknown', reason: 'No valid telemetry observation timestamp is recorded.' };
  }
  const age = Math.floor((generated - observed) / 60_000);
  const lastObservedAt = view.telemetry.observedAt;
  const common = {
    observationAgeMinutes: age,
    ...(lastObservedAt ? { lastObservedAt } : {}),
  };

  if (view.telemetry.health === 'offline' || age >= 15) {
    return { ...common, state: 'offline', reason: `Latest telemetry observation is ${age} minutes old (15 minute stale limit).` };
  }
  if (age <= 2) {
    return { ...common, state: 'live', reason: `Telemetry was observed ${age === 0 ? 'at snapshot time' : `${age} minutes before the snapshot`}.` };
  }
  return { ...common, state: 'delayed', reason: `Latest telemetry observation is ${age} minutes old.` };
}

const durationSeconds = (start: string, end: string): number | undefined => {
  const startMs = validTimestamp(start);
  const endMs = validTimestamp(end);
  if (startMs === undefined || endMs === undefined || endMs < startMs) return undefined;
  return Math.floor((endMs - startMs) / 1000);
};

function payloadSummary(payload: Record<string, unknown>): string {
  const values = Object.entries(payload).slice(0, 5).map(([key, value]) => {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return `${key}=${String(value)}`;
    if (Array.isArray(value)) return `${key}=[${value.length} values]`;
    return `${key}={record}`;
  });
  const summary = values.join(' · ');
  return summary.length > 220 ? `${summary.slice(0, 217)}…` : summary || 'No payload fields';
}

function severityForRuntimeEvent(type: string, payload: Record<string, unknown>): RuntimeSeverity {
  if (type === 'receipt.verified') return payload['verified'] === true ? 'ok' : payload['verified'] === false ? 'error' : 'neutral';
  if (type === 'policy.checked') return payload['accepted'] === true ? 'ok' : payload['accepted'] === false ? 'error' : 'neutral';
  if (type === 'settlement.intent.created') return 'active';
  const action = String(payload['action'] ?? '').toLowerCase();
  if (action.includes('fault')) return 'error';
  if (action.includes('timeout')) return 'warning';
  return 'neutral';
}

function jobRecords(snapshot: FleetSnapshot, machineId: string): RuntimeJobRecord[] {
  return snapshot.workOrders
    .filter((order) => order.machineId === machineId)
    .map((order) => ({
      workOrderId: order.workOrderId,
      ...(order.machineId ? { machineId: order.machineId } : {}),
      stage: order.stage,
      requiredCapabilities: [...order.requirement.capabilities],
      telemetryRequired: order.requirement.telemetryRequired === true,
      proofRequired: order.requirement.proofRequired === true,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      ...(order.telemetryRef ? { telemetryRef: order.telemetryRef } : {}),
      ...(order.proofId ? { proofId: order.proofId } : {}),
      ...(order.settlementIntentId ? { settlementIntentId: order.settlementIntentId } : {}),
      ...(order.resultRef ? { resultRef: order.resultRef } : {}),
      amount: order.settlement.amount,
      asset: order.settlement.asset,
      rail: order.settlement.chain,
    }));
}

function runtimeEvents(snapshot: FleetSnapshot): RuntimeEventRecord[] {
  const events: RuntimeEventRecord[] = snapshot.events.map((event) => ({
    eventId: event.eventId,
    machineId: event.machineId,
    occurredAt: event.occurredAt,
    type: event.type,
    source: 'runtime-event',
    payloadSummary: payloadSummary(event.payload),
    severity: severityForRuntimeEvent(event.type, event.payload),
  }));

  for (const view of snapshot.machines) {
    events.push({
      eventId: `telemetry-snapshot:${view.entry.machineId}:${view.telemetry.observedAt}`,
      machineId: view.entry.machineId,
      occurredAt: view.telemetry.observedAt,
      type: 'telemetry.snapshot',
      source: 'telemetry-snapshot',
      payloadSummary: [
        `health=${view.telemetry.health}`,
        view.telemetry.batteryPct === undefined ? undefined : `batteryPct=${view.telemetry.batteryPct}`,
        view.telemetry.signalPct === undefined ? undefined : `signalPct=${view.telemetry.signalPct}`,
        view.telemetry.progressPct === undefined ? undefined : `progressPct=${view.telemetry.progressPct}`,
        view.telemetry.telemetryRef ? `ref=${view.telemetry.telemetryRef}` : undefined,
      ]
        .filter((value): value is string => value !== undefined)
        .join(' · '),
      severity:
        view.diagnostics.level === 'error'
          ? 'error'
          : view.diagnostics.level === 'warn' || view.diagnostics.level === 'stale'
            ? 'warning'
            : 'ok',
    });
  }

  return events
    .sort((a, b) => (validTimestamp(b.occurredAt) ?? 0) - (validTimestamp(a.occurredAt) ?? 0))
    .slice(0, MAX_RECENT_EVENTS);
}

function normalizeMachine(snapshot: FleetSnapshot, view: MachineView, events: RuntimeEventRecord[]): RuntimeMachineRecord {
  const session = snapshot.session.machineId === view.entry.machineId
    ? {
        sessionId: snapshot.session.sessionId,
        machineId: snapshot.session.machineId,
        operatorId: snapshot.session.operatorId,
        chain: snapshot.session.chain,
        mode: snapshot.session.mode,
        policyProfileId: snapshot.session.policyProfileId,
        createdAt: snapshot.session.createdAt,
        updatedAt: snapshot.session.updatedAt,
        ...(durationSeconds(snapshot.session.createdAt, snapshot.generatedAt) === undefined
          ? {}
          : { durationSeconds: durationSeconds(snapshot.session.createdAt, snapshot.generatedAt) }),
        statusAvailable: false as const,
      }
    : undefined;

  const jobs = jobRecords(snapshot, view.entry.machineId);
  const activeJob = view.entry.activeJobId
    ? jobs.find((job) => job.workOrderId === view.entry.activeJobId)
    : undefined;
  const settlements: RuntimeSettlementRecord[] = snapshot.intent.machineId === view.entry.machineId
    ? [{
        intentId: snapshot.intent.intentId,
        machineId: snapshot.intent.machineId,
        sessionId: snapshot.intent.sessionId,
        rail: snapshot.intent.chain,
        amount: snapshot.intent.amount,
        asset: snapshot.intent.asset,
        createdAt: snapshot.intent.createdAt,
        signingMode: snapshot.intent.signingMode,
        broadcast: snapshot.intent.broadcast,
        status: 'unsigned',
      }]
    : [];
  const machineEvents = events.filter((event) => event.machineId === view.entry.machineId).slice(0, MAX_RECENT_EVENTS);
  const receipts: RuntimeReceiptRecord[] = RECEIPTS.filter((receipt) => receipt.machineId === view.entry.machineId).map(
    (receipt) => ({
      id: receipt.signature,
      machineId: receipt.machineId,
      status: receipt.status,
      verificationState: 'not-run',
      finality: receipt.finality,
      source: 'fixture',
    })
  );
  const proofs = jobs.flatMap((job): RuntimeProofRecord[] =>
    job.proofId ? [{ proofId: job.proofId, workOrderId: job.workOrderId }] : []
  );
  const policy: RuntimePolicyRecord | undefined = session
    ? {
        policyId: snapshot.policy.policyId,
        displayName: snapshot.policy.displayName,
        allowedRails: [...snapshot.policy.allowedRails],
        allowedAssets: [...snapshot.policy.allowedAssets],
        maxAmountPerIntent: snapshot.policy.maxAmountPerIntent,
        ...(snapshot.policy.maxSessionBudget ? { maxSessionBudget: snapshot.policy.maxSessionBudget } : {}),
        machineRoles: [...snapshot.policy.machineRoles],
        capabilityTags: [...snapshot.policy.capabilityTags],
      }
    : undefined;

  return {
    machineId: view.entry.machineId,
    label: view.label,
    role: view.entry.role,
    runtimeStatus: view.entry.status,
    network: {
      rail: session?.chain ?? view.network,
      state: 'unknown',
      reason: 'The snapshot records a rail but no chain reachability result.',
    },
    connection: connectionFor(view, snapshot.generatedAt),
    ...(latestTimestamp([
      view.telemetry.observedAt,
      view.entry.updatedAt,
      session?.updatedAt,
      activeJob?.updatedAt,
      ...machineEvents.map((event) => event.occurredAt),
    ])
      ? {
          lastRuntimeActivityAt: latestTimestamp([
            view.telemetry.observedAt,
            view.entry.updatedAt,
            session?.updatedAt,
            activeJob?.updatedAt,
            ...machineEvents.map((event) => event.occurredAt),
          ]),
        }
      : {}),
    telemetry: {
      observedAt: view.telemetry.observedAt,
      health: view.telemetry.health,
      ...(view.telemetry.batteryPct === undefined ? {} : { batteryPct: view.telemetry.batteryPct }),
      ...(view.telemetry.signalPct === undefined ? {} : { signalPct: view.telemetry.signalPct }),
      ...(view.telemetry.progressPct === undefined ? {} : { progressPct: view.telemetry.progressPct }),
      ...(view.telemetry.location ? { location: { ...view.telemetry.location } } : {}),
      ...(view.telemetry.pose ? { pose: { ...view.telemetry.pose } } : {}),
      ...(view.telemetry.telemetryRef ? { telemetryRef: view.telemetry.telemetryRef } : {}),
      diagnosticLevel: view.diagnostics.level,
      diagnosticMessages: [...view.diagnostics.messages],
    },
    ...(session ? { session } : {}),
    jobs,
    ...(activeJob ? { activeJob } : {}),
    ...(policy ? { policy } : {}),
    settlements,
    proofs,
    receipts,
    events: machineEvents,
  };
}

/** Loads and normalizes the only runtime source currently available. */
export function loadRuntimeConsole(): RuntimeConsoleState {
  try {
    const snapshot = fleetSnapshot();
    if (snapshot.machines.length === 0) return { status: 'empty', generatedAt: snapshot.generatedAt };
    const events = runtimeEvents(snapshot);
    const data: RuntimeConsoleModel = {
      generatedAt: snapshot.generatedAt,
      sourceMode: snapshot.session.mode,
      machines: snapshot.machines.map((view) => normalizeMachine(snapshot, view, events)),
      recentEvents: events,
      support: {
        realtimeUpdates: false,
        telemetryHistory: false,
        networkReachability: false,
        sessionControl: false,
        runtimeEvents: true,
        telemetrySnapshots: true,
      },
    };
    return { status: 'ready', data };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}

/** Resolves one machine while preserving adapter loading/error/unavailable states. */
export function loadMachineRuntime(
  machineId: string,
  state: RuntimeConsoleState = loadRuntimeConsole()
): RuntimeMachineState {
  if (state.status !== 'ready') return state;
  const machine = state.data.machines.find((candidate) => candidate.machineId === machineId);
  return machine
    ? { status: 'ready', data: machine, console: state.data }
    : { status: 'not-found', machineId };
}
