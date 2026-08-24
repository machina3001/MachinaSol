import { type StatusTone, toneFor } from '../design/tokens.js';
import {
  type BaseProps,
  type Html,
  EMPTY,
  attrs,
  baseAttrs,
  cx,
  esc,
  html,
  join,
  truncateMiddle,
} from './html.js';
import { Icon, type IconName } from './icons.js';

/**
 * Data display components. These render values they are given and derive
 * nothing: no fetching, no formatting decisions that belong to a domain layer,
 * no status interpretation beyond mapping a status string to a visual tone.
 */

// ---------------------------------------------------------------------------
// StatusBadge
// ---------------------------------------------------------------------------

export interface StatusBadgeProps extends BaseProps {
  /** Visible text. Rendered uppercase by the stylesheet. */
  label: string;
  /**
   * Visual tone. When omitted it is derived from `label` via the SDK status
   * map, so raw values like `working` or `proof_submitted` style themselves.
   */
  tone?: StatusTone | undefined;
  /** Leading dot. `solid` reads as live, `ring` as inactive. */
  dot?: 'solid' | 'ring' | 'none' | undefined;
  /** Animates the dot. Reserve for genuinely live values. */
  pulse?: boolean | undefined;
  size?: 'sm' | 'md' | undefined;
  pill?: boolean | undefined;
  /** Optional tooltip, e.g. the reason behind a faulted status. */
  title?: string | undefined;
  role?: 'status' | undefined;
  ariaLive?: 'polite' | 'assertive' | undefined;
}

export function StatusBadge({
  label,
  tone,
  dot = 'solid',
  pulse,
  size = 'md',
  pill,
  title,
  role,
  ariaLive,
  ...base
}: StatusBadgeProps): Html {
  const resolved = tone ?? toneFor(label);
  const cls = cx(
    'mc-badge',
    `mc-badge--${resolved}`,
    size === 'sm' && 'mc-badge--sm',
    pill && 'mc-badge--pill',
    base.className
  );
  return html`<span${attrs({ class: cls, id: base.id, 'data-mc': base.testId, title, role, 'aria-live': ariaLive })}>
    ${dot === 'none'
      ? EMPTY
      : html`<span class="${cx('mc-dot', dot === 'ring' && 'mc-dot--ring', pulse && 'mc-dot--pulse')}" aria-hidden="true"></span>`}
    ${label}
  </span>`;
}

/** Neutral counter badge, for nav items and section counts. */
export const CountBadge = ({ value, tone }: { value: number | string; tone?: StatusTone }): Html =>
  html`<span class="${cx('mc-badge', 'mc-badge--sm', `mc-badge--${tone ?? 'neutral'}`)}">${value}</span>`;

// ---------------------------------------------------------------------------
// MachineBadge
// ---------------------------------------------------------------------------

const ROLE_ICONS: Readonly<Record<string, IconName>> = {
  drone: 'drone',
  sensor: 'sensor',
  edge_node: 'sensor',
  robot_arm: 'machine',
  rover: 'machine',
  warehouse_bot: 'machine',
};

export interface MachineBadgeProps extends BaseProps {
  /** Human label, e.g. a machine's display name. */
  name: string;
  /** Technical identifier, rendered mono under the name. */
  machineId?: string | undefined;
  /** SDK role value; selects the glyph. */
  role?: string | undefined;
  /** Overrides the role-derived icon. */
  icon?: IconName | undefined;
  /** Trailing status, rendered inline after the text block. */
  status?: Html | undefined;
  /** Hides the icon for dense table cells. */
  compact?: boolean | undefined;
}

export function MachineBadge({
  name,
  machineId,
  role,
  icon,
  status,
  compact,
  ...base
}: MachineBadgeProps): Html {
  const glyph = icon ?? (role ? ROLE_ICONS[role] : undefined) ?? 'machine';
  return html`<span${baseAttrs(base, 'mc-machine-badge')}>
    ${compact ? EMPTY : html`<span class="mc-machine-badge__icon">${Icon({ name: glyph })}</span>`}
    <span class="mc-machine-badge__text">
      <span class="mc-machine-badge__name">${name}</span>
      ${machineId ? html`<span class="mc-machine-badge__id">${machineId}</span>` : EMPTY}
    </span>
    ${status ?? EMPTY}
  </span>`;
}

// ---------------------------------------------------------------------------
// AddressDisplay
// ---------------------------------------------------------------------------

