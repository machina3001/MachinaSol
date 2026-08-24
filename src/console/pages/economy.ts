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
  Field,
  type Html,
  KeyValueList,
  MachineBadge,
  SettlementCard,
  Split,
  Stack,
  StageRail,
  StatCard,
  StatGrid,
  StatusBadge,
  Tabs,
  TextInput,
  Timeline,
  Toggle,
  EMPTY,
  html,
  join,
} from '../ui/index.js';
import {
  ECONOMY_SUPPORT,
  economyJob,
  economyJobDetail,
  economyJobs,
  economyReceipts,
  economySettlements,
  receiptVerificationDefaults,
  type EconomyJob,
  type EconomyJobDetail,
  type EconomyReceipt,
  type EconomyRecordSource,
  type EconomySettlement,
} from '../services/economy.js';

/**
 * Jobs, settlements, and receipts pages.
 *
 * These render the normalized economy service instead of joining fixture
 * records inside view components.  Missing provider, resource, proof, and
 * receipt relationships stay visibly missing throughout the UI.
 */

const JOB_STAGE_PATH = ['queued', 'assigned', 'preparing', 'working', 'proof_submitted', 'settled'] as const;
const ACTIVE_JOB_STAGES = new Set(['assigned', 'preparing', 'working', 'proof_submitted']);
const CLOSED_JOB_STAGES = new Set(['settled', 'failed', 'cancelled']);

const unavailable = (label = 'not recorded'): Html => html`<span class="mc-dim mc-mono mc-fs-11">${label}</span>`;

const compactTimestamp = (iso: string | undefined): Html => {
  if (!iso) return unavailable();
  const shown = `${iso.slice(0, 10)} ${iso.slice(11, 19)}Z`;
  return html`<time class="mc-mono mc-fs-11" datetime="${iso}" title="${iso}">${shown}</time>`;
};

const sourceBadge = (source: EconomyRecordSource): Html =>
  source === 'repository-fixture'
    ? StatusBadge({
        label: 'fixture · not live',
        tone: 'idle',
        dot: 'ring',
        size: 'sm',
        title: "The repository's committed receipt fixture; no live cluster confirmation.",
      })
    : StatusBadge({
        label: 'sdk · deterministic',
        tone: 'idle',
        dot: 'ring',
        size: 'sm',
        title: 'Produced through SDK functions from the deterministic console snapshot.',
      });

const machineCell = (job: EconomyJob): Html =>
  job.machine
    ? MachineBadge({
        name: job.machine.label,
        machineId: job.machine.machineId,
        role: job.machine.role,
        compact: true,
      })
    : job.machineId
      ? html`<span class="mc-mono">${job.machineId}</span>`
      : unavailable('unassigned');

const settlementStateBadge = (job: EconomyJob): Html => {
  if (job.settlementState === 'settled') {
    return StatusBadge({
      label: 'runtime settled',
      tone: 'online',
      size: 'sm',
      title: 'Work-order runtime state only; not a claim of live chain confirmation.',
    });
  }
  if (job.settlementState === 'intent-prepared') {
    return StatusBadge({ label: 'intent prepared', tone: 'active', size: 'sm' });
  }
  return StatusBadge({ label: 'not linked', tone: 'neutral', dot: 'ring', size: 'sm' });
};

function jobsTable(rows: EconomyJob[], id: string, caption: string): Html {
  return DataTable({
    id,
    testId: `economy-${id}`,
    columns: [
      {
        key: 'job',
        header: 'Job ID',
        tight: true,
        cell: (job: EconomyJob) =>
          CommandButton({
            label: job.jobId,
            href: `/console/jobs/${encodeURIComponent(job.jobId)}`,
            size: 'sm',
            variant: 'quiet',
            mono: true,
          }),
      },
      { key: 'machine', header: 'Machine', cell: machineCell },
      { key: 'provider', header: 'Provider', cell: () => unavailable('not linked') },
      { key: 'resource', header: 'Resource', cell: () => unavailable('not linked') },
      {
        key: 'capabilities',
        header: 'Required capability',
        cell: (job: EconomyJob) => Chips({ items: job.requiredCapabilities }),
      },
      {
        key: 'status',
        header: 'Status',
        tight: true,
        cell: (job: EconomyJob) => StatusBadge({ label: job.status, dot: 'ring', size: 'sm' }),
      },
      { key: 'created', header: 'Created', tight: true, cell: (job: EconomyJob) => compactTimestamp(job.createdAt) },
      { key: 'started', header: 'Started', tight: true, cell: (job: EconomyJob) => compactTimestamp(job.startedAt) },
      { key: 'completed', header: 'Completed', tight: true, cell: (job: EconomyJob) => compactTimestamp(job.completedAt) },
      {
        key: 'settlement',
        header: 'Settlement',
        tight: true,
        cell: settlementStateBadge,
      },
    ],
    rows,
    rowKey: (job) => job.jobId,
    caption,
    compact: true,
    totalCount: rows.length,
    footer: sourceBadge('sdk-deterministic'),
    empty: EmptyState({
      title: 'No jobs in this state',
      description: 'The deterministic runtime snapshot has no matching work orders.',
      icon: 'inbox',
      inline: true,
    }),
  });
}

