/**
 * Deterministic console snapshot.
 *
 * SDK factories normalize deterministic seed records where the repository has
 * a public model. Values remain fixture data, not a persisted or live runtime.
 * Fixed timestamps make every render byte-stable and safe for CI.
 *
 * This is a read-only view model. It performs no network I/O.
 */

import { createMachineSession } from '../../sessions/session.js';
import { buildSettlementIntent } from '../../settlement/intents.js';
import {
  assignMachineToJob,
  markMachineOffline,
  registerMachine,
  summarizeRegistry,
  updateMachineTelemetry,
  type FleetRegistryEntry,
} from '../../fleet/registry.js';
import { transitionMachineStatus } from '../../machines/status.js';
import { summarizeFleetReadiness } from '../../fleet/availability.js';
import { createWorkOrder, transitionWorkOrder, type MachineWorkOrder, type WorkOrderStage } from '../../jobs/work-order.js';
import { normalizeTelemetrySnapshot, type MachineTelemetrySnapshot } from '../../telemetry/snapshot.js';
import { diagnosticsFromTelemetry, type TelemetryDiagnosticSummary } from '../../telemetry/diagnostics.js';
import { createRuntimeEvent, type RuntimeEvent } from '../../policy/events.js';
import { DEFAULT_POLICY_PROFILE } from '../../policy/profiles.js';
import { fixtureData } from '../../transports/fixture.js';
import type { MachineSession, SettlementIntent } from '../../adapters/shared/types.js';

/** Fixed clock so ids and derived values never drift between renders. */
const T0 = '2026-08-23T19:40:00.000Z';
const at = (minutes: number): string => new Date(Date.parse(T0) + minutes * 60_000).toISOString();
const SNAPSHOT_MINUTE = 35;

/** Verified 32-byte base58 accounts. */
const ACCOUNTS = {
  drone: '11111111111111111111111111111111',
  arm: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  sensor: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
  rover: 'Stake11111111111111111111111111111111111111',
  recipient: 'Sysvar1111111111111111111111111111111111111',
} as const;

export const WORK_ORDER_STAGES: readonly WorkOrderStage[] = [
  'queued',
  'assigned',
  'preparing',
  'working',
  'proof_submitted',
  'settled',
];

export interface MachineView {
  entry: FleetRegistryEntry;
  label: string;
  telemetry: MachineTelemetrySnapshot;
  diagnostics: TelemetryDiagnosticSummary;
  lastSeen: string;
  /** Owning organisation or team. */
  owner: string;
  /** Settlement rail this machine transacts on. */
  network: string;
  /** Minutes between telemetry observation and snapshot generation. */
  observationAgeMin: number;
  /** Update freshness derived from the recorded telemetry timestamp. */
  updateState: 'live' | 'delayed' | 'offline';
}

export interface FleetSnapshot {
  machines: MachineView[];
  registry: ReturnType<typeof summarizeRegistry>;
  readiness: ReturnType<typeof summarizeFleetReadiness>;
  session: MachineSession;
  intent: SettlementIntent;
  workOrders: MachineWorkOrder[];
  events: RuntimeEvent[];
  policy: typeof DEFAULT_POLICY_PROFILE;
  generatedAt: string;
}

interface Seed {
  machineId: string;
  label: string;
  role: Parameters<typeof registerMachine>[0]['role'];
  capabilities: Parameters<typeof registerMachine>[0]['capabilities'];
  wallet: string;
  operator: string;
  /** Owning organisation or team, distinct from the operating account. */
  owner: string;
  battery: number;
  health: FleetRegistryEntry['health'];
  /** Minute offset from T0 for the recorded telemetry observation. */
  telemetryMinute: number;
  offline?: boolean;
}

const SEEDS: Seed[] = [
  {
    machineId: 'drone-9',
    label: 'Roof Inspector 09',
    role: 'drone',
    capabilities: ['inspection', 'audit_capture'],
    wallet: ACCOUNTS.drone,
    operator: 'flight-ops',
    owner: 'Aerial Survey Group',
    battery: 72,
    telemetryMinute: 35,
    health: 'nominal',
  },
  {
    machineId: 'arm-17',
    label: 'Dock Arm 17',
    role: 'robot_arm',
    capabilities: ['pick_place', 'audit_capture'],
    wallet: ACCOUNTS.arm,
    operator: 'ops-alpha',
    owner: 'Dock Automation Ltd',
    battery: 96,
    telemetryMinute: 33,
    health: 'nominal',
  },
  {
    machineId: 'edge-3',
    label: 'Warehouse Sensor 03',
    role: 'sensor',
    capabilities: ['sensing', 'compute'],
    wallet: ACCOUNTS.sensor,
    operator: 'sensor-ops',
    owner: 'Warehouse Infra Co',
    battery: 4,
    telemetryMinute: 17,
    health: 'offline',
    offline: true,
  },
  {
    machineId: 'rover-2',
    label: 'Yard Rover 02',
    role: 'rover',
    capabilities: ['delivery', 'mapping'],
    wallet: ACCOUNTS.rover,
    operator: 'yard-ops',
    owner: 'Dock Automation Ltd',
    battery: 51,
    telemetryMinute: 30,
    health: 'degraded',
  },
];