export interface AddressDisplayProps extends BaseProps {
  /** Full address, signature, or hash. */
  value: string;
  /** Leading characters kept when truncating. */
  head?: number | undefined;
  /** Trailing characters kept when truncating. */
  tail?: number | undefined;
  /** Renders the untruncated value. */
  full?: boolean | undefined;
  /** Draws a bordered container. */
  boxed?: boolean | undefined;
  /** Shows a chain glyph before the value. */
  chain?: boolean | undefined;
  /** Explorer URL. Renders a trailing external-link affordance. */
  href?: string | undefined;
  /** Slot for a CopyButton. */
  action?: Html | undefined;
  /** Overrides the title attribute, which defaults to the full value. */
  title?: string | undefined;
}

export function AddressDisplay({
  value,
  head = 4,
  tail = 4,
  full,
  boxed,
  chain,
  href,
  action,
  title,
  ...base
}: AddressDisplayProps): Html {
  const shown = full ? value : truncateMiddle(value, head, tail);
  return html`<span${attrs({
    class: cx('mc-address', boxed && 'mc-address--boxed', base.className),
    id: base.id,
    'data-mc': base.testId,
    title: title ?? value,
  })}>
    ${chain ? html`<span class="mc-address__chain">${Icon({ name: 'link', size: 11 })}</span>` : EMPTY}
    <span class="mc-address__value">${shown}</span>
    ${href
      ? html`<a class="mc-address__link" href="${href}" target="_blank" rel="noreferrer noopener"${attrs({
          'aria-label': `Open ${esc(truncateMiddle(value, 6, 6))} in explorer`,
        })}>${Icon({ name: 'external', size: 11 })}</a>`
      : EMPTY}
    ${action ?? EMPTY}
  </span>`;
}

// ---------------------------------------------------------------------------
// NetworkIndicator
// ---------------------------------------------------------------------------

export interface NetworkIndicatorProps extends BaseProps {
  /** Network name, e.g. a cluster or rail label. */
  network: string;
  /** Connection state. `fixture` renders a dashed border for offline data. */
  state?: 'online' | 'degraded' | 'offline' | 'unknown' | 'fixture' | undefined;
  /** Round-trip latency in milliseconds. */
  latencyMs?: number | undefined;
  /** Extra trailing detail, e.g. a slot or block height. */
  detail?: string | undefined;
}

export function NetworkIndicator({
  network,
  state = 'online',
  latencyMs,
  detail,
  ...base
}: NetworkIndicatorProps): Html {
  const label =
    state === 'fixture'
      ? 'Deterministic fixture data, no network calls'
      : state === 'unknown'
        ? 'Network reachability has not been observed'
      : `Network ${state}${latencyMs !== undefined ? `, ${latencyMs}ms` : ''}`;
  return html`<span${attrs({
    class: cx('mc-network', `mc-network--${state}`, base.className),
    id: base.id,
    'data-mc': base.testId,
    title: label,
  })}>
    <span class="mc-network__dot" aria-hidden="true"
      ><span class="${cx('mc-dot', state === 'online' && 'mc-dot--pulse')}"></span
    ></span>
    <span class="mc-network__name">${network}</span>
    ${latencyMs !== undefined ? html`<span class="mc-network__latency">${latencyMs}ms</span>` : EMPTY}
    ${detail ? html`<span class="mc-network__latency">${detail}</span>` : EMPTY}
    <span class="mc-sr">${label}</span>
  </span>`;
}

// ---------------------------------------------------------------------------
// Meter and Sparkline
// ---------------------------------------------------------------------------

export interface MeterProps extends BaseProps {
  /** Current value. `undefined` renders an em dash for missing data. */
  value: number | undefined;
  max?: number | undefined;
  /** Bar colour. Defaults to the brass accent. */
  tone?: 'accent' | 'online' | 'degraded' | 'faulted' | 'working' | undefined;
  /** Shows the `/max` suffix. */
  showMax?: boolean | undefined;
  /** Accessible name, since a bare number is ambiguous. */
  label?: string | undefined;
}

export function Meter({ value, max = 100, tone = 'accent', showMax, label, ...base }: MeterProps): Html {
  if (value === undefined) {
    return html`<span${baseAttrs({ ...base, className: cx('mc-meter', 'mc-meter--empty', base.className) }, '')}
      ><span class="mc-meter__value" aria-label="${label ? `${label}: no data` : 'No data'}">—</span></span
    >`;
  }
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return html`<span${baseAttrs({ ...base, className: cx('mc-meter', base.className) }, '')}
    ><span class="mc-meter__row">
      <span class="mc-meter__value">${value}</span>
      ${showMax ? html`<span class="mc-meter__max">/${max}</span>` : EMPTY}
    </span>
    <svg
      class="mc-meter__track"
      viewBox="0 0 100 3"
      preserveAspectRatio="none"
      role="meter"${attrs({
        'aria-valuenow': value,
        'aria-valuemin': 0,
        'aria-valuemax': max,
        'aria-label': label,
      })}
      ><rect${attrs({
        class: cx('mc-meter__fill', tone !== 'accent' && `mc-meter__fill--${tone}`),
        x: 0,
        y: 0,
        width: pct.toFixed(2),
        height: 3,
      })} /></svg
    >
  </span>`;
}

