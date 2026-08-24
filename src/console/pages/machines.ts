import {
  AddressDisplay,
  Amount,
  Chips,
  CommandButton,
  CopyButton,
  CountBadge,
  DataCard,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  type Html,
  KeyValueList,
  MachineBadge,
  Meter,
  Modal,
  LoadingState,
  OverlayActions,
  Split,
  StageRail,
  Stack,
  StatCard,
  StatGrid,
  StatusBadge,
  Tabs,
  SelectInput,
  TextInput,
  Timeline,
  Toggle,
  EMPTY,
  html,
  join,
} from '../ui/index.js';
import {
  RECEIPTS,
  WORK_ORDER_STAGES,
  activityFeed,
  fleetSnapshot,
  machineById,
  type MachineView,
} from '../data/fleet-snapshot.js';
import {
  loadMachineRuntime,
  type RuntimeConnectionState,
  type RuntimeEventRecord,
  type RuntimeJobRecord,
  type RuntimeMachineRecord,
  type RuntimeMachineState,
  type RuntimeSeverity,
} from '../services/runtime.js';
import { MACHINE_SESSION_ROLES } from '../../adapters/shared/types.js';

/**
 * Machines list and machine detail.
 *
 * The list is deliberately a compact table rather than large cards, so a fleet
 * of any size stays scannable. Every value shown is either an SDK-derived
 * record or explicitly marked as unavailable.
 */

const clock = (iso: string): string => iso.slice(11, 16);

const observationAge = (view: MachineView): string =>
  view.observationAgeMin === 0 ? 'snapshot time' : `${view.observationAgeMin}m before snapshot`;

const dash = (): Html => html`<span class="mc-dim">—</span>`;

// ---------------------------------------------------------------------------
// Register machine modal
// ---------------------------------------------------------------------------

/**
 * Registration maps onto the runtime's pairing operation, which derives a
 * wallet-linked session. There is no persistence layer in this repository, so
 * the modal is explicit that the result is a derived record, not a stored one.
 */
export function registerMachineModal(): Html {
  return Modal({
    id: 'mc-register-modal',
    title: 'Register machine',
    description: 'Derives a non-persisted runtime session from supplied identifiers.',
    size: 'lg',
    children: html`<form id="mc-register-form" class="mc-col mc-gap-11">
        <div class="mc-split">
          ${Field({
            inputId: 'mc-reg-machine',
            label: 'Machine id',
            hint: 'Lowercase, dots, dashes, colons',
            children: TextInput({ inputId: 'mc-reg-machine', value: 'drone-12' }),
          })}
          ${Field({
            inputId: 'mc-reg-operator',
            label: 'Operator id',
            children: TextInput({ inputId: 'mc-reg-operator', value: 'flight-ops' }),
          })}
        </div>
        ${Field({
          inputId: 'mc-reg-wallet',
          label: 'Session address',
          hint: 'Base58 Solana account field; no signature or proof of control',
          wide: true,
          children: TextInput({ inputId: 'mc-reg-wallet', value: '11111111111111111111111111111111' }),
        })}
        <div class="mc-split">
          ${Field({
            inputId: 'mc-reg-label',
            label: 'Display label',
            children: TextInput({ inputId: 'mc-reg-label', value: 'Roof Inspector 12' }),
          })}
          ${Field({
            inputId: 'mc-reg-role',
            label: 'Runtime session role',
            hint: 'Normalized to the runtime MachineRole model',
            children: SelectInput({
              inputId: 'mc-reg-role',
              value: 'drone',
              required: true,
              options: MACHINE_SESSION_ROLES.map((role) => ({ value: role, label: role })),
            }),
          })}
        </div>
        <div class="mc-row mc-row--wrap">${Toggle({ inputId: 'mc-reg-fixture', label: 'Fixture', checked: true })}</div>
        <p class="mc-dim mc-flush mc-fs-11">
          This calls <span class="mc-mono">POST /api/pair</span>, which derives a session id from the machine, operator,
          and policy profile. The runtime has no machine store, so the record is returned rather than saved and will not
          appear in the list below.
        </p>
      </form>
      <div id="mc-register-out" class="mc-mt-14" role="region" aria-label="Registration result" aria-live="polite"></div>`,
    footer: html`<span class="mc-dim mc-fs-11" id="mc-register-status" role="status" aria-live="polite">No keys are read or generated</span>
      ${OverlayActions({
        children: join(
          [
            CommandButton({ label: 'Cancel', size: 'sm', action: 'close-overlay', target: 'mc-register-modal' }),
            CommandButton({
              label: 'Derive session',
              variant: 'primary',
              size: 'sm',
              icon: 'play',
              type: 'submit',
              form: 'mc-register-form',
            }),
          ],
          ' '
        ),
      })}`,
  });
}

// ---------------------------------------------------------------------------
// Machines list
// ---------------------------------------------------------------------------