// ---------------------------------------------------------------------------
// Jobs list
// ---------------------------------------------------------------------------

export function jobsSection(): Html {
  const jobs = economyJobs();
  const active = jobs.filter((job) => ACTIVE_JOB_STAGES.has(job.status));
  const queued = jobs.filter((job) => job.status === 'queued');
  const closed = jobs.filter((job) => CLOSED_JOB_STAGES.has(job.status));
  const assignedMachines = new Set(jobs.map((job) => job.machineId).filter((id): id is string => Boolean(id)));
  const linkedIntents = jobs.filter((job) => Boolean(job.settlementIntentId));

  return Stack({
    children: join([
      StatGrid({
        children: join([
          StatCard({ label: 'Work orders', value: jobs.length, icon: 'machine', hint: 'deterministic SDK snapshot' }),
          StatCard({ label: 'In flight', value: active.length, icon: 'play', hint: 'assigned through proof submitted' }),
          StatCard({ label: 'Assigned machines', value: assignedMachines.size, icon: 'fleet', hint: `${queued.length} queued` }),
          StatCard({
            label: 'Linked intents',
            value: linkedIntents.length,
            icon: 'settlement',
            hint: 'explicit settlementIntentId only',
          }),
        ]),
      }),
      Tabs({
        id: 'mc-jobs-status-tabs',
        testId: 'economy-jobs-status-filter',
        variant: 'enclosed',
        ariaLabel: 'Filter jobs by runtime state',
        items: [
          {
            id: 'jobs-all',
            label: 'All',
            badge: CountBadge({ value: jobs.length }),
            panel: jobsTable(jobs, 'mc-jobs-table-all', 'All work orders in the runtime snapshot'),
          },
          {
            id: 'jobs-active',
            label: 'In flight',
            badge: CountBadge({ value: active.length, tone: 'active' }),
            panel: jobsTable(active, 'mc-jobs-table-active', 'In-flight work orders'),
          },
          {
            id: 'jobs-queued',
            label: 'Queued',
            badge: CountBadge({ value: queued.length }),
            panel: jobsTable(queued, 'mc-jobs-table-queued', 'Queued work orders'),
          },
          {
            id: 'jobs-closed',
            label: 'Closed',
            badge: CountBadge({ value: closed.length }),
            panel: jobsTable(closed, 'mc-jobs-table-closed', 'Closed work orders'),
          },
        ],
      }),
      DataCard({
        title: 'Relationship coverage',
        icon: 'alert',
        actions: sourceBadge('sdk-deterministic'),
        children: KeyValueList({
          rows: [
            { key: 'Machine', value: 'Explicit MachineWorkOrder.machineId' },
            { key: 'Provider', value: 'Not recorded by the work-order model', mono: true },
            { key: 'Resource', value: 'Not recorded; required capabilities are shown separately', mono: true },
            { key: 'Started / completed time', value: 'No explicit timestamps in the current records', mono: true },
            { key: 'Settlement linkage', value: 'Explicit settlementIntentId only', mono: true },
          ],
        }),
      }),
    ]),
  });
}

// ---------------------------------------------------------------------------
// Job detail
// ---------------------------------------------------------------------------

function jobOverview(detail: EconomyJobDetail): Html {
  const job = detail.job;
  const stageIndex = JOB_STAGE_PATH.indexOf(job.status as (typeof JOB_STAGE_PATH)[number]);
  return DataCard({
    title: 'Work order',
    icon: 'machine',
    actions: join(
      [
        sourceBadge(job.source),
        CopyButton({ value: job.jobId, what: 'job id', label: 'Copy ID' }),
      ],
      ' '
    ),
    children: Stack({
      children: join([
        stageIndex >= 0
          ? StageRail({
              stages: JOB_STAGE_PATH,
              currentIndex: stageIndex,
              failed: job.status === 'failed' || job.status === 'cancelled',
              label: `Current work-order snapshot stage: ${job.status}`,
            })
          : EMPTY,
        KeyValueList({
          rows: [
            { key: 'Job ID', value: job.jobId, mono: true },
            { key: 'Status', value: StatusBadge({ label: job.status, dot: 'ring', size: 'sm' }) },
            { key: 'Required capabilities', value: Chips({ items: job.requiredCapabilities }) },
            { key: 'Created', value: compactTimestamp(job.createdAt) },
            { key: 'Last updated', value: compactTimestamp(job.updatedAt) },
            { key: 'Started', value: compactTimestamp(job.startedAt) },
            { key: 'Completed', value: compactTimestamp(job.completedAt) },
            { key: 'Telemetry required', value: String(job.telemetryRequired), mono: true },
            { key: 'Proof required', value: String(job.proofRequired), mono: true },
            {
              key: 'Expected outputs',
              value: job.expectedOutputs.length ? Chips({ items: job.expectedOutputs }) : unavailable('none recorded'),
            },
            { key: 'Settlement state', value: settlementStateBadge(job) },
          ],
        }),
      ]),
    }),
  });
}

