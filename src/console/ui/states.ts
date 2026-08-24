import { type BaseProps, type Html, EMPTY, attrs, cx, html, join } from './html.js';
import { Icon, type IconName } from './icons.js';

/**
 * Empty, loading, and error states.
 *
 * Kept deliberately quiet: an icon, a short title, one line of explanation, and
 * at most two actions. No illustrations, since this is instrumentation rather
 * than a consumer product.
 */

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------

export interface EmptyStateProps extends BaseProps {
  title: string;
  /** One sentence explaining why it is empty and what to do next. */
  description?: string | undefined;
  icon?: IconName | undefined;
  /** Primary and secondary actions. */
  actions?: Html | undefined;
  /** Reduces padding for use inside a card or table body. */
  inline?: boolean | undefined;
}

export function EmptyState({
  title,
  description,
  icon = 'inbox',
  actions,
  inline,
  ...base
}: EmptyStateProps): Html {
  return html`<div${attrs({
    class: cx('mc-state', inline && 'mc-state--inline', base.className),
    id: base.id,
    'data-mc': base.testId,
  })}>
    <span class="mc-state__icon">${Icon({ name: icon, size: 16 })}</span>
    <p class="mc-state__title">${title}</p>
    ${description ? html`<p class="mc-state__desc">${description}</p>` : EMPTY}
    ${actions ? html`<div class="mc-state__actions">${actions}</div>` : EMPTY}
  </div>`;
}

// ---------------------------------------------------------------------------
// LoadingState
// ---------------------------------------------------------------------------

export interface LoadingStateProps extends BaseProps {
  /** Short present-tense label, e.g. "Loading fleet". */
  label?: string | undefined;
  inline?: boolean | undefined;
}

export function LoadingState({ label = 'Loading', inline, ...base }: LoadingStateProps): Html {
  return html`<div${attrs({
    class: cx('mc-state', inline && 'mc-state--inline', base.className),
    id: base.id,
    'data-mc': base.testId,
    role: 'status',
    'aria-live': 'polite',
  })}>
    <span class="mc-spinner mc-spinner--lg" aria-hidden="true"></span>
    <p class="mc-state__title">${label}</p>
  </div>`;
}

/**
 * Skeleton placeholder. Prefer this over a spinner when the eventual shape is
 * known, since it avoids a layout shift on load.
 */
export interface SkeletonProps extends BaseProps {
  /** Number of placeholder lines or rows. */
  lines?: number | undefined;
  /** `row` matches table row height, `text` matches a line of copy. */
  variant?: 'text' | 'row' | undefined;
}

export function Skeleton({ lines = 3, variant = 'text', ...base }: SkeletonProps): Html {
  // Varying widths read as content rather than as one uniform loading bar.
  // Expressed as classes because this CSP blocks inline style attributes.
  const widths = ['mc-skel--w1', 'mc-skel--w2', 'mc-skel--w3', 'mc-skel--w4', 'mc-skel--w5'];
  return html`<div${attrs({
    class: cx('mc-skel-stack', base.className),
    id: base.id,
    'data-mc': base.testId,
    'aria-hidden': 'true',
  })}>
    ${join(
      Array.from({ length: lines }, (_unused, index) =>
        variant === 'row'
          ? html`<span class="mc-skel mc-skel--row"></span>`
          : html`<span class="${cx('mc-skel', 'mc-skel--text', widths[index % widths.length])}"></span>`
      )
    )}
  </div>`;
}

// ---------------------------------------------------------------------------
// ErrorState
// ---------------------------------------------------------------------------

export interface ErrorStateProps extends BaseProps {
  title: string;
  /** Plain-language explanation. */
  description?: string | undefined;
  /**
   * Verbatim technical detail, e.g. an error code and message. Rendered mono in
   * a bordered block so it can be read and reported without being mistaken for
   * user-facing copy.
   */
  detail?: string | undefined;
  /** Recovery actions, typically a retry. */
  actions?: Html | undefined;
  inline?: boolean | undefined;
}

export function ErrorState({
  title,
  description,
  detail,
  actions,
  inline,
  ...base
}: ErrorStateProps): Html {
  return html`<div${attrs({
    class: cx('mc-state', inline && 'mc-state--inline', base.className),
    id: base.id,
    'data-mc': base.testId,
    role: 'alert',
  })}>
    <span class="mc-state__icon mc-state__icon--alert">${Icon({ name: 'alert', size: 16 })}</span>
    <p class="mc-state__title">${title}</p>
    ${description ? html`<p class="mc-state__desc">${description}</p>` : EMPTY}
    ${detail ? html`<p class="mc-state__detail">${detail}</p>` : EMPTY}
    ${actions ? html`<div class="mc-state__actions">${actions}</div>` : EMPTY}
  </div>`;
}