export function machinesSection(): Html {
  const snap = fleetSnapshot();
  const live = snap.machines.filter((v) => v.updateState === 'live').length;

  const columns = [
    {
      key: 'machine',
      header: 'Machine',
      cell: (v: MachineView) =>
        html`<a class="mc-machine-link" href="/console/machines/${encodeURIComponent(v.entry.machineId)}"
          >${MachineBadge({ name: v.label, machineId: v.entry.machineId, role: v.entry.role })}</a
        >`,
    },
    { key: 'type', header: 'Type', mono: true, cell: (v: MachineView) => v.entry.role },
    {
      key: 'link',
      header: 'Update',
      cell: (v: MachineView) =>
        StatusBadge({
          label: v.updateState,
          tone: v.updateState === 'live' ? 'online' : v.updateState === 'delayed' ? 'degraded' : 'offline',
          dot: v.updateState === 'live' ? 'solid' : 'ring',
          title: `Derived from telemetry observation age (${observationAge(v)}), not self-reported`,
        }),
    },
    {
      key: 'runtime',
      header: 'Runtime',
      cell: (v: MachineView) => StatusBadge({ label: v.entry.status }),
    },
    {
      key: 'health',
      header: 'Health',
      cell: (v: MachineView) => StatusBadge({ label: v.telemetry.health }),
    },
    {
      key: 'caps',
      header: 'Capabilities',
      cell: (v: MachineView) => Chips({ items: v.entry.capabilities }),
    },
    {
      key: 'job',
      header: 'Current job',
      mono: true,
      cell: (v: MachineView) => (v.entry.activeJobId ? v.entry.activeJobId : dash()),
    },
    {
      key: 'observation',
      header: 'Latest observation',
      align: 'num' as const,
      cell: (v: MachineView) => observationAge(v),
    },
    { key: 'owner', header: 'Declared owner', cell: (v: MachineView) => v.owner },
    {
      key: 'network',
      header: 'Network',
      tight: true,
      cell: (v: MachineView) => StatusBadge({ label: v.network, tone: 'neutral', dot: 'none', size: 'sm' }),
    },
  ];

  return Stack({
    children: join([
      StatGrid({
        children: join([
          StatCard({ label: 'Registered', value: snap.registry.total, icon: 'fleet' }),
          StatCard({
            label: 'Fresh observations',
            value: live,
            unit: `/ ${snap.registry.total}`,
            icon: 'zap',
            tone: live < snap.registry.total ? 'alert' : 'default',
            hint: 'observation age ≤ 2m',
          }),
          StatCard({
            label: 'Assignable',
            value: snap.registry.available.length,
            icon: 'machine',
            hint: 'idle, healthy, charged',
          }),
          StatCard({
            label: 'Faulted',
            value: snap.registry.faulted.length,
            icon: 'alert',
            tone: snap.registry.faulted.length > 0 ? 'alert' : 'default',
            hint: snap.registry.faulted.join(', ') || 'none',
          }),
        ]),
      }),
      snap.machines.length === 0
        ? DataCard({
            flush: true,
            children: EmptyState({
              title: 'No machine records',
              description: 'Derive a non-persisted session record or connect a registry source to populate this view.',
              icon: 'fleet',
              actions: CommandButton({
                label: 'Register machine',
                variant: 'primary',
                size: 'sm',
                icon: 'play',
                action: 'open-overlay',
                target: 'mc-register-modal',
              }),
            }),
          })
        : DataTable({
            columns,
            rows: snap.machines,
            rowKey: (v) => v.entry.machineId,
            caption:
              'Machines with type, update freshness, runtime status, health, capabilities, current job, observation age, declared owner, and network',
            compact: true,
            totalCount: snap.registry.total,
            footer: html`<span class="mc-dim mc-fs-11"
              >Update freshness and health are derived from recorded telemetry, not network reachability.</span
            >`,
          }),
      registerMachineModal(),
    ]),
  });
}

// ---------------------------------------------------------------------------
// Machine detail
// ---------------------------------------------------------------------------

