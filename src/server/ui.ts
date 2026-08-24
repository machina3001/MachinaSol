const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface UiOptions {
  version: string;
  liveReadEnabled: boolean;
  /** Origin used in the copy-pasteable curl hint, e.g. `http://localhost:8787`. */
  baseUrl: string;
}

/**
 * Visual language mirrors the machinefi.run design tokens: near-black olive
 * ground, bone foreground, brass accent, oxide highlight, mono technical
 * labels. Fonts are named first and degrade to system equivalents so the
 * console stays self-contained and works offline under a strict CSP.
 */
const STYLE = `
:root {
  color-scheme: dark;
  --primary: #070807;
  --primary-elevated: #10120f;
  --primary-soft: #181b16;
  --panel: #12140f;
  --secondary: #d8d1bf;
  --secondary-muted: #8e8879;
  --brass: #c78a2a;
  --oxide: #d4501e;
  --steel: #6f7670;
  --danger: #b45c46;
  /* Text-safe variants. The decorative tokens above sit at 4.0-4.3:1 on these
     surfaces, below the WCAG AA 4.5:1 floor for body text, so anything that
     renders words uses these instead. */
  --steel-text: #868d86;
  --danger-text: #c97057;
  --neutral: #f1e8d2;
  --line: #2b2f28;
  --radius: 0.75rem;
  --font-display: 'Archivo', 'Archivo Expanded', 'Helvetica Neue', Inter, system-ui, sans-serif;
  --font-body: 'Space Grotesk', 'DM Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  background: var(--primary);
  color: var(--secondary);
  font: 15px/1.6 var(--font-body);
  -webkit-font-smoothing: antialiased;
}

/* ---------- shared primitives ---------- */
.page {
  width: 100%;
  max-width: 1240px;
  margin: 0 auto;
  padding: 0 24px;
}
.label-caps {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .16em;
  text-transform: uppercase;
  color: var(--steel-text);
}
.pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: rgba(24, 27, 22, .72);
  padding: 5px 12px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .12em;
  text-transform: uppercase;
  color: var(--secondary-muted);
}
.pill.brass { color: var(--brass); background: rgba(199, 138, 42, .08); border-color: rgba(199, 138, 42, .25); }
.pill.oxide { color: var(--oxide); background: rgba(212, 80, 30, .08); border-color: rgba(212, 80, 30, .3); }
.pill.err { color: var(--danger-text); background: rgba(180, 92, 70, .1); border-color: rgba(180, 92, 70, .34); }
.dot { width: 6px; height: 6px; border-radius: 999px; background: var(--brass); flex: 0 0 auto; }
.dot.live { animation: live-pulse 3s ease-in-out infinite; }
.dot.oxide { background: var(--oxide); }
.dot.steel { background: var(--steel); }
.dot.danger { background: var(--danger); }
@keyframes live-pulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(199, 138, 42, .5); }
  50% { opacity: .55; box-shadow: 0 0 0 5px rgba(199, 138, 42, 0); }
}
button {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: .12em;
  text-transform: uppercase;
  border-radius: 999px;
  padding: 9px 18px;
  cursor: pointer;
  transition: transform .18s cubic-bezier(.22,1,.36,1), opacity .18s ease,
              border-color .18s ease, box-shadow .18s ease, background-color .2s ease;
}
button.primary {
  background: var(--brass);
  color: var(--primary);
  border: 1px solid rgba(7, 8, 7, .34);
  box-shadow: inset 0 0 0 1px rgba(255, 248, 224, .22),
              0 13px 30px -16px rgba(199, 138, 42, .8),
              0 16px 36px -22px rgba(0, 0, 0, .86);
}
button.ghost {
  background: linear-gradient(180deg, rgba(216, 209, 191, .055), rgba(216, 209, 191, .015));
  color: var(--secondary);
  border: 1px solid rgba(216, 209, 191, .24);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .035), 0 16px 36px -24px rgba(0, 0, 0, .82);
}
button:hover { transform: translateY(-1px); }
button.primary:hover { box-shadow: inset 0 0 0 1px rgba(255, 248, 224, .3), 0 0 30px -14px rgba(199, 138, 42, .9); }
button.ghost:hover { border-color: rgba(199, 138, 42, .5); color: var(--neutral); }
:focus-visible { outline: 2px solid var(--brass); outline-offset: 3px; }

/* Entry point to the Machine Console feature. Styled as a primary action;
   an anchor is used so it is a real navigation target. */
.console-link {
  display: inline-flex; align-items: center;
  background: var(--brass);
  color: var(--primary);
  border: 1px solid var(--brass);
  border-radius: var(--r-pill, 999px);
  padding: 9px 18px;
  font-family: var(--font-mono);
  font-size: 12px; font-weight: 700;
  letter-spacing: .12em; text-transform: uppercase;
  text-decoration: none;
  box-shadow: inset 0 0 0 1px rgba(255, 248, 224, .22), 0 13px 30px -16px rgba(199, 138, 42, .8);
  transition: transform .18s cubic-bezier(.22,1,.36,1), box-shadow .18s ease, background-color .2s ease;
}
.console-link:hover {
  background: var(--accent-hover, #dba044);
  transform: translateY(-1px);
  text-decoration: none;
  box-shadow: inset 0 0 0 1px rgba(255, 248, 224, .3), 0 0 30px -14px rgba(199, 138, 42, .9);
}

a { color: var(--brass); text-decoration: none; }
a:hover { text-decoration: underline; }
code.inline {
  font-family: var(--font-mono);
  font-size: 12px;
  background: var(--primary-soft);
  border: 1px solid var(--line);
  border-radius: 5px;
  padding: 2px 6px;
  color: var(--secondary);
}
.visually-hidden {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

/* ---------- nav ---------- */
nav {
  position: sticky; top: 0; z-index: 50;
  padding: 10px 0;
  background: linear-gradient(180deg, rgba(7, 8, 7, .96), rgba(7, 8, 7, .72));
  backdrop-filter: blur(10px);
}
.nav-inner {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  height: auto; min-height: 62px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: rgba(18, 20, 15, .86);
  box-shadow: 0 12px 34px rgba(7, 8, 7, .5);
  padding: 10px 16px;
}
.brand { display: flex; align-items: center; gap: 11px; margin-right: auto; }
.brand-lockup { display: flex; flex-direction: column; gap: 1px; }
.brand-mark {
  width: 30px; height: 30px; border-radius: 9px;
  border: 1px solid rgba(199, 138, 42, .4);
  background: radial-gradient(120% 120% at 20% 10%, rgba(199, 138, 42, .3), rgba(7, 8, 7, .9));
  display: grid; place-items: center; flex: 0 0 auto;
}
.brand-name {
  display: block;
  font-family: var(--font-display);
  font-size: 15px; font-weight: 700; letter-spacing: -.01em; line-height: 1.1; color: var(--neutral);
}
.brand-sub {
  display: block;
  font-family: var(--font-mono); font-size: 9.5px; font-weight: 700; line-height: 1.1;
  letter-spacing: .18em; text-transform: uppercase; color: var(--steel-text);
}

/* ---------- hero ---------- */
.hero { position: relative; overflow: hidden; border-bottom: 1px solid var(--line); }
.hero-bg {
  position: absolute; inset: 0; pointer-events: none;
  background-image:
    radial-gradient(70% 55% at 82% 8%, rgba(199, 138, 42, .16), transparent 62%),
    radial-gradient(48% 40% at 6% 96%, rgba(212, 80, 30, .1), transparent 68%),
    linear-gradient(rgba(216, 209, 191, .032) 1px, transparent 0),
    linear-gradient(90deg, rgba(216, 209, 191, .024) 1px, transparent 0);
  background-size: auto, auto, 64px 64px, 64px 64px;
  mask-image: linear-gradient(180deg, #000 0%, #000 72%, transparent 100%);
  -webkit-mask-image: linear-gradient(180deg, #000 0%, #000 72%, transparent 100%);
}
.hero-inner { position: relative; z-index: 1; padding: 58px 0 42px; }
h1 {
  font-family: var(--font-display);
  font-size: clamp(34px, 5.4vw, 60px);
  font-weight: 700;
  letter-spacing: -.045em;
  line-height: .95;
  margin: 20px 0 18px;
  max-width: 17ch;
  color: var(--neutral);
}
h1 em { font-style: normal; color: var(--brass); }
.hero-copy { color: var(--secondary-muted); max-width: 62ch; margin: 0 0 24px; font-size: 15.5px; }
.hero-meta { display: flex; flex-wrap: wrap; gap: 9px; }

/* ---------- sections ---------- */
section.band { padding: 46px 0; border-bottom: 1px solid var(--line); }
section.band.elevated { background: var(--primary-elevated); }
.band-head { margin-bottom: 26px; }
h2 {
  font-family: var(--font-display);
  font-size: clamp(23px, 2.7vw, 33px);
  font-weight: 700; letter-spacing: -.03em; line-height: 1.06;
  margin: 12px 0 8px; color: var(--neutral);
}
.band-copy { color: var(--secondary-muted); max-width: 68ch; margin: 0; font-size: 14.5px; }

/* ---------- rail control ---------- */
.control-grid { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 16px; }
@media (max-width: 900px) { .control-grid { grid-template-columns: minmax(0, 1fr); } }
.segments { display: flex; flex-wrap: wrap; gap: 10px; }
.segment {
  display: flex; align-items: center; gap: 9px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: rgba(24, 27, 22, .55);
  padding: 9px 16px;
  transition: border-color .2s ease, background-color .2s ease;
}
.segment.is-active { border-color: rgba(199, 138, 42, .45); background: rgba(199, 138, 42, .09); }
.segment-label {
  font-family: var(--font-mono); font-size: 12px; font-weight: 700;
  letter-spacing: .1em; text-transform: uppercase; color: var(--neutral);
}
.segment-sub {
  font-family: var(--font-mono); font-size: 10px; font-weight: 700;
  letter-spacing: .12em; text-transform: uppercase; color: var(--steel-text);
}
.segment label {
  font-family: var(--font-mono); font-size: 12px; font-weight: 700;
  letter-spacing: .1em; text-transform: uppercase; color: var(--secondary-muted); cursor: pointer;
}
input[type=radio], input[type=checkbox] { accent-color: var(--brass); width: 14px; height: 14px; cursor: pointer; }
.toggle-row { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; margin-top: 16px; }
.toggle {
  display: flex; align-items: center; gap: 9px;
  border: 1px solid var(--line); border-radius: 999px;
  background: rgba(24, 27, 22, .55); padding: 9px 16px;
}
.toggle:has(:checked) { border-color: rgba(199, 138, 42, .45); background: rgba(199, 138, 42, .09); }
.toggle label {
  font-family: var(--font-mono); font-size: 12px; font-weight: 700;
  letter-spacing: .1em; text-transform: uppercase; color: var(--secondary); cursor: pointer;
}

/* ---------- module cards ---------- */
.modules { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; }
.module {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: rgba(24, 27, 22, .7);
  padding: 18px;
  transition: background-color .2s ease, border-color .2s ease;
}
.module:hover, .module:focus-within { background: var(--primary-soft); border-color: rgba(199, 138, 42, .38); }
.module-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.module-title {
  display: flex; align-items: center; gap: 9px;
  font-family: var(--font-mono); font-size: 11.5px; font-weight: 700;
  letter-spacing: .1em; text-transform: uppercase; color: var(--secondary);
}
.module-index { font-family: var(--font-mono); font-size: 11px; letter-spacing: .1em; color: var(--steel-text); }
.module-desc { color: var(--secondary-muted); font-size: 13.5px; margin: 0 0 16px; }
fieldset { border: 0; margin: 0; padding: 0; }
legend { padding: 0; }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 640px) { .grid { grid-template-columns: minmax(0, 1fr); } }
.field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.field.wide { grid-column: 1 / -1; }
.field > label {
  font-family: var(--font-mono); font-size: 10px; font-weight: 700;
  letter-spacing: .14em; text-transform: uppercase; color: var(--steel-text);
}
input[type=text] {
  background: rgba(7, 8, 7, .72);
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--secondary);
  padding: 9px 11px;
  font: 12.5px/1.45 var(--font-mono);
  min-width: 0;
  transition: border-color .18s ease, background-color .18s ease;
}
input[type=text]::placeholder { color: rgba(142, 136, 121, .6); }
input[type=text]:hover:not(:disabled) { border-color: rgba(199, 138, 42, .3); }
input[type=text]:focus { border-color: var(--brass); background: rgba(7, 8, 7, .9); }
input[type=text]:disabled { opacity: .42; cursor: not-allowed; }
.actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
.note { color: var(--secondary-muted); font-size: 12.5px; margin: 12px 0 0; line-height: 1.55; }

/* ---------- response terminal ---------- */
.console-wrap {
  position: sticky;
  top: 92px;
  /* Grid items stretch by default, which leaves a sticky item no travel room. */
  align-self: start;
}
.terminal {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel);
  overflow: hidden;
  box-shadow: 0 24px 60px -32px rgba(0, 0, 0, .9);
}
.terminal-bar {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 12px 14px;
  border-bottom: 1px solid var(--line);
  background: rgba(7, 8, 7, .55);
}
/* Kept in the nonce'd stylesheet because a CSP nonce does not authorise
   inline style attributes, which would be blocked. */
.lamps { display: flex; gap: 6px; margin-right: 4px; }
.lamps i { width: 9px; height: 9px; border-radius: 999px; display: block; }
.lamps .l1 { background: var(--danger); }
.lamps .l2 { background: var(--brass); }
.lamps .l3 { background: var(--steel); }
.note.flush { margin: 0; }
.terminal-title {
  font-family: var(--font-mono); font-size: 10.5px; font-weight: 700;
  letter-spacing: .16em; text-transform: uppercase; color: var(--steel-text); margin-right: auto;
}
.verdict-row { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; padding: 12px 14px; border-bottom: 1px solid var(--line); }
pre {
  margin: 0;
  padding: 16px;
  min-height: 240px;
  /* Bounded so the sticky column never grows taller than a short viewport,
     which would make its lower edge unreachable. */
  max-height: min(52vh, 520px);
  overflow: auto;
  font: 12.5px/1.62 var(--font-mono);
  color: var(--secondary);
  white-space: pre-wrap;
  word-break: break-word;
  background:
    linear-gradient(180deg, rgba(199, 138, 42, .03), transparent 120px);
}
pre::-webkit-scrollbar { width: 10px; height: 10px; }
pre::-webkit-scrollbar-thumb { background: #262a22; border-radius: 999px; }
.terminal-foot { padding: 12px 14px; border-top: 1px solid var(--line); background: rgba(7, 8, 7, .4); }

/* ---------- runtime loop ---------- */
.loop-list {
  list-style: none; margin: 0; padding: 0;
  display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px;
}
@media (max-width: 1080px) { .loop-list { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 620px) { .loop-list { grid-template-columns: minmax(0, 1fr); } }
.loop-item {
  border: 1px solid var(--line);
  border-top: 2px solid rgba(199, 138, 42, .5);
  border-radius: var(--radius);
  background: rgba(24, 27, 22, .55);
  padding: 15px 16px;
  transition: background-color .2s ease, border-color .2s ease;
}
.loop-item:hover { background: var(--primary-soft); border-color: rgba(199, 138, 42, .38); border-top-color: var(--brass); }
.loop-idx {
  display: block;
  font-family: var(--font-mono); font-size: 10px; font-weight: 700;
  letter-spacing: .14em; color: var(--brass); margin-bottom: 8px;
}
.loop-name {
  display: block;
  font-family: var(--font-mono); font-size: 11px; font-weight: 700;
  letter-spacing: .1em; text-transform: uppercase; color: var(--secondary);
}
.loop-desc { display: block; color: var(--secondary-muted); font-size: 12.5px; margin-top: 6px; }

/* ---------- routes + footer ---------- */
.routes { display: grid; grid-template-columns: repeat(auto-fill, minmax(268px, 1fr)); gap: 10px; }
.route {
  display: flex; flex-direction: column; gap: 5px;
  border: 1px solid var(--line); border-radius: 10px;
  background: rgba(24, 27, 22, .55); padding: 13px 15px;
  transition: border-color .2s ease, background-color .2s ease;
}
.route:hover { border-color: rgba(199, 138, 42, .38); background: var(--primary-soft); }
.route-method {
  font-family: var(--font-mono); font-size: 10px; font-weight: 700;
  letter-spacing: .14em; text-transform: uppercase; color: var(--brass);
}
.route-path { font-family: var(--font-mono); font-size: 12.5px; color: var(--secondary); word-break: break-all; }
.route-desc { color: var(--secondary-muted); font-size: 12.5px; }
footer { padding: 28px 0 44px; }
.footer-inner { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; }
.footer-note { color: var(--steel-text); font-size: 12.5px; max-width: 74ch; }

@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
  html { scroll-behavior: auto; }
  button:hover { transform: none; }
}
`;