function jobTimeline(detail: EconomyJobDetail): Html {
  return DataCard({
    title: 'Recorded timeline',
    icon: 'zap',
    badge: CountBadge({ value: detail.timeline.length }),
    actions: sourceBadge('sdk-deterministic'),
    children: detail.timeline.length
      ? Timeline({
          ariaLabel: `${detail.job.jobId} recorded lifecycle events`,
          entries: detail.timeline.map((event) => ({
            title: event.title,
            meta: html`<span class="mc-mono">${event.type}</span> · ${event.detail}`,
            time: `${event.at.slice(0, 10)} ${event.at.slice(11, 19)}Z`,
            tone: event.tone,
          })),
        })
      : EmptyState({
          title: 'No lifecycle events',
          description: 'No event in the runtime snapshot explicitly references this work order.',
          icon: 'inbox',
          inline: true,
        }),
    footer: html`<span class="mc-dim mc-fs-11"
      >The runtime retains creation and last-update timestamps, not every intermediate transition.</span
    >`,
  });
}

function jobMachine(detail: EconomyJobDetail): Html {
  const job = detail.job;
  if (!job.machine) {
    return DataCard({
      title: 'Machine',
      icon: 'machine',
      children: EmptyState({
        title: job.machineId ? 'Machine record unavailable' : 'Job is unassigned',
        description: job.machineId
          ? `The work order names ${job.machineId}, but the current registry snapshot has no matching machine record.`
          : 'The work order has no machineId.',
        icon: 'machine',
        inline: true,
      }),
    });
  }

  return DataCard({
    title: job.machine.label,
    icon: 'machine',
    badge: StatusBadge({ label: job.machine.status, dot: 'ring', size: 'sm' }),
    actions: CommandButton({
      label: 'Machine detail',
      href: `/console/machines/${encodeURIComponent(job.machine.machineId)}`,
      iconAfter: 'chevron-right',
      variant: 'quiet',
      size: 'sm',
    }),
    children: KeyValueList({
      rows: [
        { key: 'Machine ID', value: job.machine.machineId, mono: true },
        { key: 'Role', value: job.machine.role, mono: true },
        { key: 'Owner', value: job.machine.owner },
        {
          key: 'Wallet',
          value: AddressDisplay({
            value: job.machine.walletAddress,
            head: 8,
            tail: 8,
            chain: true,
            action: CopyButton({ value: job.machine.walletAddress, what: 'machine wallet' }),
          }),
        },
      ],
    }),
  });
}

function jobResource(detail: EconomyJobDetail): Html {
  return Stack({
    children: join([
      DataCard({
        title: 'Required capabilities',
        icon: 'resource',
        actions: sourceBadge(detail.job.source),
        children: detail.job.requiredCapabilities.length
          ? Chips({ items: detail.job.requiredCapabilities })
          : unavailable('none recorded'),
      }),
      DataCard({
        title: 'Resource relationship',
        icon: 'resource',
        children: EmptyState({
          title: 'No resource linked',
          description:
            'MachineWorkOrder records capabilities, but no resource request or resource identifier. Capability names are not treated as resources.',
          icon: 'resource',
          inline: true,
        }),
      }),
    ]),
  });
}

function jobProvider(): Html {
  return DataCard({
    title: 'Provider relationship',
    icon: 'resource',
    children: EmptyState({
      title: 'No provider linked',
      description:
        'The runtime work-order model has no provider identifier and no provider-selection history for this job.',
      icon: 'resource',
      inline: true,
    }),
  });
}