function detailOverview(view: MachineView): Html {
  const snap = fleetSnapshot();
  const job = view.entry.activeJobId
    ? snap.workOrders.find((order) => order.workOrderId === view.entry.activeJobId)
    : undefined;
  const feed = activityFeed().filter((entry) => entry.machineId === view.entry.machineId).slice(0, 6);
  const intent = view.entry.machineId === snap.intent.machineId ? snap.intent : undefined;
  const receipts = RECEIPTS.filter((r) => r.machineId === view.entry.machineId);

  return Stack({
    children: join([
      Split({
        children: join([
          DataCard({
            title: 'Machine identity',
            icon: 'machine',
            actions: CopyButton({ value: view.entry.machineId, what: 'machine id' }),
            children: KeyValueList({
              rows: [
                { key: 'Machine id', value: view.entry.machineId, mono: true },
                { key: 'Label', value: view.label },
                { key: 'Type', value: view.entry.role, mono: true },
                { key: 'Declared owner', value: view.owner },
                { key: 'Operator', value: view.entry.operatorId, mono: true },
                {
                  key: 'Session-supplied address',
                  value: AddressDisplay({
                    value: view.entry.walletAddress,
                    full: true,
                    action: CopyButton({ value: view.entry.walletAddress, what: 'session-supplied address' }),
                  }),
                  mono: true,
                },
                { key: 'Fleet', value: view.entry.fleetId ?? 'unassigned', mono: true },
                { key: 'Site', value: view.entry.siteId ?? 'unassigned', mono: true },
                { key: 'Registered', value: view.entry.createdAt, mono: true },
              ],
            }),
          }),
          DataCard({
            title: 'Runtime status',
            icon: 'telemetry',
            badge: StatusBadge({ label: view.entry.status }),
            children: KeyValueList({
              rows: [
                {
                  key: 'Update freshness',
                  value: StatusBadge({
                    label: view.updateState,
                    tone: view.updateState === 'live' ? 'online' : view.updateState === 'delayed' ? 'degraded' : 'offline',
                    dot: view.updateState === 'live' ? 'solid' : 'ring',
                  }),
                },
                { key: 'Latest observation', value: observationAge(view), mono: true },
                { key: 'Telemetry health', value: StatusBadge({ label: view.telemetry.health, size: 'sm' }) },
                {
                  key: 'Battery',
                  value: Meter({ value: view.entry.batteryPct, showMax: true, label: `${view.label} battery` }),
                },
                {
                  key: 'Diagnostics',
                  value: view.diagnostics.messages.length
                    ? view.diagnostics.messages.join('; ')
                    : `${view.diagnostics.level}, no messages`,
                },
                { key: 'Telemetry ref', value: view.entry.lastTelemetryRef ?? 'none', mono: true },
                { key: 'Updated', value: view.entry.updatedAt, mono: true },
              ],
            }),
          }),
        ]),
      }),
      Split({
        children: join([
          DataCard({
            title: 'Capabilities',
            icon: 'zap',
            badge: CountBadge({ value: view.entry.capabilities.length }),
            children: html`${Chips({ items: view.entry.capabilities, tone: 'matched' })}
              <p class="mc-dim mc-flush mc-mt-8 mc-fs-11">
                Capabilities gate job assignment. A machine missing a required capability is rejected by the SDK before
                any intent is built.
              </p>`,
          }),
          DataCard({
            title: 'Current job',
            icon: 'machine',
            children: job
              ? html`${KeyValueList({
                  rows: [
                    { key: 'Work order', value: job.workOrderId, mono: true },
                    { key: 'Stage', value: StatusBadge({ label: job.stage }) },
                    {
                      key: 'Required capabilities',
                      value: Chips({ items: job.requirement.capabilities }),
                    },
                    {
                      key: 'Amount',
                      value: Amount({ value: job.settlement.amount, asset: job.settlement.asset }),
                    },
                    { key: 'Created', value: job.createdAt, mono: true },
                  ],
                })}
                <div class="mc-mt-8">
                  ${StageRail({
                    stages: WORK_ORDER_STAGES,
                    currentIndex: Math.max(0, WORK_ORDER_STAGES.indexOf(job.stage)),
                    label: `Stage ${WORK_ORDER_STAGES.indexOf(job.stage) + 1} of ${WORK_ORDER_STAGES.length}`,
                    className: 'mc-stages--inline',
                  })}
                </div>`
              : EmptyState({
                  title: 'No job assigned',
                  description: 'This machine is not currently executing a work order.',
                  icon: 'machine',
                  inline: true,
                }),
          }),
        ]),
      }),
      Split({
        aside: true,
        children: join([
          DataCard({
            title: 'Recent activity',
            icon: 'terminal',
            flush: true,
            children:
              feed.length === 0
                ? EmptyState({ title: 'No activity', description: 'No runtime events reference this machine.', icon: 'terminal', inline: true })
                : html`<div class="mc-pad">
                    ${Timeline({
                      ariaLabel: `Activity for ${view.label}`,
                      entries: feed.map((entry) => ({
                        title: entry.title,
                        meta: html`<span class="mc-mono">${entry.type}</span>
                          <span class="mc-dim">${entry.detail}</span>`,
                        time: clock(entry.at),
                        tone: entry.tone,
                      })),
                    })}
                  </div>`,
          }),
          Stack({
            children: join([
              DataCard({
                title: 'Resource usage',
                icon: 'resource',
                flush: true,
                children: EmptyState({
                  title: 'No resource usage',
                  description:
                    'This runtime has no resource-request pipeline, so no consumption is recorded for any machine.',
                  icon: 'resource',
                  inline: true,
                }),
              }),
              DataCard({
                title: 'Settlement summary',
                icon: 'settlement',
                children: KeyValueList({
                  rows: [
                    { key: 'Settled volume', value: Amount({ value: '0.000', asset: 'SOL' }) },
                    {
                      key: 'Unsigned intents',
                      value: intent
                        ? html`${Amount({ value: intent.amount, asset: intent.asset })}
                            ${StatusBadge({ label: 'not broadcast', tone: 'idle', dot: 'ring', size: 'sm' })}`
                        : html`<span class="mc-dim">none</span>`,
                    },
                    {
                      key: 'Fixture receipts',
                      value: receipts.length
                        ? html`${String(receipts.length)}
                            ${StatusBadge({ label: 'fixture', tone: 'idle', dot: 'ring', size: 'sm' })}`
                        : html`<span class="mc-dim">none</span>`,
                    },
                  ],
                }),
                footer: html`<span class="mc-dim mc-fs-11">Nothing has been broadcast by the runtime.</span>`,
              }),
            ]),
          }),
        ]),
      }),
    ]),
  });
}

const runtimeConnectionTone = (
  state: RuntimeConnectionState
): 'online' | 'degraded' | 'offline' | 'neutral' =>
  state === 'live' ? 'online' : state === 'delayed' ? 'degraded' : state === 'offline' ? 'offline' : 'neutral';

const runtimeSeverityTone = (severity: RuntimeSeverity): 'online' | 'active' | 'degraded' | 'faulted' | 'neutral' =>
  severity === 'ok'
    ? 'online'
    : severity === 'active'
      ? 'active'
      : severity === 'warning'
        ? 'degraded'
        : severity === 'error'
          ? 'faulted'
          : 'neutral';

const compactTimestamp = (value: string): string => value.replace('T', ' ').replace('.000Z', 'Z');

const durationLabel = (seconds: number | undefined): string => {
  if (seconds === undefined) return 'Not available';
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
};

function runtimeStateFailure(state: Exclude<RuntimeMachineState, { status: 'ready' }>): Html {
  if (state.status === 'loading') {
    return DataCard({ flush: true, children: LoadingState({ label: 'Loading machine runtime' }) });
  }
  if (state.status === 'unavailable') {
    return DataCard({
      flush: true,
      children: EmptyState({
        title: 'Runtime unavailable',
        description: state.reason,
        icon: 'terminal',
        actions: CommandButton({ label: 'Reload', size: 'sm', icon: 'refresh', action: 'reload' }),
      }),
    });
  }
  if (state.status === 'error') {
    return DataCard({
      flush: true,
      children: ErrorState({
        title: 'Runtime data could not be loaded',
        description: 'The application adapter failed to normalize the runtime snapshot.',
        detail: state.message,
        actions: CommandButton({ label: 'Retry', size: 'sm', icon: 'refresh', action: 'reload' }),
      }),
    });
  }
  if (state.status === 'not-found') {
    return DataCard({
      flush: true,
      children: ErrorState({ title: 'Machine not found', detail: state.machineId }),
    });
  }
  return DataCard({
    flush: true,
    children: EmptyState({
      title: 'No runtime machines',
      description: 'The runtime source returned no registered machines.',
      icon: 'fleet',
    }),
  });
}