function buildMachine(seed: Seed, index: number): MachineView {
  const registered = registerMachine(
    {
      machineId: seed.machineId,
      role: seed.role,
      walletAddress: seed.wallet,
      operatorId: seed.operator,
      capabilities: seed.capabilities,
      label: seed.label,
      owner: seed.owner,
      fleetId: 'demo-fleet',
      siteId: 'dock-4',
    },
    at(index)
  );

  const telemetry = normalizeTelemetrySnapshot({
    machineId: seed.machineId,
    observedAt: at(seed.telemetryMinute),
    batteryPct: seed.battery,
    signalPct: seed.offline ? 0 : 88 - index * 6,
    progressPct: seed.offline ? 0 : 20 + index * 15,
    health: seed.health ?? 'nominal',
    telemetryRef: `telemetry:${seed.machineId}:cycle-1`,
  });

  const assignedEntry: FleetRegistryEntry = seed.machineId === 'drone-9'
      ? transitionMachineStatus(
          assignMachineToJob(
            registered,
            { jobId: 'wo-roof-scan-12', requiredCapabilities: ['inspection'] },
            at(22)
          ),
          'working',
          at(26)
        )
      : seed.machineId === 'arm-17'
        ? assignMachineToJob(
            registered,
            { jobId: 'wo-pallet-44', requiredCapabilities: ['pick_place'] },
            at(12)
          )
        : registered;

  const withTelemetry = updateMachineTelemetry(
    assignedEntry,
    { telemetryRef: telemetry.telemetryRef ?? '', batteryPct: seed.battery, health: seed.health },
    at(seed.telemetryMinute)
  );

  const entry: FleetRegistryEntry = seed.offline
    ? markMachineOffline(withTelemetry, 'telemetry observation is stale', at(seed.telemetryMinute))
    : seed.machineId === 'rover-2'
      ? transitionMachineStatus(withTelemetry, 'faulted', at(31))
      : withTelemetry;

  const observationAgeMin = SNAPSHOT_MINUTE - seed.telemetryMinute;
  const updateState = telemetry.health === 'offline' || observationAgeMin >= 15
    ? 'offline'
    : observationAgeMin <= 2
      ? 'live'
      : 'delayed';

  return {
    entry,
    label: seed.label,
    telemetry,
    diagnostics: diagnosticsFromTelemetry(telemetry, new Date(at(SNAPSHOT_MINUTE))),
    lastSeen: observationAgeMin === 0 ? 'snapshot time' : `${observationAgeMin}m before snapshot`,
    owner: seed.owner,
    network: 'solana',
    observationAgeMin,
    updateState,
  };
}

/** Looks up one machine view by id. */
export const machineById = (machineId: string): MachineView | undefined =>
  fleetSnapshot().machines.find((view) => view.entry.machineId === machineId);

let cached: FleetSnapshot | undefined;

