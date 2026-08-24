import {
  AddressDisplay,
  AppShell,
  Brand,
  Breadcrumb,
  CommandButton,
  CopyButton,
  CountBadge,
  DataCard,
  Drawer,
  EmptyState,
  type Html,
  type IconName,
  type NavItem,
  Menu,
  NetworkIndicator,
  OverlayActions,
  PageHeader,
  Sidebar,
  Skeleton,
  StatusBadge,
  Topbar,
  TopbarDivider,
  WalletButton,
  html,
  join,
} from '../ui/index.js';
import { fleetSnapshot } from '../data/fleet-snapshot.js';
import { overviewSection } from './overview.js';
import { economyReceipts } from '../services/economy.js';
import { machineDetailHeader, machineDetailSection, machinesSection } from './machines.js';
import {
  jobDetailHeader,
  jobDetailSection,
  jobsSection,
  receiptsSection,
  settlementsSection,
} from './economy.js';
import { resourceDetailHeader, resourceDetailSection, resourcesSection } from './resources.js';
import { telemetrySection } from './telemetry.js';
import { settingsSection } from './sections.js';

/**
 * The Machine Console application shell.
 *
 * Owns navigation structure, the persistent chrome, and which normalized page
 * module to render. The design system supplies every visual primitive.
 */

export interface ConsolePageOptions {
  /** Active section id, derived from the URL. */
  section: string;
  /** Detail record id for nested routes, e.g. a machine id. */
  detailId?: string | undefined;
  /** Active tab within a detail page. */
  tab?: string | undefined;
  version: string;
  liveReadEnabled: boolean;
  /** Actual server bind host, used for truthful security posture copy. */
  bindHost: string;
  /** Link back to the existing runtime page. */
  homeHref: string;
}

interface SectionDef {
  id: string;
  /** Sidebar label. */
  label: string;
  /** Page heading, when it should differ from the sidebar label. */
  title?: string;
  icon: IconName;
  /** Sidebar group. Operations sit above the economy group. */
  group: 'operations' | 'economy' | 'system';
  description: string;
}

const SECTIONS: SectionDef[] = [
  {
    id: 'overview',
    label: 'Overview',
    title: 'Machine Console',
    icon: 'overview',
    group: 'operations',
    description: 'Inspect the current normalized runtime snapshot.',
  },
  {
    id: 'machines',
    label: 'Machines',
    icon: 'fleet',
    group: 'operations',
    description: 'Inspect normalized machine records and runtime evidence.',
  },
  {
    id: 'resources',
    label: 'Resources',
    icon: 'resource',
    group: 'operations',
    description: 'Inspect provider capabilities and quotes when a marketplace source is configured.',
  },
  {
    id: 'jobs',
    label: 'Jobs',
    icon: 'machine',
    group: 'operations',
    description: 'Work orders and the stage order the runtime enforces.',
  },
  {
    id: 'telemetry',
    label: 'Telemetry',
    icon: 'telemetry',
    group: 'operations',
    description: 'Current machine snapshots, telemetry observation freshness, diagnostics, and bounded runtime events.',
  },
  {
    id: 'settlements',
    label: 'Settlements',
    icon: 'settlement',
    group: 'economy',
    description: 'Unsigned caller-wallet intents. Nothing here is signed or broadcast.',
  },
  {
    id: 'receipts',
    label: 'Receipts',
    icon: 'audit',
    group: 'economy',
    description: 'Receipt evidence, finality, and expectation mismatch reasons.',
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: 'shield',
    group: 'system',
    description: 'Runtime configuration, policy profile, and security posture.',
  },
];

const GROUP_LABELS: Readonly<Record<SectionDef['group'], string | undefined>> = {
  operations: undefined,
  economy: 'Economy',
  system: 'System',
};