function runtimeEventsTable(events: RuntimeEventRecord[], machine: RuntimeMachineRecord): Html {
  return DataTable({
    columns: [
      { key: 'time', header: 'Timestamp', mono: true, cell: (event: RuntimeEventRecord) => compactTimestamp(event.occurredAt) },
      { key: 'type', header: 'Type', mono: true, cell: (event: RuntimeEventRecord) => event.type },
      {
        key: 'source',
        header: 'Source',
        cell: (event: RuntimeEventRecord) =>
          StatusBadge({ label: event.source, tone: 'neutral', dot: 'ring', size: 'sm' }),
      },
      { key: 'summary', header: 'Payload summary', mono: true, cell: (event: RuntimeEventRecord) => event.payloadSummary },
      {
        key: 'severity',
        header: 'Severity',
        cell: (event: RuntimeEventRecord) =>
          StatusBadge({ label: event.severity, tone: runtimeSeverityTone(event.severity), size: 'sm' }),
      },
    ],
    rows: events,
    rowKey: (event) => event.eventId,
    caption: `Recent runtime and telemetry events for ${machine.label}`,
    compact: true,
    empty: EmptyState({
      title: 'No runtime events',
      description: 'No runtime event or telemetry snapshot record references this machine.',
      icon: 'terminal',
      inline: true,
    }),
    footer: html`<span class="mc-dim mc-fs-11">Bounded to the 40 most recent adapter records.</span>`,
  });
}

function runtimeSessionPanel(machine: RuntimeMachineRecord): Html {
  if (!machine.session) {
    return DataCard({
      flush: true,
      children: EmptyState({
        title: 'No active session record',
        description: 'This snapshot has no session for the machine. The runtime does not expose session control or discovery.',
        icon: 'shield',
        inline: true,
      }),
    });
  }
  const session = machine.session;
  return DataCard({
    title: 'Session record',
    icon: 'shield',
    badge: StatusBadge({ label: session.mode, tone: 'idle', dot: 'ring', size: 'sm' }),
    actions: CopyButton({ value: session.sessionId, what: 'session id' }),
    children: KeyValueList({
      rows: [
        { key: 'Session id', value: AddressDisplay({ value: session.sessionId, full: true }), mono: true },
        { key: 'Session status', value: 'Not available in the SDK session model' },
        { key: 'Operator', value: session.operatorId, mono: true },
        { key: 'Runtime rail', value: session.chain, mono: true },
        { key: 'Policy profile', value: session.policyProfileId, mono: true },
        { key: 'Started', value: compactTimestamp(session.createdAt), mono: true },
        { key: 'Last update', value: compactTimestamp(session.updatedAt), mono: true },
        { key: 'Derived duration', value: durationLabel(session.durationSeconds), mono: true },
      ],
    }),
    footer: html`<span class="mc-dim mc-fs-11"
      >Duration is derived from the session timestamp and snapshot generation time; no keepalive is implied.</span
    >`,
  });
}

function runtimeJobsPanel(machine: RuntimeMachineRecord): Html {
  type Job = RuntimeJobRecord;
  return Stack({
    children: join([
      machine.activeJob
        ? DataCard({
            title: 'Current job',
            icon: 'machine',
            badge: StatusBadge({ label: machine.activeJob.stage, size: 'sm' }),
            children: KeyValueList({
              rows: [
                { key: 'Work order', value: machine.activeJob.workOrderId, mono: true },
                { key: 'Runtime state', value: machine.activeJob.stage, mono: true },
                { key: 'Required capabilities', value: Chips({ items: machine.activeJob.requiredCapabilities }) },
                { key: 'Created', value: compactTimestamp(machine.activeJob.createdAt), mono: true },
                { key: 'Last update', value: compactTimestamp(machine.activeJob.updatedAt), mono: true },
                {
                  key: 'Telemetry ref',
                  value: machine.activeJob.telemetryRef ?? 'Not recorded',
                  mono: true,
                },
              ],
            }),
          })
        : DataCard({
            flush: true,
            children: EmptyState({
              title: 'No active job',
              description: 'The machine registry does not name an active work order.',
              icon: 'machine',
              inline: true,
            }),
          }),
      DataTable({
        columns: [
          { key: 'job', header: 'Work order', mono: true, cell: (job: Job) => job.workOrderId },
          { key: 'stage', header: 'Stage', cell: (job: Job) => StatusBadge({ label: job.stage, size: 'sm' }) },
          { key: 'caps', header: 'Requirements', cell: (job: Job) => Chips({ items: job.requiredCapabilities }) },
          { key: 'created', header: 'Created', mono: true, cell: (job: Job) => compactTimestamp(job.createdAt) },
          { key: 'updated', header: 'Updated', mono: true, cell: (job: Job) => compactTimestamp(job.updatedAt) },
        ],
        rows: machine.jobs,
        rowKey: (job) => job.workOrderId,
        caption: `Recorded work orders for ${machine.label}`,
        compact: true,
        empty: EmptyState({
          title: 'No work orders',
          description: 'No work order in the snapshot is assigned to this machine.',
          icon: 'machine',
          inline: true,
        }),
      }),
    ]),
  });
}

function runtimeTelemetryPanel(machine: RuntimeMachineRecord): Html {
  const telemetry = machine.telemetry;
  return Stack({
    children: join([
      DataCard({
        title: 'Current telemetry snapshot',
        icon: 'telemetry',
        badge: StatusBadge({ label: telemetry.diagnosticLevel, size: 'sm', dot: 'ring' }),
        children: KeyValueList({
          rows: [
            { key: 'Machine state', value: StatusBadge({ label: telemetry.health, size: 'sm' }) },
            { key: 'Observed', value: compactTimestamp(telemetry.observedAt), mono: true },
            { key: 'Battery', value: telemetry.batteryPct === undefined ? 'Not available' : `${telemetry.batteryPct}%`, mono: true },
            { key: 'Signal', value: telemetry.signalPct === undefined ? 'Not available' : `${telemetry.signalPct}%`, mono: true },
            { key: 'Progress', value: telemetry.progressPct === undefined ? 'Not available' : `${telemetry.progressPct}%`, mono: true },
            { key: 'Telemetry ref', value: telemetry.telemetryRef ?? 'Not available', mono: true },
          ],
        }),
      }),
      DataCard({
        title: 'Telemetry history',
        icon: 'telemetry',
        flush: true,
        children: EmptyState({
          title: 'Time series unavailable',
          description: 'The runtime exposes one current snapshot here, not a telemetry history or subscription stream.',
          icon: 'telemetry',
          inline: true,
        }),
      }),
    ]),
  });
}

