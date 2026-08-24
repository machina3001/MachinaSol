import { type BaseProps, type Html, EMPTY, attrs, baseAttrs, cx, html, join, truncateMiddle } from './html.js';
import { Icon, type IconName } from './icons.js';

/**
 * Interactive controls.
 *
 * These render markup and declare intent through `data-mc-*` attributes. They
 * never contain behaviour: the matching handlers live in `behavior.ts` and are
 * attached by delegation, which keeps the components pure and the client script
 * a single nonce'd block.
 */

// ---------------------------------------------------------------------------
// CommandButton
// ---------------------------------------------------------------------------

export type ButtonVariant = 'default' | 'primary' | 'danger' | 'quiet';

export interface CommandButtonProps extends BaseProps {
  /** Visible text. Omit only when `icon` plus `ariaLabel` are supplied. */
  label?: string | undefined;
  variant?: ButtonVariant | undefined;
  size?: 'sm' | 'md' | undefined;
  icon?: IconName | undefined;
  /** Places the icon after the label. */
  iconAfter?: IconName | undefined;
  disabled?: boolean | undefined;
  /** Swaps the leading icon for a spinner and blocks interaction. */
  loading?: boolean | undefined;
  /** Renders full width, for sidebar and drawer footers. */
  block?: boolean | undefined;
  /** Uppercase mono treatment, for terminal-style actions. */
  mono?: boolean | undefined;
  /** Renders an anchor instead of a button. */
  href?: string | undefined;
  /** Keyboard hint rendered as a small key cap. */
  kbd?: string | undefined;
  type?: 'button' | 'submit' | 'reset' | undefined;
  /** Required when there is no visible label. */
  ariaLabel?: string | undefined;
  ariaHasPopup?: 'menu' | 'dialog' | undefined;
  ariaControls?: string | undefined;
  ariaExpanded?: boolean | undefined;
  /** Associates the control with a form by id. */
  form?: string | undefined;
  /**
   * Behaviour hook consumed by `behavior.ts`, e.g. `open-drawer`. Purely
   * declarative so this component stays free of logic.
   */
  action?: string | undefined;
  /** Target element id for the declared action. */
  target?: string | undefined;
}

export function CommandButton({
  label,
  variant = 'default',
  size = 'md',
  icon,
  iconAfter,
  disabled,
  loading,
  block,
  mono,
  href,
  kbd,
  type = 'button',
  ariaLabel,
  ariaHasPopup,
  ariaControls,
  ariaExpanded,
  form,
  action,
  target,
  ...base
}: CommandButtonProps): Html {
  const cls = cx(
    'mc-btn',
    variant !== 'default' && `mc-btn--${variant}`,
    size === 'sm' && 'mc-btn--sm',
    block && 'mc-btn--block',
    mono && 'mc-btn--mono',
    !label && (icon || iconAfter) && 'mc-btn--icon',
    base.className
  );
  const inner = html`${loading
    ? html`<span class="mc-spinner" aria-hidden="true"></span>`
    : icon
      ? html`<span class="mc-btn__icon">${Icon({ name: icon, size: size === 'sm' ? 12 : 13 })}</span>`
      : EMPTY}
  ${label ?? EMPTY}
  ${iconAfter ? html`<span class="mc-btn__icon">${Icon({ name: iconAfter, size: size === 'sm' ? 12 : 13 })}</span>` : EMPTY}
  ${kbd ? html`<span class="mc-btn__kbd">${kbd}</span>` : EMPTY}`;

  const shared = {
    class: cls,
    id: base.id,
    'data-mc': base.testId,
    'data-mc-action': action,
    'data-mc-target': target,
    'aria-label': ariaLabel ?? (label ? undefined : 'Action'),
    'aria-haspopup': ariaHasPopup,
    'aria-controls': ariaControls,
    'aria-expanded': ariaExpanded === undefined ? undefined : String(ariaExpanded),
    'aria-busy': loading ? 'true' : undefined,
  };

  if (href) {
    return html`<a${attrs({
      ...shared,
      href: disabled || loading ? undefined : href,
      'aria-disabled': disabled || loading ? 'true' : undefined,
      tabindex: disabled || loading ? -1 : undefined,
    })}>${inner}</a>`;
  }
  return html`<button${attrs({
    ...shared,
    type,
    form,
    disabled: disabled || loading ? true : undefined,
  })}>${inner}</button>`;
}

