import { type BaseProps, type Html, EMPTY, attrs, baseAttrs, cx, html, join } from './html.js';
import { Icon, type IconName } from './icons.js';

/**
 * Layout components. Pure presentation: they place slots and never decide what
 * goes in them. Every slot is typed as `Html` so callers compose with the
 * `html` template and escaping stays enforced.
 */

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------

export interface BrandProps extends BaseProps {
  /** Product name shown as the primary line. */
  name: string;
  /** Small mono line under the name, e.g. a workspace or environment label. */
  tagline?: string | undefined;
  /** Custom mark. Defaults to a neutral geometric glyph. */
  mark?: Html | undefined;
  /** When set, the lockup becomes a link. */
  href?: string | undefined;
}

const DEFAULT_MARK: Html = html`<span aria-hidden="true">R8</span>`;

export function Brand({ name, tagline, mark, href, ...base }: BrandProps): Html {
  const inner = html`
    <span class="mc-brand__mark">${mark ?? DEFAULT_MARK}</span>
    <span class="mc-brand__meta">
      <span class="mc-brand__name">${name}</span>
      ${tagline ? html`<span class="mc-brand__sub">${tagline}</span>` : EMPTY}
    </span>
  `;
  if (href) {
    return html`<a${attrs({
      class: cx('mc-brand', base.className),
      id: base.id,
      'data-mc': base.testId,
      href,
      'aria-label': name,
      title: name,
    })}>${inner}</a>`;
  }
  return html`<span${baseAttrs(base, 'mc-brand')}>${inner}</span>`;
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

export interface NavItem {
  /** Visible label. */
  label: string;
  href: string;
  icon?: IconName | undefined;
  /** Marks the item as the current page. */
  active?: boolean | undefined;
  /** Trailing slot, typically a StatusBadge or a count. */
  badge?: Html | undefined;
  disabled?: boolean | undefined;
}

export interface NavGroup {
  /** Optional uppercase group heading. */
  label?: string | undefined;
  items: NavItem[];
}

export interface SidebarBlock {
  /** Small uppercase heading above the block. */
  label?: string | undefined;
  /** Block content, e.g. a NetworkIndicator or WalletButton. */
  content: Html;
}

export interface SidebarProps extends BaseProps {
  groups: NavGroup[];
  /**
   * Pinned blocks below the nav, each on its own hairline-separated row. Used
   * for persistent status such as network and wallet.
   */
  blocks?: SidebarBlock[] | undefined;
  /** Pinned to the very bottom of the rail, e.g. a session control. */
  footer?: Html | undefined;
  /** Accessible name for the navigation landmark. */
  ariaLabel?: string | undefined;
}

function NavLink(item: NavItem): Html {
  const a = attrs({
    class: 'mc-nav__link',
    href: item.disabled ? undefined : item.href,
    'aria-label': item.label,
    title: item.label,
    'aria-current': item.active ? 'page' : undefined,
    'aria-disabled': item.disabled ? 'true' : undefined,
    tabindex: item.disabled ? -1 : undefined,
  });
  return html`<a${a}>
    ${item.icon ? html`<span class="mc-nav__icon">${Icon({ name: item.icon })}</span>` : EMPTY}
    <span class="mc-nav__text">${item.label}</span>
    ${item.badge ? html`<span class="mc-nav__badge">${item.badge}</span>` : EMPTY}
  </a>`;
}

export function Sidebar({
  groups,
  blocks,
  footer,
  ariaLabel = 'Console sections',
  ...base
}: SidebarProps): Html {
  return html`<div${baseAttrs(base, 'mc-sidebar')}>
    <nav class="mc-nav"${attrs({ 'aria-label': ariaLabel })}>
      ${join(
        groups.map(
          (group) => html`<div class="mc-nav__group">
            ${group.label ? html`<span class="mc-label mc-nav__group-label">${group.label}</span>` : EMPTY}
            ${join(group.items.map(NavLink))}
          </div>`
        )
      )}
    </nav>
    ${blocks
      ? join(
          blocks.map(
            (block) => html`<div class="mc-sidebar__block">
              ${block.label ? html`<span class="mc-label mc-sidebar__block-label">${block.label}</span>` : EMPTY}
              ${block.content}
            </div>`
          )
        )
      : EMPTY}
    ${footer ? html`<div class="mc-sidebar__footer">${footer}</div>` : EMPTY}
  </div>`;
}

// ---------------------------------------------------------------------------
// Topbar
// ---------------------------------------------------------------------------

export interface TopbarProps extends BaseProps {
  /** Leading slot: context switcher, breadcrumb, or search. */
  start?: Html | undefined;
  /** Centre slot, unused by default so the bar stays quiet. */
  center?: Html | undefined;
  /** Trailing slot: network indicator, wallet, overflow actions. */
  end?: Html | undefined;
}

/** A hairline separator for grouping topbar controls. */
export const TopbarDivider = (): Html => html`<span class="mc-topbar__divider" aria-hidden="true"></span>`;

export function Topbar({ start, center, end, ...base }: TopbarProps): Html {
  return html`<header${baseAttrs(base, 'mc-topbar')}>
    ${start ? html`<div class="mc-topbar__slot">${start}</div>` : EMPTY}
    ${center ? html`<div class="mc-topbar__slot mc-grow">${center}</div>` : EMPTY}
    ${end ? html`<div class="mc-topbar__slot mc-topbar__slot--end">${end}</div>` : EMPTY}
  </header>`;
}

// ---------------------------------------------------------------------------
// AppShell
// ---------------------------------------------------------------------------

export interface AppShellProps extends BaseProps {
  brand: Html;
  sidebar: Html;
  topbar: Html;
  /** Main region content. */
  children: Html;
  /** Skips the default inner padding wrapper for full-bleed pages. */
  bleed?: boolean | undefined;
}

export function AppShell({ brand, sidebar, topbar, children, bleed, ...base }: AppShellProps): Html {
  return html`<div${baseAttrs(base, 'mc-shell')}>
    <div class="mc-shell__brand">${brand}</div>
    <div class="mc-shell__topbar">${topbar}</div>
    <div class="mc-shell__sidebar">${sidebar}</div>
    <main class="mc-shell__main" id="mc-main" tabindex="-1">
      ${bleed ? children : html`<div class="mc-shell__inner">${children}</div>`}
    </main>
  </div>`;
}

// ---------------------------------------------------------------------------
// PageHeader
// ---------------------------------------------------------------------------

export interface Crumb {
  label: string;
  href?: string | undefined;
}

export function Breadcrumb({ items, ...base }: { items: Crumb[] } & BaseProps): Html {
  const last = items.length - 1;
  return html`<nav${baseAttrs(base, 'mc-breadcrumb')} aria-label="Breadcrumb">
    ${join(
      items.map((item, index) => {
        const current = index === last;
        const node = item.href && !current
          ? html`<a class="mc-breadcrumb__item" href="${item.href}">${item.label}</a>`
          : html`<span class="mc-breadcrumb__item"${attrs({ 'aria-current': current ? 'page' : undefined })}>${item.label}</span>`;
        return index === 0
          ? node
          : html`<span class="mc-breadcrumb__sep" aria-hidden="true">/</span>${node}`;
      })
    )}
  </nav>`;
}

export interface PageHeaderProps extends BaseProps {
  title: string;
  /** Supporting sentence under the title. */
  description?: string | undefined;
  /** Rendered above the title. */
  breadcrumb?: Html | undefined;
  /** Status badges or indicators shown under the title block. */
  meta?: Html | undefined;
  /** Primary and secondary actions, right-aligned. */
  actions?: Html | undefined;
  /** Heading level, for correct document outline. Defaults to 1. */
  as?: 'h1' | 'h2' | undefined;
}

export function PageHeader({
  title,
  description,
  breadcrumb,
  meta,
  actions,
  as = 'h1',
  ...base
}: PageHeaderProps): Html {
  return html`<div${baseAttrs(base, 'mc-page-header')}>
    ${breadcrumb ?? EMPTY}
    <div class="mc-page-header__row">
      <div class="mc-page-header__titles">
        <${as} class="mc-page-header__title">${title}</${as}>
        ${description ? html`<p class="mc-page-header__desc">${description}</p>` : EMPTY}
      </div>
      ${actions ? html`<div class="mc-page-header__actions">${actions}</div>` : EMPTY}
    </div>
    ${meta ? html`<div class="mc-page-header__meta">${meta}</div>` : EMPTY}
  </div>`;
}

// ---------------------------------------------------------------------------
// SectionHeader
// ---------------------------------------------------------------------------

export interface SectionHeaderProps extends BaseProps {
  title: string;
  /** Small mono count shown next to the title, e.g. "12 total". */
  count?: string | number | undefined;
  /** Right-aligned controls: filters, sort, view toggles. */
  actions?: Html | undefined;
  /** Leading icon. */
  icon?: IconName | undefined;
  as?: 'h2' | 'h3' | undefined;
}

export function SectionHeader({
  title,
  count,
  actions,
  icon,
  as = 'h2',
  ...base
}: SectionHeaderProps): Html {
  return html`<div${baseAttrs(base, 'mc-section-header')}>
    ${icon ? html`<span class="mc-dim mc-icon-slot" >${Icon({ name: icon })}</span>` : EMPTY}
    <${as} class="mc-section-header__title">${title}</${as}>
    ${count !== undefined ? html`<span class="mc-section-header__count">${count}</span>` : EMPTY}
    ${actions ? html`<div class="mc-section-header__actions">${actions}</div>` : EMPTY}
  </div>`;
}

// ---------------------------------------------------------------------------
// Structural helpers
// ---------------------------------------------------------------------------

/** Vertical rhythm container for stacking page sections. */
export const Stack = ({ children, className }: { children: Html; className?: string }): Html =>
  html`<div class="${cx('mc-stack', className)}">${children}</div>`;

/** Two-column split. `aside` biases the first column wider. */
export const Split = ({
  children,
  aside,
  className,
}: {
  children: Html;
  aside?: boolean | undefined;
  className?: string | undefined;
}): Html => html`<div class="${cx(aside ? 'mc-split--aside' : 'mc-split', className)}">${children}</div>`;

/** Responsive grid for entity cards. */
export const CardGrid = ({
  children,
  wide,
  className,
}: {
  children: Html;
  wide?: boolean | undefined;
  className?: string | undefined;
}): Html => html`<div class="${cx('mc-card-grid', wide && 'mc-card-grid--wide', className)}">${children}</div>`;