function runtimePolicyPanel(machine: RuntimeMachineRecord): Html {
  if (!machine.policy) {
    return DataCard({
      flush: true,
      children: EmptyState({
        title: 'Policy unavailable',
        description: 'No session policy is associated with this machine in the runtime snapshot.',
        icon: 'shield',
        inline: true,
      }),
    });
  }
  return DataCard({
    title: machine.policy.displayName,
    icon: 'shield',
    actions: CopyButton({ value: machine.policy.policyId, what: 'policy id' }),
    children: KeyValueList({
      rows: [
        { key: 'Policy id', value: machine.policy.policyId, mono: true },
        { key: 'Allowed rails', value: Chips({ items: machine.policy.allowedRails }) },
        { key: 'Allowed assets', value: Chips({ items: machine.policy.allowedAssets }) },
        { key: 'Max intent amount', value: machine.policy.maxAmountPerIntent, mono: true },
        { key: 'Max session budget', value: machine.policy.maxSessionBudget ?? 'Not specified', mono: true },
        { key: 'Machine roles', value: Chips({ items: machine.policy.machineRoles }) },
        { key: 'Capability tags', value: Chips({ items: machine.policy.capabilityTags }) },
      ],
    }),
    footer: html`<span class="mc-dim mc-fs-11">Policy values are descriptive; this console does not evaluate or mutate them.</span>`,
  });
}

function runtimeSettlementPanel(machine: RuntimeMachineRecord): Html {
  type Settlement = RuntimeMachineRecord['settlements'][number];
  return DataTable({
    columns: [
      { key: 'id', header: 'Intent', mono: true, cell: (item: Settlement) => item.intentId },
      { key: 'amount', header: 'Amount', align: 'num' as const, cell: (item: Settlement) => Amount({ value: item.amount, asset: item.asset }) },
      { key: 'rail', header: 'Rail', mono: true, cell: (item: Settlement) => item.rail },
      { key: 'status', header: 'Status', cell: (item: Settlement) => StatusBadge({ label: item.status, tone: 'idle', dot: 'ring', size: 'sm' }) },
      { key: 'created', header: 'Created', mono: true, cell: (item: Settlement) => compactTimestamp(item.createdAt) },
      { key: 'broadcast', header: 'Broadcast', mono: true, cell: (item: Settlement) => String(item.broadcast) },
    ],
    rows: machine.settlements,
    rowKey: (item) => item.intentId,
    caption: `Settlement intents for ${machine.label}`,
    compact: true,
    empty: EmptyState({
      title: 'No settlement intent',
      description: 'No settlement intent in this runtime snapshot references the machine.',
      icon: 'settlement',
      inline: true,
    }),
    footer: html`<span class="mc-dim mc-fs-11">Runtime intents are caller-wallet, unsigned, and never broadcast here.</span>`,
  });
}

function runtimeProofPanel(machine: RuntimeMachineRecord): Html {
  if (machine.proofs.length === 0) {
    const required = machine.jobs.filter((job) => job.proofRequired).map((job) => job.workOrderId);
    return DataCard({
      flush: true,
      children: EmptyState({
        title: 'No proof records',
        description:
          required.length > 0
            ? `Proof is required by ${required.join(', ')}, but no proof id has been recorded.`
            : 'No assigned work order requires or records a proof id.',
        icon: 'audit',
        inline: true,
      }),
    });
  }
  return KeyValueList({
    rows: machine.proofs.map((proof) => ({ key: proof.workOrderId, value: proof.proofId, mono: true })),
  });
}

