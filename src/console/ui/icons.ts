import { Html, attrs, raw } from './html.js';

/**
 * Inline stroke icons. Original geometry, drawn on a 16x16 grid with a 1.25
 * stroke so they sit correctly next to 10-12px mono labels. All use
 * `currentColor` so tone is inherited from the surrounding component.
 */

export type IconName =
  | 'overview'
  | 'telemetry'
  | 'fleet'
  | 'settlement'
  | 'audit'
  | 'resource'
  | 'machine'
  | 'drone'
  | 'sensor'
  | 'chevron-right'
  | 'chevron-down'
  | 'chevron-up'
  | 'plus'
  | 'copy'
  | 'check'
  | 'external'
  | 'close'
  | 'search'
  | 'alert'
  | 'inbox'
  | 'refresh'
  | 'play'
  | 'wallet'
  | 'link'
  | 'clock'
  | 'zap'
  | 'arrow-up'
  | 'arrow-down'
  | 'dash'
  | 'sort'
  | 'filter'
  | 'download'
  | 'shield'
  | 'terminal'
  | 'menu';

const PATHS: Readonly<Record<IconName, string>> = {
  overview: '<rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/>',
  telemetry: '<path d="M1 9h2.5l1.5-4 2 7 2-9 2 6h3"/>',
  fleet: '<rect x="2" y="2.5" width="12" height="4" rx="1"/><rect x="2" y="9.5" width="12" height="4" rx="1"/><path d="M4.5 4.5h.01M4.5 11.5h.01"/>',
  settlement: '<rect x="1.5" y="4" width="13" height="8.5" rx="1.5"/><path d="M1.5 7h13M11 10h1.5"/>',
  audit: '<path d="M8 1.5 2.5 3.5v4c0 3 2.3 5.6 5.5 7 3.2-1.4 5.5-4 5.5-7v-4L8 1.5Z"/><path d="M5.8 7.8 7.4 9.4l3-3.2"/>',
  resource: '<path d="M8 1.8 14 5v6l-6 3.2L2 11V5l6-3.2Z"/><path d="M2 5l6 3.2L14 5M8 8.2v6"/>',
  machine: '<rect x="4" y="4" width="8" height="8" rx="1.5"/><path d="M6.5 1.5v2.5M9.5 1.5v2.5M6.5 12v2.5M9.5 12v2.5M1.5 6.5h2.5M1.5 9.5h2.5M12 6.5h2.5M12 9.5h2.5"/>',
  drone: '<circle cx="8" cy="8" r="2.2"/><path d="M6.4 6.4 3.4 3.4M9.6 6.4l3-3M6.4 9.6l-3 3M9.6 9.6l3 3"/><circle cx="2.6" cy="2.6" r="1.3"/><circle cx="13.4" cy="2.6" r="1.3"/><circle cx="2.6" cy="13.4" r="1.3"/><circle cx="13.4" cy="13.4" r="1.3"/>',
  sensor: '<circle cx="8" cy="8" r="1.6"/><path d="M4.8 4.8a4.5 4.5 0 0 0 0 6.4M11.2 11.2a4.5 4.5 0 0 0 0-6.4M2.6 2.6a7.6 7.6 0 0 0 0 10.8M13.4 13.4a7.6 7.6 0 0 0 0-10.8"/>',
  'chevron-right': '<path d="M6 3.5 10.5 8 6 12.5"/>',
  plus: '<path d="M8 3.2v9.6M3.2 8h9.6"/>',
  'chevron-down': '<path d="M3.5 6 8 10.5 12.5 6"/>',
  'chevron-up': '<path d="M3.5 10 8 5.5 12.5 10"/>',
  copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5v-1a1.5 1.5 0 0 0-1.5-1.5H4a1.5 1.5 0 0 0-1.5 1.5v5A1.5 1.5 0 0 0 4 11h1"/>',
  check: '<path d="M3 8.5 6.2 11.7 13 4.8"/>',
  external: '<path d="M9.5 2.5H13V6M12.8 2.7 7.5 8M11 9.5V12a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 12V6.5A1.5 1.5 0 0 1 4 5h2.5"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8"/>',
  search: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/>',
  alert: '<path d="M8 2.2 14.5 13.5h-13L8 2.2Z"/><path d="M8 6.4v3.2M8 11.6h.01"/>',
  inbox: '<path d="M1.8 8.5h3.4l1 2h3.6l1-2h3.4"/><path d="M1.8 8.5 3.6 3.2A1.5 1.5 0 0 1 5 2.2h6a1.5 1.5 0 0 1 1.4 1l1.8 5.3v3.8a1.5 1.5 0 0 1-1.5 1.5H3.3a1.5 1.5 0 0 1-1.5-1.5V8.5Z"/>',
  refresh: '<path d="M13.5 8a5.5 5.5 0 0 1-9.6 3.6M2.5 8a5.5 5.5 0 0 1 9.6-3.6"/><path d="M12.1 1.8v2.7H9.4M3.9 14.2v-2.7h2.7"/>',
  play: '<path d="M5 3.2 12.5 8 5 12.8V3.2Z"/>',
  wallet: '<rect x="1.5" y="3.5" width="13" height="9.5" rx="1.5"/><path d="M11 8.2h1.6"/><path d="M1.5 6.4h13"/>',
  link: '<path d="M6.6 9.4a2.6 2.6 0 0 1 0-3.7l2-2a2.6 2.6 0 0 1 3.7 3.7l-1 1"/><path d="M9.4 6.6a2.6 2.6 0 0 1 0 3.7l-2 2a2.6 2.6 0 0 1-3.7-3.7l1-1"/>',
  clock: '<circle cx="8" cy="8" r="6"/><path d="M8 4.6V8l2.4 1.6"/>',
  zap: '<path d="M9.2 1.8 3.5 9h3.8l-.5 5.2L12.5 7H8.7l.5-5.2Z"/>',
  'arrow-up': '<path d="M8 12.5V3.5M4.5 7 8 3.5 11.5 7"/>',
  'arrow-down': '<path d="M8 3.5v9M4.5 9 8 12.5 11.5 9"/>',
  dash: '<path d="M3.5 8h9"/>',
  sort: '<path d="M5 6.2 5 12M3.2 10.2 5 12l1.8-1.8M11 9.8V4M9.2 5.8 11 4l1.8 1.8"/>',
  filter: '<path d="M2 3.5h12L9.2 8.8v4.2l-2.4-1.4V8.8L2 3.5Z"/>',
  download: '<path d="M8 2.5v7.5M4.8 7 8 10.2 11.2 7M2.5 12.5h11"/>',
  shield: '<path d="M8 1.8 3 3.6v4.2c0 2.9 2.1 5.4 5 6.4 2.9-1 5-3.5 5-6.4V3.6L8 1.8Z"/>',
  terminal: '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M4.5 6.5 6.5 8.5 4.5 10.5M8.5 10.5h3"/>',
  menu: '<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/>',
};

export interface IconProps {
  name: IconName;
  /** Pixel size for both dimensions. Defaults to 14. */
  size?: number | undefined;
  className?: string | undefined;
  /**
   * Accessible label. Omit for purely decorative icons, which are then hidden
   * from assistive technology.
   */
  label?: string | undefined;
}

export function Icon({ name, size = 14, className, label }: IconProps): Html {
  const body = PATHS[name];
  const a = attrs({
    class: className,
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.25,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': label ? undefined : 'true',
    'aria-label': label,
    role: label ? 'img' : undefined,
    focusable: 'false',
  });
  return raw(`<svg${a.value}>${body}</svg>`);
}

/** True when the name is a known icon, useful for validating external input. */
export const isIconName = (value: string): value is IconName =>
  Object.prototype.hasOwnProperty.call(PATHS, value);
