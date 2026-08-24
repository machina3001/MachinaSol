import { sharedTheme } from '../../design/theme.js';

/**
 * Machine Console design tokens.
 *
 * Single source of truth. Consumed two ways:
 *   - `toCssVars()` emits them as CSS custom properties for the stylesheet.
 *   - imported directly in TS where a component needs a raw value.
 *
 * Dark-first, layered surfaces, two accents only (brass for primary/active,
 * oxide for alert). Deliberately no gradient scales and no shadow ramp beyond
 * two steps, to keep the surface reading as instrumentation rather than SaaS.
 */

export const color = {
  /** Page ground, darkest layer. */
  ground: sharedTheme.color.background,
  /** Default panel sitting on the ground. */
  surface: sharedTheme.color.surface,
  /** Raised panel (cards on a panel). */
  surfaceRaised: sharedTheme.color.surfaceElevated,
  /** Overlay surfaces (modal, drawer, popover). */
  surfaceOverlay: sharedTheme.color.surfaceOverlay,
  /** Row/control hover fill. */
  surfaceHover: sharedTheme.color.surfaceHover,
  /** Selected/active fill. */
  surfaceActive: sharedTheme.color.surfaceActive,

  /** Hairline borders. Thin and low contrast by design. */
  border: sharedTheme.color.border,
  borderStrong: sharedTheme.color.borderStrong,

  textPrimary: sharedTheme.color.foreground,
  textSecondary: sharedTheme.color.muted,
  textTertiary: sharedTheme.color.mutedSubtle,
  textDisabled: sharedTheme.color.disabled,

  /** Brass: primary actions, active nav, focus, positive emphasis. */
  accent: sharedTheme.color.accent,
  accentHover: sharedTheme.color.accentHover,
  accentForeground: sharedTheme.color.accentForeground,
  accentText: sharedTheme.color.accent,
  accentMuted: sharedTheme.color.accentMuted,
  accentBorder: sharedTheme.color.accentBorder,

  /** Oxide: warnings, breaches, destructive. */
  alert: sharedTheme.color.error,
  alertText: sharedTheme.color.error,
  alertMuted: sharedTheme.color.errorMuted,
  alertBorder: sharedTheme.color.errorBorder,

  /** Status palette. Keys align with the SDK's status vocabularies. */
  statusOnline: sharedTheme.color.success,
  statusOnlineMuted: sharedTheme.color.successMuted,
  statusOnlineBorder: sharedTheme.color.successBorder,
  statusWorking: sharedTheme.color.info,
  statusWorkingMuted: sharedTheme.color.infoMuted,
  statusWorkingBorder: sharedTheme.color.infoBorder,
  statusIdle: sharedTheme.color.neutral,
  statusDegraded: sharedTheme.color.warning,
  statusDegradedMuted: sharedTheme.color.warningMuted,
  statusDegradedBorder: sharedTheme.color.warningBorder,
  statusFaulted: sharedTheme.color.error,
  statusFaultedMuted: sharedTheme.color.errorMuted,
  statusFaultedBorder: sharedTheme.color.errorBorder,
  statusOffline: sharedTheme.color.offline,

  /** Chain accent, used sparingly on network indicators only. */
  chain: sharedTheme.color.accent,
  chainMuted: sharedTheme.color.accentMuted,
} as const;

export const font = {
  sans: sharedTheme.font.sans,
  mono: sharedTheme.font.mono,
} as const;

export const radius = {
  ...sharedTheme.radius,
} as const;

export const shadow = {
  /** Minimal by design: one flat card shadow and one overlay shadow. */
  ...sharedTheme.shadow,
} as const;

export const layout = {
  sidebarWidth: '236px',
  topbarHeight: '52px',
  contentMax: '1600px',
} as const;

/** Status token keys understood by StatusBadge / MachineBadge. */
export const STATUS_TONES = [
  'online',
  'working',
  'idle',
  'degraded',
  'faulted',
  'offline',
  'active',
  'neutral',
] as const;

