import {
  CommandButton,
  DataCard,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  type Html,
  LoadingState,
  MachineBadge,
  SelectInput,
  Stack,
  StatCard,
  StatGrid,
  StatusBadge,
  TextInput,
  html,
  join,
} from '../ui/index.js';
import {
  loadRuntimeConsole,
  type RuntimeConnectionState,
  type RuntimeConsoleState,
  type RuntimeEventRecord,
  type RuntimeMachineRecord,
  type RuntimeSeverity,
} from '../services/runtime.js';

/**
 * Dense infrastructure telemetry view.
 *
 * It renders the adapter's single current snapshot and bounded runtime event
 * list. No chart is shown because the runtime source does not provide a real
 * time series, and this page does not start a client-side polling loop.
 */

const connectionTone = (
  state: RuntimeConnectionState
): 'online' | 'degraded' | 'offline' | 'neutral' =>
  state === 'live' ? 'online' : state === 'delayed' ? 'degraded' : state === 'offline' ? 'offline' : 'neutral';

const severityTone = (severity: RuntimeSeverity): 'online' | 'active' | 'degraded' | 'faulted' | 'neutral' =>
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

function telemetryReady(machines: RuntimeMachineRecord[], recentEvents: RuntimeEventRecord[], generatedAt: string): Html {
  const counts = {
    live: machines.filter((machine) => machine.connection.state === 'live').length,
    delayed: machines.filter((machine) => machine.connection.state === 'delayed').length,
    offline: machines.filter((machine) => machine.connection.state === 'offline').length,
    unknown: machines.filter((machine) => machine.connection.state === 'unknown').length,
  };

  return Stack({
    children: join([
      StatGrid({
        children: join([
          StatCard({ label: 'Fresh', value: counts.live, icon: 'zap', hint: 'observation age ≤ 2m' }),
          StatCard({
            label: 'Delayed',
            value: counts.delayed,
            icon: 'telemetry',
            tone: counts.delayed > 0 ? 'alert' : 'default',
            hint: 'observation age 3–14m',
          }),
          StatCard({
            label: 'Offline',
            value: counts.offline,
            icon: 'alert',
            tone: counts.offline > 0 ? 'alert' : 'default',
            hint: 'observation age ≥ 15m or offline health',
          }),
          StatCard({ label: 'Unknown', value: counts.unknown, icon: 'shield', hint: 'no valid observation timestamp' }),
        ]),
      }),
      html`<div class="mc-filterbar" aria-label="Telemetry filters">
        ${Field({
          inputId: 'mc-telemetry-filter-machine',
          label: 'Machine',
          children: TextInput({
            inputId: 'mc-telemetry-filter-machine',
            placeholder: 'Name or machine ID',
            className: 'mc-input--sans',
          }),
        })}
        ${Field({
          inputId: 'mc-telemetry-filter-connection',
          label: 'Update state',
          children: SelectInput({
            inputId: 'mc-telemetry-filter-connection',
            className: 'mc-input--sans',
            options: [
              { value: '', label: 'All update states' },
              { value: 'live', label: 'Fresh at snapshot' },
              { value: 'delayed', label: 'Delayed' },
              { value: 'offline', label: 'Offline' },
              { value: 'unknown', label: 'Unknown' },
            ],
          }),
        })}
        ${Field({
          inputId: 'mc-telemetry-filter-runtime',
          label: 'Runtime state',
          children: SelectInput({
            inputId: 'mc-telemetry-filter-runtime',
            className: 'mc-input--sans',
            options: [
              { value: '', label: 'All runtime states' },
              ...Array.from(new Set(machines.map((machine) => machine.runtimeStatus)))
                .sort()
                .map((status) => ({ value: status, label: status })),
            ],
          }),
        })}
        <span id="mc-telemetry-filter-status" class="mc-dim mc-mono mc-fs-11" role="status" aria-live="polite"
          >${machines.length} machines shown</span
        >
      </div>`,
      html`<div id="mc-telemetry-machine-table">${DataTable({
        columns: [
          {
            key: 'machine',
            header: 'Machine',
            cell: (machine: RuntimeMachineRecord) =>
              html`<a class="mc-machine-link" href="/console/machines/${encodeURIComponent(machine.machineId)}/telemetry"
                >${MachineBadge({ name: machine.label, machineId: machine.machineId, role: machine.role })}</a
              >`,
          },
          {
            key: 'runtime',
            header: 'Runtime',
            cell: (machine: RuntimeMachineRecord) =>
              StatusBadge({
                label: machine.runtimeStatus,
                size: 'sm',
              }),
          },
          {
            key: 'state',
            header: 'Machine state',
            cell: (machine: RuntimeMachineRecord) => StatusBadge({ label: machine.telemetry.health, size: 'sm' }),
          },
          {
            key: 'connection',
            header: 'Update state',
            cell: (machine: RuntimeMachineRecord) =>
              StatusBadge({
                label: machine.connection.state,
                tone: connectionTone(machine.connection.state),
                dot: machine.connection.state === 'unknown' ? 'ring' : 'solid',
                size: 'sm',
                title: machine.connection.reason,
              }),
          },
          {
            key: 'observation',
            header: 'Last observed',
            mono: true,
            cell: (machine: RuntimeMachineRecord) =>
              machine.connection.lastObservedAt
                ? compactTimestamp(machine.connection.lastObservedAt)
                : 'Not available',
          },
          {
            key: 'updated',
            header: 'Last update',
            mono: true,
            cell: (machine: RuntimeMachineRecord) => compactTimestamp(machine.telemetry.observedAt),
          },
          {
            key: 'activity',
            header: 'Current activity',
            mono: true,
            cell: (machine: RuntimeMachineRecord) =>
              machine.activeJob ? `${machine.activeJob.workOrderId} · ${machine.activeJob.stage}` : 'No active job',
          },
          {
            key: 'telemetry',
            header: 'Telemetry',
            cell: (machine: RuntimeMachineRecord) =>
              StatusBadge({
                label: machine.telemetry.diagnosticLevel,
                size: 'sm',
                dot: 'ring',
                title: machine.telemetry.diagnosticMessages.join('; ') || 'No diagnostic messages',
              }),
          },
        ],
        rows: machines,
        rowKey: (machine) => machine.machineId,
        caption: 'Machine runtime, observation freshness, activity, and recent telemetry status',
        compact: true,
        totalCount: machines.length,
        footer: html`<span class="mc-dim mc-fs-11">Snapshot generated ${compactTimestamp(generatedAt)}</span>`,
      })}</div>`,
      DataCard({
        title: 'Recent telemetry and runtime events',
        icon: 'terminal',
        flush: true,
        badge: StatusBadge({ label: `${recentEvents.length} records`, tone: 'neutral', dot: 'none', size: 'sm' }),
        children: DataTable({
          columns: [
            {
              key: 'time',
              header: 'Timestamp',
              mono: true,
              cell: (event: RuntimeEventRecord) => compactTimestamp(event.occurredAt),
            },
            { key: 'type', header: 'Type', mono: true, cell: (event: RuntimeEventRecord) => event.type },
            {
              key: 'machine',
              header: 'Machine',
              mono: true,
              cell: (event: RuntimeEventRecord) =>
                html`<a href="/console/machines/${encodeURIComponent(event.machineId)}/telemetry">${event.machineId}</a>`,
            },
            {
              key: 'source',
              header: 'Source',
              cell: (event: RuntimeEventRecord) =>
                StatusBadge({ label: event.source, tone: 'neutral', dot: 'ring', size: 'sm' }),
            },
            { key: 'payload', header: 'Payload summary', mono: true, cell: (event: RuntimeEventRecord) => event.payloadSummary },
            {
              key: 'severity',
              header: 'Severity',
              cell: (event: RuntimeEventRecord) =>
                StatusBadge({ label: event.severity, tone: severityTone(event.severity), size: 'sm' }),
            },
          ],
          rows: recentEvents,
          rowKey: (event) => event.eventId,
          caption: 'Bounded recent telemetry snapshots and runtime events',
          compact: true,
          empty: EmptyState({
            title: 'No recent events',
            description: 'The runtime snapshot contains no telemetry or runtime event records.',
            icon: 'terminal',
            inline: true,
          }),
          footer: html`<span class="mc-dim mc-fs-11"
            >At most 40 records are rendered. This page does not poll or claim a live stream.</span
          >`,
        }),
      }),
      DataCard({
        title: 'Update mechanism',
        icon: 'shield',
        children: html`<p class="mc-muted mc-flush mc-fs-12">
          Data is read once from the server-side runtime fixture snapshot for each page request. The runtime exposes no
          telemetry history or subscription endpoint here, so time-series charts and automatic polling are unavailable.
        </p>`,
      }),
    ]),
  });
}