function jobTelemetry(detail: EconomyJobDetail): Html {
  if (!detail.telemetry) {
    return DataCard({
      title: 'Telemetry',
      icon: 'telemetry',
      children: EmptyState({
        title: detail.job.telemetryRef ? 'Telemetry payload unavailable' : 'No telemetry linked',
        description: detail.job.telemetryRef
          ? `The work order references ${detail.job.telemetryRef}, but no telemetry snapshot has the same reference.`
          : 'This work-order snapshot has no telemetryRef.',
        icon: 'telemetry',
        inline: true,
        ...(detail.job.telemetryRef
          ? {
              actions: CopyButton({ value: detail.job.telemetryRef, what: 'telemetry reference', label: 'Copy reference' }),
            }
          : {}),
      }),
    });
  }

  const telemetry = detail.telemetry;
  return DataCard({
    title: 'Linked telemetry snapshot',
    icon: 'telemetry',
    badge: StatusBadge({ label: telemetry.health, dot: 'ring', size: 'sm' }),
    actions: CopyButton({ value: telemetry.telemetryRef, what: 'telemetry reference', label: 'Copy reference' }),
    children: KeyValueList({
      rows: [
        { key: 'Reference', value: telemetry.telemetryRef, mono: true },
        { key: 'Machine ID', value: telemetry.machineId, mono: true },
        { key: 'Observed', value: compactTimestamp(telemetry.observedAt) },
        { key: 'Battery', value: telemetry.batteryPct === undefined ? unavailable() : `${telemetry.batteryPct}%`, mono: true },
        { key: 'Signal', value: telemetry.signalPct === undefined ? unavailable() : `${telemetry.signalPct}%`, mono: true },
        { key: 'Progress', value: telemetry.progressPct === undefined ? unavailable() : `${telemetry.progressPct}%`, mono: true },
        { key: 'Diagnostics', value: StatusBadge({ label: telemetry.diagnosticLevel, dot: 'ring', size: 'sm' }) },
        {
          key: 'Diagnostic detail',
          value: telemetry.diagnosticMessages.length ? telemetry.diagnosticMessages.join('; ') : unavailable('none'),
        },
      ],
    }),
  });
}

function jobSettlement(detail: EconomyJobDetail): Html {
  const job = detail.job;
  return Stack({
    children: join([
      DataCard({
        title: 'Settlement terms',
        icon: 'settlement',
        actions: sourceBadge(job.source),
        children: KeyValueList({
          rows: [
            { key: 'Rail', value: job.settlement.chain, mono: true },
            { key: 'Amount', value: Amount({ value: job.settlement.amount, asset: job.settlement.asset, large: true }) },
            {
              key: 'Recipient',
              value: AddressDisplay({
                value: job.settlement.recipient,
                head: 8,
                tail: 8,
                chain: true,
                action: CopyButton({ value: job.settlement.recipient, what: 'settlement recipient' }),
              }),
            },
          ],
        }),
        footer: html`<span class="mc-dim mc-fs-11"
          >Terms are part of the work order; they are not a signed or broadcast transaction.</span
        >`,
      }),
      detail.linkedSettlement
        ? SettlementCard({
            reference: detail.linkedSettlement.settlementId,
            amount: detail.linkedSettlement.amount,
            asset: detail.linkedSettlement.token,
            status: detail.linkedSettlement.status,
            source: AddressDisplay({
              value: detail.linkedSettlement.sourceAccount,
              action: CopyButton({ value: detail.linkedSettlement.sourceAccount, what: 'source account' }),
            }),
            recipient: AddressDisplay({
              value: detail.linkedSettlement.recipient,
              action: CopyButton({ value: detail.linkedSettlement.recipient, what: 'recipient account' }),
            }),
            memo: detail.linkedSettlement.memo,
            signingNote: 'Caller-wallet intent; broadcast is false.',
            fields: [
              { label: 'Session', value: detail.linkedSettlement.sessionId, mono: true },
              { label: 'Created', value: compactTimestamp(detail.linkedSettlement.createdAt) },
            ],
            footer: sourceBadge(detail.linkedSettlement.source),
          })
        : DataCard({
            title: 'Settlement intent',
            icon: 'settlement',
            children: EmptyState({
              title: 'No intent linked',
              description:
                'This work order has no settlementIntentId. The separate console intent is not matched by amount, machine, or memo.',
              icon: 'settlement',
              inline: true,
              actions: CommandButton({
                label: 'View settlements',
                href: '/console/settlements',
                variant: 'quiet',
                size: 'sm',
                iconAfter: 'chevron-right',
              }),
            }),
          }),
    ]),
  });
}

function jobReceipt(detail: EconomyJobDetail): Html {
  if (detail.linkedReceipts.length === 0) {
    return DataCard({
      title: 'Receipt',
      icon: 'audit',
      children: EmptyState({
        title: 'No receipt linked',
        description:
          'Neither the work order nor the receipt fixture carries an explicit relationship between these records. Similar machine, amount, or memo values are not enough to create one.',
        icon: 'audit',
        inline: true,
        actions: CommandButton({
          label: 'View receipt fixtures',
          href: '/console/receipts',
          size: 'sm',
          variant: 'quiet',
          iconAfter: 'chevron-right',
        }),
      }),
    });
  }
  return receiptsTable(detail.linkedReceipts, 'mc-job-receipts-table', `Receipts explicitly linked to ${detail.job.jobId}`);
}

function jobProof(detail: EconomyJobDetail): Html {
  if (!detail.job.proofId) {
    return DataCard({
      title: 'Work proof',
      icon: 'shield',
      children: EmptyState({
        title: 'No proof linked',
        description: detail.job.proofRequired
          ? 'This work order requires proof, but its current snapshot has no proofId.'
          : 'This work order does not require proof and has no proofId.',
        icon: 'shield',
        inline: true,
      }),
    });
  }

  return DataCard({
    title: 'Proof reference',
    icon: 'shield',
    actions: CopyButton({ value: detail.job.proofId, what: 'proof reference', label: 'Copy reference' }),
    children: KeyValueList({
      rows: [
        { key: 'Proof ID', value: detail.job.proofId, mono: true },
        { key: 'Result reference', value: detail.job.resultRef ?? unavailable('not recorded'), mono: true },
        { key: 'Proof payload', value: 'Not available; this repository has no proof store', mono: true },
      ],
    }),
  });
}

