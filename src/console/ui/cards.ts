import { type StatusTone } from '../design/tokens.js';
import { type BaseProps, type Html, EMPTY, attrs, cx, html, join } from './html.js';
import { type IconName } from './icons.js';
import { Amount, Chips, MachineBadge, Meter, StatusBadge } from './display.js';
import { StageRail } from './collections.js';

/**
 * Entity cards.
 *
 * These are composition shells, not domain objects. Each takes already-shaped
 * display values, so they hold no knowledge of SDK types and can be reused for
 * fixture data, live data, or a paginated list. Field values accept `Html` so a
 * caller can drop in an AddressDisplay, Amount, or badge.
 */

// ---------------------------------------------------------------------------
// Shared field grid
// ---------------------------------------------------------------------------

export interface EntityField {
  label: string;
  /** Pre-rendered or plain value. */
  value: Html | string;
  /** Renders mono, for identifiers, hashes, and addresses. */
  mono?: boolean | undefined;
  /** Renders with tabular figures, for measurements. */
  numeric?: boolean | undefined;
}

const fieldGrid = (fields: EntityField[]): Html =>
  fields.length === 0
    ? EMPTY
    : html`<div class="mc-entity__grid">
        ${join(
          fields.map(
            (field) => html`<div class="mc-entity__field">
              <span class="mc-entity__field-label">${field.label}</span>
              <span
                class="${cx(
                  'mc-entity__field-value',
                  field.mono && 'mc-entity__field-value--mono',
                  field.numeric && 'mc-entity__field-value--num'
                )}"
                >${field.value}</span
              >
            </div>`
          )
        )}
      </div>`;

interface EntityCardBase extends BaseProps {
  /** Footer slot, conventionally actions on the right. */
  footer?: Html | undefined;
  /** Makes the whole card an actionable surface. */
  href?: string | undefined;
  /** Declarative action name, e.g. to open a detail drawer. */
  action?: string | undefined;
  /** Payload for the declared action, typically the entity id. */
  actionTarget?: string | undefined;
  tone?: 'default' | 'accent' | 'alert' | undefined;
}

function entityShell(
  props: EntityCardBase,
  top: Html,
  body: Html,
  ownClass = ''
): Html {
  const cls = cx(
    'mc-card',
    'mc-entity',
    (props.href || props.action) && 'mc-card--interactive',
    props.tone === 'accent' && 'mc-card--accent',
    props.tone === 'alert' && 'mc-card--alert',
    ownClass,
    props.className
  );
  const shared = {
    class: cls,
    id: props.id,
    'data-mc': props.testId,
    'data-mc-action': props.action,
    'data-mc-target': props.actionTarget,
  };
  const inner = html`${top}${body}${props.footer
    ? html`<div class="mc-entity__foot">${props.footer}</div>`
    : EMPTY}`;

  if (props.href) {
    return html`<a${attrs({ ...shared, class: cx(cls, 'mc-entity-link'), href: props.href })}>${inner}</a>`;
  }
  return html`<article${attrs(shared)}>${inner}</article>`;
}

// ---------------------------------------------------------------------------
// MachineCard
// ---------------------------------------------------------------------------

export interface MachineCardProps extends EntityCardBase {
  /** Display name. */
  name: string;
  /** Technical identifier. */
  machineId: string;
  /** SDK role value, drives the glyph. */
  role?: string | undefined;
  /** Raw status string; self-styles via the status map. */
  status?: string | undefined;
  /** Health reading, 0-100. `undefined` renders as no data. */
  health?: number | undefined;
  /** Battery reading, 0-100. */
  battery?: number | undefined;
  /** Capability tags. */
  capabilities?: string[] | undefined;
  /** Additional fields appended after the defaults. */
  fields?: EntityField[] | undefined;
  /** Trailing slot on the top row, e.g. an overflow menu. */
  topEnd?: Html | undefined;
}