function sectionBody(id: string, options: ConsolePageOptions): Html {
  switch (id) {
    case 'not-found':
      return DataCard({
        flush: true,
        children: EmptyState({
          title: 'Console route not found',
          description: 'This path does not map to a Machine Console section or supported detail route.',
          icon: 'alert',
          actions: CommandButton({ label: 'Console overview', href: '/console', size: 'sm', variant: 'primary' }),
        }),
      });
    case 'machines':
      return options.detailId
        ? machineDetailSection(options.detailId, options.tab ?? 'overview')
        : machinesSection();
    case 'resources':
      return options.detailId ? resourceDetailSection(options.detailId) : resourcesSection();
    case 'jobs':
      return options.detailId ? jobDetailSection(options.detailId, options.tab) : jobsSection();
    case 'telemetry':
      return telemetrySection();
    case 'settlements':
      return settlementsSection(options.liveReadEnabled);
    case 'receipts':
      return receiptsSection();
    case 'settings':
      return settingsSection(options.liveReadEnabled, options.version, options.bindHost);
    default:
      return overviewSection();
  }
}

/** Detail panel populated client-side when a machine row or card is activated. */
function machineDrawer(): Html {
  return Drawer({
    id: 'mc-machine-drawer',
    title: 'Machine detail',
    description: 'Select a machine to inspect its runtime record',
    wide: true,
    children: html`<div id="mc-machine-drawer-body">${Skeleton({ lines: 6 })}</div>`,
    footer: OverlayActions({
      children: CommandButton({ label: 'Close', size: 'sm', action: 'close-overlay', target: 'mc-machine-drawer' }),
    }),
  });
}