export function jobDetailSection(jobId: string, tab = 'overview'): Html {
  const detail = economyJobDetail(jobId);
  if (!detail) {
    return DataCard({
      id: 'mc-job-not-found',
      flush: true,
      children: EmptyState({
        title: 'Job not found',
        description: `No work order with id "${jobId}" exists in the runtime snapshot.`,
        icon: 'alert',
        actions: CommandButton({
          label: 'Back to jobs',
          href: '/console/jobs',
          variant: 'primary',
          size: 'sm',
          icon: 'chevron-right',
        }),
      }),
    });
  }

  const panels = [
    { key: 'overview', id: 'job-overview', label: 'Overview', icon: 'overview' as const, panel: jobOverview(detail) },
    { key: 'timeline', id: 'job-timeline', label: 'Timeline', icon: 'zap' as const, panel: jobTimeline(detail) },
    { key: 'machine', id: 'job-machine', label: 'Machine', icon: 'machine' as const, panel: jobMachine(detail) },
    { key: 'resource', id: 'job-resource', label: 'Resource', icon: 'resource' as const, panel: jobResource(detail) },
    { key: 'provider', id: 'job-provider', label: 'Provider', icon: 'resource' as const, panel: jobProvider() },
    { key: 'telemetry', id: 'job-telemetry', label: 'Telemetry', icon: 'telemetry' as const, panel: jobTelemetry(detail) },
    { key: 'settlement', id: 'job-settlement', label: 'Settlement', icon: 'settlement' as const, panel: jobSettlement(detail) },
    { key: 'receipt', id: 'job-receipt', label: 'Receipt', icon: 'audit' as const, panel: jobReceipt(detail) },
    { key: 'proof', id: 'job-proof', label: 'Proof', icon: 'shield' as const, panel: jobProof(detail) },
  ];
  const active = panels.find((panel) => panel.key === tab) ?? panels[0]!;

  return Tabs({
    id: 'mc-job-detail-tabs',
    testId: 'economy-job-detail-tabs',
    active: active.id,
    ariaLabel: `${detail.job.jobId} detail sections`,
    items: panels.map((panel) => ({
      id: panel.id,
      label: panel.label,
      icon: panel.icon,
      panel: panel.panel,
    })),
  });
}

/** Header metadata kept beside the detail renderer for shell integration. */
export function jobDetailHeader(jobId: string): {
  title: string;
  breadcrumbLabel: string;
  jobId: string;
  found: boolean;
  status: string;
  machineId?: string | undefined;
  settlementState: string;
  amount?: string | undefined;
  token?: string | undefined;
  sourceLabel: string;
  backHref: '/console/jobs';
  machineHref?: string | undefined;
} {
  const job = economyJob(jobId);
  if (!job) {
    return {
      title: 'Job not found',
      breadcrumbLabel: jobId,
      jobId,
      found: false,
      status: 'unknown',
      settlementState: 'not-linked',
      sourceLabel: 'unavailable',
      backHref: '/console/jobs',
    };
  }
  return {
    title: job.jobId,
    breadcrumbLabel: job.jobId,
    jobId: job.jobId,
    found: true,
    status: job.status,
    ...(job.machineId ? { machineId: job.machineId, machineHref: `/console/machines/${encodeURIComponent(job.machineId)}` } : {}),
    settlementState: job.settlementState,
    amount: job.settlement.amount,
    token: job.settlement.asset,
    sourceLabel: 'sdk · deterministic',
    backHref: '/console/jobs',
  };
}

// ---------------------------------------------------------------------------
// Settlements
// ---------------------------------------------------------------------------