function detailRuntime(view: MachineView, state: RuntimeMachineState = loadMachineRuntime(view.entry.machineId)): Html {
  if (state.status !== 'ready') return runtimeStateFailure(state);
  const machine = state.data;
  const offlineNotice = machine.connection.state === 'offline'
    ? DataCard({
        tone: 'alert',
        flush: true,
        children: EmptyState({
          title: 'Machine offline',
          description: `${machine.connection.reason} The records below are the last available snapshot, not a live control channel.`,
          icon: 'alert',
          inline: true,
        }),
      })
    : EMPTY;

  const runtimeTabs = [
    { id: 'rt-session', label: 'Session', icon: 'shield' as const, panel: runtimeSessionPanel(machine) },
    { id: 'rt-jobs', label: 'Jobs', icon: 'machine' as const, panel: runtimeJobsPanel(machine) },
    { id: 'rt-telemetry', label: 'Telemetry', icon: 'telemetry' as const, panel: runtimeTelemetryPanel(machine) },
    { id: 'rt-policy', label: 'Policy', icon: 'shield' as const, panel: runtimePolicyPanel(machine) },
    { id: 'rt-settlement', label: 'Settlement', icon: 'settlement' as const, panel: runtimeSettlementPanel(machine) },
    { id: 'rt-proof', label: 'Proof', icon: 'audit' as const, panel: runtimeProofPanel(machine) },
  ];

  return Stack({
    children: join([
      Split({
        children: join([
          DataCard({
            title: 'Runtime header',
            icon: 'terminal',
            badge: StatusBadge({
              label: machine.runtimeStatus,
              size: 'sm',
            }),
            children: KeyValueList({
              rows: [
                { key: 'Machine', value: machine.label },
                { key: 'Machine id', value: machine.machineId, mono: true },
                { key: 'Runtime status', value: machine.runtimeStatus, mono: true },
                { key: 'Runtime rail', value: machine.network.rail, mono: true },
                { key: 'Last runtime activity', value: machine.lastRuntimeActivityAt ? compactTimestamp(machine.lastRuntimeActivityAt) : 'Not available', mono: true },
              ],
            }),
          }),
          DataCard({
            title: 'Connectivity',
            icon: 'zap',
            badge: StatusBadge({
              label: machine.connection.state,
              tone: runtimeConnectionTone(machine.connection.state),
              dot: machine.connection.state === 'unknown' ? 'ring' : 'solid',
              size: 'sm',
              title: machine.connection.reason,
            }),
            children: KeyValueList({
              rows: [
                { key: 'Update state', value: machine.connection.state, mono: true },
                { key: 'Observation age', value: machine.connection.observationAgeMinutes === undefined ? 'Not available' : `${machine.connection.observationAgeMinutes}m`, mono: true },
                { key: 'Last observed', value: machine.connection.lastObservedAt ? compactTimestamp(machine.connection.lastObservedAt) : 'Not available', mono: true },
                {
                  key: 'Network reachability',
                  value: StatusBadge({
                    label: machine.network.state === 'unknown' ? 'not observed' : machine.network.state,
                    tone: machine.network.state === 'connected' ? 'online' : machine.network.state === 'disconnected' ? 'faulted' : 'neutral',
                    dot: 'ring',
                    size: 'sm',
                    title: machine.network.reason,
                  }),
                },
              ],
            }),
          }),
        ]),
      }),
      offlineNotice,
      Tabs({ items: runtimeTabs, active: 'rt-session', ariaLabel: `${machine.label} runtime sections`, variant: 'enclosed' }),
      DataCard({
        title: 'Runtime lifecycle records',
        icon: 'terminal',
        flush: true,
        badge: CountBadge({ value: machine.events.length }),
        children:
          machine.events.length === 0
            ? EmptyState({
                title: 'No lifecycle records',
                description: 'No runtime event or telemetry snapshot record references this machine.',
                icon: 'terminal',
                inline: true,
              })
            : html`<div class="mc-pad">
                ${Timeline({
                  ariaLabel: `Runtime lifecycle records for ${machine.label}`,
                  entries: machine.events.map((event) => ({
                    title: event.type,
                    meta: html`<span class="mc-mono">${event.source}</span>
                      <span class="mc-dim">${event.payloadSummary}</span>`,
                    time: compactTimestamp(event.occurredAt),
                    tone:
                      event.severity === 'warning'
                        ? 'warn'
                        : event.severity === 'error'
                          ? 'error'
                          : event.severity === 'ok'
                            ? 'ok'
                            : event.severity,
                  })),
                })}
              </div>`,
        footer: html`<span class="mc-dim mc-fs-11"
          >Only recorded runtime events and the current telemetry snapshot appear; missing lifecycle stages are not synthesized.</span
        >`,
      }),
    ]),
  });
}

function detailJobs(view: MachineView): Html {
  const jobs = fleetSnapshot().workOrders.filter((order) => order.machineId === view.entry.machineId);
  type Job = (typeof jobs)[number];
  if (jobs.length === 0) {
    return DataCard({
      flush: true,
      children: EmptyState({
        title: 'No work orders',
        description: 'No work order in this session is assigned to this machine.',
        icon: 'machine',
        inline: true,
      }),
    });
  }
  return DataTable({
    columns: [
      { key: 'job', header: 'Work order', mono: true, cell: (o: Job) => o.workOrderId },
      { key: 'stage', header: 'Stage', cell: (o: Job) => StatusBadge({ label: o.stage }) },
      {
        key: 'capabilities',
        header: 'Required capabilities',
        cell: (o: Job) => Chips({ items: o.requirement.capabilities }),
      },
      {
        key: 'amount',
        header: 'Amount',
        align: 'num' as const,
        cell: (o: Job) => Amount({ value: o.settlement.amount, asset: o.settlement.asset }),
      },
      { key: 'created', header: 'Created', align: 'num' as const, cell: (o: Job) => clock(o.createdAt) },
      { key: 'updated', header: 'Updated', align: 'num' as const, tight: true, cell: (o: Job) => clock(o.updatedAt) },
    ],
    rows: jobs,
    rowKey: (o) => o.workOrderId,
    caption: `Work orders assigned to ${view.label}`,
    compact: true,
  });
}

function detailResources(view: MachineView): Html {
  return DataCard({
    flush: true,
    children: EmptyState({
      title: 'No resource requests',
      description: `${view.label} has no persisted resource request history. Provider discovery and request submission are unavailable until a marketplace backend is configured.`,
      icon: 'resource',
      actions: CommandButton({
        label: 'Open Resources',
        href: '/console/resources',
        size: 'sm',
        variant: 'quiet',
        iconAfter: 'chevron-right',
      }),
    }),
  });
}

