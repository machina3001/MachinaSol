import { type StatusTone, toneFor } from '../design/tokens.js';
import { type BaseProps, type Html, EMPTY, attrs, baseAttrs, cx, html, join } from './html.js';
import { Icon, type IconName } from './icons.js';

/**
 * Collection components: table, timeline, activity feed.
 *
 * `DataTable` is generic over the row type and takes a `cell` renderer per
 * column, so it stays presentational: it never sorts, filters, or paginates.
 * Sort state is passed in and sort requests are emitted declaratively.
 */

// ---------------------------------------------------------------------------
// DataTable
// ---------------------------------------------------------------------------

export type CellAlign = 'start' | 'num';

export interface Column<Row> {
  /** Stable key, also used as the sort identifier. */
  key: string;
  /** Header text. Rendered uppercase mono by the stylesheet. */
  header: string;
  /** Renders the cell for one row. */
  cell: (row: Row, index: number) => Html | string;
  /** `num` right-aligns and uses tabular figures. */
  align?: CellAlign | undefined;
  /** Renders the cell in mono at a smaller size. */
  mono?: boolean | undefined;
  /** Shrinks the column to its content and prevents wrapping. */
  tight?: boolean | undefined;
  /** Marks the column sortable, which renders a sort control. */
  sortable?: boolean | undefined;
  /** Accessible header override when `header` is a glyph or abbreviation. */
  ariaLabel?: string | undefined;
}

export interface SortState {
  key: string;
  direction: 'ascending' | 'descending';
}

export interface DataTableProps<Row> extends BaseProps {
  columns: Column<Row>[];
  rows: Row[];
  /** Stable key per row, used for the row id and selection. */
  rowKey: (row: Row, index: number) => string;
  /** Caption for assistive technology. Visually hidden. */
  caption: string;
  /** Current sort, if the caller is sorting. */
  sort?: SortState | undefined;
  /** Compacts row padding for high-density views. */
  compact?: boolean | undefined;
  /** Keys of selected rows. */
  selectedKeys?: readonly string[] | undefined;
  /** Rendered in place of the body when `rows` is empty. */
  empty?: Html | undefined;
  /** Footer content, e.g. a count or pagination. */
  footer?: Html | undefined;
  /** Total row count for the footer, when the caller is paginating. */
  totalCount?: number | undefined;
}

function headerCell<Row>(column: Column<Row>, sort: SortState | undefined): Html {
  const isSorted = sort?.key === column.key;
  const ariaSort = isSorted ? sort?.direction : undefined;
  const inner = column.sortable
    ? html`<button${attrs({
        class: 'mc-table__sort',
        type: 'button',
        'data-mc-action': 'sort',
        'data-mc-target': column.key,
        'aria-sort': ariaSort,
      })}>
        ${column.header}
        <span class="mc-table__sort-icon">${Icon({
          name: isSorted ? (sort?.direction === 'ascending' ? 'chevron-up' : 'chevron-down') : 'sort',
          size: 10,
        })}</span>
      </button>`
    : html`${column.header}`;

  return html`<th${attrs({
    scope: 'col',
    class: cx(column.align === 'num' && 'mc-table__cell--num', column.tight && 'mc-table__cell--tight'),
    'aria-sort': column.sortable ? (ariaSort ?? 'none') : undefined,
    'aria-label': column.ariaLabel,
  })}>${inner}</th>`;
}

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  caption,
  sort,
  compact,
  selectedKeys,
  empty,
  footer,
  totalCount,
  ...base
}: DataTableProps<Row>): Html {
  if (rows.length === 0 && empty) {
    return html`<div${baseAttrs(base, 'mc-table-wrap')}>${empty}</div>`;
  }

  const selected = new Set(selectedKeys ?? []);

  return html`<div${baseAttrs(base, 'mc-table-wrap')}>
    <div class="mc-table-scroll" role="region" aria-label="${caption} · horizontally scrollable table" tabindex="0">
      <table class="${cx('mc-table', compact && 'mc-table--compact')}">
        <caption class="mc-sr">${caption}</caption>
        <thead>
          <tr>${join(columns.map((column) => headerCell(column, sort)))}</tr>
        </thead>
        <tbody>
          ${join(
            rows.map((row, index) => {
              const key = rowKey(row, index);
              return html`<tr${attrs({
                'data-mc-row': key,
                'aria-selected': selected.has(key) ? 'true' : undefined,
              })}>
                ${join(
                  columns.map(
                    (column) => html`<td${attrs({
                      class: cx(
                        column.align === 'num' && 'mc-table__cell--num',
                        column.mono && 'mc-table__cell--mono',
                        column.tight && 'mc-table__cell--tight'
                      ),
                    })}>${column.cell(row, index)}</td>`
                  )
                )}
              </tr>`;
            })
          )}
        </tbody>
      </table>
    </div>
    ${footer || totalCount !== undefined
      ? html`<div class="mc-table__foot">
          ${totalCount !== undefined
            ? html`<span class="mc-table__count">${rows.length} of ${totalCount}</span>`
            : EMPTY}
          ${footer ? html`<span class="mc-row mc-push mc-gap-6" >${footer}</span>` : EMPTY}
        </div>`
      : EMPTY}
  </div>`;
}

// ---------------------------------------------------------------------------
// ActivityItem
// ---------------------------------------------------------------------------

