import { type BaseProps, type Html, EMPTY, attrs, cx, html, join } from './html.js';
import { CommandButton } from './controls.js';
import { Icon, type IconName } from './icons.js';

/**
 * Overlay containers. Both render closed by default (`hidden` on the scrim) and
 * are opened by `behavior.ts` in response to a `data-mc-action` trigger, so no
 * component here owns open/close state.
 */

interface OverlayShellProps extends BaseProps {
  /** Element id, required so a trigger can target it. */
  id: string;
  title: string;
  /** Supporting line under the title. */
  description?: string | undefined;
  children: Html;
  /** Footer actions. Convention: secondary left, primary right. */
  footer?: Html | undefined;
  /** Starts open. Server-rendered open state, useful for a forced dialog. */
  open?: boolean | undefined;
  /** Hides the close button, for flows that must be resolved by an action. */
  hideClose?: boolean | undefined;
  /** Accessible label for the close control. */
  closeLabel?: string | undefined;
}

function overlayHead(
  id: string,
  title: string,
  description: string | undefined,
  hideClose: boolean | undefined,
  closeLabel: string
): Html {
  return html`<div class="mc-overlay__head">
    <div class="mc-overlay__titles">
      <h2 class="mc-overlay__title" id="${id}-title">${title}</h2>
      ${description ? html`<p class="mc-overlay__desc" id="${id}-desc">${description}</p>` : EMPTY}
    </div>
    ${hideClose
      ? EMPTY
      : html`<span class="mc-overlay__close"
          >${CommandButton({
            variant: 'quiet',
            size: 'sm',
            icon: 'close',
            ariaLabel: closeLabel,
            action: 'close-overlay',
            target: id,
          })}</span
        >`}
  </div>`;
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export interface ModalProps extends OverlayShellProps {
  size?: 'sm' | 'md' | 'lg' | undefined;
}

export function Modal({
  id,
  title,
  description,
  children,
  footer,
  open,
  hideClose,
  closeLabel = 'Close dialog',
  size = 'md',
  ...base
}: ModalProps): Html {
  return html`<div${attrs({
    class: cx('mc-scrim', base.className),
    id,
    'data-mc': base.testId,
    'data-mc-overlay': 'modal',
    hidden: open ? undefined : true,
  })}>
    <div${attrs({
      class: cx('mc-modal', size !== 'md' && `mc-modal--${size}`),
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': `${id}-title`,
      'aria-describedby': description ? `${id}-desc` : undefined,
    })}>
      ${overlayHead(id, title, description, hideClose, closeLabel)}
      <div class="mc-overlay__body">${children}</div>
      ${footer ? html`<div class="mc-overlay__foot">${footer}</div>` : EMPTY}
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Drawer
// ---------------------------------------------------------------------------

export interface DrawerProps extends OverlayShellProps {
  /** Widens the panel for record detail with dense key/value content. */
  wide?: boolean | undefined;
}

export function Drawer({
  id,
  title,
  description,
  children,
  footer,
  open,
  hideClose,
  closeLabel = 'Close panel',
  wide,
  ...base
}: DrawerProps): Html {
  return html`<div${attrs({
    class: cx('mc-scrim', base.className),
    id,
    'data-mc': base.testId,
    'data-mc-overlay': 'drawer',
    hidden: open ? undefined : true,
  })}>
    <aside${attrs({
      class: cx('mc-drawer', wide && 'mc-drawer--wide'),
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': `${id}-title`,
      'aria-describedby': description ? `${id}-desc` : undefined,
    })}>
      ${overlayHead(id, title, description, hideClose, closeLabel)}
      <div class="mc-overlay__body">${children}</div>
      ${footer ? html`<div class="mc-overlay__foot">${footer}</div>` : EMPTY}
    </aside>
  </div>`;
}

/** Right-aligned footer group, the conventional action placement. */
export const OverlayActions = ({ children }: { children: Html }): Html =>
  html`<div class="mc-overlay__foot-end">${children}</div>`;

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

export interface MenuItem {
  label: string;
  /** Renders an anchor when set, a button otherwise. */
  href?: string | undefined;
  icon?: IconName | undefined;
  /** Declarative action name for button items. */
  action?: string | undefined;
  /** Payload for the declared action. */
  target?: string | undefined;
  /** Trailing hint, e.g. a shortcut or current value. */
  hint?: string | undefined;
  /** Applies the alert tone, for destructive entries. */
  danger?: boolean | undefined;
  disabled?: boolean | undefined;
  /** Draws a divider above this item. */
  separated?: boolean | undefined;
}

export interface MenuProps extends BaseProps {
  /** Element id, required so the trigger can reference it. */
  id: string;
  /** The control that opens the menu. Given the correct ARIA wiring here. */
  trigger: Html;
  items: MenuItem[];
  /** Optional heading block at the top of the panel. */
  header?: Html | undefined;
  /** Aligns the panel to the trigger's left edge instead of its right. */
  alignStart?: boolean | undefined;
  /** Accessible name for the menu. */
  ariaLabel?: string | undefined;
}

/**
 * Popover menu. Unlike Modal/Drawer this has no scrim: it is anchored to its
 * trigger and dismissed by outside click or Escape, handled in `behavior.ts`.
 */
export function Menu({
  id,
  trigger,
  items,
  header,
  alignStart,
  ariaLabel = 'Menu',
  ...base
}: MenuProps): Html {
  const entry = (item: MenuItem): Html => {
    const shared = {
      class: cx('mc-menu__item', item.danger && 'mc-menu__item--danger', item.separated && 'mc-menu__item--sep'),
      role: 'menuitem',
      'aria-disabled': item.disabled ? 'true' : undefined,
    };
    const inner = html`${item.icon ? html`<span class="mc-menu__icon">${Icon({ name: item.icon, size: 12 })}</span>` : EMPTY}
      <span class="mc-grow mc-truncate">${item.label}</span>
      ${item.hint ? html`<span class="mc-menu__hint">${item.hint}</span>` : EMPTY}`;
    if (item.href) {
      return html`<a${attrs({ ...shared, href: item.disabled ? undefined : item.href })}>${inner}</a>`;
    }
    return html`<button${attrs({
      ...shared,
      type: 'button',
      disabled: item.disabled ? true : undefined,
      'data-mc-action': item.action,
      'data-mc-target': item.target,
    })}>${inner}</button>`;
  };

  return html`<div${attrs({
    class: cx('mc-menu', base.className),
    'data-mc': base.testId,
    'data-mc-menu-root': id,
  })}>
    ${trigger}
    <div${attrs({
      class: cx('mc-menu__panel', alignStart && 'mc-menu__panel--start'),
      id,
      role: 'menu',
      'aria-label': ariaLabel,
      hidden: true,
    })}>
      ${header ? html`<div class="mc-menu__header">${header}</div>` : EMPTY}
      ${join(items.map(entry))}
    </div>
  </div>`;
}