export function MachineCard({
  name,
  machineId,
  role,
  status,
  health,
  battery,
  capabilities,
  fields = [],
  topEnd,
  ...rest
}: MachineCardProps): Html {
  const healthTone = health === undefined ? 'accent' : health >= 80 ? 'online' : health >= 50 ? 'degraded' : 'faulted';
  const derived: EntityField[] = [
    { label: 'Health', value: Meter({ value: health, tone: healthTone, label: `${name} health` }) },
    { label: 'Battery', value: Meter({ value: battery, tone: 'accent', label: `${name} battery` }) },
    ...fields,
  ];
  const top = html`<div class="mc-entity__top">
    ${MachineBadge({ name, machineId, role })}
    <div class="mc-entity__top-end">
      ${status ? StatusBadge({ label: status }) : EMPTY}
      ${topEnd ?? EMPTY}
    </div>
  </div>`;
  const body = html`${fieldGrid(derived)}
  ${capabilities && capabilities.length
    ? html`<div class="mc-pad-b">${Chips({ items: capabilities })}</div>`
    : EMPTY}`;
  return entityShell(rest, top, body);
}

// ---------------------------------------------------------------------------
// JobCard
// ---------------------------------------------------------------------------

export interface JobCardProps extends EntityCardBase {
  /** Job or work order identifier. */
  jobId: string;
  /** Short human title for the job. */
  title?: string | undefined;
  /** Raw stage/status string. */
  stage?: string | undefined;
  /** Ordered stage vocabulary, for the progress rail. */
  stages?: readonly string[] | undefined;
  /** Index of the current stage within `stages`. */
  stageIndex?: number | undefined;
  /** Assigned machine, if any. */
  machineId?: string | undefined;
  /** Required capabilities. */
  capabilities?: string[] | undefined;
  /** Capabilities the assigned machine is missing. */
  missingCapabilities?: string[] | undefined;
  fields?: EntityField[] | undefined;
  topEnd?: Html | undefined;
}

export function JobCard({
  jobId,
  title,
  stage,
  stages,
  stageIndex,
  machineId,
  capabilities,
  missingCapabilities,
  fields = [],
  topEnd,
  ...rest
}: JobCardProps): Html {
  const failed = stage === 'failed' || stage === 'cancelled';
  const derived: EntityField[] = [
    ...(machineId ? [{ label: 'Machine', value: machineId, mono: true }] : []),
    ...fields,
  ];
  const top = html`<div class="mc-entity__top">
    <span class="mc-col mc-gap-2 mc-min0" >
      <span class="mc-machine-badge__name">${title ?? jobId}</span>
      <span class="mc-machine-badge__id">${jobId}</span>
    </span>
    <div class="mc-entity__top-end">
      ${stage ? StatusBadge({ label: stage }) : EMPTY}
      ${topEnd ?? EMPTY}
    </div>
  </div>`;
  const body = html`${stages && stages.length && stageIndex !== undefined
    ? StageRail({ stages, currentIndex: stageIndex, failed, label: `Stage ${stageIndex + 1} of ${stages.length}${stage ? `: ${stage}` : ''}` })
    : EMPTY}
  ${fieldGrid(derived)}
  ${capabilities && capabilities.length
    ? html`<div class="mc-row mc-row--wrap mc-pad-b mc-gap-4" >
        ${Chips({ items: capabilities, tone: 'matched' })}
        ${missingCapabilities && missingCapabilities.length ? Chips({ items: missingCapabilities, tone: 'missing' }) : EMPTY}
      </div>`
    : EMPTY}`;
  return entityShell(rest, top, body);
}

// ---------------------------------------------------------------------------
// SettlementCard
// ---------------------------------------------------------------------------

