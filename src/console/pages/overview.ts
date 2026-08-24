import {
  ActivityItem,
  ActivityList,
  AddressDisplay,
  Amount,
  Chips,
  CommandButton,
  CopyButton,
  CountBadge,
  DataCard,
  DataTable,
  EmptyState,
  type Html,
  MachineBadge,
  Meter,
  SectionHeader,
  Split,
  StageRail,
  Stack,
  StatCard,
  StatGrid,
  StatusBadge,
  Tabs,
  Timeline,
  EMPTY,
  html,
  join,
} from '../ui/index.js';
import {
  WORK_ORDER_STAGES,
  activeJobs,
  activityFeed,
  fleetSnapshot,
  missingActivityTypes,
  overviewCounters,
  type ActivityEntry,
  type MachineView,
  type RecordSource,
} from '../data/fleet-snapshot.js';

/**
 * Machine Console overview dashboard.
 *
 * Honesty constraints applied throughout:
 *   - Settlement volume counts settled work orders only. Nothing is settled in
 *     this session, so it reads 0 and unsigned intents are shown separately.
 *   - No resource-request pipeline exists in this repository, so those panels
 *     render empty states rather than invented traffic.
 *   - Every record carries a provenance badge (sdk deterministic / fixture / local) so no row
 *     can be mistaken for a confirmed on-chain transaction.
 */

const clock = (iso: string): string => iso.slice(11, 16);

const SOURCE_LABEL: Readonly<Record<RecordSource, string>> = {
  sdk: 'sdk · deterministic',
  fixture: 'fixture',
  local: 'local',
};

const sourceBadge = (source: RecordSource): Html =>
  StatusBadge({
    label: SOURCE_LABEL[source],
    tone: source === 'sdk' ? 'idle' : source === 'fixture' ? 'idle' : 'neutral',
    dot: 'ring',
    size: 'sm',
    title:
      source === 'sdk'
        ? 'Normalized through SDK factories from deterministic seed records'
        : source === 'fixture'
          ? "The repository's committed fixture data"
          : 'Console-local demo metadata, no upstream source',
  });

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

function statistics(): Html {
  const c = overviewCounters();
  return StatGrid({
    children: join([
      StatCard({
        label: 'Machines',
        value: c.machines,
        icon: 'fleet',
        hint: 'registry records in snapshot',
      }),
      StatCard({
        label: 'Working state',
        value: c.activeMachines,
        unit: `/ ${c.machines}`,
        icon: 'machine',
        tone: 'accent',
        hint: c.activeMachines === 0 ? 'none in working state' : 'current snapshot state',
      }),
      StatCard({
        label: 'Active jobs',
        value: c.activeJobs,
        unit: `/ ${c.totalJobs}`,
        icon: 'overview',
        hint: 'in flight, not closed',
      }),
      StatCard({
        label: 'Resource requests',
        value: c.resourceRequests,
        icon: 'resource',
        hint: 'no request pipeline yet',
      }),
      StatCard({
        label: 'Resources provided',
        value: c.resourcesProvided,
        icon: 'zap',
        hint: 'provider source unavailable',
      }),
      StatCard({
        // Settled volume only. Naming this "settled" rather than "volume"
        // prevents an unsigned intent from reading as a completed transfer.
        label: 'Settlement volume',
        value: c.settledVolume,
        unit: 'SOL',
        icon: 'settlement',
        badge: StatusBadge({ label: 'settled', tone: 'idle', dot: 'ring', size: 'sm' }),
        hint: `${c.pendingIntentVolume} SOL unsigned, not broadcast`,
      }),
    ]),
  });
}

// ---------------------------------------------------------------------------
// Machines (left column)
// ---------------------------------------------------------------------------

function machinesPanel(): Html {
  const snap = fleetSnapshot();

  const columns = [
    {
      key: 'machine',
      header: 'Machine',
      cell: (v: MachineView) =>
        html`<a class="mc-machine-link" href="/console/machines/${encodeURIComponent(v.entry.machineId)}"
          >${MachineBadge({ name: v.label, machineId: v.entry.machineId, role: v.entry.role })}</a
        >`,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (v: MachineView) => StatusBadge({ label: v.entry.status }),
    },
    {
      key: 'runtime',
      header: 'Health',
      cell: (v: MachineView) => StatusBadge({ label: v.telemetry.health }),
    },
    {
      key: 'job',
      header: 'Current job',
      mono: true,
      cell: (v: MachineView) =>
        v.entry.activeJobId ? v.entry.activeJobId : html`<span class="mc-dim">none</span>`,
    },
    {
      key: 'seen',
      header: 'Last activity',
      align: 'num' as const,
      tight: true,
      cell: (v: MachineView) => v.lastSeen,
    },
  ];

  return DataCard({
    title: 'Machines',
    icon: 'fleet',
    badge: CountBadge({ value: snap.registry.total }),
    flush: true,
    actions: CommandButton({
      label: 'All machines',
      href: '/console/machines',
      size: 'sm',
      variant: 'quiet',
      iconAfter: 'chevron-right',
    }),
    children:
      snap.machines.length === 0
        ? EmptyState({
            title: 'No machine records',
            description: 'No registry records are present in the current snapshot.',
            icon: 'fleet',
            inline: true,
          })
        : DataTable({
            columns,
            rows: snap.machines,
            rowKey: (v) => v.entry.machineId,
            caption: 'Machines with runtime status, telemetry health, current job, and last activity',
            compact: true,
            className: 'mc-card--flush',
          }),
    footer: html`<span class="mc-dim mc-fs-11">Runtime health is derived from telemetry, not reported by the machine.</span>`,
  });
}