/** Render the global telemetry route from a normalized adapter state. */
export function telemetrySection(state: RuntimeConsoleState = loadRuntimeConsole()): Html {
  if (state.status === 'loading') {
    return DataCard({ flush: true, children: LoadingState({ label: 'Loading runtime telemetry' }) });
  }
  if (state.status === 'unavailable') {
    return DataCard({
      flush: true,
      children: EmptyState({
        title: 'Runtime unavailable',
        description: state.reason,
        icon: 'telemetry',
        actions: CommandButton({ label: 'Reload', icon: 'refresh', size: 'sm', action: 'reload' }),
      }),
    });
  }
  if (state.status === 'error') {
    return DataCard({
      flush: true,
      children: ErrorState({
        title: 'Telemetry could not be loaded',
        description: 'The runtime adapter failed while normalizing the current snapshot.',
        detail: state.message,
        actions: CommandButton({ label: 'Retry', icon: 'refresh', size: 'sm', action: 'reload' }),
      }),
    });
  }
  if (state.status === 'empty') {
    return DataCard({
      flush: true,
      children: EmptyState({
        title: 'No machine telemetry',
        description: 'No machines or telemetry snapshots are available from the runtime source.',
        icon: 'telemetry',
      }),
    });
  }
  return telemetryReady(state.data.machines, state.data.recentEvents, state.data.generatedAt);
}