/** Builds the snapshot once and reuses it, since it is deterministic. */
export function fleetSnapshot(): FleetSnapshot {
  if (cached) return cached;

  const machines = SEEDS.map(buildMachine);
  const entries = machines.map((machine) => machine.entry);

  const session = createMachineSession({
    chain: 'solana',
    walletAddress: ACCOUNTS.drone,
    machineId: 'drone-9',
    operatorId: 'flight-ops',
    machineLabel: 'Roof Inspector 09',
    policyProfileId: DEFAULT_POLICY_PROFILE.policyId,
    mode: 'fixture',
    nonce: 'console:demo:drone-9',
    now: at(2),
    metadata: { role: 'drone', capabilities: ['inspection'] },
  });

  const intent = buildSettlementIntent({
    chain: 'solana',
    source: ACCOUNTS.drone,
    recipient: ACCOUNTS.recipient,
    amount: '0.5',
    asset: 'SOL',
    machineId: 'drone-9',
    sessionId: session.sessionId,
    policyId: DEFAULT_POLICY_PROFILE.policyId,
    memo: 'job:drone-inspection-9',
    nonce: 'console:demo:intent',
    now: at(34),
  });

  const roofScan = transitionWorkOrder(
    transitionWorkOrder(
      transitionWorkOrder(
        createWorkOrder(
          {
            workOrderId: 'wo-roof-scan-12',
            machineId: 'drone-9',
            requirement: { capabilities: ['inspection'], telemetryRequired: true, proofRequired: true },
            settlement: { chain: 'solana', amount: '0.5', asset: 'SOL', recipient: ACCOUNTS.recipient },
          },
          at(20)
        ),
        'assigned',
        { machineId: 'drone-9' },
        at(22)
      ),
      'preparing',
      {},
      at(24)
    ),
    'working',
    { telemetryRef: 'telemetry:drone-9:cycle-1' },
    at(26)
  );

  const palletMove = transitionWorkOrder(
    createWorkOrder(
      {
        workOrderId: 'wo-pallet-44',
        machineId: 'arm-17',
        requirement: { capabilities: ['pick_place'], telemetryRequired: true },
        settlement: { chain: 'solana', amount: '1.25', asset: 'SOL', recipient: ACCOUNTS.recipient },
      },
      at(10)
    ),
    'assigned',
    { machineId: 'arm-17' },
    at(12)
  );

  const yardRun = createWorkOrder(
    {
      workOrderId: 'wo-yard-run-07',
      requirement: { capabilities: ['delivery'], telemetryRequired: true },
      settlement: { chain: 'solana', amount: '0.25', asset: 'SOL', recipient: ACCOUNTS.recipient },
    },
    at(15)
  );

  const events: RuntimeEvent[] = [
    createRuntimeEvent({
      type: 'settlement.intent.created',
      machineId: 'drone-9',
      sessionId: session.sessionId,
      occurredAt: at(34),
      payload: { amount: '0.5', asset: 'SOL', intentId: intent.intentId },
    }),
    createRuntimeEvent({
      type: 'policy.checked',
      machineId: 'drone-9',
      sessionId: session.sessionId,
      occurredAt: at(33),
      payload: { policyId: DEFAULT_POLICY_PROFILE.policyId, accepted: true },
    }),
  ];

  cached = {
    machines,
    registry: summarizeRegistry(entries),
    readiness: summarizeFleetReadiness(entries),
    session,
    intent,
    workOrders: [roofScan, palletMove, yardRun],
    events,
    policy: DEFAULT_POLICY_PROFILE,
    generatedAt: at(SNAPSHOT_MINUTE),
  };
  return cached;
}

/** The committed fixture signature the verifier is pre-filled with. */
export const FIXTURE_SIGNATURE = fixtureData.solana.receipts[0]!.id;

export const DEMO_ACCOUNTS = ACCOUNTS;

/** Normalized views of the repository's committed Solana fixture records. */
export interface ReceiptEntry {
  signature: string;
  status: string;
  finality: string;
  amount: string;
  asset: string;
  machineId: string;
  memo: string;
  sessionId: string;
  slot: number;
  confirmations: number;
}

export const RECEIPTS: ReceiptEntry[] = fixtureData.solana.receipts.map((receipt) => ({
    signature: receipt.id,
    status: receipt.status,
    finality: receipt.confirmationStatus,
    amount: receipt.amount,
    asset: 'SOL',
    machineId: receipt.machineId,
    memo: receipt.memo,
    sessionId: receipt.sessionId,
    slot: receipt.slot,
    confirmations: receipt.confirmations,
  }));

/**
 * Provenance of a displayed record.
 *   sdk     - produced by a real SDK call in this process
 *   fixture - the repository's committed fixture data
 *   local   - console-local demo metadata, no upstream source
 *
 * Rendered as a badge so nothing on screen can be mistaken for a confirmed
 * on-chain event.
 */
export type RecordSource = 'sdk' | 'fixture' | 'local';

export interface ActivityEntry {
  /** Event type identifier. */
  type: string;
  /** Human title. */
  title: string;
  /** Supporting mono detail. */
  detail: string;
  /** Explicit record relationship; never inferred from display text. */
  machineId?: string | undefined;
  at: string;
  tone: 'success' | 'active' | 'degraded' | 'faulted' | 'neutral';
  source: RecordSource;
}

/**
 * Event types the runtime can emit. Types with no record in this session are
 * reported as such rather than being invented.
 */
export const KNOWN_ACTIVITY_TYPES = [
  'machine.registered',
  'session.record.created',
  'resource.requested',
  'provider.selected',
  'work-order.record.created',
  'work-order.record.updated',
  'settlement.intent.created',
  'policy.checked',
  'receipt.verified',
  'machine.action',
] as const;