// ---------------------------------------------------------------------------
// CopyButton
// ---------------------------------------------------------------------------

export interface CopyButtonProps extends BaseProps {
  /** Exact text placed on the clipboard. */
  value: string;
  /** Accessible description of what is copied, e.g. "machine wallet". */
  what?: string | undefined;
  size?: 'sm' | 'md' | undefined;
  /** Shows a text label next to the glyph. */
  label?: string | undefined;
}

export function CopyButton({ value, what = 'value', size = 'sm', label, ...base }: CopyButtonProps): Html {
  return html`<button${attrs({
    class: cx('mc-btn', 'mc-btn--quiet', 'mc-copy', size === 'sm' && 'mc-btn--sm', !label && 'mc-btn--icon', base.className),
    id: base.id,
    'data-mc': base.testId,
    type: 'button',
    'data-mc-action': 'copy',
    'data-mc-copy': value,
    'aria-label': `Copy ${what}`,
  })}>
    <span class="mc-btn__icon mc-copy__idle">${Icon({ name: 'copy', size: 12 })}</span>
    <span class="mc-btn__icon mc-copy__done">${Icon({ name: 'check', size: 12 })}</span>
    ${label ?? EMPTY}
  </button>`;
}

// ---------------------------------------------------------------------------
// WalletButton
// ---------------------------------------------------------------------------

export interface WalletButtonProps extends BaseProps {
  /** Connected account address. Omit to render the disconnected state. */
  address?: string | undefined;
  /** Small caption above/below the address, e.g. a wallet name or balance. */
  caption?: string | undefined;
  /** Text shown when disconnected. */
  connectLabel?: string | undefined;
  /** Declarative action name handed to `behavior.ts`. */
  action?: string | undefined;
  /** Payload for the declared action. */
  target?: string | undefined;
  /** Truthful semantic name for the displayed address. */
  addressLabel?: string | undefined;
  /** Description of what activating the control opens. */
  openLabel?: string | undefined;
  /** Marks the control as busy during a connection attempt. */
  connecting?: boolean | undefined;
}