function settlementsTable(settlements: EconomySettlement[]): Html {
  return DataTable({
    id: 'mc-settlements-table',
    testId: 'economy-settlements',
    columns: [
      {
        key: 'id',
        header: 'Settlement ID',
        mono: true,
        cell: (settlement: EconomySettlement) =>
          AddressDisplay({
            value: settlement.settlementId,
            head: 12,
            tail: 8,
            action: CopyButton({ value: settlement.settlementId, what: 'settlement intent id' }),
          }),
      },
      {
        key: 'job',
        header: 'Job',
        mono: true,
        cell: (settlement: EconomySettlement) => settlement.jobId ?? unavailable('not linked'),
      },
      {
        key: 'machine',
        header: 'Machine',
        cell: (settlement: EconomySettlement) =>
          settlement.machine
            ? MachineBadge({
                name: settlement.machine.label,
                machineId: settlement.machine.machineId,
                role: settlement.machine.role,
                compact: true,
              })
            : html`<span class="mc-mono">${settlement.machineId}</span>`,
      },
      { key: 'provider', header: 'Provider', cell: () => unavailable('not linked') },
      { key: 'resource', header: 'Resource', cell: () => unavailable('not linked') },
      { key: 'amount', header: 'Amount', align: 'num' as const, cell: (settlement: EconomySettlement) => settlement.amount },
      { key: 'token', header: 'Token', mono: true, tight: true, cell: (settlement: EconomySettlement) => settlement.token },
      {
        key: 'status',
        header: 'Status',
        tight: true,
        cell: (settlement: EconomySettlement) =>
          StatusBadge({
            label: settlement.status,
            tone: 'idle',
            dot: 'ring',
            size: 'sm',
            title: 'Caller-wallet intent; not signed and not broadcast.',
          }),
      },
      {
        key: 'transaction',
        header: 'Transaction',
        mono: true,
        cell: (settlement: EconomySettlement) =>
          settlement.transactionSignature
            ? AddressDisplay({
                value: settlement.transactionSignature,
                href: settlement.explorerUrl,
                action: CopyButton({ value: settlement.transactionSignature, what: 'transaction signature' }),
              })
            : unavailable('not submitted'),
      },
      {
        key: 'timestamp',
        header: 'Timestamp',
        tight: true,
        cell: (settlement: EconomySettlement) => compactTimestamp(settlement.createdAt),
      },
      { key: 'source', header: 'Source', tight: true, cell: (settlement: EconomySettlement) => sourceBadge(settlement.source) },
    ],
    rows: settlements,
    rowKey: (settlement) => settlement.settlementId,
    caption: 'Settlement intent records with explicit economy relationships',
    compact: true,
    totalCount: settlements.length,
    empty: EmptyState({
      title: 'No settlement records',
      description: 'No settlement intent or confirmed transaction is available.',
      icon: 'settlement',
      inline: true,
    }),
  });
}

function intentBuilder(settlement: EconomySettlement | undefined, liveReadEnabled: boolean): Html {
  if (!settlement) {
    return DataCard({
      title: 'Build an intent',
      icon: 'settlement',
      children: EmptyState({
        title: 'No defaults available',
        description: 'The current runtime snapshot has no source or recipient account for the builder.',
        icon: 'settlement',
        inline: true,
      }),
    });
  }

  return Split({
    children: join([
      DataCard({
        title: 'Build unsigned intent',
        icon: 'settlement',
        actions: StatusBadge({ label: 'caller wallet', tone: 'idle', dot: 'ring', size: 'sm' }),
        children: html`<form id="mc-intent-form" class="mc-col mc-gap-11">
          <input type="hidden" id="mc-intent-machine" value="${settlement.machineId}">
          <input type="hidden" id="mc-intent-session" value="${settlement.sessionId}">
          <div class="mc-split">
            ${Field({
              inputId: 'mc-intent-source',
              label: 'Source',
              children: TextInput({ inputId: 'mc-intent-source', value: settlement.sourceAccount }),
            })}
            ${Field({
              inputId: 'mc-intent-recipient',
              label: 'Recipient',
              children: TextInput({ inputId: 'mc-intent-recipient', value: settlement.recipient }),
            })}
          </div>
          <div class="mc-split">
            ${Field({
              inputId: 'mc-intent-amount',
              label: 'Amount',
              hint: `${settlement.token} · Solana precision rules apply`,
              children: TextInput({ inputId: 'mc-intent-amount', value: settlement.amount }),
            })}
            ${Field({
              inputId: 'mc-intent-memo',
              label: 'Memo',
              children: TextInput({ inputId: 'mc-intent-memo', value: settlement.memo ?? '' }),
            })}
          </div>
          <div class="mc-row mc-row--wrap">
            ${CommandButton({ label: 'Build intent', variant: 'primary', size: 'sm', icon: 'play', type: 'submit' })}
            ${Toggle({ inputId: 'mc-intent-fixture', label: 'Fixture', checked: true })}
            ${liveReadEnabled
              ? StatusBadge({ label: 'live reads allowed', tone: 'degraded', dot: 'ring', size: 'sm' })
              : StatusBadge({ label: 'fixture only', tone: 'idle', dot: 'ring', size: 'sm' })}
          </div>
        </form>`,
        footer: html`<span class="mc-dim mc-fs-11"
          >POST /api/intent/build returns an unsigned record. The runtime never signs or broadcasts.</span
        >`,
      }),
      DataCard({
        title: 'Build response',
        icon: 'terminal',
        flush: true,
        actions: StatusBadge({ label: 'idle', tone: 'idle', dot: 'ring', size: 'sm', id: 'mc-intent-status', role: 'status', ariaLive: 'polite' }),
        children: html`<div id="mc-intent-out" class="mc-pad" role="region" aria-label="Intent builder result" aria-live="polite">
          ${EmptyState({
            title: 'No intent built in this view',
            description: 'Submit the form to inspect the unsigned runtime response.',
            icon: 'settlement',
            inline: true,
          })}
        </div>`,
      }),
    ]),
  });
}