/** Builds the activity feed from records that genuinely exist. */
export function activityFeed(): ActivityEntry[] {
  const snap = fleetSnapshot();
  const entries: ActivityEntry[] = [];

  for (const view of snap.machines) {
    entries.push({
      type: 'machine.registered',
      title: `Machine registered · ${view.label}`,
      detail: `${view.entry.machineId} · role ${view.entry.role} · operator ${view.entry.operatorId}`,
      machineId: view.entry.machineId,
      at: view.entry.createdAt,
      tone: 'neutral',
      source: 'sdk',
    });
  }

  entries.push({
    type: 'session.record.created',
    title: 'Runtime session record created',
    detail: `${snap.session.sessionId} · mode ${snap.session.mode}`,
    machineId: snap.session.machineId,
    at: snap.session.createdAt,
    tone: 'success',
    source: 'sdk',
  });

  for (const order of snap.workOrders) {
    entries.push({
      type: 'work-order.record.created',
      title: `Work-order record created · ${order.workOrderId}`,
      detail: `current stage ${order.stage}${order.machineId ? ` · machine ${order.machineId}` : ''}`,
      ...(order.machineId ? { machineId: order.machineId } : {}),
      at: order.createdAt,
      tone: 'neutral',
      source: 'sdk',
    });
    if (order.updatedAt !== order.createdAt) {
      entries.push({
        type: 'work-order.record.updated',
        title: `Work-order record last updated · ${order.workOrderId}`,
        detail: `current stage ${order.stage}; intermediate transition timestamps are not retained${order.machineId ? ` · machine ${order.machineId}` : ''}`,
        ...(order.machineId ? { machineId: order.machineId } : {}),
        at: order.updatedAt,
        tone: order.stage === 'failed' ? 'faulted' : 'active',
        source: 'sdk',
      });
    }
  }

  entries.push({
    type: 'settlement.intent.created',
    title: 'Settlement intent record created',
    detail: `${snap.intent.amount} ${snap.intent.asset} · unsigned · broadcast ${String(snap.intent.broadcast)}`,
    machineId: snap.intent.machineId,
    at: snap.intent.createdAt,
    tone: 'active',
    source: 'sdk',
  });

  for (const event of snap.events) {
    if (!['machine.action', 'policy.checked', 'receipt.verified'].includes(event.type)) continue;
    const action = String(event.payload['action'] ?? event.type);
    entries.push({
      type: event.type,
      title: `Runtime event · ${action.replace(/_/g, ' ')}`,
      detail: `${event.machineId} · ${Object.entries(event.payload).map(([key, value]) => `${key}=${String(value)}`).join(' · ')}`,
      machineId: event.machineId,
      at: event.occurredAt,
      tone: action.includes('fault')
        ? 'faulted'
        : event.type === 'policy.checked'
          ? event.payload['accepted'] === true
            ? 'success'
            : event.payload['accepted'] === false
              ? 'faulted'
              : 'neutral'
          : event.type === 'receipt.verified'
            ? event.payload['verified'] === true
              ? 'success'
              : event.payload['verified'] === false
                ? 'faulted'
                : 'neutral'
            : 'degraded',
      source: 'sdk',
    });
  }

  return entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** Event types with no record in this session. */
export function missingActivityTypes(): string[] {
  const present = new Set(activityFeed().map((entry) => entry.type));
  return KNOWN_ACTIVITY_TYPES.filter((type) => !present.has(type));
}

export interface OverviewCounters {
  machines: number;
  activeMachines: number;
  activeJobs: number;
  totalJobs: number;
  /** No request pipeline exists in this repository, so this is structurally 0. */
  resourceRequests: number;
  resourcesProvided: number;
  /** Settled volume only. Unsigned intents are counted separately. */
  settledVolume: string;
  pendingIntentVolume: string;
  pendingIntentCount: number;
}

const ACTIVE_STAGES = new Set(['assigned', 'preparing', 'working', 'proof_submitted']);
const CLOSED_STAGES = new Set(['settled', 'failed', 'cancelled']);

export function overviewCounters(): OverviewCounters {
  const snap = fleetSnapshot();
  const settled = snap.workOrders.filter((order) => order.stage === 'settled');
  const settledTotal = settled.reduce((sum, order) => sum + Number(order.settlement.amount), 0);

  return {
    machines: snap.registry.total,
    activeMachines: snap.machines.filter((view) => view.entry.status === 'working').length,
    activeJobs: snap.workOrders.filter((order) => ACTIVE_STAGES.has(order.stage)).length,
    totalJobs: snap.workOrders.length,
    resourceRequests: 0,
    resourcesProvided: 0,
    settledVolume: settledTotal.toFixed(3),
    pendingIntentVolume: Number(snap.intent.amount).toFixed(3),
    pendingIntentCount: 1,
  };
}

/** Work orders that are in flight, for the Active Jobs table. */
export function activeJobs() {
  return fleetSnapshot().workOrders.filter((order) => !CLOSED_STAGES.has(order.stage));
}