const SCRIPT = String.raw`
'use strict';
var out = document.getElementById('output');
var statusPill = document.getElementById('status-pill');
var routePill = document.getElementById('route-pill');
var verdictPill = document.getElementById('verdict-pill');
var verdictNote = document.getElementById('verdict-note');
var announcer = document.getElementById('announcer');
var fixtureReceipt = null;

var PRESET = {
  asset: 'SOL',
  wallet: '11111111111111111111111111111111',
  source: '11111111111111111111111111111111',
  recipient: 'Sysvar1111111111111111111111111111111111111',
  amount: '0.5',
  machineId: 'drone-9',
  operator: 'flight-ops',
  role: 'drone',
  sessionId: 'mfi_solana_fixture_session',
  memo: 'job:drone-inspection-9'
};

function chain() { return 'solana'; }
function isFixture() { return document.getElementById('fixture').checked; }
function val(id) {
  var el = document.getElementById(id);
  return el && el.value.trim() !== '' ? el.value.trim() : undefined;
}
function set(id, value) {
  var el = document.getElementById(id);
  if (el) el.value = value == null ? '' : value;
}
function setPill(el, text, tone) {
  el.textContent = text;
  el.className = 'pill' + (tone ? ' ' + tone : '');
}

function verdictOf(httpStatus, payload) {
  if (!payload || typeof payload !== 'object') return { text: 'HTTP ' + httpStatus, tone: 'err', note: '' };
  if (payload.ok === false && payload.error) {
    return { text: 'Rejected', tone: 'err', note: String(payload.error.detail || '') };
  }
  var v = payload.value && typeof payload.value === 'object' ? payload.value : null;
  if (v && typeof v.verified === 'boolean') {
    if (v.verified) {
      return { text: 'Verified', tone: 'brass', note: 'status ' + v.status + ' · finality ' + (v.finality || 'unknown') + ' · evidence complete' };
    }
    var reasons = (v.mismatchReasons || []).join('; ');
    return {
      text: v.found ? 'Not verified' : 'Not found',
      tone: 'oxide',
      note: reasons || 'receipt not present in this source'
    };
  }
  // A settlement intent carries both intentId and sessionId, so it must be
  // matched before the session branch.
  if (payload.intentId) {
    return {
      text: 'Intent built',
      tone: 'brass',
      note: payload.amount + ' ' + payload.asset + ' · ' + payload.signingMode + ' · broadcast ' + payload.broadcast
    };
  }
  if (payload.sessionId) return { text: 'Session paired', tone: 'brass', note: payload.mode + ' · ' + payload.sessionId };
  if (payload.rpcReachable !== undefined) {
    return payload.ok
      ? { text: 'Rail reachable', tone: 'brass', note: payload.mode + ' · ' + payload.latencyMs + 'ms' }
      : { text: 'Rail unreachable', tone: 'err', note: String(payload.error || 'status check failed') };
  }
  if (payload.endpoints) return { text: 'Route index', tone: 'brass', note: Object.keys(payload.endpoints).length + ' endpoints on this server' };
  if (payload.receipts) return { text: 'Fixtures', tone: 'brass', note: payload.receipts.length + ' fixture receipt(s) available' };
  if (payload.rpcEnv) return { text: 'Rail constants', tone: 'brass', note: payload.chain + ' · ' + payload.rpcEnv };
  if (payload.ok === true) return { text: 'OK', tone: 'brass', note: payload.mode ? String(payload.mode) : '' };
  return { text: 'Response', tone: '', note: '' };
}

function render(route, httpStatus, payload, failed) {
  setPill(routePill, route, '');
  if (failed) {
    setPill(statusPill, 'no response', 'err');
    setPill(verdictPill, 'Request failed', 'err');
    verdictNote.textContent = typeof payload === 'string' ? payload : '';
    out.textContent = typeof payload === 'string' ? payload : 'Request failed';
    announcer.textContent = 'Request to ' + route + ' failed';
    return;
  }
  var tone = httpStatus < 300 ? '' : httpStatus < 500 ? 'oxide' : 'err';
  setPill(statusPill, 'http ' + httpStatus, tone);
  var verdict = verdictOf(httpStatus, payload);
  setPill(verdictPill, verdict.text, verdict.tone);
  verdictNote.textContent = verdict.note;
  out.textContent = JSON.stringify(payload, null, 2);
  announcer.textContent = route + ' returned HTTP ' + httpStatus + '. ' + verdict.text + '. ' + verdict.note;
}

function pending(route) {
  setPill(routePill, route, '');
  setPill(statusPill, 'running', '');
  setPill(verdictPill, 'Waiting', '');
  verdictNote.textContent = '';
  out.textContent = 'Calling ' + route + ' ...';
  // Controls in the nav sit far above the response panel. Without this the
  // request succeeds off-screen and the click looks like it did nothing.
  var box = document.querySelector('.terminal').getBoundingClientRect();
  if (box.top < 60 || box.bottom > window.innerHeight) {
    document.querySelector('.terminal').scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

function call(route, body) {
  pending(route);
  var payload = {};
  for (var key in body) {
    if (Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined) payload[key] = body[key];
  }
  fetch(route, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function (res) {
    return res.json().catch(function () { return { ok: false, error: { detail: 'response was not JSON' } }; })
      .then(function (json) { render(route, res.status, json, false); });
  }).catch(function (error) {
    render(route, 0, 'Request failed: ' + (error && error.message ? error.message : 'unknown error'), true);
  });
}

function get(route, withChain) {
  pending(route);
  var url = route;
  if (withChain) url += (route.indexOf('?') >= 0 ? '&' : '?') + 'chain=' + encodeURIComponent(chain());
  fetch(url).then(function (res) {
    return res.json().then(function (json) { render(route, res.status, json, false); });
  }).catch(function (error) {
    render(route, 0, 'Request failed: ' + (error && error.message ? error.message : 'unknown error'), true);
  });
}

function applyPreset() {
  var p = PRESET;
  set('pair-machine', p.machineId);
  set('pair-wallet', p.wallet);
  set('pair-operator', p.operator);
  set('pair-role', p.role);
  set('intent-source', p.source);
  set('intent-recipient', p.recipient);
  set('intent-amount', p.amount);
  set('intent-machine', p.machineId);
  set('intent-session', p.sessionId);
  set('intent-memo', p.memo);
  set('verify-amount', p.amount);
  set('verify-memo', p.memo);
  set('verify-machine', p.machineId);
  set('verify-session', p.sessionId);
  // Left blank on purpose: this fixture cannot prove transfer direction.
  set('verify-from', '');
  set('verify-to', '');
  document.getElementById('intent-asset').placeholder = p.asset;
  set('verify-id', fixtureReceipt ? fixtureReceipt.id : '');
  document.getElementById('verify-note').textContent = fixtureReceipt && fixtureReceipt.note ? fixtureReceipt.note : '';
}

function loadFixtures() {
  fetch('/api/fixtures').then(function (res) { return res.json(); }).then(function (json) {
    fixtureReceipt = (json.receipts || [])[0] || null;
    applyPreset();
  }).catch(function () { applyPreset(); });
}

function syncFixtureToggle() {
  var isFix = isFixture();
  var badge = document.getElementById('mode-badge');
  badge.innerHTML = '';
  var dot = document.createElement('span');
  dot.className = 'dot live' + (isFix ? '' : ' oxide');
  badge.appendChild(dot);
  badge.appendChild(document.createTextNode(isFix ? 'fixture mode' : 'live-read mode'));
  badge.className = 'pill ' + (isFix ? 'brass' : 'oxide');
  document.getElementById('hero-mode').textContent = isFix ? 'mode fixture' : 'mode live-read';
}

document.getElementById('fixture').addEventListener('change', syncFixtureToggle);
document.getElementById('btn-reset').addEventListener('click', applyPreset);

document.getElementById('form-status').addEventListener('submit', function (e) {
  e.preventDefault();
  call('/api/status', { chain: chain(), fixture: isFixture() });
});
document.getElementById('btn-inspect').addEventListener('click', function () { get('/api/inspect', true); });
document.getElementById('btn-health').addEventListener('click', function () { get('/api/health', false); });
document.getElementById('btn-fixtures').addEventListener('click', function () { get('/api/fixtures', false); });
document.getElementById('btn-routes').addEventListener('click', function () { get('/api', false); });

document.getElementById('form-pair').addEventListener('submit', function (e) {
  e.preventDefault();
  call('/api/pair', {
    chain: chain(),
    fixture: isFixture(),
    machineId: val('pair-machine'),
    wallet: val('pair-wallet'),
    operator: val('pair-operator'),
    role: val('pair-role'),
    machineLabel: val('pair-label'),
    policy: val('pair-policy')
  });
});

document.getElementById('form-intent').addEventListener('submit', function (e) {
  e.preventDefault();
  call('/api/intent/build', {
    chain: chain(),
    fixture: isFixture(),
    source: val('intent-source'),
    recipient: val('intent-recipient'),
    amount: val('intent-amount'),
    asset: val('intent-asset'),
    machineId: val('intent-machine'),
    sessionId: val('intent-session'),
    memo: val('intent-memo')
  });
});

document.getElementById('form-verify').addEventListener('submit', function (e) {
  e.preventDefault();
  var body = {
    chain: chain(),
    fixture: isFixture(),
    from: val('verify-from'),
    to: val('verify-to'),
    amount: val('verify-amount'),
    memo: val('verify-memo'),
    machineId: val('verify-machine'),
    sessionId: val('verify-session')
  };
  body.signature = val('verify-id');
  call('/api/verify', body);
});

syncFixtureToggle();
loadFixtures();
`;