export function renderConsolePage(options: ConsolePageOptions): Html {
  const snap = fleetSnapshot();
  const routeNotFound = options.section === 'not-found';
  const active = routeNotFound
    ? 'not-found'
    : SECTIONS.some((s) => s.id === options.section)
      ? options.section
      : 'overview';
  const current = routeNotFound
    ? {
        id: 'not-found',
        label: 'Not found',
        icon: 'alert' as const,
        group: 'system' as const,
        description: 'The requested console route does not exist.',
      }
    : (SECTIONS.find((s) => s.id === active) ?? SECTIONS[0]!);
  const machineDetail = active === 'machines' && options.detailId ? machineDetailHeader(options.detailId) : undefined;
  const resourceDetail = active === 'resources' && options.detailId ? resourceDetailHeader(options.detailId) : undefined;
  const jobDetail = active === 'jobs' && options.detailId ? jobDetailHeader(options.detailId) : undefined;
  const detailTitle = machineDetail?.title ?? resourceDetail?.title ?? jobDetail?.title;
  const hasDetail = detailTitle !== undefined;

  const navItem = (section: SectionDef): NavItem => ({
    label: section.label,
    href: `/console/${section.id}`,
    icon: section.icon,
    active: section.id === active,
    ...(section.id === 'machines' ? { badge: CountBadge({ value: snap.registry.total }) } : {}),
    ...(section.id === 'receipts'
      ? {
          badge: StatusBadge({
            label: String(economyReceipts().length),
            tone: 'idle',
            dot: 'none',
            size: 'sm',
          }),
        }
      : {}),
  });

  const groups = (['operations', 'economy', 'system'] as const).map((group) => ({
    ...(GROUP_LABELS[group] ? { label: GROUP_LABELS[group] } : {}),
    items: SECTIONS.filter((section) => section.group === group).map(navItem),
  }));

  const networkState = options.liveReadEnabled ? 'unknown' : 'fixture';

  // Account menu. Entries are declarative; handlers live in the client script.
  const accountMenu = Menu({
    id: 'mc-account-menu',
    ariaLabel: 'Account menu',
    trigger: CommandButton({
      label: snap.session.operatorId,
      icon: 'wallet',
      iconAfter: 'chevron-down',
      size: 'sm',
      variant: 'quiet',
      action: 'menu',
      target: 'mc-account-menu',
      ariaLabel: `Account menu for ${snap.session.operatorId}`,
      ariaHasPopup: 'menu',
      ariaControls: 'mc-account-menu',
      ariaExpanded: false,
    }),
    header: html`<div class="mc-col mc-gap-2">
      <span class="mc-label">Session identity · unverified</span>
      <span class="mc-fs-12">${snap.session.operatorId}</span>
      ${AddressDisplay({ value: snap.session.walletAddress, head: 6, tail: 6 })}
    </div>`,
    items: [
      {
        label: 'Copy session id',
        icon: 'copy',
        action: 'copy-session',
        target: snap.session.sessionId,
        hint: 'session',
      },
      { label: 'Machine detail', icon: 'machine', action: 'open-machine', target: snap.session.machineId },
      { label: 'Settings', icon: 'shield', href: '/console/settings' },
      { label: 'Route index', icon: 'external', href: '/api' },
      { label: 'Runtime page', icon: 'terminal', href: options.homeHref, separated: true },
    ],
  });

  return AppShell({
    brand: Brand({ name: 'Machine Console', tagline: `runtime ${options.version}`, href: '/console' }),
    sidebar: Sidebar({
      groups,
      blocks: [
        {
          label: 'Network',
          content: NetworkIndicator({
            network: 'solana',
            state: networkState,
            detail: options.liveReadEnabled ? 'live reads permitted' : 'deterministic',
          }),
        },
        {
          label: 'Account',
          content: WalletButton({
            address: snap.session.walletAddress,
            caption: `${snap.session.operatorId} · unverified`,
            addressLabel: 'Session-supplied address',
            openLabel: 'open machine record',
            action: 'open-machine',
            target: snap.session.machineId,
          }),
        },
      ],
      footer: CommandButton({
        label: 'Reload session view',
        icon: 'refresh',
        size: 'sm',
        variant: 'quiet',
        block: true,
        action: 'reload',
      }),
    }),
    topbar: Topbar({
      start: join(
        [
          CommandButton({
            label: snap.session.machineLabel ?? snap.session.machineId,
            icon: 'drone',
            iconAfter: 'chevron-down',
            size: 'sm',
            variant: 'quiet',
            action: 'open-machine',
            target: snap.session.machineId,
          }),
          TopbarDivider(),
          StatusBadge({ label: `${snap.session.mode} session record`, tone: 'idle', dot: 'ring', size: 'sm' }),
        ],
        ' '
      ),
      end: join(
        [
          NetworkIndicator({
            network: 'solana',
            state: networkState,
            detail: options.liveReadEnabled ? 'unobserved' : 'fixture',
          }),
          TopbarDivider(),
          WalletButton({
            address: snap.session.walletAddress,
            caption: 'session address · unverified',
            addressLabel: 'Session-supplied address',
            openLabel: 'open machine record',
            action: 'open-machine',
            target: snap.session.machineId,
          }),
          accountMenu,
        ],
        ' '
      ),
    }),
    children: html`
      ${PageHeader({
        title: detailTitle ?? current.title ?? current.label,
        description: hasDetail ? undefined : current.description,
        breadcrumb: Breadcrumb({
          items: machineDetail
            ? [
                { label: 'Console', href: '/console' },
                { label: 'Machines', href: '/console/machines' },
                { label: machineDetail.machineId },
              ]
            : resourceDetail
              ? [
                { label: 'Console', href: '/console' },
                { label: 'Resources', href: '/console/resources' },
                { label: resourceDetail.resourceId },
              ]
            : jobDetail
              ? [
                  { label: 'Console', href: '/console' },
                  { label: 'Jobs', href: '/console/jobs' },
                  { label: jobDetail.breadcrumbLabel },
                ]
            : [{ label: 'Console', href: '/console' }, { label: current.label }],
        }),
        meta: machineDetail
          ? machineDetail.found
            ? join(
                [
                  StatusBadge({ label: machineDetail.machineId, tone: 'neutral', dot: 'none', size: 'sm' }),
                  StatusBadge({ label: machineDetail.status, size: 'sm' }),
                  AddressDisplay({
                    value: machineDetail.wallet,
                    boxed: true,
                    chain: true,
                    action: CopyButton({ value: machineDetail.wallet, what: 'session-supplied address' }),
                  }),
                  StatusBadge({
                    label: `${machineDetail.owner} · declared`,
                    tone: 'neutral',
                    dot: 'none',
                    size: 'sm',
                  }),
                ],
                ' '
              )
            : StatusBadge({ label: 'not found', tone: 'faulted', size: 'sm' })
          : resourceDetail
            ? resourceDetail.found
              ? join(
                  [
                    StatusBadge({ label: resourceDetail.resourceId, tone: 'neutral', dot: 'none', size: 'sm' }),
                    StatusBadge({ label: resourceDetail.resourceType, tone: 'idle', dot: 'ring', size: 'sm' }),
                    StatusBadge({ label: resourceDetail.providerStatus, size: 'sm' }),
                    StatusBadge({ label: resourceDetail.runtimeRail, tone: 'neutral', dot: 'none', size: 'sm' }),
                  ],
                  ' '
                )
              : StatusBadge({ label: 'unavailable', tone: 'offline', size: 'sm' })
          : jobDetail
            ? jobDetail.found
              ? join(
                  [
                    StatusBadge({ label: jobDetail.jobId, tone: 'neutral', dot: 'none', size: 'sm' }),
                    StatusBadge({ label: jobDetail.status, size: 'sm' }),
                    StatusBadge({ label: jobDetail.settlementState, tone: 'idle', dot: 'ring', size: 'sm' }),
                    StatusBadge({ label: jobDetail.sourceLabel, tone: 'neutral', dot: 'none', size: 'sm' }),
                  ],
                  ' '
                )
              : StatusBadge({ label: 'not found', tone: 'faulted', size: 'sm' })
          : join(
              [
                StatusBadge({
                  label: options.liveReadEnabled ? 'live-read allowed' : 'fixture mode',
                  tone: 'idle',
                  dot: 'ring',
                  size: 'sm',
                }),
                StatusBadge({
                  label: 'no auth · no keys · no custody · no broadcast',
                  tone: 'neutral',
                  dot: 'none',
                  size: 'sm',
                }),
              ],
              ' '
            ),
        actions: machineDetail
          ? join(
              [
                CommandButton({
                  label: 'All machines',
                  href: '/console/machines',
                  size: 'sm',
                  variant: 'quiet',
                  icon: 'fleet',
                }),
                CommandButton({ label: 'Reload', size: 'sm', icon: 'refresh', action: 'reload' }),
              ],
              ' '
            )
          : resourceDetail
            ? join(
                [
                  CommandButton({
                    label: 'All resources',
                    href: '/console/resources',
                    size: 'sm',
                    variant: 'quiet',
                    icon: 'resource',
                  }),
                  CommandButton({
                    label: 'Request resource',
                    size: 'sm',
                    variant: 'primary',
                    icon: 'plus',
                    action: 'open-resource-request',
                  }),
                ],
                ' '
              )
          : jobDetail
            ? join(
                [
                  CommandButton({
                    label: 'All jobs',
                    href: jobDetail.backHref,
                    size: 'sm',
                    variant: 'quiet',
                    icon: 'machine',
                  }),
                  ...(jobDetail.machineHref
                    ? [
                        CommandButton({
                          label: 'Machine',
                          href: jobDetail.machineHref,
                          size: 'sm',
                          icon: 'fleet',
                        }),
                      ]
                    : []),
                ],
                ' '
              )
          : active === 'machines'
            ? join(
                [
                  CommandButton({ label: 'Reload', size: 'sm', variant: 'quiet', icon: 'refresh', action: 'reload' }),
                  CommandButton({
                    label: 'Register Machine',
                    variant: 'primary',
                    size: 'sm',
                    icon: 'plus',
                    action: 'open-overlay',
                    target: 'mc-register-modal',
                  }),
                ],
                ' '
              )
            : join(
                [
                  CopyButton({ value: snap.session.sessionId, what: 'session id', label: 'Session id' }),
                  CommandButton({ label: 'Reload', size: 'sm', icon: 'refresh', action: 'reload' }),
                ],
                ' '
              ),
      })}
      ${sectionBody(active, options)} ${machineDrawer()}
    `,
  });
}

export const CONSOLE_SECTIONS = SECTIONS;