export type StatusTone = (typeof STATUS_TONES)[number];

/**
 * Maps SDK status strings onto visual tones so callers can pass raw SDK values
 * (MachineRuntimeStatus, WorkOrderStage, health) without a translation layer.
 */
export const statusToneMap: Readonly<Record<string, StatusTone>> = {
  // MachineRuntimeStatus
  idle: 'idle',
  assigned: 'active',
  working: 'working',
  completed: 'online',
  faulted: 'faulted',
  offline: 'offline',
  // health
  nominal: 'online',
  degraded: 'degraded',
  // WorkOrderStage / MachineJobStatus
  queued: 'idle',
  preparing: 'active',
  created: 'idle',
  running: 'working',
  proof_submitted: 'working',
  settled: 'online',
  cancelled: 'offline',
  failed: 'faulted',
  // verification / diagnostics
  success: 'online',
  pending: 'active',
  not_found: 'offline',
  ok: 'online',
  warn: 'degraded',
  error: 'faulted',
  stale: 'degraded',
};

export const toneFor = (value: string | undefined): StatusTone =>
  (value !== undefined && statusToneMap[value.toLowerCase()]) || 'neutral';

/** Emits the token set as CSS custom properties for the stylesheet's :root. */
export function toCssVars(): string {
  const entries: string[] = [];
  const push = (name: string, value: string) => entries.push(`  --mc-${name}: ${value};`);

  push('ground', color.ground);
  push('surface', color.surface);
  push('surface-raised', color.surfaceRaised);
  push('surface-overlay', color.surfaceOverlay);
  push('surface-hover', color.surfaceHover);
  push('surface-active', color.surfaceActive);
  push('border', color.border);
  push('border-strong', color.borderStrong);
  push('text', color.textPrimary);
  push('text-2', color.textSecondary);
  push('text-3', color.textTertiary);
  push('text-off', color.textDisabled);
  push('accent', color.accent);
  push('accent-hover', color.accentHover);
  push('accent-fg', color.accentForeground);
  push('accent-text', color.accentText);
  push('accent-muted', color.accentMuted);
  push('accent-border', color.accentBorder);
  push('alert', color.alert);
  push('alert-text', color.alertText);
  push('alert-muted', color.alertMuted);
  push('alert-border', color.alertBorder);
  push('st-online', color.statusOnline);
  push('st-online-muted', color.statusOnlineMuted);
  push('st-online-border', color.statusOnlineBorder);
  push('st-working', color.statusWorking);
  push('st-working-muted', color.statusWorkingMuted);
  push('st-working-border', color.statusWorkingBorder);
  push('st-idle', color.statusIdle);
  push('st-degraded', color.statusDegraded);
  push('st-degraded-muted', color.statusDegradedMuted);
  push('st-degraded-border', color.statusDegradedBorder);
  push('st-faulted', color.statusFaulted);
  push('st-faulted-muted', color.statusFaultedMuted);
  push('st-faulted-border', color.statusFaultedBorder);
  push('st-offline', color.statusOffline);
  push('chain', color.chain);
  push('chain-muted', color.chainMuted);
  push('font-sans', font.sans);
  push('font-mono', font.mono);
  push('r-sm', radius.sm);
  push('r-md', radius.md);
  push('r-lg', radius.lg);
  push('r-xl', radius.xl);
  push('r-pill', radius.pill);
  push('sh-card', shadow.card);
  push('sh-overlay', shadow.overlay);
  push('sh-focus', shadow.focus);
  push('transition-fast', sharedTheme.motion.fast);
  push('transition-standard', sharedTheme.motion.standard);
  push('sidebar-w', layout.sidebarWidth);
  push('topbar-h', layout.topbarHeight);
  push('content-max', layout.contentMax);

  return entries.join('\n');
}