export interface SettlementCardProps extends EntityCardBase {
  /** Intent or receipt identifier. */
  reference: string;
  /** Formatted amount. */
  amount: string;
  /** Asset ticker. */
  asset?: string | undefined;
  /** Raw status string, e.g. a verification status or intent state. */
  status?: string | undefined;
  /** Source account, pre-rendered so it can be an AddressDisplay. */
  source?: Html | string | undefined;
  /** Destination account. */
  recipient?: Html | string | undefined;
  /** Memo or job linkage. */
  memo?: string | undefined;
  /** Signing posture, e.g. whether the runtime can broadcast. */
  signingNote?: string | undefined;
  fields?: EntityField[] | undefined;
  topEnd?: Html | undefined;
}

export function SettlementCard({
  reference,
  amount,
  asset,
  status,
  source,
  recipient,
  memo,
  signingNote,
  fields = [],
  topEnd,
  ...rest
}: SettlementCardProps): Html {
  const derived: EntityField[] = [
    ...(source ? [{ label: 'From', value: source, mono: typeof source === 'string' }] : []),
    ...(recipient ? [{ label: 'To', value: recipient, mono: typeof recipient === 'string' }] : []),
    ...(memo ? [{ label: 'Memo', value: memo, mono: true }] : []),
    ...fields,
  ];
  const top = html`<div class="mc-entity__top">
    <span class="mc-col mc-gap-3 mc-min0" >
      ${Amount({ value: amount, asset, large: true })}
      <span class="mc-machine-badge__id">${reference}</span>
    </span>
    <div class="mc-entity__top-end">
      ${status ? StatusBadge({ label: status }) : EMPTY}
      ${topEnd ?? EMPTY}
    </div>
  </div>`;
  const body = html`${fieldGrid(derived)}
  ${signingNote
    ? html`<p class="mc-dim mc-flush mc-pad-b mc-fs-11" >${signingNote}</p>`
    : EMPTY}`;
  return entityShell(rest, top, body);
}

// ---------------------------------------------------------------------------
// ResourceCard
// ---------------------------------------------------------------------------

export interface ResourceCardProps extends EntityCardBase {
  /** Resource type identifier, e.g. a namespaced capability. */
  resourceType: string;
  /** Provider display name. */
  provider?: string | undefined;
  /** Provider identifier. */
  providerId?: string | undefined;
  /** Availability or match status. */
  status?: string | undefined;
  /** Formatted unit price. */
  price?: string | undefined;
  /** Asset the price is denominated in. */
  priceAsset?: string | undefined;
  /** Unit the price applies to, e.g. "per call". */
  priceUnit?: string | undefined;
  /** Regions or coverage tags. */
  regions?: string[] | undefined;
  fields?: EntityField[] | undefined;
  icon?: IconName | undefined;
  topEnd?: Html | undefined;
}

export function ResourceCard({
  resourceType,
  provider,
  providerId,
  status,
  price,
  priceAsset,
  priceUnit,
  regions,
  fields = [],
  topEnd,
  ...rest
}: ResourceCardProps): Html {
  const top = html`<div class="mc-entity__top">
    <span class="mc-col mc-gap-3 mc-min0" >
      <span class="mc-resource__type mc-truncate">${resourceType}</span>
      ${provider || providerId
        ? html`<span class="mc-machine-badge__id">${provider ?? ''}${provider && providerId ? ' · ' : ''}${providerId ?? ''}</span>`
        : EMPTY}
    </span>
    <div class="mc-entity__top-end">
      ${price
        ? html`<span class="mc-resource__price">
            ${Amount({ value: price, asset: priceAsset })}
            ${priceUnit ? html`<span class="mc-entity__field-label">${priceUnit}</span>` : EMPTY}
          </span>`
        : EMPTY}
      ${status ? StatusBadge({ label: status }) : EMPTY}
      ${topEnd ?? EMPTY}
    </div>
  </div>`;
  const body = html`${fieldGrid(fields)}
  ${regions && regions.length ? html`<div class="mc-pad-b">${Chips({ items: regions })}</div>` : EMPTY}`;
  return entityShell(rest, top, body);
}

/** Re-exported so callers can type a tone without importing from design/. */
export type { StatusTone };