export interface ActivityItemProps extends BaseProps {
  /** Primary line. Accepts markup so callers can inline an Amount or address. */
  title: Html | string;
  /** Mono metadata line under the title, e.g. a signature or reference. */
  meta?: Html | string | undefined;
  /** Right-aligned timestamp. Pre-formatted by the caller. */
  time?: string | undefined;
  /** Leading glyph. */
  icon?: IconName | undefined;
  /**
   * Visual tone for the glyph. When a raw status string is passed it is mapped
   * through the SDK status map.
   */
  tone?: StatusTone | string | undefined;
  /** Draws a divider under the item, for use inside a bordered list. */
  bordered?: boolean | undefined;
  /** Trailing slot, e.g. a StatusBadge or a copy control. */
  action?: Html | undefined;
}

export function ActivityItem({
  title,
  meta,
  time,
  icon = 'zap',
  tone,
  bordered,
  action,
  ...base
}: ActivityItemProps): Html {
  const resolved: StatusTone = tone === undefined ? 'neutral' : toneFor(String(tone));
  const iconTone = resolved === 'neutral' || resolved === 'idle' || resolved === 'offline' ? '' : `mc-activity__icon--${resolved}`;
  return html`<div${attrs({
    class: cx('mc-activity', bordered && 'mc-activity--bordered', base.className),
    id: base.id,
    'data-mc': base.testId,
  })}>
    <span class="${cx('mc-activity__icon', iconTone)}">${Icon({ name: icon, size: 11 })}</span>
    <span class="mc-activity__body">
      <span class="mc-activity__title">${title}</span>
      ${meta ? html`<span class="mc-activity__meta">${meta}</span>` : EMPTY}
    </span>
    ${action ?? EMPTY}
    ${time ? html`<time class="mc-activity__time">${time}</time>` : EMPTY}
  </div>`;
}

/** Bordered list wrapper for ActivityItems. */
export const ActivityList = ({ children, className }: { children: Html; className?: string }): Html =>
  html`<div class="${cx('mc-col', className)} mc-gap-0" >${children}</div>`;

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export interface TimelineEntry {
  /** Primary line. */
  title: Html | string;
  /** Supporting mono line. */
  meta?: Html | string | undefined;
  /** Right-aligned timestamp. */
  time?: string | undefined;
  /** Marker tone; accepts a raw SDK status string. */
  tone?: StatusTone | string | undefined;
  /** Body content revealed under the entry, e.g. an evidence record. */
  detail?: Html | undefined;
}

export interface TimelineProps extends BaseProps {
  entries: TimelineEntry[];
  /** Accessible name for the list. */
  ariaLabel?: string | undefined;
}

export function Timeline({ entries, ariaLabel = 'Event timeline', ...base }: TimelineProps): Html {
  return html`<ol${attrs({
    class: cx('mc-timeline', base.className),
    id: base.id,
    'data-mc': base.testId,
    'aria-label': ariaLabel,
  })}>
    ${join(
      entries.map((entry) => {
        const resolved: StatusTone = entry.tone === undefined ? 'neutral' : toneFor(String(entry.tone));
        const markerTone =
          resolved === 'neutral' || resolved === 'idle' ? '' : `mc-timeline__marker--${resolved}`;
        return html`<li class="mc-timeline__item">
          <span class="${cx('mc-timeline__marker', markerTone)}" aria-hidden="true"
            ><span class="mc-timeline__marker-dot"></span
          ></span>
          <div class="mc-row mc-baseline" >
            <span class="mc-activity__title mc-grow">${entry.title}</span>
            ${entry.time ? html`<time class="mc-activity__time mc-flush" >${entry.time}</time>` : EMPTY}
          </div>
          ${entry.meta ? html`<div class="mc-activity__meta mc-mt-2" >${entry.meta}</div>` : EMPTY}
          ${entry.detail ? html`<div class="mc-mt-8">${entry.detail}</div>` : EMPTY}
        </li>`;
      })
    )}
  </ol>`;
}

// ---------------------------------------------------------------------------
// Stage rail
// ---------------------------------------------------------------------------

export interface StageRailProps extends BaseProps {
  /** Ordered stage names. */
  stages: readonly string[];
  /** Index of the current stage. */
  currentIndex: number;
  /** Renders the current pip as failed. */
  failed?: boolean | undefined;
  /** Accessible summary, e.g. "Stage 3 of 6: working". */
  label?: string | undefined;
}

export function StageRail({ stages, currentIndex, failed, label, ...base }: StageRailProps): Html {
  return html`<div${attrs({
    class: cx('mc-stages', base.className),
    id: base.id,
    'data-mc': base.testId,
    role: 'img',
    'aria-label': label ?? `Stage ${currentIndex + 1} of ${stages.length}`,
  })}>
    ${join(
      stages.map((stage, index) => {
        const state =
          index < currentIndex
            ? 'done'
            : index === currentIndex
              ? failed
                ? 'failed'
                : 'current'
              : 'pending';
        return html`<span class="${cx('mc-stages__step', state !== 'pending' && `mc-stages__step--${state}`)}" title="${stage}">
          <span class="mc-stages__pip"></span>
          ${index < stages.length - 1 ? html`<span class="mc-stages__bar"></span>` : EMPTY}
        </span>`;
      })
    )}
  </div>`;
}