const BRAND_MARK = `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
  <rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="none" stroke="#c78a2a" stroke-width="1.3"/>
  <rect x="5.4" y="5.4" width="5.2" height="5.2" rx="1.2" fill="#c78a2a"/>
</svg>`;

interface RouteRow {
  method: string;
  path: string;
  desc: string;
}

const ROUTE_ROWS: RouteRow[] = [
  { method: 'GET', path: '/api', desc: 'Route index for the local server.' },
  { method: 'GET', path: '/api/health', desc: 'Server version and whether live-read is permitted.' },
  { method: 'GET', path: '/api/inspect', desc: 'Chain id, hex id, and explorer for the selected rail.' },
  { method: 'GET', path: '/api/fixtures', desc: 'Fixture receipts, with the expectations each one can prove.' },
  { method: 'GET · POST', path: '/api/status', desc: 'Rail reachability and chain match. Mirrors machinefi status.' },
  { method: 'GET · POST', path: '/api/pair', desc: 'Derive a machine session. Mirrors machinefi pair.' },
  { method: 'GET · POST', path: '/api/intent/build', desc: 'Unsigned caller-wallet intent. Mirrors machinefi intent build.' },
  { method: 'GET · POST', path: '/api/verify', desc: 'Receipt evidence and mismatch reasons. Mirrors machinefi verify.' }
];