function detailTelemetry(
  view: MachineView,
  state: RuntimeMachineState = loadMachineRuntime(view.entry.machineId)
): Html {
  if (state.status !== 'ready') return runtimeStateFailure(state);
  const machine = state.data;
  const telemetry = machine.telemetry;
  const readingBlocks: Html[] = [];
  if (telemetry.batteryPct !== undefined) {
    readingBlocks.push(html`<div class="mc-col mc-gap-3">
      <span class="mc-label">Battery</span>
      ${Meter({ value: telemetry.batteryPct, showMax: true, label: `${machine.label} battery` })}
    </div>`);
  }
  if (telemetry.signalPct !== undefined) {
    readingBlocks.push(html`<div class="mc-col mc-gap-3">
      <span class="mc-label">Signal</span>
      ${Meter({ value: telemetry.signalPct, showMax: true, tone: 'online', label: `${machine.label} signal` })}
    </div>`);
  }
  if (telemetry.progressPct !== undefined) {
    readingBlocks.push(html`<div class="mc-col mc-gap-3">
      <span class="mc-label">Progress</span>
      ${Meter({ value: telemetry.progressPct, showMax: true, tone: 'working', label: `${machine.label} progress` })}
    </div>`);
  }

  return Stack({
    children: join([
      machine.connection.state === 'offline'
        ? DataCard({
            tone: 'alert',
            flush: true,
            children: EmptyState({
              title: 'Machine offline',
              description: `${machine.connection.reason} Readings below are the last recorded snapshot.`,
              icon: 'alert',
              inline: true,
            }),
          })
        : EMPTY,
      Split({
        children: join([
          DataCard({
            title: 'Machine and runtime state',
            icon: 'machine',
            badge: StatusBadge({ label: telemetry.health, size: 'sm' }),
            children: KeyValueList({
              rows: [
                { key: 'Machine state', value: telemetry.health, mono: true },
                { key: 'Runtime state', value: machine.runtimeStatus, mono: true },
                { key: 'Runtime rail', value: machine.network.rail, mono: true },
                { key: 'Session', value: machine.session?.sessionId ?? 'No session record', mono: true },
                {
                  key: 'Current activity',
                  value: machine.activeJob
                    ? `${machine.activeJob.workOrderId} · ${machine.activeJob.stage}`
                    : 'No active job',
                  mono: true,
                },
              ],
            }),
          }),
          DataCard({
            title: 'Snapshot freshness',
            icon: 'telemetry',
            badge: StatusBadge({
              label: machine.connection.state,
              tone: runtimeConnectionTone(machine.connection.state),
              dot: machine.connection.state === 'unknown' ? 'ring' : 'solid',
              size: 'sm',
              title: machine.connection.reason,
            }),
            children: KeyValueList({
              rows: [
                {
                  key: 'Last observed',
                  value: machine.connection.lastObservedAt
                    ? compactTimestamp(machine.connection.lastObservedAt)
                    : 'Not available',
                  mono: true,
                },
                {
                  key: 'Observation age',
                  value:
                    machine.connection.observationAgeMinutes === undefined
                      ? 'Not available'
                      : `${machine.connection.observationAgeMinutes}m`,
                  mono: true,
                },
                { key: 'Last update', value: compactTimestamp(telemetry.observedAt), mono: true },
                { key: 'Telemetry ref', value: telemetry.telemetryRef ?? 'Not available', mono: true },
                { key: 'Diagnostic status', value: telemetry.diagnosticLevel, mono: true },
              ],
            }),
            footer: html`<span class="mc-dim mc-fs-11"
              >Update state is derived from the recorded telemetry timestamp; it is not a socket or polling indicator.</span
            >`,
          }),
        ]),
      }),
      DataCard({
        title: 'Current readings',
        icon: 'telemetry',
        actions: StatusBadge({
          label: telemetry.diagnosticLevel,
          size: 'sm',
          dot: 'ring',
          title: telemetry.diagnosticMessages.join('; ') || 'No diagnostic messages',
        }),
        children:
          readingBlocks.length > 0
            ? html`<div class="mc-split">${join(readingBlocks)}</div>`
            : EmptyState({
                title: 'No numeric readings',
                description: 'The telemetry snapshot contains state and timestamp fields but no numeric readings.',
                icon: 'telemetry',
                inline: true,
              }),
      }),
      telemetry.location || telemetry.pose
        ? DataCard({
            title: 'Position',
            icon: 'machine',
            children: KeyValueList({
              rows: [
                ...(telemetry.location
                  ? [
                      { key: 'Latitude', value: String(telemetry.location.lat), mono: true },
                      { key: 'Longitude', value: String(telemetry.location.lon), mono: true },
                      ...(telemetry.location.altitudeM === undefined
                        ? []
                        : [{ key: 'Altitude', value: `${telemetry.location.altitudeM}m`, mono: true }]),
                    ]
                  : []),
                ...(telemetry.pose
                  ? [
                      { key: 'Pose X', value: String(telemetry.pose.x), mono: true },
                      { key: 'Pose Y', value: String(telemetry.pose.y), mono: true },
                      ...(telemetry.pose.z === undefined
                        ? []
                        : [{ key: 'Pose Z', value: String(telemetry.pose.z), mono: true }]),
                      ...(telemetry.pose.yawDeg === undefined
                        ? []
                        : [{ key: 'Yaw', value: `${telemetry.pose.yawDeg}°`, mono: true }]),
                    ]
                  : []),
              ],
            }),
          })
        : EMPTY,
      DataCard({
        title: 'Diagnostics',
        icon: 'alert',
        tone: telemetry.diagnosticLevel === 'error' ? 'alert' : 'default',
        children: telemetry.diagnosticMessages.length
          ? KeyValueList({
              rows: telemetry.diagnosticMessages.map((message, index) => ({
                key: `Message ${index + 1}`,
                value: message,
              })),
            })
          : EmptyState({
              title: 'No diagnostic messages',
              description: `The normalized diagnostic level is ${telemetry.diagnosticLevel}.`,
              icon: 'shield',
              inline: true,
            }),
      }),
      DataCard({
        title: 'Recent events',
        icon: 'terminal',
        flush: true,
        badge: CountBadge({ value: machine.events.length }),
        children: runtimeEventsTable(machine.events, machine),
      }),
      DataCard({
        title: 'Telemetry history',
        icon: 'telemetry',
        flush: true,
        children: EmptyState({
          title: 'Time series unavailable',
          description: 'The runtime source exposes one current snapshot, so no chart or automatic polling is shown.',
          icon: 'telemetry',
          inline: true,
        }),
      }),
    ]),
  });
}

