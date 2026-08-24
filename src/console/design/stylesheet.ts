import { toCssVars } from './tokens.js';

/**
 * Machine Console stylesheet.
 *
 * Every class is `mc-` prefixed so this can be served alongside the existing
 * runtime page without any chance of collision. Inlined under the server's
 * existing nonce'd CSP, so there are no external stylesheet requests and the
 * console works offline.
 *
 * Deliberate constraints, per the design direction:
 *   - borders carry structure, not shadows (two shadow steps only)
 *   - no gradient scales; the only gradients are hairline top-edge highlights
 *   - transitions capped at 140ms, and none on layout-affecting properties
 *   - mono for every identifier, hash, address, and numeric measurement
 */
export const stylesheet = (): string => `
:root {
${toCssVars()}
  color-scheme: dark;
}

*, *::before, *::after { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: var(--mc-ground);
  color: var(--mc-text);
  font-family: var(--mc-font-sans);
  font-size: 13px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

/* Technical values are always mono, and never wrap mid-token. */
.mc-mono {
  font-family: var(--mc-font-mono);
  font-variant-ligatures: none;
  font-feature-settings: 'zero' 1;
}

.mc-num {
  font-family: var(--mc-font-mono);
  font-variant-numeric: tabular-nums;
}

a { color: var(--mc-accent-text); text-decoration: none; }
a:hover { text-decoration: underline; text-underline-offset: 2px; }

:focus-visible {
  outline: 1px solid var(--mc-accent);
  outline-offset: 1px;
  box-shadow: var(--mc-sh-focus);
  border-radius: var(--mc-r-sm);
}

.mc-sr {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
.mc-sr:focus {
  position: fixed; z-index: 200; top: 10px; left: 10px;
  width: auto; height: auto; margin: 0; padding: 7px 10px;
  overflow: visible; clip: auto;
  border: 1px solid var(--mc-accent); border-radius: var(--mc-r-md);
  background: var(--mc-surface-overlay); color: var(--mc-text);
}

/* Small uppercase mono label. The workhorse of the whole interface. */
.mc-label {
  font-family: var(--mc-font-mono);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.11em;
  text-transform: uppercase;
  color: var(--mc-text-3);
}

/* ============================ AppShell ============================ */

.mc-shell {
  display: grid;
  grid-template-columns: var(--mc-sidebar-w) minmax(0, 1fr);
  grid-template-rows: var(--mc-topbar-h) minmax(0, 1fr);
  grid-template-areas: 'brand topbar' 'sidebar main';
  min-height: 100vh;
}
.mc-shell__brand {
  grid-area: brand;
  display: flex; align-items: center;
  border-right: 1px solid var(--mc-border);
  border-bottom: 1px solid var(--mc-border);
  background: var(--mc-surface);
  padding: 0 14px;
  min-width: 0;
}
.mc-shell__topbar { grid-area: topbar; min-width: 0; }
.mc-shell__sidebar { grid-area: sidebar; min-width: 0; }
.mc-shell__main {
  grid-area: main;
  min-width: 0;
  overflow-x: hidden;
  background: var(--mc-ground);
}
.mc-shell__inner {
  max-width: var(--mc-content-max);
  padding: 20px 24px 56px;
}

/* Responsive overrides live at the end of this sheet, after the base rules they
   override. Keeping them here would lose the cascade to later declarations. */

/* ============================ Brand ============================ */

.mc-brand { display: flex; align-items: center; gap: 9px; min-width: 0; }
.mc-brand__mark {
  width: 26px; height: 26px; flex: 0 0 auto;
  border-radius: 0;
  border: 1px solid var(--mc-accent);
  background: var(--mc-accent);
  color: var(--mc-accent-fg);
  clip-path: polygon(0 0, 78% 0, 100% 22%, 100% 100%, 22% 100%, 0 78%);
  display: grid; place-items: center;
  font-family: var(--mc-font-mono); font-size: 8px; font-weight: 800;
}
.mc-brand__meta { display: flex; flex-direction: column; min-width: 0; }
.mc-brand__name {
  font-size: 13px; font-weight: 600; letter-spacing: -0.01em;
  color: var(--mc-text); line-height: 1.2; white-space: nowrap;
}
.mc-brand__sub {
  font-family: var(--mc-font-mono);
  font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--mc-text-3); line-height: 1.3; white-space: nowrap;
}

/* ============================ Sidebar ============================ */

.mc-sidebar {
  height: 100%;
  border-right: 1px solid var(--mc-border);
  background: var(--mc-surface);
  display: flex; flex-direction: column;
}
.mc-nav { display: flex; flex-direction: column; gap: 2px; padding: 12px 10px; flex: 1 1 auto; }
.mc-nav__group { display: flex; flex-direction: column; gap: 2px; }
.mc-nav__group + .mc-nav__group { margin-top: 14px; }
.mc-nav__group-label { padding: 6px 8px 4px; }
.mc-nav__link {
  display: flex; align-items: center; gap: 9px;
  padding: 7px 9px;
  border-radius: var(--mc-r-md);
  color: var(--mc-text-2);
  font-size: 12.5px;
  font-weight: 500;
  border: 1px solid transparent;
  transition: background-color var(--mc-transition-fast), color var(--mc-transition-fast), border-color var(--mc-transition-fast);
  min-width: 0;
}
.mc-nav__link:hover { background: var(--mc-surface-hover); color: var(--mc-text); text-decoration: none; }
.mc-nav__link[aria-current='page'] {
  background: var(--mc-accent-muted);
  border-color: var(--mc-accent-border);
  color: var(--mc-accent-text);
}
.mc-nav__icon { flex: 0 0 auto; display: grid; place-items: center; width: 15px; height: 15px; opacity: 0.85; }
.mc-nav__link[aria-current='page'] .mc-nav__icon { opacity: 1; }
.mc-nav__text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mc-nav__badge { margin-left: auto; flex: 0 0 auto; }
.mc-sidebar__footer { padding: 10px; border-top: 1px solid var(--mc-border); display: flex; flex-direction: column; gap: 6px; }

/* ============================ Topbar ============================ */

.mc-topbar {
  height: var(--mc-topbar-h);
  border-bottom: 1px solid var(--mc-border);
  background: var(--mc-surface);
  display: flex; align-items: center; gap: 10px;
  padding: 0 16px;
  min-width: 0;
}
.mc-topbar__slot { display: flex; align-items: center; gap: 8px; min-width: 0; }
.mc-topbar__slot--end { margin-left: auto; flex: 0 0 auto; }
.mc-topbar__divider { width: 1px; height: 20px; background: var(--mc-border); flex: 0 0 auto; }

/* ============================ PageHeader ============================ */

.mc-page-header { display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px; }
.mc-page-header__row { display: flex; align-items: flex-start; gap: 14px; flex-wrap: wrap; }
.mc-page-header__titles { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1 1 320px; }
.mc-page-header__title {
  margin: 0;
  font-size: 19px; font-weight: 600; letter-spacing: -0.015em;
  color: var(--mc-text); line-height: 1.25;
}
.mc-page-header__desc { margin: 0; color: var(--mc-text-2); font-size: 12.5px; max-width: 76ch; }
.mc-page-header__actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; flex: 0 0 auto; }
.mc-page-header__meta { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }

.mc-breadcrumb { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.mc-breadcrumb__sep { color: var(--mc-text-off); font-size: 10px; }
.mc-breadcrumb__item { font-size: 11px; color: var(--mc-text-3); }
.mc-breadcrumb__item[aria-current='page'] { color: var(--mc-text-2); }

/* ============================ SectionHeader ============================ */

.mc-section-header {
  display: flex; align-items: center; gap: 10px;
  padding-bottom: 8px;
  margin: 0 0 12px;
  border-bottom: 1px solid var(--mc-border);
}
.mc-section-header__title {
  margin: 0; font-size: 12px; font-weight: 600; letter-spacing: 0.01em; color: var(--mc-text);
}
.mc-section-header__count {
  font-family: var(--mc-font-mono); font-size: 10.5px; color: var(--mc-text-3);
}
.mc-section-header__actions { margin-left: auto; display: flex; align-items: center; gap: 6px; }

/* ============================ Card shell ============================ */

.mc-card {
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-r-lg);
  background: var(--mc-surface);
  box-shadow: var(--mc-sh-card);
  min-width: 0;
}
.mc-card--raised { background: var(--mc-surface-raised); }
.mc-card--interactive { transition: border-color var(--mc-transition-fast), background-color var(--mc-transition-fast); }
.mc-card--interactive:hover { border-color: var(--mc-border-strong); background: var(--mc-surface-raised); }
.mc-card--accent { border-color: var(--mc-accent-border); }
.mc-card--alert { border-color: var(--mc-alert-border); }
.mc-card--flush { box-shadow: none; }

.mc-card__head {
  display: flex; align-items: center; gap: 9px;
  padding: 10px 13px;
  border-bottom: 1px solid var(--mc-border);
  min-width: 0;
}
.mc-card__title {
  display: flex; align-items: center; gap: 7px;
  font-size: 11.5px; font-weight: 600; color: var(--mc-text);
  min-width: 0;
}
.mc-card__head-actions { margin-left: auto; display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
.mc-card__body { padding: 13px; min-width: 0; }
.mc-card__body--flush { padding: 0; }
.mc-card__foot {
  padding: 9px 13px;
  border-top: 1px solid var(--mc-border);
  display: flex; align-items: center; gap: 8px;
  background: rgba(0, 0, 0, 0.16);
  border-radius: 0 0 var(--mc-r-lg) var(--mc-r-lg);
}

/* ============================ StatCard ============================ */

.mc-stat { display: flex; flex-direction: column; gap: 6px; padding: 12px 13px; }
.mc-stat__head { display: flex; align-items: center; gap: 6px; }
.mc-stat__value {
  font-family: var(--mc-font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 22px; font-weight: 500; line-height: 1.1;
  color: var(--mc-text); letter-spacing: -0.02em;
  display: flex; align-items: baseline; gap: 5px;
}
.mc-stat__unit { font-size: 11px; color: var(--mc-text-3); letter-spacing: 0; font-weight: 400; }
.mc-stat__foot { display: flex; align-items: center; gap: 6px; min-height: 15px; }
.mc-stat__delta { font-family: var(--mc-font-mono); font-size: 10.5px; display: inline-flex; align-items: center; gap: 3px; }
.mc-stat__delta--up { color: var(--mc-st-online); }
.mc-stat__delta--down { color: var(--mc-alert-text); }
.mc-stat__delta--flat { color: var(--mc-text-3); }
.mc-stat__hint { font-size: 10.5px; color: var(--mc-text-3); }

.mc-stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}

/* Meter: the inline number + bar pattern used for health columns. */
.mc-meter { display: flex; flex-direction: column; gap: 4px; min-width: 68px; }
/* Capped so the bar reads as a gauge rather than stretching across a wide cell,
   key/value row, or card field. */
.mc-table .mc-meter, .mc-entity__field .mc-meter, .mc-kv__val .mc-meter { max-width: 104px; }
.mc-table__cell--num .mc-meter { margin-left: auto; }
.mc-meter__row { display: flex; align-items: baseline; gap: 5px; }
.mc-meter__value { font-family: var(--mc-font-mono); font-variant-numeric: tabular-nums; font-size: 12.5px; color: var(--mc-text); }
.mc-meter__max { font-family: var(--mc-font-mono); font-size: 9.5px; color: var(--mc-text-off); }
/* The bar is an SVG so its length can be a geometry attribute rather than an
   inline style, which this CSP would block. */
.mc-meter__track {
  display: block; width: 100%; height: 3px;
  border-radius: var(--mc-r-pill);
  background: var(--mc-surface-active);
  overflow: hidden;
}
.mc-meter__fill { fill: var(--mc-accent); }
.mc-meter__fill--online { fill: var(--mc-st-online); }
.mc-meter__fill--degraded { fill: var(--mc-st-degraded); }
.mc-meter__fill--faulted { fill: var(--mc-st-faulted); }
.mc-meter__fill--working { fill: var(--mc-st-working); }
.mc-meter--empty .mc-meter__value { color: var(--mc-text-off); }

/* Sparkline for compact trend series. */
.mc-spark { display: block; width: 100%; height: 26px; overflow: visible; }
.mc-spark__line { fill: none; stroke: var(--mc-accent); stroke-width: 1.25; stroke-linejoin: round; stroke-linecap: round; }
.mc-spark__line--online { stroke: var(--mc-st-online); }
.mc-spark__line--degraded { stroke: var(--mc-st-degraded); }
.mc-spark__line--faulted { stroke: var(--mc-st-faulted); }
.mc-spark__area { fill: var(--mc-accent-muted); stroke: none; }

/* ============================ Badges ============================ */

.mc-badge {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 2px 7px;
  border-radius: var(--mc-r-sm);
  border: 1px solid var(--mc-border);
  background: var(--mc-surface-raised);
  font-family: var(--mc-font-mono);
  font-size: 9.5px; font-weight: 500;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--mc-text-2);
  white-space: nowrap;
  line-height: 1.6;
}
.mc-badge--pill { border-radius: var(--mc-r-pill); padding-inline: 8px; }
.mc-badge--sm { font-size: 9px; padding: 1px 5px; }
.mc-badge--online { color: var(--mc-st-online); border-color: var(--mc-st-online-border); background: var(--mc-st-online-muted); }
.mc-badge--working { color: var(--mc-st-working); border-color: var(--mc-st-working-border); background: var(--mc-st-working-muted); }
.mc-badge--active { color: var(--mc-accent-text); border-color: var(--mc-accent-border); background: var(--mc-accent-muted); }
.mc-badge--degraded { color: var(--mc-st-degraded); border-color: var(--mc-st-degraded-border); background: var(--mc-st-degraded-muted); }
.mc-badge--faulted { color: var(--mc-st-faulted); border-color: var(--mc-st-faulted-border); background: var(--mc-st-faulted-muted); }
.mc-badge--offline { color: var(--mc-text-3); border-color: var(--mc-border); background: transparent; }
.mc-badge--idle { color: var(--mc-text-2); }
.mc-badge--neutral { color: var(--mc-text-2); }

.mc-dot { width: 5px; height: 5px; border-radius: var(--mc-r-pill); flex: 0 0 auto; background: currentColor; }
.mc-dot--ring { background: transparent; border: 1.5px solid currentColor; width: 7px; height: 7px; }
.mc-dot--pulse { animation: mc-pulse 2.4s ease-in-out infinite; }
@keyframes mc-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }

/* MachineBadge: identifier + role, reads as one unit. */
.mc-machine-badge { display: inline-flex; align-items: center; gap: 7px; min-width: 0; }
.mc-machine-badge__icon {
  width: 22px; height: 22px; flex: 0 0 auto;
  border-radius: var(--mc-r-sm);
  border: 1px solid var(--mc-border);
  background: var(--mc-surface-raised);
  display: grid; place-items: center;
  color: var(--mc-text-3);
}
.mc-machine-badge__text { display: flex; flex-direction: column; min-width: 0; line-height: 1.3; }
.mc-machine-badge__name {
  font-size: 12px; font-weight: 500; color: var(--mc-text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mc-machine-badge__id {
  font-family: var(--mc-font-mono); font-size: 9.5px; color: var(--mc-text-3);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* Machine name cell links to the detail route without looking like body copy. */
.mc-machine-link { display: inline-flex; min-width: 0; color: inherit; text-decoration: none; }
.mc-machine-link:hover { text-decoration: none; }
.mc-machine-link:hover .mc-machine-badge__name { color: var(--mc-accent-text); }
.mc-machine-link:hover .mc-machine-badge__icon { border-color: var(--mc-accent-border); color: var(--mc-accent-text); }

/* ============================ AddressDisplay ============================ */

.mc-address {
  display: inline-flex; align-items: center; gap: 5px;
  font-family: var(--mc-font-mono); font-size: 11.5px;
  color: var(--mc-text-2);
  min-width: 0;
}
.mc-address__value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mc-address--boxed {
  padding: 3px 7px;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-r-sm);
  background: var(--mc-surface-raised);
}
.mc-address__chain { color: var(--mc-chain); flex: 0 0 auto; display: grid; place-items: center; }
.mc-address__link { display: inline-grid; place-items: center; color: var(--mc-text-3); flex: 0 0 auto; }
.mc-address__link:hover { color: var(--mc-accent-text); }

/* ============================ NetworkIndicator ============================ */

.mc-network {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 3px 9px 3px 7px;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-r-pill);
  background: var(--mc-surface-raised);
  min-width: 0;
}
.mc-network__name {
  font-family: var(--mc-font-mono); font-size: 10px; font-weight: 500;
  letter-spacing: 0.07em; text-transform: uppercase; color: var(--mc-text-2);
  white-space: nowrap;
}
.mc-network__latency { font-family: var(--mc-font-mono); font-size: 9.5px; color: var(--mc-text-3); }
.mc-network--online .mc-network__dot { color: var(--mc-st-online); }
.mc-network--degraded .mc-network__dot { color: var(--mc-st-degraded); }
.mc-network--offline .mc-network__dot { color: var(--mc-st-faulted); }
.mc-network--unknown .mc-network__dot { color: var(--mc-text-3); }
.mc-network--fixture { border-style: dashed; }
.mc-network--fixture .mc-network__dot { color: var(--mc-text-3); }

/* ============================ Buttons ============================ */

.mc-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 6px 11px;
  border-radius: var(--mc-r-md);
  border: 1px solid var(--mc-border);
  background: var(--mc-surface-raised);
  color: var(--mc-text);
  font-family: var(--mc-font-sans);
  font-size: 12px; font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color var(--mc-transition-fast), border-color var(--mc-transition-fast), color var(--mc-transition-fast);
}
.mc-btn:hover { background: var(--mc-surface-hover); border-color: var(--mc-border-strong); }
.mc-btn:active { background: var(--mc-surface-active); }
.mc-btn[disabled], .mc-btn[aria-disabled='true'] {
  opacity: 0.45; cursor: not-allowed; pointer-events: none;
}
.mc-btn--primary {
  background: var(--mc-accent); border-color: var(--mc-accent); color: var(--mc-accent-fg); font-weight: 600;
}
.mc-btn--primary:hover { background: var(--mc-accent-hover); border-color: var(--mc-accent-hover); }
.mc-btn--secondary, .mc-btn--outline { color: var(--mc-text-2); background: var(--mc-surface-raised); border-color: var(--mc-border-strong); }
.mc-btn--secondary:hover, .mc-btn--outline:hover { color: var(--mc-text); background: var(--mc-surface-hover); }
.mc-btn--danger { color: var(--mc-alert-text); border-color: var(--mc-alert-border); background: var(--mc-alert-muted); }
.mc-btn--danger:hover { background: var(--mc-alert-muted); border-color: var(--mc-alert); }
.mc-btn--quiet { background: transparent; border-color: transparent; color: var(--mc-text-2); }
.mc-btn--quiet:hover { background: var(--mc-surface-hover); color: var(--mc-text); border-color: transparent; }
.mc-btn--ghost { background: transparent; border-color: transparent; color: var(--mc-text-2); }
.mc-btn--destructive { color: var(--mc-alert-text); border-color: var(--mc-alert-border); background: var(--mc-alert-muted); }
.mc-btn--sm { padding: 4px 8px; font-size: 11px; }
.mc-btn--icon { padding: 5px; }
.mc-btn--block { width: 100%; }
.mc-btn--mono {
  font-family: var(--mc-font-mono); font-size: 10.5px;
  letter-spacing: 0.08em; text-transform: uppercase;
}
.mc-btn__icon { display: grid; place-items: center; flex: 0 0 auto; }
.mc-btn__kbd {
  font-family: var(--mc-font-mono); font-size: 9.5px;
  color: var(--mc-text-3); border: 1px solid var(--mc-border);
  border-radius: var(--mc-r-sm); padding: 0 3px; margin-left: 2px;
}

/* Spinner shared by buttons and LoadingState. */
.mc-spinner {
  width: 12px; height: 12px; flex: 0 0 auto;
  border: 1.5px solid var(--mc-border-strong);
  border-top-color: var(--mc-accent);
  border-radius: var(--mc-r-pill);
  animation: mc-spin 700ms linear infinite;
}
.mc-spinner--lg { width: 20px; height: 20px; border-width: 2px; }
@keyframes mc-spin { to { transform: rotate(360deg); } }

/* CopyButton feedback is CSS-driven off a data attribute. */
.mc-copy { position: relative; }
.mc-copy__done { display: none; color: var(--mc-st-online); }
.mc-copy[data-copied='true'] .mc-copy__idle { display: none; }
.mc-copy[data-copied='true'] .mc-copy__done { display: grid; }
.mc-copy-scratch {
  position: fixed; left: -9999px; top: 0;
  width: 1px; height: 1px; opacity: 0; pointer-events: none;
}

/* ============================ WalletButton ============================ */

.mc-wallet {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 4px 10px 4px 6px;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-r-pill);
  background: var(--mc-surface-raised);
  cursor: pointer;
  transition: border-color 120ms ease, background-color 120ms ease;
  min-width: 0;
}
.mc-wallet:hover { border-color: var(--mc-border-strong); background: var(--mc-surface-hover); }
.mc-wallet__avatar {
  width: 20px; height: 20px; flex: 0 0 auto;
  border-radius: var(--mc-r-pill);
  border: 1px solid var(--mc-accent-border);
  background: var(--mc-accent-muted);
  display: grid; place-items: center;
  color: var(--mc-accent-text);
}
.mc-wallet__meta { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; line-height: 1.25; }
.mc-wallet__addr { font-family: var(--mc-font-mono); font-size: 11px; color: var(--mc-text); }
.mc-wallet__label {
  font-family: var(--mc-font-mono); font-size: 8.5px; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--mc-text-3);
}
.mc-wallet--disconnected { border-style: dashed; }
.mc-wallet--disconnected .mc-wallet__avatar { border-style: dashed; color: var(--mc-text-3); background: transparent; }

/* ============================ Tabs ============================ */

.mc-tabs { display: flex; flex-direction: column; min-width: 0; }
.mc-tabs__list {
  display: flex; align-items: stretch; gap: 2px;
  border-bottom: 1px solid var(--mc-border);
  overflow-x: auto;
  scrollbar-width: none;
}
.mc-tabs__list::-webkit-scrollbar { display: none; }
.mc-tabs__tab {
  appearance: none; background: transparent; border: 0;
  border-bottom: 1.5px solid transparent;
  padding: 8px 12px;
  margin-bottom: -1px;
  color: var(--mc-text-3);
  font-family: var(--mc-font-sans); font-size: 12px; font-weight: 500;
  cursor: pointer; white-space: nowrap;
  display: inline-flex; align-items: center; gap: 6px;
  transition: color 120ms ease, border-color 120ms ease;
}
.mc-tabs__tab:hover { color: var(--mc-text); }
.mc-tabs__tab[aria-selected='true'],
.mc-tabs__tab[aria-current='page'] { color: var(--mc-accent-text); border-bottom-color: var(--mc-accent); }
.mc-tabs__panel { padding-top: 16px; }
.mc-tabs__panel[hidden] { display: none; }
.mc-tabs--enclosed .mc-tabs__list { border-bottom: 0; gap: 4px; }
.mc-tabs--enclosed .mc-tabs__tab {
  border: 1px solid transparent; border-radius: var(--mc-r-md); margin: 0; padding: 5px 10px;
}
.mc-tabs--enclosed .mc-tabs__tab[aria-selected='true'],
.mc-tabs--enclosed .mc-tabs__tab[aria-current='page'] {
  background: var(--mc-accent-muted); border-color: var(--mc-accent-border);
}

/* ============================ DataTable ============================ */

.mc-table-wrap { border: 1px solid var(--mc-border); border-radius: var(--mc-r-lg); overflow: hidden; background: var(--mc-surface); }
.mc-table-scroll { overflow-x: auto; }
.mc-table { width: 100%; border-collapse: separate; border-spacing: 0; min-width: 100%; }
.mc-table th, .mc-table td {
  text-align: left;
  padding: 8px 12px;
  border-bottom: 1px solid var(--mc-border);
  vertical-align: middle;
}
.mc-table thead th {
  position: sticky; top: 0; z-index: 1;
  background: var(--mc-surface-raised);
  font-family: var(--mc-font-mono);
  font-size: 9.5px; font-weight: 500;
  letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--mc-text-3);
  white-space: nowrap;
  padding-block: 7px;
}
.mc-table tbody tr { transition: background-color 110ms ease; }
.mc-table tbody tr:hover { background: var(--mc-surface-hover); }
.mc-table tbody tr:last-child td { border-bottom: 0; }
.mc-table tbody tr[aria-selected='true'] { background: var(--mc-accent-muted); }
.mc-table td { font-size: 12px; color: var(--mc-text-2); }
.mc-table__cell--num, .mc-table th.mc-table__cell--num { text-align: right; font-family: var(--mc-font-mono); font-variant-numeric: tabular-nums; }
/* Stacked cell content must not stretch, or a badge fills the whole column. */
.mc-table td .mc-col { align-items: flex-start; }
.mc-table td.mc-table__cell--num .mc-col { align-items: flex-end; }
.mc-table__cell--mono { font-family: var(--mc-font-mono); font-size: 11.5px; }
.mc-table__cell--tight { width: 1%; white-space: nowrap; }
.mc-table--compact th, .mc-table--compact td { padding: 5px 10px; }
.mc-table__sort {
  appearance: none; background: none; border: 0; padding: 0; cursor: pointer;
  color: inherit; font: inherit; letter-spacing: inherit; text-transform: inherit;
  display: inline-flex; align-items: center; gap: 4px;
}
.mc-table__sort:hover { color: var(--mc-text); }
.mc-table__sort-icon { opacity: 0.4; }
.mc-table__sort[aria-sort='ascending'] .mc-table__sort-icon,
.mc-table__sort[aria-sort='descending'] .mc-table__sort-icon { opacity: 1; color: var(--mc-accent-text); }
.mc-table__foot {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 12px;
  border-top: 1px solid var(--mc-border);
  background: var(--mc-surface-raised);
}
.mc-table__count { font-family: var(--mc-font-mono); font-size: 10px; color: var(--mc-text-3); }

/* ============================ Timeline / ActivityItem ============================ */

.mc-timeline { list-style: none; margin: 0; padding: 0; position: relative; }
.mc-timeline::before {
  content: ''; position: absolute; left: 6px; top: 8px; bottom: 8px;
  width: 1px; background: var(--mc-border);
}
.mc-timeline__item { position: relative; padding: 0 0 14px 22px; }
.mc-timeline__item:last-child { padding-bottom: 0; }
.mc-timeline__marker {
  position: absolute; left: 0; top: 4px;
  width: 13px; height: 13px;
  border-radius: var(--mc-r-pill);
  background: var(--mc-surface);
  border: 1px solid var(--mc-border-strong);
  display: grid; place-items: center;
  color: var(--mc-text-3);
}
.mc-timeline__marker--online { border-color: var(--mc-st-online); color: var(--mc-st-online); }
.mc-timeline__marker--active { border-color: var(--mc-accent); color: var(--mc-accent); }
.mc-timeline__marker--faulted { border-color: var(--mc-st-faulted); color: var(--mc-st-faulted); }
.mc-timeline__marker--degraded { border-color: var(--mc-st-degraded); color: var(--mc-st-degraded); }
.mc-timeline__marker-dot { width: 4px; height: 4px; border-radius: var(--mc-r-pill); background: currentColor; }

.mc-activity { display: flex; align-items: flex-start; gap: 9px; padding: 7px 0; min-width: 0; }
.mc-activity--bordered { border-bottom: 1px solid var(--mc-border); }
.mc-activity--bordered:last-child { border-bottom: 0; }
.mc-activity__icon {
  width: 20px; height: 20px; flex: 0 0 auto; margin-top: 1px;
  border-radius: var(--mc-r-sm);
  border: 1px solid var(--mc-border);
  background: var(--mc-surface-raised);
  display: grid; place-items: center;
  color: var(--mc-text-3);
}
.mc-activity__icon--online { color: var(--mc-st-online); border-color: var(--mc-st-online-border); }
.mc-activity__icon--active { color: var(--mc-accent-text); border-color: var(--mc-accent-border); }
.mc-activity__icon--faulted { color: var(--mc-st-faulted); border-color: var(--mc-st-faulted-border); }
.mc-activity__icon--degraded { color: var(--mc-st-degraded); border-color: var(--mc-st-degraded-border); }
.mc-activity__body { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
.mc-activity__title { font-size: 12px; color: var(--mc-text); min-width: 0; }
.mc-activity__meta {
  display: flex; align-items: center; gap: 7px; flex-wrap: wrap;
  font-family: var(--mc-font-mono); font-size: 10px; color: var(--mc-text-3);
}
.mc-activity__time {
  font-family: var(--mc-font-mono); font-size: 10px; color: var(--mc-text-3);
  flex: 0 0 auto; margin-left: auto; padding-left: 8px;
  font-variant-numeric: tabular-nums;
}

/* Key/value rows for detail records. */
.mc-kv { display: flex; flex-direction: column; }
.mc-kv__row {
  display: grid; grid-template-columns: minmax(120px, 26%) minmax(0, 1fr);
  gap: 12px; padding: 7px 0;
  border-bottom: 1px solid var(--mc-border);
  align-items: baseline;
}
.mc-kv__row:last-child { border-bottom: 0; }
.mc-kv__key {
  font-family: var(--mc-font-mono); font-size: 9.5px;
  letter-spacing: 0.1em; text-transform: uppercase; color: var(--mc-text-3);
}
.mc-kv__val { font-size: 12px; color: var(--mc-text); min-width: 0; overflow-wrap: anywhere; }
.mc-kv__val--mono { font-family: var(--mc-font-mono); font-size: 11.5px; }
@media (max-width: 560px) {
  .mc-kv__row { grid-template-columns: minmax(0, 1fr); gap: 3px; }
}

/* ============================ Domain cards ============================ */

.mc-entity { display: flex; flex-direction: column; gap: 0; }
.mc-entity__top { display: flex; align-items: flex-start; gap: 10px; padding: 11px 13px; min-width: 0; }
.mc-entity__top-end { margin-left: auto; display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
.mc-entity__grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
  gap: 10px 12px;
  padding: 0 13px 12px;
}
.mc-entity__field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.mc-entity__field-label {
  font-family: var(--mc-font-mono); font-size: 9px;
  letter-spacing: 0.1em; text-transform: uppercase; color: var(--mc-text-3);
}
.mc-entity__field-value {
  font-size: 12px; color: var(--mc-text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mc-entity__field-value--mono { font-family: var(--mc-font-mono); font-size: 11.5px; }
.mc-entity__field-value--num { font-family: var(--mc-font-mono); font-variant-numeric: tabular-nums; }
.mc-entity__foot {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 13px;
  border-top: 1px solid var(--mc-border);
  background: rgba(0, 0, 0, 0.14);
}
.mc-entity__foot-end { margin-left: auto; display: flex; align-items: center; gap: 6px; }

/* Amount emphasis for settlement records. */
.mc-amount { display: inline-flex; align-items: baseline; gap: 4px; font-family: var(--mc-font-mono); }
.mc-amount__value { font-size: 15px; font-variant-numeric: tabular-nums; color: var(--mc-text); letter-spacing: -0.01em; }
.mc-amount__asset { font-size: 10px; color: var(--mc-text-3); letter-spacing: 0.06em; }
.mc-amount--lg .mc-amount__value { font-size: 19px; }

/* Stage rail for job progress. */
.mc-stages { display: flex; align-items: center; gap: 0; padding: 0 13px 12px; }
/* Table-cell variant: no card padding, capped so it reads as a compact gauge. */
.mc-stages--inline { padding: 0; max-width: 104px; }
.mc-stages--inline .mc-stages__pip { width: 5px; height: 5px; }
.mc-stages--inline .mc-stages__bar { min-width: 4px; }
.mc-stages__step { display: flex; align-items: center; gap: 0; flex: 1 1 0; min-width: 0; }
.mc-stages__step:last-child { flex: 0 0 auto; }
.mc-stages__pip {
  width: 7px; height: 7px; flex: 0 0 auto;
  border-radius: var(--mc-r-pill);
  border: 1px solid var(--mc-border-strong);
  background: var(--mc-surface);
}
.mc-stages__bar { height: 1px; flex: 1 1 auto; background: var(--mc-border); min-width: 8px; }
.mc-stages__step--done .mc-stages__pip { background: var(--mc-accent); border-color: var(--mc-accent); }
.mc-stages__step--done .mc-stages__bar { background: var(--mc-accent-border); }
.mc-stages__step--current .mc-stages__pip {
  border-color: var(--mc-accent); background: var(--mc-accent);
  box-shadow: 0 0 0 3px var(--mc-accent-muted);
}
.mc-stages__step--failed .mc-stages__pip { background: var(--mc-st-faulted); border-color: var(--mc-st-faulted); }

/* Capability chips. */
.mc-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.mc-chip {
  font-family: var(--mc-font-mono); font-size: 9.5px;
  padding: 1px 6px;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-r-sm);
  color: var(--mc-text-2);
  background: var(--mc-surface-raised);
  white-space: nowrap;
}
.mc-chip--missing { color: var(--mc-alert-text); border-color: var(--mc-alert-border); background: var(--mc-alert-muted); }
.mc-chip--matched { color: var(--mc-st-online); border-color: var(--mc-st-online-border); }

/* ResourceCard-specific: provider/price emphasis. */
.mc-resource__type {
  font-family: var(--mc-font-mono); font-size: 11px;
  color: var(--mc-accent-text);
}
.mc-resource__price { display: flex; flex-direction: column; align-items: flex-end; gap: 1px; }

/* Card grid used by all entity card lists. */
.mc-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 10px;
}
.mc-card-grid--wide { grid-template-columns: repeat(auto-fill, minmax(400px, 1fr)); }

/* ============================ States ============================ */

.mc-state {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px;
  padding: 40px 24px;
  text-align: center;
  min-height: 180px;
}
.mc-state--inline { padding: 22px 16px; min-height: 0; }
.mc-state__icon {
  width: 34px; height: 34px;
  border-radius: var(--mc-r-lg);
  border: 1px solid var(--mc-border);
  background: var(--mc-surface-raised);
  display: grid; place-items: center;
  color: var(--mc-text-3);
}
.mc-state__icon--alert { color: var(--mc-alert-text); border-color: var(--mc-alert-border); background: var(--mc-alert-muted); }
.mc-state__title { font-size: 13px; font-weight: 600; color: var(--mc-text); margin: 0; }
.mc-state__desc { font-size: 12px; color: var(--mc-text-2); margin: 0; max-width: 46ch; }
.mc-state__actions { display: flex; align-items: center; gap: 8px; margin-top: 2px; flex-wrap: wrap; justify-content: center; }
.mc-state__detail {
  margin-top: 4px;
  font-family: var(--mc-font-mono); font-size: 10.5px;
  color: var(--mc-alert-text);
  background: var(--mc-alert-muted);
  border: 1px solid var(--mc-alert-border);
  border-radius: var(--mc-r-md);
  padding: 7px 10px;
  max-width: 100%;
  overflow-wrap: anywhere;
  text-align: left;
}

/* Skeletons: shimmer is a single opacity pulse, not a moving gradient. */
.mc-skel { border-radius: var(--mc-r-sm); background: var(--mc-surface-active); animation: mc-pulse 1.6s ease-in-out infinite; }
.mc-skel--text { height: 9px; }
.mc-skel--row { height: 32px; border-radius: var(--mc-r-md); }
.mc-skel-stack { display: flex; flex-direction: column; gap: 8px; width: 100%; }

/* ============================ Overlays ============================ */

.mc-scrim {
  position: fixed; inset: 0; z-index: 100;
  background: rgba(3, 4, 3, 0.72);
  display: grid;
  animation: mc-fade 120ms ease-out;
}
.mc-scrim[hidden] { display: none; }
@keyframes mc-fade { from { opacity: 0; } to { opacity: 1; } }

.mc-modal {
  place-self: center;
  width: min(560px, calc(100vw - 32px));
  max-height: calc(100vh - 64px);
  display: flex; flex-direction: column;
  border: 1px solid var(--mc-border-strong);
  border-radius: var(--mc-r-xl);
  background: var(--mc-surface-overlay);
  box-shadow: var(--mc-sh-overlay);
  overflow: hidden;
}
.mc-modal--sm { width: min(420px, calc(100vw - 32px)); }
.mc-modal--lg { width: min(820px, calc(100vw - 32px)); }

.mc-drawer {
  place-self: stretch end;
  width: min(520px, calc(100vw - 24px));
  height: 100vh;
  display: flex; flex-direction: column;
  border-left: 1px solid var(--mc-border-strong);
  background: var(--mc-surface-overlay);
  box-shadow: var(--mc-sh-overlay);
  animation: mc-slide-in 150ms cubic-bezier(0.22, 1, 0.36, 1);
  overflow: hidden;
}
.mc-drawer--wide { width: min(720px, calc(100vw - 24px)); }
@keyframes mc-slide-in { from { transform: translateX(14px); opacity: 0.6; } to { transform: none; opacity: 1; } }

.mc-overlay__head {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 13px 15px;
  border-bottom: 1px solid var(--mc-border);
  flex: 0 0 auto;
}
.mc-overlay__titles { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.mc-overlay__title { margin: 0; font-size: 14px; font-weight: 600; color: var(--mc-text); }
.mc-overlay__desc { margin: 0; font-size: 12px; color: var(--mc-text-2); }
.mc-overlay__close { margin-left: auto; flex: 0 0 auto; }
.mc-overlay__body { padding: 15px; overflow-y: auto; flex: 1 1 auto; min-height: 0; }
.mc-overlay__foot {
  display: flex; align-items: center; gap: 8px;
  padding: 11px 15px;
  border-top: 1px solid var(--mc-border);
  background: rgba(0, 0, 0, 0.18);
  flex: 0 0 auto;
}
.mc-overlay__foot-end { margin-left: auto; display: flex; align-items: center; gap: 8px; }

@media (max-width: 560px) {
  .mc-drawer { width: 100vw; }
  .mc-modal { width: calc(100vw - 20px); }
}

/* ============================ Code / JSON output ============================ */

.mc-code {
  margin: 0;
  font-family: var(--mc-font-mono);
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--mc-text-2);
  background: var(--mc-ground);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-r-md);
  padding: 11px 12px;
  overflow: auto;
  max-height: 420px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.mc-code--flush { border: 0; border-radius: 0; background: transparent; }

/* Scrollbars: thin and unobtrusive. */
.mc-code::-webkit-scrollbar, .mc-table-scroll::-webkit-scrollbar,
.mc-overlay__body::-webkit-scrollbar, .mc-shell__main::-webkit-scrollbar { width: 9px; height: 9px; }
.mc-code::-webkit-scrollbar-thumb, .mc-table-scroll::-webkit-scrollbar-thumb,
.mc-overlay__body::-webkit-scrollbar-thumb, .mc-shell__main::-webkit-scrollbar-thumb {
  background: #262a22; border-radius: var(--mc-r-pill);
}
.mc-code::-webkit-scrollbar-thumb:hover, .mc-table-scroll::-webkit-scrollbar-thumb:hover { background: #333829; }

/* ============================ Utilities ============================ */

.mc-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.mc-row--between { justify-content: space-between; }
.mc-row--wrap { flex-wrap: wrap; }
.mc-col { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.mc-grow { flex: 1 1 auto; min-width: 0; }
.mc-truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mc-muted { color: var(--mc-text-2); }
.mc-dim { color: var(--mc-text-3); }
.mc-stack { display: flex; flex-direction: column; gap: 16px; }
/* Both variants need the grid declaration; the modifier only retunes columns.
   align-items:start keeps a short panel at its natural height instead of
   stretching it to match a taller sibling and leaving dead space. */
.mc-split, .mc-split--aside { display: grid; gap: 14px; align-items: start; }
.mc-split { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
.mc-split--aside { grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); }
@media (max-width: 1000px) { .mc-split, .mc-split--aside { grid-template-columns: minmax(0, 1fr); } }

/* ---------- CSP-safe utilities ----------
   A nonce does not authorise inline style attributes, so every static style
   that would otherwise be written inline lives here as a class instead. */
.mc-icon-slot { display: grid; place-items: center; }
.mc-push { margin-left: auto; }
.mc-flush { margin: 0; }
.mc-min0 { min-width: 0; }
.mc-baseline { align-items: baseline; }
.mc-clickable { cursor: pointer; }
.mc-accent-fg { color: var(--mc-accent); }
.mc-gap-0 { gap: 0; }
.mc-gap-2 { gap: 2px; }
.mc-gap-3 { gap: 3px; }
.mc-gap-4 { gap: 4px; }
.mc-gap-6 { gap: 6px; }
.mc-gap-11 { gap: 11px; }
.mc-mt-2 { margin-top: 2px; }
.mc-mt-8 { margin-top: 8px; }
.mc-mt-14 { margin-top: 14px; }
.mc-mb-12 { margin-bottom: 12px; }
.mc-fs-11 { font-size: 11px; }
.mc-fs-12 { font-size: 12px; }
.mc-hint-text { font-size: 10.5px; color: var(--mc-text-3); }
.mc-error-text { font-family: var(--mc-font-mono); font-size: 10.5px; color: var(--mc-alert-text); }
.mc-pad { padding: 13px; }
.mc-pad-x { padding-left: 13px; padding-right: 13px; }
.mc-pad-b { padding: 0 13px 12px; }
.mc-entity-link { display: flex; flex-direction: column; text-decoration: none; color: inherit; }
.mc-entity-link:hover { text-decoration: none; }
.mc-toggle {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 5px 10px;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-r-pill);
  background: var(--mc-surface-raised);
}
.mc-toggle:has(:checked) { border-color: var(--mc-accent-border); background: var(--mc-accent-muted); }
.mc-toggle__box { accent-color: var(--mc-accent); width: 13px; height: 13px; cursor: pointer; }

.mc-input {
  width: 100%;
  padding: 6px 9px;
  border-radius: var(--mc-r-md);
  border: 1px solid var(--mc-border);
  background: var(--mc-ground);
  color: var(--mc-text);
  font-size: 12px;
  transition: border-color 130ms ease, background-color 130ms ease;
}
.mc-input--mono { font-family: var(--mc-font-mono); }
.mc-input--sans { font-family: var(--mc-font-sans); }
.mc-input--invalid { border-color: var(--mc-alert-border); }
.mc-input::placeholder { color: var(--mc-text-off); }
.mc-input:hover:not(:disabled):not([readonly]) { border-color: var(--mc-border-strong); }
.mc-input:focus { border-color: var(--mc-accent); background: var(--mc-ground); }
.mc-input:disabled { opacity: 0.45; cursor: not-allowed; }
.mc-input[readonly] { color: var(--mc-text-2); }

/* Compact filter controls for infrastructure tables. */
.mc-filterbar {
  display: grid;
  grid-template-columns: minmax(180px, 1.4fr) minmax(150px, 1fr) minmax(150px, 1fr) auto;
  gap: 10px;
  align-items: end;
  padding: 10px 12px;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-r-lg);
  background: var(--mc-surface);
}
.mc-filterbar > [role='status'] { align-self: center; white-space: nowrap; }

/* The request wizard is technical and dense; its status area remains visually
   bounded when discovery or validation inserts an inline state. */
#mc-resource-request-progress .mc-stages { padding: 2px 0 7px; }
#mc-resource-request-result:not(:empty) {
  padding-top: 10px;
  border-top: 1px solid var(--mc-border);
  color: var(--mc-text-2);
  font-size: 12px;
}

@media (max-width: 760px) {
  .mc-filterbar { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .mc-filterbar > [role='status'] { grid-column: 1 / -1; }
}
@media (max-width: 480px) {
  .mc-filterbar { grid-template-columns: minmax(0, 1fr); }
}

/* ---------- Menu (anchored popover) ---------- */
.mc-menu { position: relative; display: inline-flex; }
.mc-menu__panel {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 60;
  min-width: 210px;
  padding: 5px;
  display: flex; flex-direction: column; gap: 1px;
  border: 1px solid var(--mc-border-strong);
  border-radius: var(--mc-r-lg);
  background: var(--mc-surface-overlay);
  box-shadow: var(--mc-sh-overlay);
}
.mc-menu__panel--start { right: auto; left: 0; }
.mc-menu__panel[hidden] { display: none; }
.mc-menu__header {
  padding: 8px 9px;
  margin-bottom: 3px;
  border-bottom: 1px solid var(--mc-border);
}
.mc-menu__item {
  appearance: none;
  display: flex; align-items: center; gap: 8px;
  width: 100%;
  padding: 6px 9px;
  border: 0;
  border-radius: var(--mc-r-md);
  background: transparent;
  color: var(--mc-text-2);
  font-family: var(--mc-font-sans);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  text-decoration: none;
  transition: background-color 110ms ease, color 110ms ease;
}
.mc-menu__item:hover { background: var(--mc-surface-hover); color: var(--mc-text); text-decoration: none; }
.mc-menu__item[aria-disabled='true'] { opacity: 0.4; pointer-events: none; }
.mc-menu__item--danger { color: var(--mc-alert-text); }
.mc-menu__item--danger:hover { background: var(--mc-alert-muted); color: var(--mc-alert-text); }
.mc-menu__item--sep { margin-top: 4px; padding-top: 9px; border-top: 1px solid var(--mc-border); border-radius: 0 0 var(--mc-r-md) var(--mc-r-md); }
.mc-menu__icon { display: grid; place-items: center; flex: 0 0 auto; color: var(--mc-text-3); }
.mc-menu__item:hover .mc-menu__icon { color: var(--mc-text-2); }
.mc-menu__hint { font-family: var(--mc-font-mono); font-size: 9.5px; color: var(--mc-text-3); flex: 0 0 auto; }

/* ---------- Sidebar footer blocks ---------- */
.mc-sidebar__block {
  display: flex; flex-direction: column; gap: 6px;
  padding: 9px 10px;
  border-top: 1px solid var(--mc-border);
}
.mc-sidebar__block-label { padding-inline: 1px; }
/* In the icon rail the footer blocks would overflow, so they compress. */
@media (max-width: 1100px) {
  .mc-sidebar__block { align-items: center; padding-inline: 4px; }
  .mc-sidebar__block-label, .mc-sidebar__block .mc-network__name,
  .mc-sidebar__block .mc-network__latency, .mc-sidebar__block .mc-wallet__meta { display: none; }
  .mc-sidebar__block .mc-network { padding: 5px; border-radius: var(--mc-r-md); }
  .mc-sidebar__block .mc-wallet { padding: 4px; }
}
@media (max-width: 720px) {
  .mc-sidebar__block { display: none; }
}
/* Skeleton line widths, since a percentage cannot come from a class-free
   inline style under this CSP. */
.mc-skel--w1 { width: 92%; }
.mc-skel--w2 { width: 68%; }
.mc-skel--w3 { width: 80%; }
.mc-skel--w4 { width: 54%; }
.mc-skel--w5 { width: 74%; }

/* ============================ Responsive ============================
   Placed last so these win the cascade over the base rules above. Two steps:
   the sidebar becomes an icon rail, then the whole shell stacks and the rail
   becomes a scrollable horizontal nav. */

@media (max-width: 1100px) {
  .mc-shell { grid-template-columns: 60px minmax(0, 1fr); }
  .mc-nav__text, .mc-brand__meta, .mc-nav__group-label { display: none; }
  .mc-nav__link { justify-content: center; padding-left: 0; padding-right: 0; }
  .mc-shell__brand { justify-content: center; padding: 0; }
  /* With labels hidden there is nothing for the badge to sit beside. */
  .mc-nav__badge { display: none; }
  .mc-sidebar__footer { display: none; }
}

@media (max-width: 720px) {
  .mc-shell {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: var(--mc-topbar-h) auto minmax(0, 1fr);
    grid-template-areas: 'topbar' 'sidebar' 'main';
  }
  .mc-shell__brand { display: none; }
  .mc-shell__sidebar { border-right: 0; border-bottom: 1px solid var(--mc-border); }
  .mc-nav {
    flex-direction: row; flex-wrap: nowrap;
    overflow-x: auto; scrollbar-width: none;
    padding: 8px 12px; gap: 6px;
  }
  .mc-nav::-webkit-scrollbar { display: none; }
  /* Groups use display:contents so they do not create columns inside the row. */
  .mc-nav__group { display: contents; }
  .mc-nav__group + .mc-nav__group { margin-top: 0; }
  .mc-nav__text { display: inline; }
  .mc-nav__link { justify-content: flex-start; padding: 7px 12px; flex: 0 0 auto; }
  /* The vertical layout pushes badges to the far edge; in a row that would
     stretch each link across the viewport. */
  .mc-nav__badge { display: inline-flex; margin-left: 0; }
  .mc-sidebar__footer { padding: 8px 12px; }
  /* A fixed-height bar cannot wrap, so it scrolls and the end slot stops being
     pinned. Otherwise the start and end controls overlap on narrow screens. */
  .mc-topbar { overflow-x: auto; scrollbar-width: none; gap: 8px; padding: 0 12px; }
  .mc-topbar::-webkit-scrollbar { display: none; }
  .mc-topbar__slot { flex: 0 0 auto; }
  .mc-topbar__slot--end { margin-left: 0; }
  .mc-shell__inner { padding: 16px 14px 40px; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important; }
}
`;