export interface SparklineProps extends BaseProps {
  /** Series values, oldest first. Needs at least two points to draw. */
  points: number[];
  tone?: 'accent' | 'online' | 'degraded' | 'faulted' | undefined;
  /** Fills the area under the line. */
  area?: boolean | undefined;
  height?: number | undefined;
  /** Accessible summary, since the shape itself conveys the meaning. */
  label?: string | undefined;
}

export function Sparkline({
  points,
  tone = 'accent',
  area,
  height = 26,
  label,
  ...base
}: SparklineProps): Html {
  if (points.length < 2) return EMPTY;
  const width = 100;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const stepX = width / (points.length - 1);
  const coords = points.map((point, index) => {
    const x = index * stepX;
    // Inset by 1 on each edge so the stroke is not clipped at the extremes.
    const y = height - 1 - ((point - min) / span) * (height - 2);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const line = `M${coords.join('L')}`;
  const areaPath = `${line}L${width.toFixed(2)},${height}L0,${height}Z`;
  return html`<svg${attrs({
    class: cx('mc-spark', base.className),
    id: base.id,
    'data-mc': base.testId,
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: 'none',
    role: label ? 'img' : 'presentation',
    'aria-label': label,
    'aria-hidden': label ? undefined : 'true',
  })}>
    ${area ? html`<path class="mc-spark__area" d="${areaPath}" />` : EMPTY}
    <path class="${cx('mc-spark__line', tone !== 'accent' && `mc-spark__line--${tone}`)}" d="${line}" vector-effect="non-scaling-stroke" />
  </svg>`;
}

// ---------------------------------------------------------------------------
// StatCard
// ---------------------------------------------------------------------------

export interface StatCardProps extends BaseProps {
  /** Uppercase mono label. */
  label: string;
  /** Primary figure. Pre-formatted by the caller. */
  value: string | number;
  /** Unit suffix rendered smaller next to the value. */
  unit?: string | undefined;
  /** Signed change indicator. */
  delta?: { value: string; direction: 'up' | 'down' | 'flat' } | undefined;
  /** Small explanatory line at the bottom. */
  hint?: string | undefined;
  /** Leading icon next to the label. */
  icon?: IconName | undefined;
  /** Trailing slot on the label row, e.g. a StatusBadge. */
  badge?: Html | undefined;
  /** Trend visual rendered under the value. */
  trend?: Html | undefined;
  tone?: 'default' | 'accent' | 'alert' | undefined;
}

export function StatCard({
  label,
  value,
  unit,
  delta,
  hint,
  icon,
  badge,
  trend,
  tone = 'default',
  ...base
}: StatCardProps): Html {
  const arrow: IconName = delta?.direction === 'up' ? 'arrow-up' : delta?.direction === 'down' ? 'arrow-down' : 'dash';
  return html`<div${attrs({
    class: cx('mc-card', tone === 'accent' && 'mc-card--accent', tone === 'alert' && 'mc-card--alert', base.className),
    id: base.id,
    'data-mc': base.testId,
  })}>
    <div class="mc-stat">
      <div class="mc-stat__head">
        ${icon ? html`<span class="mc-dim mc-icon-slot" >${Icon({ name: icon, size: 12 })}</span>` : EMPTY}
        <span class="mc-label">${label}</span>
        ${badge ? html`<span class="mc-push">${badge}</span>` : EMPTY}
      </div>
      <div class="mc-stat__value">
        <span>${value}</span>
        ${unit ? html`<span class="mc-stat__unit">${unit}</span>` : EMPTY}
      </div>
      ${trend ?? EMPTY}
      ${delta || hint
        ? html`<div class="mc-stat__foot">
            ${delta
              ? html`<span class="${cx('mc-stat__delta', `mc-stat__delta--${delta.direction}`)}">
                  ${Icon({ name: arrow, size: 10 })}${delta.value}
                </span>`
              : EMPTY}
            ${hint ? html`<span class="mc-stat__hint">${hint}</span>` : EMPTY}
          </div>`
        : EMPTY}
    </div>
  </div>`;
}

/** Auto-fitting grid for StatCards. */
export const StatGrid = ({ children, className }: { children: Html; className?: string }): Html =>
  html`<div class="${cx('mc-stat-grid', className)}">${children}</div>`;

// ---------------------------------------------------------------------------
// DataCard
// ---------------------------------------------------------------------------

export interface DataCardProps extends BaseProps {
  /** Card heading. Omit for an unlabelled container. */
  title?: string | undefined;
  /** Leading icon in the header. */
  icon?: IconName | undefined;
  /** Right-aligned header slot. */
  actions?: Html | undefined;
  /** Header badge rendered immediately after the title. */
  badge?: Html | undefined;
  /** Body content. */
  children: Html;
  /** Footer content. */
  footer?: Html | undefined;
  /** Removes body padding, for tables and code blocks. */
  flush?: boolean | undefined;
  /** Uses the raised surface, for cards sitting on another card. */
  raised?: boolean | undefined;
  /** Adds a hover affordance. Use only when the whole card is actionable. */
  interactive?: boolean | undefined;
  tone?: 'default' | 'accent' | 'alert' | undefined;
}

export function DataCard({
  title,
  icon,
  actions,
  badge,
  children,
  footer,
  flush,
  raised,
  interactive,
  tone = 'default',
  ...base
}: DataCardProps): Html {
  const cls = cx(
    'mc-card',
    raised && 'mc-card--raised',
    interactive && 'mc-card--interactive',
    tone === 'accent' && 'mc-card--accent',
    tone === 'alert' && 'mc-card--alert',
    base.className
  );
  return html`<section${attrs({ class: cls, id: base.id, 'data-mc': base.testId })}>
    ${title || actions
      ? html`<div class="mc-card__head">
          <h3 class="mc-card__title">
            ${icon ? html`<span class="mc-dim mc-icon-slot" >${Icon({ name: icon, size: 12 })}</span>` : EMPTY}
            <span class="mc-truncate">${title ?? ''}</span>
            ${badge ?? EMPTY}
          </h3>
          ${actions ? html`<div class="mc-card__head-actions">${actions}</div>` : EMPTY}
        </div>`
      : EMPTY}
    <div class="${cx('mc-card__body', flush && 'mc-card__body--flush')}">${children}</div>
    ${footer ? html`<div class="mc-card__foot">${footer}</div>` : EMPTY}
  </section>`;
}

// ---------------------------------------------------------------------------
// Key/value list
// ---------------------------------------------------------------------------

export interface KeyValueRow {
  key: string;
  /** Pre-rendered value, so callers can nest an AddressDisplay or badge. */
  value: Html | string;
  /** Renders the value in mono, for identifiers and hashes. */
  mono?: boolean | undefined;
}

export function KeyValueList({ rows, ...base }: { rows: KeyValueRow[] } & BaseProps): Html {
  return html`<dl${baseAttrs(base, 'mc-kv')}>
    ${join(
      rows.map(
        (row) => html`<div class="mc-kv__row">
          <dt class="mc-kv__key">${row.key}</dt>
          <dd class="${cx('mc-kv__val', row.mono && 'mc-kv__val--mono')}">${row.value}</dd>
        </div>`
      )
    )}
  </dl>`;
}

/** Amount plus asset ticker, sized for settlement emphasis. */
export const Amount = ({
  value,
  asset,
  large,
  className,
}: {
  value: string;
  asset?: string | undefined;
  large?: boolean | undefined;
  className?: string | undefined;
}): Html => html`<span class="${cx('mc-amount', large && 'mc-amount--lg', className)}"
  ><span class="mc-amount__value">${value}</span>${asset
    ? html`<span class="mc-amount__asset">${asset}</span>`
    : EMPTY}</span
>`;

/** Capability/tag chips. */
export const Chips = ({
  items,
  tone,
}: {
  items: string[];
  tone?: 'default' | 'matched' | 'missing' | undefined;
}): Html =>
  html`<span class="mc-chips"
    >${join(
      items.map(
        (item) => html`<span class="${cx('mc-chip', tone && tone !== 'default' && `mc-chip--${tone}`)}">${item}</span>`
      )
    )}</span
  >`;

/** Preformatted JSON or log output. */
export const CodeBlock = ({ content, flush, className }: { content: string; flush?: boolean; className?: string }): Html =>
  html`<pre class="${cx('mc-code', flush && 'mc-code--flush', className)}" tabindex="0">${content}</pre>`;
