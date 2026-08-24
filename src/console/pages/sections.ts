import {
  Amount,
  Chips,
  CommandButton,
  DataCard,
  type Html,
  KeyValueList,
  Split,
  Stack,
  StatusBadge,
  html,
  join,
} from '../ui/index.js';
import { fleetSnapshot } from '../data/fleet-snapshot.js';

/** System settings and the explicit local-runtime trust boundary. */
export function settingsSection(liveReadEnabled: boolean, version: string, bindHost: string): Html {
  const snap = fleetSnapshot();
  const loopbackBound = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(bindHost.trim().toLowerCase());
  return Stack({
    children: join([
      Split({
        children: join([
          DataCard({
            title: 'Runtime',
            icon: 'terminal',
            children: KeyValueList({
              rows: [
                { key: 'Version', value: version, mono: true },
                { key: 'Rail', value: StatusBadge({ label: 'solana', tone: 'active', size: 'sm' }) },
                {
                  key: 'Mode',
                  value: liveReadEnabled
                    ? StatusBadge({ label: 'fixture + live-read', tone: 'degraded', size: 'sm' })
                    : StatusBadge({ label: 'fixture only', tone: 'idle', dot: 'ring', size: 'sm' }),
                },
                { key: 'RPC configuration', value: 'operator-managed · value hidden', mono: true },
                { key: 'Default endpoint', value: 'none bundled', mono: true },
                { key: 'Bind', value: `${bindHost} · ${loopbackBound ? 'loopback' : 'non-loopback'}`, mono: true },
              ],
            }),
            footer: html`<span class="mc-dim mc-fs-11"
              >Live-read requires <span class="mc-mono">--allow-live</span> plus an operator-configured
              endpoint; HTTP callers cannot select it.</span
            >`,
          }),
          DataCard({
            title: 'Policy profile',
            icon: 'shield',
            children: KeyValueList({
              rows: [
                { key: 'Profile id', value: snap.policy.policyId, mono: true },
                { key: 'Display name', value: snap.policy.displayName },
                { key: 'Max per intent', value: Amount({ value: snap.policy.maxAmountPerIntent, asset: 'SOL' }) },
                {
                  key: 'Session budget',
                  value: snap.policy.maxSessionBudget
                    ? Amount({ value: snap.policy.maxSessionBudget, asset: 'SOL' })
                    : 'unbounded',
                },
                { key: 'Allowed rails', value: Chips({ items: [...snap.policy.allowedRails] }) },
                { key: 'Allowed assets', value: Chips({ items: [...snap.policy.allowedAssets] }) },
                { key: 'Machine roles', value: Chips({ items: [...snap.policy.machineRoles] }) },
                { key: 'Capability tags', value: Chips({ items: [...snap.policy.capabilityTags] }) },
              ],
            }),
          }),
        ]),
      }),
      DataCard({
        title: 'Security posture',
        icon: 'shield',
        children: KeyValueList({
          rows: [
            { key: 'Key custody', value: 'None. The runtime never reads, holds, or generates private keys.' },
            { key: 'Signing', value: 'Caller wallet only. Intents are emitted unsigned.' },
            { key: 'Broadcast', value: 'Never. The runtime does not submit transactions.' },
            {
              key: 'Authentication',
              value: `None. Current bind is ${bindHost} (${loopbackBound ? 'loopback' : 'non-loopback'}).`,
            },
            { key: 'CSP', value: 'Nonce-based, no inline styles or external assets.' },
          ],
        }),
        footer: html`<span class="mc-dim mc-fs-11"
          >${loopbackBound
            ? 'Keep this unauthenticated server loopback-only.'
            : 'Warning: this unauthenticated server is configured on a non-loopback bind.'}</span
        >`,
      }),
      DataCard({
        title: 'Local API',
        icon: 'link',
        children: html`<p class="mc-muted mc-flush mc-mb-12 mc-fs-12">
            The console reuses the runtime endpoints and adds a resource adapter boundary. Resource submission remains
            fail-closed; these routes do not add persistence, authentication, grants, or receipts.
          </p>
          ${KeyValueList({
            rows: [
              { key: 'GET /api', value: 'Route index', mono: true },
              { key: 'GET /api/health', value: 'Server version and mode', mono: true },
              { key: 'GET /api/inspect', value: 'Rail constants', mono: true },
              { key: 'GET /api/fixtures', value: 'Fixture receipts', mono: true },
              { key: 'POST /api/status', value: 'Rail reachability', mono: true },
              { key: 'POST /api/pair', value: 'Derive a non-persisted machine session record', mono: true },
              { key: 'POST /api/intent/build', value: 'Build an unsigned intent', mono: true },
              { key: 'POST /api/verify', value: 'Verify receipt evidence', mono: true },
              { key: 'GET /api/resources', value: 'Resource capability flags and current empty snapshot', mono: true },
              { key: 'POST /api/resources/discover', value: 'Validate a draft and match injected capabilities', mono: true },
              { key: 'POST /api/resources/request', value: 'Validate then reject unsupported submission', mono: true },
            ],
          })}`,
        footer: CommandButton({ label: 'Open route index', href: '/api', size: 'sm', variant: 'quiet', icon: 'external' }),
      }),
    ]),
  });
}