// ---------------------------------------------------------------------------
// Network activity (right column)
// ---------------------------------------------------------------------------

function networkActivityPanel(): Html {
  const snap = fleetSnapshot();
  const c = overviewCounters();

  const resourcesPanel = EmptyState({
    title: 'No resource requests',
    description:
      'This runtime has no resource-request pipeline or configured provider source, so nothing has been requested or fulfilled.',
    icon: 'resource',
    inline: true,
    actions: CommandButton({
      label: 'View resources',
      href: '/console/resources',
      size: 'sm',
      variant: 'quiet',
      iconAfter: 'chevron-right',
    }),
  });

  const jobsPanel = ActivityList({
    children: join(
      snap.workOrders.map((order, index) =>
        ActivityItem({
          title: order.workOrderId,
          meta: `stage ${order.stage}${order.machineId ? ` · ${order.machineId}` : ' · unassigned'}`,
          time: clock(order.updatedAt),
          tone: order.stage === 'working' ? 'active' : order.stage === 'queued' ? 'idle' : 'success',
          icon: 'machine',
          bordered: index < snap.workOrders.length - 1,
          action: sourceBadge('sdk'),
        })
      )
    ),
  });

  const settlementsPanel = html`${ActivityList({
      children: ActivityItem({
        title: html`${Amount({ value: snap.intent.amount, asset: snap.intent.asset })} intent prepared`,
        meta: `${snap.intent.intentId.slice(0, 18)}… · ${snap.intent.signingMode}`,
        time: clock(snap.intent.createdAt),
        tone: 'active',
        icon: 'settlement',
        action: sourceBadge('sdk'),
      }),
    })}
    <div class="mc-mt-8">
      ${EmptyState({
        title: 'Nothing settled',
        description:
          'The runtime emits unsigned intents and never broadcasts, so settlement completion is confirmed outside this console.',
        icon: 'settlement',
        inline: true,
      })}
    </div>`;

  const eventsPanel = ActivityList({
    children: join(
      snap.events.map((event, index) =>
        ActivityItem({
          title: event.type,
          meta: `${event.machineId} · ${Object.entries(event.payload)
            .slice(0, 2)
            .map(([k, v]) => `${k}=${String(v)}`)
            .join(' ')}`,
          time: clock(event.occurredAt),
          tone:
            event.type === 'receipt.verified' || event.type === 'policy.checked'
              ? 'success'
              : event.type === 'machine.action'
                ? 'degraded'
                : 'active',
          icon:
            event.type === 'settlement.intent.created'
              ? 'settlement'
              : event.type === 'policy.checked'
                ? 'shield'
                : event.type === 'receipt.verified'
                  ? 'audit'
                  : 'alert',
          bordered: index < snap.events.length - 1,
        })
      )
    ),
  });

  return DataCard({
    title: 'Network activity',
    icon: 'zap',
    flush: true,
    children: html`<div class="mc-pad">
      ${Tabs({
        variant: 'enclosed',
        ariaLabel: 'Network activity streams',
        items: [
          {
            id: 'na-resources',
            label: 'Resources',
            badge: CountBadge({ value: c.resourceRequests }),
            panel: resourcesPanel,
          },
          { id: 'na-jobs', label: 'Jobs', badge: CountBadge({ value: snap.workOrders.length }), panel: jobsPanel },
          {
            id: 'na-settlements',
            label: 'Settlements',
            badge: CountBadge({ value: c.pendingIntentCount }),
            panel: settlementsPanel,
          },
          { id: 'na-events', label: 'Events', badge: CountBadge({ value: snap.events.length }), panel: eventsPanel },
        ],
        active: 'na-jobs',
      })}
    </div>`,
  });
}

// ---------------------------------------------------------------------------
// Active jobs table
// ---------------------------------------------------------------------------