export function settlementsSection(liveReadEnabled = false): Html {
  const settlements = economySettlements();
  const unsigned = settlements.filter((settlement) => settlement.status === 'unsigned');
  const submitted = settlements.filter((settlement) => Boolean(settlement.transactionSignature));

  return Stack({
    children: join([
      StatGrid({
        children: join([
          StatCard({ label: 'Intent records', value: settlements.length, icon: 'settlement', hint: 'SDK deterministic snapshot' }),
          StatCard({ label: 'Unsigned', value: unsigned.length, icon: 'wallet', hint: 'caller-wallet signing required' }),
          StatCard({ label: 'Submitted', value: submitted.length, icon: 'external', hint: 'transaction signatures recorded' }),
          StatCard({ label: 'Live confirmed', value: 0, icon: 'shield', hint: 'no verified cluster confirmations' }),
        ]),
      }),
      settlementsTable(settlements),
      DataCard({
        title: 'Settlement boundary',
        icon: 'alert',
        actions: sourceBadge('sdk-deterministic'),
        children: KeyValueList({
          rows: [
            { key: 'Signing', value: 'caller-wallet', mono: true },
            { key: 'Broadcast', value: 'false', mono: true },
            { key: 'Transaction signature', value: 'Not available', mono: true },
            { key: 'Cluster identity', value: 'Not verified; explorer links withheld', mono: true },
            { key: 'Job / provider / resource', value: 'No explicit links on the current intent', mono: true },
          ],
        }),
      }),
      intentBuilder(settlements[0], liveReadEnabled),
    ]),
  });
}

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

function receiptsTable(receipts: EconomyReceipt[], id = 'mc-receipts-table', caption = 'Repository receipt fixtures'): Html {
  return DataTable({
    id,
    testId: 'economy-receipts',
    columns: [
      {
        key: 'receipt',
        header: 'Receipt ID',
        mono: true,
        cell: (receipt: EconomyReceipt) =>
          AddressDisplay({
            value: receipt.receiptId,
            head: 10,
            tail: 8,
            action: CopyButton({ value: receipt.receiptId, what: 'receipt id' }),
          }),
      },
      { key: 'job', header: 'Job', mono: true, cell: (receipt: EconomyReceipt) => receipt.jobId ?? unavailable('not linked') },
      {
        key: 'machine',
        header: 'Machine',
        cell: (receipt: EconomyReceipt) =>
          receipt.machine
            ? MachineBadge({
                name: receipt.machine.label,
                machineId: receipt.machine.machineId,
                role: receipt.machine.role,
                compact: true,
              })
            : html`<span class="mc-mono">${receipt.machineId}</span>`,
      },
      { key: 'provider', header: 'Provider', cell: (receipt: EconomyReceipt) => receipt.providerId ?? unavailable('not linked') },
      { key: 'resource', header: 'Resource', cell: (receipt: EconomyReceipt) => receipt.resourceId ?? unavailable('not linked') },
      {
        key: 'settlement',
        header: 'Settlement',
        mono: true,
        cell: (receipt: EconomyReceipt) => receipt.settlementId ?? unavailable('not linked'),
      },
      {
        key: 'verification',
        header: 'Verification',
        tight: true,
        cell: (receipt: EconomyReceipt) => html`<span class="mc-col mc-gap-2">
          ${StatusBadge({
            label: 'recorded fixture',
            tone: 'neutral',
            dot: 'ring',
            size: 'sm',
            title: 'Committed fixture record; verification has not been run in this view.',
          })}
          <span class="mc-dim mc-mono mc-fs-11">${receipt.status} · ${receipt.finality}</span>
        </span>`,
      },
      {
        key: 'proof',
        header: 'Work proof',
        mono: true,
        cell: (receipt: EconomyReceipt) => receipt.workProofRef ?? unavailable('not linked'),
      },
      {
        key: 'transaction',
        header: 'Transaction',
        mono: true,
        cell: (receipt: EconomyReceipt) =>
          AddressDisplay({
            value: receipt.transactionSignature,
            head: 10,
            tail: 8,
            href: receipt.explorerUrl,
            title: receipt.explorerUrl ? receipt.transactionSignature : receipt.explorerUnavailableReason,
            action: CopyButton({ value: receipt.transactionSignature, what: 'transaction signature' }),
          }),
      },
      { key: 'timestamp', header: 'Timestamp', tight: true, cell: (receipt: EconomyReceipt) => compactTimestamp(receipt.timestamp) },
      { key: 'source', header: 'Source', tight: true, cell: (receipt: EconomyReceipt) => sourceBadge(receipt.source) },
    ],
    rows: receipts,
    rowKey: (receipt) => receipt.receiptId,
    caption,
    compact: true,
    totalCount: receipts.length,
    empty: EmptyState({
      title: 'No receipts',
      description: 'No receipt records are available from the current source.',
      icon: 'audit',
      inline: true,
    }),
  });
}