const renderRoutes = (): string =>
  ROUTE_ROWS.map(
    (row) => `<div class="route">
            <span class="route-method">${row.method}</span>
            <span class="route-path">${row.path}</span>
            <span class="route-desc">${row.desc}</span>
          </div>`
  ).join('\n          ');

export function renderIndexHtml(nonce: string, options: UiOptions): string {
  const safeNonce = escapeHtml(nonce);
  const version = escapeHtml(options.version);
  const baseUrl = escapeHtml(options.baseUrl);
  const modePill = options.liveReadEnabled
    ? '<span class="pill oxide"><span class="dot oxide"></span>live-read allowed</span>'
    : '<span class="pill"><span class="dot steel"></span>fixture-only server</span>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>MachineFi Runtime · Machine Console</title>
<style nonce="${safeNonce}">${STYLE}</style>
</head>
<body>

<nav aria-label="Machine console">
  <div class="page">
    <div class="nav-inner">
      <div class="brand">
        <span class="brand-mark">${BRAND_MARK}</span>
        <span class="brand-lockup">
          <span class="brand-name">MachineFi</span>
          <span class="brand-sub">runtime console</span>
        </span>
      </div>
      <span class="pill">v${version}</span>
      <span class="pill brass" id="mode-badge"><span class="dot live"></span>fixture mode</span>
      ${modePill}
      <button type="button" class="ghost" id="btn-routes">Route index</button>
      <a class="console-link" href="/console">Machine Console</a>
    </div>
  </div>
</nav>

<header class="hero">
  <div class="hero-bg" aria-hidden="true"></div>
  <div class="page hero-inner">
    <span class="pill brass"><span class="dot live"></span>Local Machine Console</span>
    <h1>Runtime visibility for every <em>machine session</em>.</h1>
    <p class="hero-copy">
      Pair a wallet-linked machine session, build an unsigned settlement intent, and inspect receipt
      evidence on Solana. Fixture mode is deterministic and makes no network calls,
      so every panel below returns the same result on every run.
    </p>
    <div class="hero-meta">
      <span class="pill">rail Solana</span>
      <span class="pill" id="hero-mode">mode fixture</span>
      <span class="pill">no keys · no custody · no broadcast</span>
    </div>
  </div>
</header>

<main>
  <section class="band elevated">
    <div class="page">
      <div class="band-head">
        <span class="label-caps">Session context</span>
        <h2>Runtime mode.</h2>
        <p class="band-copy">Applies to every module below. Live-read mode is only accepted when the server was started with <code class="inline">--allow-live</code> and an operator-configured endpoint.</p>
      </div>

      <div class="control-grid">
        <div>
          <div class="segments">
            <span class="segment is-active">
              <span class="dot" aria-hidden="true"></span>
              <span class="segment-label">Solana</span>
              <span class="segment-sub">only supported rail</span>
            </span>
          </div>
          <div class="toggle-row">
            <span class="toggle">
              <input type="checkbox" id="fixture" checked>
              <label for="fixture">Fixture mode</label>
            </span>
            <button type="button" class="ghost" id="btn-reset">Reset to fixture values</button>
          </div>
        </div>
        <div class="field" aria-label="Live-read endpoint policy">
          <span class="label-caps">Live-read endpoint</span>
          <p class="note">Managed by the server operator and never accepted from HTTP requests or displayed in this console. Configure it at startup with <code class="inline">--rpc-url</code> or <code class="inline">MACHINEFI_SOLANA_RPC_URL</code>.</p>
        </div>
      </div>
    </div>
  </section>

  <section class="band">
    <div class="page">
      <div class="band-head">
        <span class="label-caps">Runtime modules</span>
        <h2>Five modules. One runtime loop.</h2>
        <p class="band-copy">Each module calls the same command layer as the CLI, so the console and <code class="inline">machinefi</code> cannot drift apart.</p>
      </div>

      <div class="control-grid">
        <div class="modules">

          <article class="module">
            <fieldset>
              <legend class="visually-hidden">Chain status</legend>
              <div class="module-head">
                <span class="module-title"><span class="dot"></span>Chain status</span>
                <span class="module-index">01</span>
              </div>
              <p class="module-desc">Rail reachability and chain-id match, plus the server's own health and constants.</p>
              <form id="form-status">
                <div class="actions">
                  <button type="submit" class="primary">Check status</button>
                  <button type="button" class="ghost" id="btn-inspect">Chain constants</button>
                  <button type="button" class="ghost" id="btn-health">Server health</button>
                  <button type="button" class="ghost" id="btn-fixtures">Fixtures</button>
                </div>
              </form>
            </fieldset>
          </article>

          <article class="module">
            <fieldset>
              <legend class="visually-hidden">Machine session</legend>
              <div class="module-head">
                <span class="module-title"><span class="dot"></span>Machine identity</span>
                <span class="module-index">02</span>
              </div>
              <p class="module-desc">Derives a wallet-linked runtime session id. No keys are read, held, or generated.</p>
              <form id="form-pair">
                <div class="grid">
                  <div class="field"><label for="pair-machine">Machine id</label><input type="text" id="pair-machine"></div>
                  <div class="field"><label for="pair-operator">Operator id</label><input type="text" id="pair-operator"></div>
                  <div class="field wide"><label for="pair-wallet">Wallet address</label><input type="text" id="pair-wallet"></div>
                  <div class="field"><label for="pair-role">Role</label><input type="text" id="pair-role" placeholder="robot · drone · sensor"></div>
                  <div class="field"><label for="pair-label">Machine label · optional</label><input type="text" id="pair-label"></div>
                  <div class="field wide"><label for="pair-policy">Policy profile · optional</label><input type="text" id="pair-policy" placeholder="standard-machine-policy"></div>
                </div>
                <div class="actions"><button type="submit" class="primary">Pair session</button></div>
              </form>
            </fieldset>
          </article>

          <article class="module">
            <fieldset>
              <legend class="visually-hidden">Settlement intent</legend>
              <div class="module-head">
                <span class="module-title"><span class="dot"></span>Settlement intent</span>
                <span class="module-index">03</span>
              </div>
              <p class="module-desc">Unsigned caller-wallet intent with decimal and base-unit validation. Never broadcast.</p>
              <form id="form-intent">
                <div class="grid">
                  <div class="field wide"><label for="intent-source">Source</label><input type="text" id="intent-source"></div>
                  <div class="field wide"><label for="intent-recipient">Recipient</label><input type="text" id="intent-recipient"></div>
                  <div class="field"><label for="intent-amount">Amount</label><input type="text" id="intent-amount"></div>
                  <div class="field"><label for="intent-asset">Asset · optional</label><input type="text" id="intent-asset" placeholder="SOL"></div>
                  <div class="field"><label for="intent-machine">Machine id</label><input type="text" id="intent-machine"></div>
                  <div class="field"><label for="intent-session">Session id</label><input type="text" id="intent-session"></div>
                  <div class="field wide"><label for="intent-memo">Memo · optional</label><input type="text" id="intent-memo"></div>
                </div>
                <div class="actions"><button type="submit" class="primary">Build intent</button></div>
              </form>
            </fieldset>
          </article>

          <article class="module">
            <fieldset>
              <legend class="visually-hidden">Receipt evidence</legend>
              <div class="module-head">
                <span class="module-title"><span class="dot"></span>Receipt evidence</span>
                <span class="module-index">04</span>
              </div>
              <p class="module-desc">Source-aware verification. Blank expectations are not checked; unprovable ones are reported as mismatch reasons.</p>
              <form id="form-verify">
                <div class="grid">
                  <div class="field wide">
                    <label for="verify-id">Transaction signature</label>
                    <input type="text" id="verify-id">
                  </div>
                  <div class="field wide"><label for="verify-from">Expected from · optional</label><input type="text" id="verify-from"></div>
                  <div class="field wide"><label for="verify-to">Expected to · optional</label><input type="text" id="verify-to"></div>
                  <div class="field"><label for="verify-amount">Expected amount · optional</label><input type="text" id="verify-amount"></div>
                  <div class="field"><label for="verify-memo">Expected memo · optional</label><input type="text" id="verify-memo"></div>
                  <div class="field"><label for="verify-machine">Expected machine id · optional</label><input type="text" id="verify-machine"></div>
                  <div class="field"><label for="verify-session">Expected session id · optional</label><input type="text" id="verify-session"></div>
                </div>
                <div class="actions"><button type="submit" class="primary">Verify receipt</button></div>
                <p class="note" id="verify-note"></p>
              </form>
            </fieldset>
          </article>

          <article class="module">
            <div class="module-head">
              <span class="module-title"><span class="dot"></span>Audit trail</span>
              <span class="module-index">05</span>
            </div>
            <p class="module-desc">
              Every response on the right is the raw runtime record: evidence fields carry their own source label,
              so native chain evidence stays separated from MachineFi envelope and fixture metadata.
            </p>
          </article>

        </div>

        <div class="console-wrap">
          <div class="terminal">
            <div class="terminal-bar">
              <span class="lamps" aria-hidden="true"><i class="l1"></i><i class="l2"></i><i class="l3"></i></span>
              <span class="terminal-title">runtime response</span>
              <span class="pill" id="route-pill">idle</span>
              <span class="pill" id="status-pill">no request</span>
            </div>
            <div class="verdict-row">
              <span class="pill" id="verdict-pill">Ready</span>
              <span class="route-desc" id="verdict-note">Pick a module to issue a request.</span>
            </div>
            <pre id="output" tabindex="0">Fixture mode is deterministic and offline. Choose a rail, then run a module.</pre>
            <div class="terminal-foot">
              <p class="note flush">
                Same payloads over curl:
                <code class="inline">curl "${baseUrl}/api/status?chain=solana&amp;fixture=true"</code>
              </p>
            </div>
          </div>

        </div>
      </div>
    </div>
  </section>

  <section class="band elevated">
    <div class="page">
      <div class="band-head">
        <span class="label-caps">Runtime loop</span>
        <h2>Machine action to audit trail.</h2>
        <p class="band-copy">The order the runtime enforces. Identity and policy precede any intent, and settlement evidence is verified against what the chain can actually prove.</p>
      </div>
      <ul class="loop-list">
        <li class="loop-item">
          <span class="loop-idx">01</span>
          <span class="loop-name">Machine identity</span>
          <span class="loop-desc">Wallet-linked session id derived from machine, operator, and policy profile.</span>
        </li>
        <li class="loop-item">
          <span class="loop-idx">02</span>
          <span class="loop-name">Policy runtime</span>
          <span class="loop-desc">Profile limits gate the action before any intent is constructed.</span>
        </li>
        <li class="loop-item">
          <span class="loop-idx">03</span>
          <span class="loop-name">Settlement intent</span>
          <span class="loop-desc">Unsigned, caller-wallet, never broadcast by the runtime.</span>
        </li>
        <li class="loop-item">
          <span class="loop-idx">04</span>
          <span class="loop-name">Work proof</span>
          <span class="loop-desc">Telemetry and evidence bundles link the job to the settlement.</span>
        </li>
        <li class="loop-item">
          <span class="loop-idx">05</span>
          <span class="loop-name">Receipt evidence</span>
          <span class="loop-desc">Each field carries its own source, so native evidence stays separate from envelope metadata.</span>
        </li>
      </ul>
    </div>
  </section>

  <section class="band">
    <div class="page">
      <div class="band-head">
        <span class="label-caps">Local API</span>
        <h2>Every route on this server.</h2>
        <p class="band-copy">GET routes take query parameters, POST routes take a JSON body. Both accept the same field names as the CLI flags.</p>
      </div>
      <div class="routes">
          ${renderRoutes()}
      </div>
    </div>
  </section>
</main>

<footer>
  <div class="page footer-inner">
    <span class="label-caps">MachineFi Runtime · v${version} · local</span>
    <p class="footer-note">
      Loopback-bound development console with no authentication layer. Fixture mode is the default and
      performs no network I/O. Do not expose this server beyond your machine.
    </p>
  </div>
</footer>

<p class="visually-hidden" role="status" aria-live="polite" id="announcer"></p>
<script nonce="${safeNonce}">${SCRIPT}</script>
</body>
</html>
`;
}