function activeJobsTable(): Html {
  const jobs = activeJobs().filter((order) => order.stage !== 'queued');
  const snap = fleetSnapshot();
  const machineLabel = (machineId: string | undefined): string => {
    if (!machineId) return '';
    return snap.machines.find((v) => v.entry.machineId === machineId)?.label ?? machineId;
  };

  type Job = (typeof jobs)[number];

  const columns = [
    {
      key: 'job',
      header: 'Job',
      cell: (order: Job) => html`<span class="mc-col mc-gap-2 mc-min0">
        <span class="mc-machine-badge__name">${order.workOrderId.replace(/^wo-/, '').replace(/-/g, ' ')}</span>
        <span class="mc-machine-badge__id">${order.workOrderId}</span>
      </span>`,
    },
    {
      key: 'machine',
      header: 'Machine',
      cell: (order: Job) =>
        order.machineId
          ? MachineBadge({ name: machineLabel(order.machineId), machineId: order.machineId, compact: true })
          : html`<span class="mc-dim">unassigned</span>`,
    },
    {
      key: 'requirements',
      header: 'Required capabilities',
      cell: (order: Job) => Chips({ items: order.requirement.capabilities }),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (order: Job) => html`<span class="mc-col mc-gap-3 mc-min0">
        ${StatusBadge({ label: order.stage })}
        ${StageRail({
          stages: WORK_ORDER_STAGES,
          currentIndex: Math.max(0, WORK_ORDER_STAGES.indexOf(order.stage)),
          label: `Stage ${WORK_ORDER_STAGES.indexOf(order.stage) + 1} of ${WORK_ORDER_STAGES.length}: ${order.stage}`,
          className: 'mc-stages--inline',
        })}
      </span>`,
    },
    {
      key: 'created',
      header: 'Created',
      align: 'num' as const,
      cell: (order: Job) => clock(order.createdAt),
    },
    {
      key: 'settlement',
      header: 'Settlement',
      align: 'num' as const,
      tight: true,
      cell: (order: Job) => html`<span class="mc-col mc-gap-2 mc-min0">
        ${Amount({ value: order.settlement.amount, asset: order.settlement.asset })}
        ${order.settlementIntentId
          ? StatusBadge({ label: 'intent linked', tone: 'active', size: 'sm', dot: 'ring' })
          : StatusBadge({ label: 'not settled', tone: 'idle', size: 'sm', dot: 'ring' })}
      </span>`,
    },
  ];

  return html`<div>
    ${SectionHeader({
      title: 'Active jobs',
      icon: 'machine',
      count: `${jobs.length} in flight`,
      actions: CommandButton({
        label: 'All jobs',
        href: '/console/jobs',
        size: 'sm',
        variant: 'quiet',
        iconAfter: 'chevron-right',
      }),
    })}
    ${DataTable({
      columns,
      rows: jobs,
      rowKey: (order) => order.workOrderId,
      caption: 'Active jobs with machine, required capabilities, stage, created time, and settlement state',
      compact: true,
      empty: EmptyState({
        title: 'No active jobs',
        description: 'Work orders appear here once they leave the queued stage.',
        icon: 'machine',
        inline: true,
      }),
      footer: html`<span class="mc-dim mc-fs-11"
        >Settlement shows the intended amount. No job in this session has reached the settled stage.</span
      >`,
    })}
  </div>`;
}

// ---------------------------------------------------------------------------
// Recent activity timeline
// ---------------------------------------------------------------------------

function recentActivity(): Html {
  const feed = activityFeed();
  const missing = missingActivityTypes();

  return html`<div>
    ${SectionHeader({
      title: 'Recent activity',
      icon: 'terminal',
      count: `${feed.length} events`,
    })}
    ${DataCard({
      flush: true,
      children:
        feed.length === 0
          ? EmptyState({
              title: 'No activity recorded',
              description: 'Runtime events appear here as the session progresses.',
              icon: 'terminal',
              inline: true,
            })
          : html`<div class="mc-pad">
              ${Timeline({
                ariaLabel: 'Runtime activity timeline',
                entries: feed.map((entry: ActivityEntry) => ({
                  title: entry.title,
                  meta: html`<span class="mc-mono">${entry.type}</span>
                    <span class="mc-dim">${entry.detail}</span>
                    ${sourceBadge(entry.source)}`,
                  time: clock(entry.at),
                  tone: entry.tone,
                })),
              })}
            </div>`,
      footer:
        missing.length > 0
          ? html`<span class="mc-col mc-gap-4">
              <span class="mc-dim mc-fs-11">Event types the runtime can emit that have no record in this session:</span>
              ${Chips({ items: missing })}
            </span>`
          : html`<span class="mc-dim mc-fs-11">All known event types have at least one record.</span>`,
    })}
  </div>`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function overviewSection(): Html {
  return Stack({
    children: join([
      statistics(),
      Split({
        aside: true,
        children: join([machinesPanel(), networkActivityPanel()]),
      }),
      activeJobsTable(),
      recentActivity(),
    ]),
  });
}