function receiptVerifier(): Html {
  const defaults = receiptVerificationDefaults();
  if (!defaults) {
    return DataCard({
      title: 'Verify receipt evidence',
      icon: 'audit',
      children: EmptyState({
        title: 'No fixture defaults',
        description: 'The repository receipt fixture is empty.',
        icon: 'audit',
        inline: true,
      }),
    });
  }

  return Split({
    children: join([
      DataCard({
        title: 'Verify receipt evidence',
        icon: 'audit',
        actions: sourceBadge('repository-fixture'),
        children: html`<form id="mc-verify-form" class="mc-col mc-gap-11">
          ${Field({
            inputId: 'mc-verify-sig',
            label: 'Transaction signature',
            wide: true,
            children: TextInput({ inputId: 'mc-verify-sig', value: defaults.signature }),
          })}
          <div class="mc-split">
            ${Field({
              inputId: 'mc-verify-amount',
              label: 'Expected amount',
              children: TextInput({ inputId: 'mc-verify-amount', value: defaults.amount }),
            })}
            ${Field({
              inputId: 'mc-verify-memo',
              label: 'Expected memo',
              children: TextInput({ inputId: 'mc-verify-memo', value: defaults.memo }),
            })}
          </div>
          <div class="mc-split">
            ${Field({
              inputId: 'mc-verify-machine',
              label: 'Expected machine ID',
              children: TextInput({ inputId: 'mc-verify-machine', value: defaults.machineId }),
            })}
            ${Field({
              inputId: 'mc-verify-session',
              label: 'Expected session ID',
              children: TextInput({ inputId: 'mc-verify-session', value: defaults.sessionId }),
            })}
          </div>
          <div class="mc-row mc-row--wrap">
            ${CommandButton({ label: 'Verify fixture', variant: 'primary', size: 'sm', icon: 'shield', type: 'submit' })}
            ${CommandButton({ label: 'Server health', size: 'sm', variant: 'quiet', icon: 'refresh', action: 'health' })}
          </div>
          <p class="mc-dim mc-flush mc-fs-11">
            The fixture has no lamport balance deltas. Leaving transfer counterparties unset avoids claiming transfer
            direction evidence that the record cannot provide.
          </p>
        </form>`,
        footer: html`<span class="mc-dim mc-fs-11">POST /api/verify · fixture verification is not live confirmation</span>`,
      }),
      DataCard({
        title: 'Verification result',
        icon: 'terminal',
        flush: true,
        actions: StatusBadge({ label: 'idle', tone: 'idle', dot: 'ring', size: 'sm', id: 'mc-verify-status', role: 'status', ariaLive: 'polite' }),
        children: html`<div id="mc-verify-out" class="mc-pad" role="region" aria-label="Receipt verification result" aria-live="polite">
          ${EmptyState({
            title: 'No verification run in this view',
            description: 'Evidence fields and mismatch reasons will appear here.',
            icon: 'audit',
            inline: true,
          })}
        </div>`,
      }),
    ]),
  });
}

export function receiptsSection(): Html {
  const receipts = economyReceipts();
  const explicitlyLinkedJobs = receipts.filter((receipt) => Boolean(receipt.jobId));

  return Stack({
    children: join([
      StatGrid({
        children: join([
          StatCard({ label: 'Receipt fixtures', value: receipts.length, icon: 'audit', hint: 'repository records' }),
          StatCard({ label: 'Verification runs', value: 0, icon: 'shield', hint: 'use the verifier below' }),
          StatCard({ label: 'Linked jobs', value: explicitlyLinkedJobs.length, icon: 'machine', hint: 'explicit identifiers only' }),
          StatCard({ label: 'Live confirmed', value: 0, icon: 'external', hint: 'cluster identity unavailable' }),
        ]),
      }),
      receiptsTable(receipts),
      DataCard({
        title: 'Receipt evidence boundary',
        icon: 'alert',
        actions: sourceBadge('repository-fixture'),
        children: KeyValueList({
          rows: [
            { key: 'Fixture finality', value: 'Recorded in the committed fixture; not queried live', mono: true },
            { key: 'Job relationship', value: 'Not recorded; memo text is not used as a join', mono: true },
            { key: 'Settlement relationship', value: 'Not recorded; amount/machine similarity is ignored', mono: true },
            { key: 'Provider / resource', value: 'Not recorded', mono: true },
            { key: 'Work proof', value: 'Not recorded and no proof store is available', mono: true },
            { key: 'Explorer', value: 'Withheld because the fixture has no verified cluster identity', mono: true },
          ],
        }),
      }),
      receiptVerifier(),
    ]),
  });
}

/** Read-only support flags are exported for shell badges or tests. */
export const ECONOMY_PAGE_SUPPORT = ECONOMY_SUPPORT;