function detailSettlements(view: MachineView): Html {
  const snap = fleetSnapshot();
  const intent = snap.intent.machineId === view.entry.machineId ? snap.intent : undefined;
  return Stack({
    children: join([
      intent
        ? DataCard({
            title: 'Unsigned intent',
            icon: 'settlement',
            badge: StatusBadge({ label: 'not broadcast', tone: 'idle', dot: 'ring', size: 'sm' }),
            actions: CopyButton({ value: JSON.stringify(intent, null, 2), what: 'intent JSON', label: 'Copy JSON' }),
            children: KeyValueList({
              rows: [
                { key: 'Intent id', value: intent.intentId, mono: true },
                { key: 'Amount', value: Amount({ value: intent.amount, asset: intent.asset, large: true }) },
                { key: 'Source', value: AddressDisplay({ value: intent.source, full: true }), mono: true },
                { key: 'Recipient', value: AddressDisplay({ value: intent.recipient, full: true }), mono: true },
                { key: 'Memo', value: intent.memo ?? 'none', mono: true },
                { key: 'Signing mode', value: intent.signingMode, mono: true },
                { key: 'Broadcast', value: String(intent.broadcast), mono: true },
              ],
            }),
            footer: html`<span class="mc-dim mc-fs-11"
              >The runtime emits this record unsigned. Signing and submission happen in the caller's wallet.</span
            >`,
          })
        : DataCard({
            flush: true,
            children: EmptyState({
              title: 'No settlement intents',
              description: `No intent in this session names ${view.label} as its machine.`,
              icon: 'settlement',
              inline: true,
            }),
          }),
      DataCard({
        title: 'Settled history',
        icon: 'audit',
        flush: true,
        children: EmptyState({
          title: 'Nothing settled',
          description:
            'The runtime never broadcasts, so settlement completion is confirmed outside this console and no settled history is recorded here.',
          icon: 'settlement',
          inline: true,
        }),
      }),
    ]),
  });
}

function detailReceipts(view: MachineView): Html {
  const receipts = RECEIPTS.filter((r) => r.machineId === view.entry.machineId);
  type Receipt = (typeof receipts)[number];
  if (receipts.length === 0) {
    return DataCard({
      flush: true,
      children: EmptyState({
        title: 'No receipts',
        description: `No committed fixture receipt references ${view.label}.`,
        icon: 'audit',
        inline: true,
        actions: CommandButton({
          label: 'Verify a receipt',
          href: '/console/receipts',
          size: 'sm',
          variant: 'quiet',
          iconAfter: 'chevron-right',
        }),
      }),
    });
  }
  return DataTable({
    columns: [
      {
        key: 'sig',
        header: 'Signature',
        mono: true,
        cell: (r: Receipt) =>
          AddressDisplay({ value: r.signature, head: 10, tail: 8, action: CopyButton({ value: r.signature, what: 'signature' }) }),
      },
      { key: 'status', header: 'Status', cell: (r: Receipt) => StatusBadge({ label: r.status }) },
      { key: 'finality', header: 'Finality', cell: (r: Receipt) => StatusBadge({ label: r.finality, size: 'sm', dot: 'ring' }) },
      {
        key: 'amount',
        header: 'Amount',
        align: 'num' as const,
        cell: (r: Receipt) => Amount({ value: r.amount, asset: r.asset }),
      },
      { key: 'memo', header: 'Memo', mono: true, cell: (r: Receipt) => r.memo },
      { key: 'slot', header: 'Slot', align: 'num' as const, tight: true, cell: (r: Receipt) => String(r.slot) },
      {
        key: 'src',
        header: 'Source',
        tight: true,
        cell: () => StatusBadge({ label: 'fixture', tone: 'idle', dot: 'ring', size: 'sm' }),
      },
    ],
    rows: receipts,
    rowKey: (r) => r.signature,
    caption: `Receipts referencing ${view.label}`,
    compact: true,
    footer: html`<span class="mc-dim mc-fs-11"
      >Recorded in the repository fixture; verification is available on the Receipts page and is not a live cluster confirmation.</span
    >`,
  });
}

/** Renders the detail body for a machine, or a not-found state. */
export function machineDetailSection(machineId: string, tab: string): Html {
  const view = machineById(machineId);
  if (!view) {
    return DataCard({
      flush: true,
      children: EmptyState({
        title: 'Machine not found',
        description: `No machine with id "${machineId}" exists in the current registry snapshot.`,
        icon: 'alert',
        actions: CommandButton({
          label: 'Back to machines',
          href: '/console/machines',
          variant: 'primary',
          size: 'sm',
          icon: 'chevron-right',
        }),
      }),
    });
  }

  const tabs = [
    { id: 'md-overview', key: 'overview', label: 'Overview', icon: 'overview' as const, panel: detailOverview(view) },
    { id: 'md-runtime', key: 'runtime', label: 'Runtime', icon: 'terminal' as const, panel: detailRuntime(view) },
    { id: 'md-jobs', key: 'jobs', label: 'Jobs', icon: 'machine' as const, panel: detailJobs(view) },
    { id: 'md-resources', key: 'resources', label: 'Resources', icon: 'resource' as const, panel: detailResources(view) },
    { id: 'md-telemetry', key: 'telemetry', label: 'Telemetry', icon: 'telemetry' as const, panel: detailTelemetry(view) },
    { id: 'md-settlements', key: 'settlements', label: 'Settlements', icon: 'settlement' as const, panel: detailSettlements(view) },
    { id: 'md-receipts', key: 'receipts', label: 'Receipts', icon: 'audit' as const, panel: detailReceipts(view) },
  ];
  const activeTab = tabs.find((t) => t.key === tab) ?? tabs[0]!;

  return html`${Tabs({
      items: tabs.map((t) => ({ id: t.id, label: t.label, icon: t.icon, panel: t.panel })),
      active: activeTab.id,
      ariaLabel: `${view.label} detail sections`,
      hrefFor: (item) =>
        `/console/machines/${encodeURIComponent(view.entry.machineId)}/${item.id.replace(/^md-/, '')}`,
    })}
    ${registerMachineModal()}`;
}

/** Header metadata for the machine detail page. */
export function machineDetailHeader(machineId: string): {
  title: string;
  machineId: string;
  found: boolean;
  status: string;
  wallet: string;
  owner: string;
} {
  const view = machineById(machineId);
  if (!view) {
    return { title: 'Machine not found', machineId, found: false, status: 'unknown', wallet: '', owner: '' };
  }
  return {
    title: view.label,
    machineId: view.entry.machineId,
    found: true,
    status: view.entry.status,
    wallet: view.entry.walletAddress,
    owner: view.owner,
  };
}
