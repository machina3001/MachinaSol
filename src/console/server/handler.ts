import { esc, render, stylesheet, behaviorScript } from '../ui/index.js';
import { renderConsolePage, CONSOLE_SECTIONS } from '../pages/console-page.js';
import { consoleClientScript } from '../pages/client.js';
import { fleetSnapshot } from '../data/fleet-snapshot.js';
import { toneFor } from '../design/tokens.js';

/**
 * Machine Console route.
 *
 * Self-contained: given a pathname and a nonce it returns a complete document.
 * It reuses the existing server's response helpers and CSP rather than adding
 * any transport of its own, so the existing runtime page is unaffected.
 */

export const CONSOLE_BASE_PATH = '/console';

/** True when this path belongs to the console feature. */
export const isConsolePath = (pathname: string): boolean =>
  pathname === CONSOLE_BASE_PATH || pathname.startsWith(`${CONSOLE_BASE_PATH}/`);

export interface ConsoleRoute {
  /** Top-level section id. */
  section: string;
  /** Detail record id, for nested routes like `/console/machines/<id>`. */
  detailId?: string | undefined;
  /** Tab key within a detail page. */
  tab?: string | undefined;
}

const MACHINE_DETAIL_TABS = new Set([
  'overview',
  'runtime',
  'jobs',
  'resources',
  'telemetry',
  'settlements',
  'receipts',
]);

function decodeDetailId(segment: string): string {
  const decoded = decodeURIComponent(segment);
  if (decoded.length === 0 || decoded.length > 256 || /[\/\u0000-\u001f\u007f]/u.test(decoded)) {
    throw new URIError('invalid console detail identifier');
  }
  return decoded;
}

/**
 * Parses a console pathname.
 *
 * Supports `/console`, `/console/<section>`, machine detail tabs, and resource
 * and job detail routes. Unknown or over-deep paths resolve to the console's
 * dedicated not-found page.
 */
export function routeFromPath(pathname: string): ConsoleRoute {
  const rest = pathname.slice(CONSOLE_BASE_PATH.length).replace(/^\/+|\/+$/g, '');
  if (rest === '') return { section: 'overview' };

  const parts = rest.split('/').filter(Boolean);
  const section = parts[0] ?? 'overview';
  if (!CONSOLE_SECTIONS.some((candidate) => candidate.id === section)) {
    return { section: 'not-found' };
  }
  // Machine detail uses the fourth segment as a tab key.
  if (section === 'machines' && parts[1]) {
    const tab = parts[2] ?? 'overview';
    if (parts[3] || !MACHINE_DETAIL_TABS.has(tab)) return { section: 'not-found' };
    return { section, detailId: decodeDetailId(parts[1]), tab };
  }
  // Resources and jobs have one record-detail segment and no nested tabs.
  if ((section === 'resources' || section === 'jobs') && parts[1]) {
    if (parts[2]) return { section: 'not-found' };
    return { section, detailId: decodeDetailId(parts[1]) };
  }
  if (parts[1]) return { section: 'not-found' };
  return { section };
}

/** Extracts the section id from a console pathname. */
export const sectionFromPath = (pathname: string): string => routeFromPath(pathname).section;

/** Serialisable machine records handed to the client for the detail drawer. */
function machinesForClient(): string {
  const snap = fleetSnapshot();
  const map: Record<string, unknown> = {};
  for (const view of snap.machines) {
    map[view.entry.machineId] = {
      machineId: view.entry.machineId,
      label: view.label,
      role: view.entry.role,
      status: view.entry.status,
      tone: toneFor(view.entry.status),
      operatorId: view.entry.operatorId,
      walletAddress: view.entry.walletAddress,
      health: view.telemetry.health,
      battery: view.entry.batteryPct ?? null,
      diagnostics: view.diagnostics.messages.length
        ? `${view.diagnostics.level}: ${view.diagnostics.messages.join('; ')}`
        : view.diagnostics.level,
      telemetryRef: view.entry.lastTelemetryRef ?? 'none',
      capabilities: view.entry.capabilities,
      lastSeen: view.lastSeen,
      raw: {
        machineId: view.entry.machineId,
        status: view.entry.status,
        health: view.entry.health,
        batteryPct: view.entry.batteryPct,
        fleetId: view.entry.fleetId,
        siteId: view.entry.siteId,
        activeJobId: view.entry.activeJobId ?? null,
        telemetry: view.telemetry,
      },
    };
  }
  // `</script>` cannot appear inside an inline script, and U+2028/9 break JS
  // string literals, so both are escaped.
  return JSON.stringify(map)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export interface ConsoleDocumentOptions {
  pathname: string;
  nonce: string;
  version: string;
  liveReadEnabled: boolean;
  bindHost?: string | undefined;
}

/** Renders the full console document. */
export function renderConsoleDocument({
  pathname,
  nonce,
  version,
  liveReadEnabled,
  bindHost = '127.0.0.1',
}: ConsoleDocumentOptions): string {
  const route = routeFromPath(pathname);
  const page = renderConsolePage({
    section: route.section,
    detailId: route.detailId,
    tab: route.tab,
    version,
    liveReadEnabled,
    bindHost,
    homeHref: '/',
  });
  const sectionLabel =
    route.section === 'not-found'
      ? 'Not found'
      : (CONSOLE_SECTIONS.find((item) => item.id === route.section)?.label ?? 'Overview');
  const label = route.detailId ? `${route.detailId} · ${sectionLabel}` : sectionLabel;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${esc(label)} · Machine Console</title>
<style nonce="${nonce}">${stylesheet()}</style>
</head>
<body>
<a href="#mc-main" class="mc-sr">Skip to content</a>
${render(page)}
<script nonce="${nonce}">${behaviorScript()}</script>
<script nonce="${nonce}">${consoleClientScript(machinesForClient())}</script>
</body>
</html>
`;
}
