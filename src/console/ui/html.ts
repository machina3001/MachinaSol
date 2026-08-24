/**
 * Markup primitives for the Machine Console component library.
 *
 * Components are typed functions returning `Html`. `Html` is a real wrapper
 * object rather than a bare string alias, so the `html` tagged template can
 * tell at runtime whether an interpolated value is already-safe markup or
 * untrusted text that must be escaped. A bare `type Html = string` cannot make
 * that distinction and silently invites injection.
 */

const ESCAPE_MAP: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Pre-escaped, trusted markup. Never construct directly from user input. */
export class Html {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

/** Anything the `html` template can interpolate. */
export type Renderable = Html | string | number | boolean | null | undefined | Renderable[];

/** Marks a string as trusted markup. Only for markup you generated yourself. */
export const raw = (markup: string): Html => new Html(markup);

/** Escapes text for safe use in element content and quoted attribute values. */
export const esc = (value: unknown): string =>
  String(value).replace(/[&<>"']/g, (char) => ESCAPE_MAP[char] ?? char);

/** Empty markup, useful as a conditional branch result. */
export const EMPTY: Html = new Html('');

function renderValue(value: Renderable): string {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof Html) return value.value;
  if (Array.isArray(value)) return value.map(renderValue).join('');
  if (value === true) return '';
  return esc(value);
}

/**
 * Tagged template that escapes every interpolated value unless it is already
 * `Html`. Arrays are flattened, and null/undefined/false render as nothing so
 * `cond && html\`...\`` works as a conditional.
 */
export function html(strings: TemplateStringsArray, ...values: Renderable[]): Html {
  let out = strings[0] ?? '';
  for (let i = 0; i < values.length; i += 1) {
    out += renderValue(values[i]) + (strings[i + 1] ?? '');
  }
  return new Html(out);
}

/** Joins renderables, optionally with a separator. */
export const join = (parts: Renderable[], separator = ''): Html =>
  new Html(parts.map(renderValue).filter((part) => part !== '').join(separator));

/** Final unwrap for handing markup to an HTTP response. */
export const render = (markup: Html): string => markup.value;

/** Joins class names, dropping falsy entries. */
export const cx = (...names: Array<string | false | null | undefined>): string =>
  names.filter((name): name is string => Boolean(name)).join(' ');

export type AttrValue = string | number | boolean | null | undefined;

/**
 * Renders an attribute map. `true` yields a bare attribute, `false`/nullish
 * omits it entirely, and all values are escaped.
 */
export function attrs(map: Readonly<Record<string, AttrValue>>): Html {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(map)) {
    if (value === null || value === undefined || value === false) continue;
    if (value === true) {
      parts.push(key);
      continue;
    }
    parts.push(`${key}="${esc(value)}"`);
  }
  return new Html(parts.length ? ` ${parts.join(' ')}` : '');
}

/** Props shared by every visual component. */
export interface BaseProps {
  /** Extra class names appended after the component's own classes. */
  className?: string | undefined;
  /** DOM id, needed when another control references this element. */
  id?: string | undefined;
  /** Hook for tests and behavior wiring. Rendered as `data-mc`. */
  testId?: string | undefined;
}

/** Renders the shared base attributes. */
export const baseAttrs = (props: BaseProps, ownClass: string): Html =>
  attrs({
    class: cx(ownClass, props.className),
    id: props.id,
    'data-mc': props.testId,
  });

/** Truncates a long technical value to `head…tail`, e.g. a wallet address. */
export function truncateMiddle(value: string, head = 4, tail = 4): string {
  const trimmed = value.trim();
  if (trimmed.length <= head + tail + 1) return trimmed;
  return `${trimmed.slice(0, head)}…${trimmed.slice(-tail)}`;
}