export function WalletButton({
  address,
  caption,
  connectLabel = 'Connect wallet',
  action = 'wallet',
  target,
  addressLabel = 'Wallet',
  openLabel = 'open wallet menu',
  connecting,
  ...base
}: WalletButtonProps): Html {
  const connected = Boolean(address);
  return html`<button${attrs({
    class: cx('mc-wallet', !connected && 'mc-wallet--disconnected', base.className),
    id: base.id,
    'data-mc': base.testId,
    type: 'button',
    'data-mc-action': action,
    'data-mc-target': target,
    'aria-busy': connecting ? 'true' : undefined,
    'aria-label': connected
      ? `${addressLabel} ${truncateMiddle(address ?? '', 4, 4)}, ${openLabel}`
      : connectLabel,
  })}>
    <span class="mc-wallet__avatar" aria-hidden="true">
      ${connecting ? html`<span class="mc-spinner"></span>` : Icon({ name: 'wallet', size: 11 })}
    </span>
    <span class="mc-wallet__meta">
      ${connected
        ? html`<span class="mc-wallet__addr">${truncateMiddle(address ?? '', 4, 4)}</span>
            ${caption ? html`<span class="mc-wallet__label">${caption}</span>` : EMPTY}`
        : html`<span class="mc-wallet__addr">${connectLabel}</span>
            ${caption ? html`<span class="mc-wallet__label">${caption}</span>` : EMPTY}`}
    </span>
  </button>`;
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export interface TabItem {
  /** Stable id used for the panel association. */
  id: string;
  label: string;
  icon?: IconName | undefined;
  /** Panel content. Omit when panels are rendered elsewhere. */
  panel?: Html | undefined;
  /** Trailing count or badge. */
  badge?: Html | undefined;
  disabled?: boolean | undefined;
}

export interface TabsProps extends BaseProps {
  items: TabItem[];
  /** Id of the initially selected tab. Defaults to the first enabled tab. */
  active?: string | undefined;
  /** `underline` for page-level navigation, `enclosed` for inner switching. */
  variant?: 'underline' | 'enclosed' | undefined;
  /** Accessible name for the tablist. */
  ariaLabel?: string | undefined;
  /**
   * Renders tabs as links instead of in-page tab buttons. Use when each tab is
   * a distinct URL, which keeps them deep-linkable and server-rendered.
   */
  hrefFor?: (item: TabItem) => string;
}

export function Tabs({
  items,
  active,
  variant = 'underline',
  ariaLabel = 'Sections',
  hrefFor,
  ...base
}: TabsProps): Html {
  const selected = active ?? items.find((item) => !item.disabled)?.id ?? items[0]?.id;
  const asLinks = typeof hrefFor === 'function';

  const tab = (item: TabItem): Html => {
    const isActive = item.id === selected;
    const shared = {
      class: 'mc-tabs__tab',
      id: `${item.id}-tab`,
      'aria-selected': asLinks ? undefined : isActive ? 'true' : 'false',
      'aria-current': asLinks && isActive ? 'page' : undefined,
      'aria-disabled': item.disabled ? 'true' : undefined,
    };
    const inner = html`${item.icon ? Icon({ name: item.icon, size: 13 }) : EMPTY}${item.label}${item.badge ?? EMPTY}`;
    if (asLinks) {
      return html`<a${attrs({ ...shared, href: item.disabled ? undefined : hrefFor(item) })}>${inner}</a>`;
    }
    return html`<button${attrs({
      ...shared,
      type: 'button',
      role: 'tab',
      'aria-controls': `${item.id}-panel`,
      tabindex: isActive ? 0 : -1,
      disabled: item.disabled ? true : undefined,
      'data-mc-action': 'tab',
      'data-mc-target': item.id,
    })}>${inner}</button>`;
  };

  const panels = items.filter((item) => item.panel !== undefined);

  return html`<div${attrs({
    class: cx('mc-tabs', variant === 'enclosed' && 'mc-tabs--enclosed', base.className),
    id: base.id,
    'data-mc': base.testId,
    'data-mc-tabs': asLinks ? undefined : 'true',
  })}>
    <div${attrs({ class: 'mc-tabs__list', role: asLinks ? undefined : 'tablist', 'aria-label': ariaLabel })}>
      ${join(items.map(tab))}
    </div>
    ${join(
      panels
        .filter((item) => !asLinks || item.id === selected)
        .map(
        (item) => html`<div${attrs({
          class: 'mc-tabs__panel',
          id: `${item.id}-panel`,
          role: asLinks ? undefined : 'tabpanel',
          'aria-labelledby': asLinks ? undefined : `${item.id}-tab`,
          tabindex: asLinks ? undefined : 0,
          hidden: item.id === selected ? undefined : true,
        })}>${item.panel}</div>`
      )
    )}
  </div>`;
}

// ---------------------------------------------------------------------------
// Field primitives
// ---------------------------------------------------------------------------

export interface FieldProps extends BaseProps {
  /** Input id, required so the label associates correctly. */
  inputId: string;
  label: string;
  /** Rendered under the control. */
  hint?: string | undefined;
  /** Rendered under the control in the alert tone, replacing `hint`. */
  error?: string | undefined;
  /** The control itself. */
  children: Html;
  /** Spans the full width of a parent grid. */
  wide?: boolean | undefined;
}

export function Field({ inputId, label, hint, error, children, wide, ...base }: FieldProps): Html {
  return html`<div${attrs({
    class: cx('mc-col', 'mc-gap-4', wide && 'mc-grow', base.className),
    id: base.id,
    'data-mc': base.testId,
  })}>
    <label class="mc-label" for="${inputId}">${label}</label>
    ${children}
    ${error
      ? html`<span class="mc-error-text">${error}</span>`
      : hint
        ? html`<span class="mc-hint-text">${hint}</span>`
        : EMPTY}
  </div>`;
}

export interface TextInputProps extends BaseProps {
  inputId: string;
  name?: string | undefined;
  value?: string | undefined;
  placeholder?: string | undefined;
  /** Renders the value in mono, for addresses and identifiers. */
  mono?: boolean | undefined;
  disabled?: boolean | undefined;
  readonly?: boolean | undefined;
  required?: boolean | undefined;
  invalid?: boolean | undefined;
  autocomplete?: string | undefined;
  inputmode?: 'text' | 'numeric' | 'decimal' | undefined;
}

export function TextInput({
  inputId,
  name,
  value,
  placeholder,
  mono = true,
  disabled,
  readonly,
  required,
  invalid,
  autocomplete = 'off',
  inputmode,
  ...base
}: TextInputProps): Html {
  return html`<input${attrs({
    class: cx('mc-input', mono ? 'mc-input--mono' : 'mc-input--sans', invalid && 'mc-input--invalid', base.className),
    id: inputId,
    'data-mc': base.testId,
    type: 'text',
    name: name ?? inputId,
    value,
    placeholder,
    disabled: disabled ? true : undefined,
    readonly: readonly ? true : undefined,
    required: required ? true : undefined,
    'aria-invalid': invalid ? 'true' : undefined,
    autocomplete,
    inputmode,
  })} />`;
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean | undefined;
}

export interface SelectInputProps extends BaseProps {
  inputId: string;
  options: SelectOption[];
  name?: string | undefined;
  value?: string | undefined;
  disabled?: boolean | undefined;
  required?: boolean | undefined;
  ariaLabel?: string | undefined;
}

/** Native select with the same compact treatment as TextInput. */
export function SelectInput({
  inputId,
  options,
  name,
  value,
  disabled,
  required,
  ariaLabel,
  ...base
}: SelectInputProps): Html {
  return html`<select${attrs({
    class: cx('mc-input', 'mc-input--mono', 'mc-select', base.className),
    id: inputId,
    'data-mc': base.testId,
    name: name ?? inputId,
    disabled: disabled ? true : undefined,
    required: required ? true : undefined,
    'aria-label': ariaLabel,
  })}>
    ${join(
      options.map(
        (option) => html`<option${attrs({
          value: option.value,
          selected: option.value === value ? true : undefined,
          disabled: option.disabled ? true : undefined,
        })}>${option.label}</option>`
      )
    )}
  </select>`;
}

/** Inline toggle styled as a compact pill, for mode switches. */
export interface ToggleProps extends BaseProps {
  inputId: string;
  label: string;
  checked?: boolean | undefined;
  name?: string | undefined;
  disabled?: boolean | undefined;
}

export function Toggle({ inputId, label, checked, name, disabled, ...base }: ToggleProps): Html {
  return html`<span${attrs({
    class: cx('mc-toggle', base.className),
    id: base.id,
    'data-mc': base.testId,
  })}>
    <input${attrs({
      class: 'mc-toggle__box',
      type: 'checkbox',
      id: inputId,
      name: name ?? inputId,
      checked: checked ? true : undefined,
      disabled: disabled ? true : undefined,
    })} />
    <label class="mc-label mc-clickable mc-muted" for="${inputId}">${label}</label>
  </span>`;
}
