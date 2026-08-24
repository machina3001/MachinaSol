import { sharedThemeCssVars } from '../design/theme.js';

export interface PublicSiteOptions {
  version: string;
  showRuntimeInspector: boolean;
}

const escapeHtml = (value: string): string => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const GITHUB_URL = 'https://github.com/Machine-Fi/runtime-8';
const NPM_URL = 'https://www.npmjs.com/package/@machinefi/runtime';

const STYLE = String.raw`
:root {
${sharedThemeCssVars()}
  color-scheme: dark;
  --ink: var(--foreground);
  --faint: var(--muted-subtle);
  --night: var(--background);
  --panel: var(--surface);
  --panel-2: var(--surface-elevated);
  --line: var(--border);
  --line-strong: var(--border-strong);
  --acid: var(--accent);
  --acid-2: var(--accent-hover);
  --sky: var(--info);
  --max: 1240px;
  --mono: var(--font-mono);
  --sans: var(--font-sans);
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; background: var(--night); }
body { margin: 0; color: var(--ink); background: var(--night); font-family: var(--sans); -webkit-font-smoothing: antialiased; }
a { color: inherit; text-decoration: none; }
button, summary { font: inherit; }
::selection { color: var(--accent-foreground); background: var(--acid); }
:focus-visible { outline: 1px solid var(--accent); outline-offset: 2px; box-shadow: var(--shadow-focus); border-radius: var(--radius-sm); }

.site-shell { min-height: 100vh; overflow: hidden; background:
  radial-gradient(circle at 78% 9%, rgba(128, 177, 93, .12), transparent 30rem),
  radial-gradient(circle at 20% 37%, rgba(75, 124, 110, .08), transparent 25rem),
  var(--night); }
.container { width: min(calc(100% - 48px), var(--max)); margin-inline: auto; }
.eyebrow { display: inline-flex; align-items: center; gap: 10px; margin: 0 0 22px; color: var(--acid); font: 600 11px/1 var(--mono); letter-spacing: .16em; text-transform: uppercase; }
.eyebrow::before { content: ""; width: 22px; height: 1px; background: var(--acid); }
.section { position: relative; padding: 124px 0; border-top: 1px solid var(--line); }
.section-heading { max-width: 820px; margin-bottom: 64px; }
.section-heading h2 { margin: 0; max-width: 780px; font-size: clamp(40px, 5.4vw, 72px); line-height: .98; letter-spacing: -.055em; font-weight: 530; }
.section-heading p { max-width: 650px; margin: 25px 0 0; color: var(--muted); font-size: 18px; line-height: 1.7; }
.section-index { position: absolute; top: 128px; right: max(24px, calc((100vw - var(--max)) / 2)); color: var(--faint); font: 11px/1 var(--mono); letter-spacing: .14em; }

.public-nav { position: fixed; z-index: 30; inset: 0 0 auto; height: 76px; border-bottom: 1px solid var(--line); background: rgba(7, 9, 8, .84); backdrop-filter: blur(18px); }
.nav-inner { height: 100%; display: flex; align-items: center; justify-content: space-between; gap: 32px; }
.brand { display: inline-flex; align-items: center; gap: 12px; flex: 0 0 auto; }
.brand-mark { position: relative; display: grid; place-items: center; width: 35px; height: 35px; color: var(--accent-foreground); background: var(--acid); font: 900 12px/1 var(--mono); clip-path: polygon(0 0, 78% 0, 100% 22%, 100% 100%, 22% 100%, 0 78%); }
.brand-copy { display: grid; gap: 2px; }
.brand-name { font-size: 15px; line-height: 1; letter-spacing: -.02em; font-weight: 700; }
.brand-sub { color: var(--faint); font: 9px/1 var(--mono); letter-spacing: .13em; text-transform: uppercase; }
.nav-links { display: flex; align-items: center; gap: clamp(18px, 2.7vw, 38px); margin-left: auto; }
.nav-links a, .nav-github { color: var(--muted); font-size: 13px; transition: color var(--transition-fast); }
.nav-links a:hover, .nav-github:hover { color: var(--ink); }
.nav-actions { display: flex; align-items: center; gap: 20px; }
.button { display: inline-flex; align-items: center; justify-content: center; min-height: 48px; gap: 13px; padding: 0 21px; border: 1px solid var(--line-strong); border-radius: var(--radius-md); color: var(--ink); background: var(--surface-elevated); font: 600 12px/1 var(--mono); letter-spacing: .04em; transition: transform var(--transition-fast), border-color var(--transition-fast), background var(--transition-fast); }
.button:hover { transform: translateY(-2px); border-color: var(--accent-border); }
.button.primary { color: var(--accent-foreground); background: var(--acid); border-color: var(--acid); box-shadow: var(--shadow-card); }
.button.primary:hover { background: var(--accent-hover); }
.button.compact { min-height: 40px; padding: 0 16px; font-size: 10px; }
.arrow { font-size: 17px; line-height: 0; }
.mobile-menu { display: none; position: relative; margin-left: auto; }
.mobile-menu summary { width: 40px; height: 40px; display: grid; place-items: center; border: 1px solid var(--line-strong); color: var(--ink); cursor: pointer; list-style: none; }
.mobile-menu summary::-webkit-details-marker { display: none; }
.menu-lines, .menu-lines::before, .menu-lines::after { width: 15px; height: 1px; display: block; background: currentColor; content: ""; }
.menu-lines { position: relative; }.menu-lines::before { position: absolute; top: -5px; }.menu-lines::after { position: absolute; top: 5px; }
.mobile-panel { position: absolute; z-index: 40; top: 48px; right: 0; width: min(280px, calc(100vw - 32px)); padding: 10px; border: 1px solid var(--line-strong); border-radius: var(--radius-lg); background: var(--surface-overlay); box-shadow: var(--shadow-overlay); }
.mobile-panel a { display: flex; align-items: center; justify-content: space-between; min-height: 43px; padding: 0 12px; border-bottom: 1px solid var(--line); color: #c4c7bf; font: 11px/1 var(--mono); }.mobile-panel a:last-child { border-bottom: 0; color: var(--acid); }

.hero { position: relative; min-height: 100svh; padding: 164px 0 96px; display: flex; align-items: center; }
.hero::before { content: ""; position: absolute; inset: 0; pointer-events: none; background-image: linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px); background-size: 68px 68px; opacity: .25; mask-image: linear-gradient(to bottom, #000 8%, transparent 92%); }
.hero::after { content: ""; position: absolute; width: 500px; height: 500px; right: -280px; top: 150px; border: 1px solid rgba(201, 243, 107, .14); border-radius: 50%; box-shadow: 0 0 0 80px rgba(201, 243, 107, .025), 0 0 0 160px rgba(201, 243, 107, .015); }
.hero-grid { position: relative; display: grid; grid-template-columns: minmax(0, 1.16fr) minmax(360px, .84fr); align-items: center; gap: 70px; }
.hero-label { display: inline-flex; align-items: center; gap: 12px; margin-bottom: 36px; color: #bcc0b8; font: 10px/1 var(--mono); letter-spacing: .11em; text-transform: uppercase; }
.hero-label span { width: 7px; height: 7px; background: var(--acid); border-radius: 50%; box-shadow: 0 0 16px var(--acid); }
.hero h1 { margin: 0; max-width: 850px; font-size: clamp(58px, 7.35vw, 104px); line-height: .91; letter-spacing: -.07em; font-weight: 520; }
.hero h1 em { color: var(--acid); font-style: normal; }
.hero-copy { max-width: 670px; margin: 35px 0 0; color: #b2b5ad; font-size: clamp(17px, 1.55vw, 21px); line-height: 1.65; }
.hero-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 42px; }
.hero-notes { display: flex; flex-wrap: wrap; gap: 20px; margin-top: 30px; color: var(--faint); font: 10px/1.4 var(--mono); text-transform: uppercase; letter-spacing: .08em; }
.hero-notes span::before { content: "+"; color: var(--acid); margin-right: 7px; }

.runtime-orbit { position: relative; aspect-ratio: 1; max-width: 470px; width: 100%; justify-self: end; }
.orbit-ring { position: absolute; inset: 8%; border: 1px solid var(--line); border-radius: 50%; }
.orbit-ring.two { inset: 22%; border-style: dashed; animation: spin 36s linear infinite; }
.orbit-core { position: absolute; inset: 34%; display: grid; place-items: center; border: 1px solid rgba(201,243,107,.5); background: rgba(201,243,107,.06); transform: rotate(45deg); }
.orbit-core span { transform: rotate(-45deg); color: var(--acid); font: 700 14px/1 var(--mono); letter-spacing: .12em; }
.orbit-node { position: absolute; min-width: 116px; padding: 12px 14px; border: 1px solid var(--line-strong); background: rgba(10, 14, 11, .92); }
.orbit-node small { display: block; color: var(--faint); font: 9px/1 var(--mono); letter-spacing: .12em; text-transform: uppercase; }
.orbit-node strong { display: block; margin-top: 7px; font: 500 12px/1.2 var(--mono); }
.node-a { left: -1%; top: 16%; }.node-b { right: -2%; top: 18%; }.node-c { right: 0; bottom: 17%; }.node-d { left: 1%; bottom: 14%; }
.orbit-status { position: absolute; left: 50%; bottom: 3%; translate: -50% 0; color: var(--acid); font: 9px/1 var(--mono); letter-spacing: .12em; white-space: nowrap; }
@keyframes spin { to { transform: rotate(360deg); } }

.signal-strip { position: relative; border-block: 1px solid var(--line); overflow: hidden; }
.signal-track { display: flex; width: max-content; animation: marquee 32s linear infinite; }
.signal-track span { display: inline-flex; align-items: center; gap: 18px; min-height: 56px; padding: 0 32px; color: #949991; font: 10px/1 var(--mono); letter-spacing: .12em; text-transform: uppercase; }
.signal-track span::after { content: "✦"; color: var(--acid); font-size: 8px; }
@keyframes marquee { to { transform: translateX(-50%); } }

.why-grid { display: grid; grid-template-columns: repeat(4, 1fr); border-top: 1px solid var(--line); border-left: 1px solid var(--line); border-radius: var(--radius-lg); overflow: hidden; }
.why-card { min-height: 330px; padding: 30px; display: flex; flex-direction: column; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--surface) 72%, transparent); transition: background var(--transition-standard); }
.why-card:hover { background: var(--panel-2); }
.card-index { color: var(--acid); font: 10px/1 var(--mono); letter-spacing: .12em; }
.why-icon { width: 54px; height: 54px; display: grid; place-items: center; margin: 55px 0 28px; border: 1px solid var(--line-strong); color: var(--acid); font: 18px/1 var(--mono); }
.why-card h3 { margin: 0; font-size: 19px; font-weight: 560; letter-spacing: -.02em; }
.why-card p { margin: 14px 0 0; color: var(--muted); font-size: 14px; line-height: 1.7; }

.console-section { background: #090c0a; }
.console-intro { display: grid; grid-template-columns: .75fr 1.25fr; gap: 80px; align-items: center; }
.console-copy h2 { margin: 0; font-size: clamp(42px, 5vw, 70px); line-height: .98; letter-spacing: -.055em; font-weight: 530; }
.console-copy > p { margin: 25px 0 34px; color: var(--muted); font-size: 17px; line-height: 1.7; }
.console-list { display: grid; gap: 0; margin: 0 0 36px; padding: 0; list-style: none; border-top: 1px solid var(--line); }
.console-list li { display: flex; justify-content: space-between; gap: 20px; padding: 13px 0; border-bottom: 1px solid var(--line); color: #c1c4bc; font: 11px/1.4 var(--mono); text-transform: uppercase; letter-spacing: .06em; }
.console-list li span { color: var(--acid); }
.console-frame { border: 1px solid var(--line-strong); border-radius: var(--radius-lg); overflow: hidden; background: var(--background); box-shadow: var(--shadow-overlay); }
.console-top { min-height: 44px; display: flex; align-items: center; justify-content: space-between; padding: 0 15px; border-bottom: 1px solid var(--line); color: var(--faint); font: 9px/1 var(--mono); letter-spacing: .09em; text-transform: uppercase; }
.console-dots { display: flex; gap: 6px; }.console-dots i { width: 6px; height: 6px; border: 1px solid var(--faint); border-radius: 50%; }
.console-ui { min-height: 475px; display: grid; grid-template-columns: 128px 1fr; }
.console-side { padding: 17px 12px; border-right: 1px solid var(--line); }
.mini-brand { width: 27px; height: 27px; display: grid; place-items: center; margin-bottom: 28px; color: #081006; background: var(--acid); font: 800 9px/1 var(--mono); }
.mini-nav { display: grid; gap: 4px; }
.mini-nav span { padding: 9px 8px; color: #737870; font: 8px/1 var(--mono); text-transform: uppercase; }
.mini-nav span.active { color: var(--acid); background: rgba(201,243,107,.07); }
.console-main { padding: 25px; }
.console-title { display: flex; align-items: start; justify-content: space-between; gap: 15px; margin-bottom: 24px; }
.console-title small { color: var(--acid); font: 8px/1 var(--mono); letter-spacing: .1em; text-transform: uppercase; }
.console-title h3 { margin: 7px 0 0; font-size: 22px; font-weight: 500; }.live-pill { color: var(--acid); border: 1px solid rgba(201,243,107,.3); padding: 7px 9px; font: 8px/1 var(--mono); }
.console-metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.metric { min-height: 88px; padding: 13px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); }
.metric small { color: #6e736d; font: 8px/1 var(--mono); text-transform: uppercase; }.metric strong { display: block; margin-top: 14px; font: 500 19px/1 var(--mono); }.metric em { display: block; margin-top: 7px; color: var(--acid); font: normal 7px/1 var(--mono); }
.console-chart { position: relative; height: 138px; margin-top: 8px; padding: 14px; border: 1px solid var(--line); background-image: linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px); background-size: 28px 28px; overflow: hidden; }
.chart-line { position: absolute; inset: 42px 12px 22px; background: linear-gradient(135deg, transparent 0 10%, var(--acid) 10.5% 11%, transparent 11.5% 25%, var(--acid) 25.5% 26%, transparent 26.5% 38%, var(--acid) 38.5% 39%, transparent 39.5% 52%, var(--acid) 52.5% 53%, transparent 53.5% 67%, var(--acid) 67.5% 68%, transparent 68.5% 81%, var(--acid) 81.5% 82%, transparent 82.5%); opacity: .8; transform: skewY(-6deg); }
.console-table { margin-top: 8px; border: 1px solid var(--line); }
.console-row { display: grid; grid-template-columns: 1.2fr .8fr .7fr; gap: 10px; padding: 11px 12px; color: #878b84; font: 8px/1 var(--mono); border-bottom: 1px solid var(--line); }.console-row:last-child { border: 0; }.console-row.head { color: #555b54; text-transform: uppercase; }.console-row .ok { color: var(--acid); }
.preview-note { margin: 12px 0 0; color: var(--faint); font: 9px/1.5 var(--mono); text-align: right; }

.loop-grid { display: grid; grid-template-columns: repeat(5, 1fr); border: 1px solid var(--line); border-radius: var(--radius-lg); overflow: hidden; }
.loop-step { position: relative; min-height: 330px; padding: 27px; border-right: 1px solid var(--line); }
.loop-step:last-child { border-right: 0; }
.loop-step::after { content: "→"; position: absolute; z-index: 2; right: -14px; top: 50%; width: 28px; height: 28px; display: grid; place-items: center; translate: 0 -50%; color: var(--acid); background: var(--night); border: 1px solid var(--line-strong); font: 12px/1 var(--mono); }
.loop-step:last-child::after { display: none; }
.loop-number { color: var(--acid); font: 10px/1 var(--mono); }
.loop-symbol { display: block; margin: 70px 0 30px; color: #dce2d7; font: 300 32px/1 var(--mono); }
.loop-step h3 { margin: 0; font-size: 17px; font-weight: 550; }.loop-step p { margin: 13px 0 0; color: var(--muted); font-size: 13px; line-height: 1.65; }

.stack-grid { display: grid; grid-template-columns: repeat(2, 1fr); border: 1px solid var(--line); border-radius: var(--radius-lg); overflow: hidden; }
.stack-card { display: grid; grid-template-columns: 60px 1fr auto; gap: 24px; align-items: start; min-height: 160px; padding: 30px 28px; border-bottom: 1px solid var(--line); }
.stack-card:nth-child(odd) { border-right: 1px solid var(--line); }
.stack-no { color: var(--acid); font: 10px/1 var(--mono); }.stack-card h3 { margin: 0; font-size: 20px; font-weight: 540; }.stack-card p { margin: 12px 0 0; color: var(--muted); font-size: 13px; line-height: 1.65; }.stack-state { color: var(--faint); font: 9px/1 var(--mono); letter-spacing: .09em; text-transform: uppercase; }

.resource-section { background: linear-gradient(135deg, rgba(201,243,107,.045), transparent 45%), #0a0d0b; }
.resource-layout { display: grid; grid-template-columns: .82fr 1.18fr; align-items: center; gap: 90px; }
.resource-copy h2 { margin: 0; font-size: clamp(42px, 5.5vw, 74px); line-height: .97; letter-spacing: -.055em; font-weight: 520; }.resource-copy p { margin: 26px 0 0; max-width: 540px; color: var(--muted); font-size: 17px; line-height: 1.75; }
.resource-points { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 30px; }.resource-points span { padding: 9px 11px; border: 1px solid var(--line); color: #aeb3aa; font: 9px/1 var(--mono); text-transform: uppercase; letter-spacing: .05em; }
.resource-flow { display: grid; gap: 8px; }
.resource-node { position: relative; display: grid; grid-template-columns: 42px 1fr auto; align-items: center; gap: 15px; min-height: 65px; padding: 10px 18px; border: 1px solid var(--line); border-radius: var(--radius-md); background: color-mix(in srgb, var(--background) 75%, transparent); }
.resource-node:not(:last-child)::after { content: ""; position: absolute; z-index: 2; bottom: -9px; left: 38px; width: 1px; height: 9px; background: var(--acid); }.resource-node b { display: grid; place-items: center; width: 30px; height: 30px; color: var(--acid); border: 1px solid var(--line-strong); font: 9px/1 var(--mono); }.resource-node strong { font-size: 14px; font-weight: 520; }.resource-node small { color: var(--faint); font: 8px/1 var(--mono); text-transform: uppercase; }

.use-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
.use-card { position: relative; min-height: 360px; padding: 36px; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--panel); overflow: hidden; transition: border-color var(--transition-fast), background var(--transition-fast); }
.use-card::before { content: ""; position: absolute; width: 210px; height: 210px; right: -80px; bottom: -80px; border: 1px solid var(--line); border-radius: 50%; box-shadow: 0 0 0 38px rgba(201,243,107,.018), 0 0 0 76px rgba(201,243,107,.01); }.use-card:hover { border-color: rgba(201,243,107,.36); }.use-tag { color: var(--acid); font: 9px/1 var(--mono); letter-spacing: .11em; text-transform: uppercase; }.use-glyph { display: block; margin: 64px 0 42px; color: #bac2b6; font: 300 37px/1 var(--mono); }.use-card h3 { margin: 0; max-width: 440px; font-size: 27px; letter-spacing: -.035em; font-weight: 520; }.use-card p { max-width: 440px; margin: 15px 0 0; color: var(--muted); font-size: 14px; line-height: 1.7; }

.economy-line { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid var(--line); border-radius: var(--radius-lg); overflow: hidden; }
.economy-stage { position: relative; padding: 31px 28px 38px; border-right: 1px solid var(--line); }.economy-stage:last-child { border: 0; }.economy-stage::before { content: ""; position: absolute; top: -4px; left: 28px; width: 7px; height: 7px; background: var(--acid); border-radius: 50%; }.economy-stage small { color: var(--faint); font: 9px/1 var(--mono); }.economy-stage h3 { margin: 38px 0 0; font-size: 20px; font-weight: 530; }.economy-stage p { margin: 13px 0 0; color: var(--muted); font-size: 13px; line-height: 1.65; }

.developer-box { display: grid; grid-template-columns: .9fr 1.1fr; border: 1px solid var(--line-strong); border-radius: var(--radius-lg); overflow: hidden; background: var(--surface); }
.developer-copy { padding: 54px; border-right: 1px solid var(--line); }.developer-copy h2 { margin: 0; font-size: clamp(38px, 4.5vw, 62px); line-height: 1; letter-spacing: -.05em; font-weight: 520; }.developer-copy p { margin: 22px 0 32px; color: var(--muted); font-size: 16px; line-height: 1.7; }.developer-actions { display: flex; flex-wrap: wrap; gap: 10px; }
.terminal { padding: 28px; min-width: 0; }.terminal-top { display: flex; align-items: center; justify-content: space-between; padding-bottom: 18px; color: var(--faint); font: 9px/1 var(--mono); text-transform: uppercase; border-bottom: 1px solid var(--line); }.terminal pre { margin: 25px 0 0; overflow-x: auto; color: #b7bcb3; font: 12px/2 var(--mono); }.terminal .prompt { color: var(--acid); }.terminal .comment { color: #60665f; }

.final-cta { padding: 160px 0; text-align: center; background: radial-gradient(circle at 50% 60%, rgba(201,243,107,.09), transparent 28rem); }.final-cta h2 { max-width: 920px; margin: 0 auto; font-size: clamp(52px, 8vw, 104px); line-height: .92; letter-spacing: -.07em; font-weight: 520; }.final-cta p { max-width: 590px; margin: 30px auto 38px; color: var(--muted); font-size: 18px; line-height: 1.7; }.final-cta .hero-actions { justify-content: center; margin-top: 0; }

.footer { padding: 48px 0 30px; border-top: 1px solid var(--line); }.footer-grid { display: grid; grid-template-columns: 1.3fr repeat(3, .7fr); gap: 60px; }.footer-lead p { max-width: 350px; margin: 19px 0 0; color: var(--faint); font-size: 13px; line-height: 1.65; }.footer-col h3 { margin: 0 0 17px; color: #737970; font: 9px/1 var(--mono); letter-spacing: .1em; text-transform: uppercase; }.footer-col a { display: block; width: fit-content; margin-top: 11px; color: #b4b8b0; font-size: 13px; }.footer-col a:hover { color: var(--acid); }.footer-bottom { display: flex; justify-content: space-between; gap: 20px; margin-top: 58px; padding-top: 22px; border-top: 1px solid var(--line); color: var(--faint); font: 9px/1.5 var(--mono); letter-spacing: .06em; text-transform: uppercase; }

@media (max-width: 1050px) {
  .nav-links { display: none; }.mobile-menu { display: block; }
  .hero-grid { grid-template-columns: 1fr .65fr; gap: 35px; }
  .why-grid { grid-template-columns: repeat(2, 1fr); }
  .console-intro, .resource-layout { grid-template-columns: 1fr; gap: 55px; }
  .console-copy { max-width: 700px; }
  .loop-grid { grid-template-columns: repeat(5, minmax(185px, 1fr)); overflow-x: auto; }
  .loop-step { min-height: 300px; }
  .developer-box { grid-template-columns: 1fr; }.developer-copy { border-right: 0; border-bottom: 1px solid var(--line); }
}
@media (max-width: 760px) {
  .container { width: min(calc(100% - 32px), var(--max)); }
  .public-nav { height: 68px; }.brand-sub, .nav-github { display: none; }.nav-actions { gap: 8px; }.button.compact { padding: 0 12px; }
  .hero { min-height: auto; padding: 135px 0 82px; }.hero-grid { grid-template-columns: 1fr; }.hero h1 { font-size: clamp(52px, 17vw, 78px); }.runtime-orbit { max-width: 410px; margin: 35px auto 0; justify-self: center; }
  .section { padding: 90px 0; }.section-index { display: none; }.section-heading { margin-bottom: 42px; }.section-heading p { font-size: 16px; }
  .why-grid, .stack-grid, .use-grid, .economy-line, .footer-grid { grid-template-columns: 1fr; }.why-card { min-height: 275px; }.why-icon { margin: 40px 0 25px; }.stack-card:nth-child(odd), .economy-stage { border-right: 0; }.economy-stage:not(:last-child) { border-bottom: 1px solid var(--line); }
  .console-ui { grid-template-columns: 86px 1fr; }.console-main { padding: 15px; }.console-metrics { grid-template-columns: 1fr; }.metric:nth-child(n+2) { display: none; }.console-row { grid-template-columns: 1fr .7fr; }.console-row span:nth-child(2) { display: none; }
  .resource-copy p { font-size: 16px; }.use-card { min-height: 320px; padding: 28px; }
  .developer-copy { padding: 34px 27px; }.terminal { padding: 22px 18px; }.terminal pre { font-size: 10px; }
  .footer-grid { gap: 34px; }.footer-bottom { flex-direction: column; }.final-cta { padding: 110px 0; }
}
@media (max-width: 480px) {
  .brand-copy { display: none; }.hero-actions .button { width: 100%; }.runtime-orbit { transform: scale(.88); margin-inline: -6%; width: 112%; }.orbit-node { min-width: 100px; padding: 10px; }.console-ui { grid-template-columns: 1fr; }.console-side { display: none; }.console-main { min-width: 0; }.stack-card { grid-template-columns: 36px 1fr; }.stack-state { display: none; }.resource-node { grid-template-columns: 36px 1fr; }.resource-node small { display: none; }
}
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; } }
`;

export function renderPublicSiteHtml(nonce: string, options: PublicSiteOptions): string {
  const safeNonce = escapeHtml(nonce);
  const version = escapeHtml(options.version);
  const inspectorLink = options.showRuntimeInspector
    ? '<a href="/developers/runtime-inspector">Runtime inspector</a>'
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="description" content="Runtime 8 is application infrastructure for wallet-owned machines, resource coordination, telemetry, settlement, and verifiable receipts.">
<title>Runtime 8 · Infrastructure for the Machine Economy</title>
<style nonce="${safeNonce}">${STYLE}</style>
</head>
<body>
<div class="site-shell">
  <nav class="public-nav" aria-label="Public website">
    <div class="container nav-inner">
      <a class="brand" href="#home" aria-label="Runtime 8 home">
        <span class="brand-mark">R8</span>
        <span class="brand-copy"><span class="brand-name">Runtime 8</span><span class="brand-sub">Machine infrastructure</span></span>
      </a>
      <div class="nav-links">
        <a href="#home">Home</a><a href="#runtime">Runtime</a><a href="#resources">Resources</a><a href="#use-cases">Use Cases</a><a href="#developers">Developers</a>
      </div>
      <details class="mobile-menu">
        <summary aria-label="Open navigation"><span class="menu-lines" aria-hidden="true"></span></summary>
        <div class="mobile-panel"><a href="#home">Home <span>01</span></a><a href="#runtime">Runtime <span>02</span></a><a href="#resources">Resources <span>03</span></a><a href="#use-cases">Use Cases <span>04</span></a><a href="#developers">Developers <span>05</span></a><a href="${GITHUB_URL}" target="_blank" rel="noreferrer">GitHub <span>↗</span></a></div>
      </details>
      <div class="nav-actions">
        <a class="nav-github" href="${GITHUB_URL}" target="_blank" rel="noreferrer">GitHub ↗</a>
        <a class="button primary compact" href="/console">Launch Console <span class="arrow">↗</span></a>
      </div>
    </div>
  </nav>

  <main>
    <section class="hero" id="home">
      <div class="container hero-grid">
        <div>
          <div class="hero-label"><span></span> Runtime 8 · Application layer for autonomous machines</div>
          <h1>Infrastructure for the <em>machine economy.</em></h1>
          <p class="hero-copy">A production application layer where robots, drones, sensors, and edge hardware can establish identity, coordinate work, request resources, settle value, and leave verifiable records.</p>
          <div class="hero-actions">
            <a class="button primary" href="/console">Launch Machine Console <span class="arrow">↗</span></a>
            <a class="button" href="#runtime">View Runtime <span class="arrow">↓</span></a>
            <a class="button" href="#resources">Explore Resources <span class="arrow">↓</span></a>
          </div>
          <div class="hero-notes"><span>Non-custodial signing</span><span>Owner-scoped operations</span><span>Solana settlement</span></div>
        </div>
        <div class="runtime-orbit" aria-label="Runtime identity, resources, telemetry, and receipts diagram">
          <div class="orbit-ring"></div><div class="orbit-ring two"></div>
          <div class="orbit-core"><span>RUNTIME</span></div>
          <div class="orbit-node node-a"><small>Identity</small><strong>Wallet owned</strong></div>
          <div class="orbit-node node-b"><small>Resources</small><strong>Provider matched</strong></div>
          <div class="orbit-node node-c"><small>Settlement</small><strong>User signed</strong></div>
          <div class="orbit-node node-d"><small>Telemetry</small><strong>Machine sourced</strong></div>
          <div class="orbit-status">● APPLICATION CONTROL PLANE</div>
        </div>
      </div>
    </section>

    <div class="signal-strip" aria-hidden="true"><div class="signal-track">
      <span>Machine identity</span><span>Runtime sessions</span><span>Resource requests</span><span>Provider discovery</span><span>Live telemetry</span><span>Wallet settlement</span><span>Receipt evidence</span>
      <span>Machine identity</span><span>Runtime sessions</span><span>Resource requests</span><span>Provider discovery</span><span>Live telemetry</span><span>Wallet settlement</span><span>Receipt evidence</span>
    </div></div>

    <section class="section" id="why-now">
      <span class="section-index">01 / WHY NOW</span>
      <div class="container">
        <div class="section-heading"><p class="eyebrow">The coordination gap</p><h2>Machines are ready to do more than execute commands.</h2><p>Autonomous hardware increasingly chooses tasks, consumes services, and produces value. It needs economic infrastructure designed for identities that are neither people nor traditional servers.</p></div>
        <div class="why-grid">
          <article class="why-card"><span class="card-index">01</span><span class="why-icon">◇</span><h3>Economic agency</h3><p>Give every machine a durable, owner-controlled identity for participating in work and value flows.</p></article>
          <article class="why-card"><span class="card-index">02</span><span class="why-icon">⇄</span><h3>Resource exchange</h3><p>Coordinate access to compute, inference, data, charging, connectivity, and specialized services.</p></article>
          <article class="why-card"><span class="card-index">03</span><span class="why-icon">⌁</span><h3>Operational evidence</h3><p>Connect jobs and telemetry to receipts so operators can inspect what happened and when.</p></article>
          <article class="why-card"><span class="card-index">04</span><span class="why-icon">◎</span><h3>Programmatic settlement</h3><p>Move from approved work to user-reviewed, non-custodial payment and explicit confirmation states.</p></article>
        </div>
      </div>
    </section>

    <section class="section console-section" id="console-preview">
      <span class="section-index">02 / CONSOLE</span>
      <div class="container console-intro">
        <div class="console-copy">
          <p class="eyebrow">Machine Console</p><h2>One control plane for the runtime.</h2>
          <p>Connect an operator wallet to inspect owned machines, open runtime sessions, coordinate jobs and resources, watch telemetry, and complete settlements.</p>
          <ul class="console-list"><li>Machine registry <span>Owner scoped</span></li><li>Resource marketplace <span>Persistent</span></li><li>Telemetry delivery <span>Event driven</span></li><li>Settlement lifecycle <span>Explicit states</span></li></ul>
          <a class="button primary" href="/console">Launch Machine Console <span class="arrow">↗</span></a>
        </div>
        <div>
          <div class="console-frame" aria-label="Illustrative Machine Console preview">
            <div class="console-top"><div class="console-dots"><i></i><i></i><i></i></div><span>Runtime 8 / Console preview</span><span>v${version}</span></div>
            <div class="console-ui">
              <aside class="console-side"><div class="mini-brand">R8</div><div class="mini-nav"><span class="active">Overview</span><span>Machines</span><span>Resources</span><span>Jobs</span><span>Telemetry</span><span>Settlements</span></div></aside>
              <div class="console-main">
                <div class="console-title"><div><small>Operator workspace</small><h3>Network overview</h3></div><span class="live-pill">● CONNECTED</span></div>
                <div class="console-metrics"><div class="metric"><small>Machines</small><strong>OWNER SCOPE</strong><em>Identity verified</em></div><div class="metric"><small>Telemetry</small><strong>EVENT FLOW</strong><em>Freshness derived</em></div><div class="metric"><small>Settlement</small><strong>USER SIGNED</strong><em>Confirmation tracked</em></div></div>
                <div class="console-chart"><div class="chart-line"></div></div>
                <div class="console-table"><div class="console-row head"><span>Runtime module</span><span>Source</span><span>State</span></div><div class="console-row"><span>Machine telemetry</span><span>Credential</span><span class="ok">AUTHORIZED</span></div><div class="console-row"><span>Resource request</span><span>Wallet</span><span class="ok">PERSISTED</span></div><div class="console-row"><span>Settlement receipt</span><span>Chain</span><span class="ok">VERIFIED</span></div></div>
              </div>
            </div>
          </div>
          <p class="preview-note">Illustrative interface preview · the Console displays authenticated production records</p>
        </div>
      </div>
    </section>

    <section class="section" id="runtime">
      <span class="section-index">03 / RUNTIME LOOP</span>
      <div class="container">
        <div class="section-heading"><p class="eyebrow">Runtime loop</p><h2>From machine action to durable proof.</h2><p>The application joins runtime primitives and resource coordination into a clear operational lifecycle.</p></div>
        <div class="loop-grid">
          <article class="loop-step"><span class="loop-number">01</span><span class="loop-symbol">⌁</span><h3>Machine action</h3><p>Hardware performs work and submits an authenticated runtime event.</p></article>
          <article class="loop-step"><span class="loop-number">02</span><span class="loop-symbol">◇</span><h3>Runtime & policy</h3><p>Identity, capability, ownership, and operating context are evaluated.</p></article>
          <article class="loop-step"><span class="loop-number">03</span><span class="loop-symbol">⇄</span><h3>Resource request</h3><p>The application discovers compatible provider capabilities and persists a request.</p></article>
          <article class="loop-step"><span class="loop-number">04</span><span class="loop-symbol">◎</span><h3>Settlement</h3><p>A trusted transaction is prepared, reviewed, signed, submitted, and confirmed.</p></article>
          <article class="loop-step"><span class="loop-number">05</span><span class="loop-symbol">▣</span><h3>Receipt & proof</h3><p>Outcome references and settlement evidence become an auditable record.</p></article>
        </div>
      </div>
    </section>

    <section class="section" id="stack">
      <span class="section-index">04 / STACK</span>
      <div class="container">
        <div class="section-heading"><p class="eyebrow">Runtime stack</p><h2>Eight application modules. One operating layer.</h2><p>Runtime 8 combines public runtime interfaces with production application services for authentication, persistence, marketplace coordination, and live operations.</p></div>
        <div class="stack-grid">
          <article class="stack-card"><span class="stack-no">01</span><div><h3>Machine identity</h3><p>Wallet-owned machine records, roles, capabilities, and revocable machine credentials.</p></div><span class="stack-state">Application</span></article>
          <article class="stack-card"><span class="stack-no">02</span><div><h3>Runtime sessions</h3><p>Durable machine session records mapped to the runtime-8 session model.</p></div><span class="stack-state">Runtime</span></article>
          <article class="stack-card"><span class="stack-no">03</span><div><h3>Policy boundary</h3><p>Capability and ownership gates before machine and settlement operations proceed.</p></div><span class="stack-state">Runtime</span></article>
          <article class="stack-card"><span class="stack-no">04</span><div><h3>Resource layer</h3><p>Provider discovery, requests, quotes, grants, consumption records, and receipts.</p></div><span class="stack-state">Application</span></article>
          <article class="stack-card"><span class="stack-no">05</span><div><h3>Telemetry</h3><p>Credential-authenticated ingestion, retention, freshness, and live Console delivery.</p></div><span class="stack-state">Application</span></article>
          <article class="stack-card"><span class="stack-no">06</span><div><h3>Jobs</h3><p>Work-order lifecycle connected to owned machines and required capabilities.</p></div><span class="stack-state">Runtime</span></article>
          <article class="stack-card"><span class="stack-no">07</span><div><h3>Settlement</h3><p>Non-custodial transaction preparation with separate signing and confirmation states.</p></div><span class="stack-state">Solana</span></article>
          <article class="stack-card"><span class="stack-no">08</span><div><h3>Receipts & proof</h3><p>Evidence references and chain receipts linked back to authorized resource activity.</p></div><span class="stack-state">Runtime</span></article>
        </div>
      </div>
    </section>

    <section class="section resource-section" id="resources">
      <span class="section-index">05 / RESOURCE LAYER</span>
      <div class="container resource-layout">
        <div class="resource-copy"><p class="eyebrow">Resource economy</p><h2>Machines can acquire what the next task requires.</h2><p>The Resource Layer turns provider capabilities into an authorization-aware service lifecycle—from discovery and quoting through access, execution, settlement, and evidence.</p><div class="resource-points"><span>Compute</span><span>Inference</span><span>Weather</span><span>Charging</span><span>Navigation</span><span>Sensor data</span></div></div>
        <div class="resource-flow" aria-label="Resource request lifecycle">
          <div class="resource-node"><b>01</b><strong>Machine</strong><small>Authenticated identity</small></div><div class="resource-node"><b>02</b><strong>Resource request</strong><small>Need + constraints</small></div><div class="resource-node"><b>03</b><strong>Provider discovery</strong><small>Compatible capabilities</small></div><div class="resource-node"><b>04</b><strong>Quote and access</strong><small>Explicit grant</small></div><div class="resource-node"><b>05</b><strong>Runtime consumption</strong><small>Machine activity</small></div><div class="resource-node"><b>06</b><strong>Settlement</strong><small>Wallet reviewed</small></div><div class="resource-node"><b>07</b><strong>Resource receipt</strong><small>Recorded evidence</small></div>
        </div>
      </div>
    </section>

    <section class="section" id="use-cases">
      <span class="section-index">06 / USE CASES</span>
      <div class="container">
        <div class="section-heading"><p class="eyebrow">Built for physical systems</p><h2>Infrastructure for machines that work in the world.</h2></div>
        <div class="use-grid">
          <article class="use-card"><span class="use-tag">Fleet operations</span><span class="use-glyph">▦</span><h3>Autonomous robot fleets</h3><p>Coordinate warehouse and logistics machines across work orders, service access, runtime evidence, and settlement.</p></article>
          <article class="use-card"><span class="use-tag">Aerial networks</span><span class="use-glyph">⌁</span><h3>Drone operations</h3><p>Let mission systems acquire weather, navigation, compute, and charging resources with a traceable lifecycle.</p></article>
          <article class="use-card"><span class="use-tag">Edge infrastructure</span><span class="use-glyph">⌗</span><h3>DePIN hardware</h3><p>Give sensors and edge nodes a common application layer for providing or consuming resources.</p></article>
          <article class="use-card"><span class="use-tag">Embodied intelligence</span><span class="use-glyph">◇</span><h3>Physical AI agents</h3><p>Connect autonomous decisions to policy boundaries, external services, economic activity, and inspectable proof.</p></article>
        </div>
      </div>
    </section>

    <section class="section" id="economy">
      <span class="section-index">07 / NETWORK ECONOMY</span>
      <div class="container">
        <div class="section-heading"><p class="eyebrow">Runtime to economy</p><h2>Hardware becomes a network participant in four steps.</h2><p>A shared identity and state model lets isolated machines coordinate resources and form permissioned markets.</p></div>
        <div class="economy-line"><article class="economy-stage"><small>01 / FOUNDATION</small><h3>Machine identity</h3><p>An owner links hardware to a durable runtime identity and operating role.</p></article><article class="economy-stage"><small>02 / CONTEXT</small><h3>Machine state</h3><p>Sessions, jobs, and telemetry make current operating context inspectable.</p></article><article class="economy-stage"><small>03 / COORDINATION</small><h3>Machine resources</h3><p>Providers and requesters exchange authorized service access.</p></article><article class="economy-stage"><small>04 / NETWORK</small><h3>Machine markets</h3><p>Settlement and receipts allow repeatable economic coordination at network scale.</p></article></div>
      </div>
    </section>

    <section class="section" id="developers">
      <span class="section-index">08 / DEVELOPERS</span>
      <div class="container developer-box">
        <div class="developer-copy"><p class="eyebrow">Developer runtime</p><h2>Inspect the primitives. Build the application.</h2><p>The public TypeScript package exposes runtime interfaces for wallet-linked machine sessions, work lifecycle, telemetry normalization, unsigned intents, and receipt verification.</p><div class="developer-actions"><a class="button primary" href="${GITHUB_URL}" target="_blank" rel="noreferrer">View GitHub ↗</a><a class="button" href="${NPM_URL}" target="_blank" rel="noreferrer">npm package ↗</a></div></div>
        <div class="terminal"><div class="terminal-top"><span>Quick start</span><span>@machinefi/runtime · v${version}</span></div><pre><span class="comment"># Install the runtime SDK</span>
<span class="prompt">$</span> npm install @machinefi/runtime

<span class="comment"># Inspect deterministic fixture status</span>
<span class="prompt">$</span> npx machinefi status --chain solana --fixture

<span class="comment"># Explore authenticated application routes</span>
<span class="prompt">$</span> open /console</pre></div>
      </div>
    </section>

    <section class="section final-cta"><div class="container"><p class="eyebrow">Operator control plane</p><h2>Put autonomous machines into motion.</h2><p>Connect a Solana wallet, register a machine, and coordinate its runtime from a production-backed Console.</p><div class="hero-actions"><a class="button primary" href="/console">Launch Machine Console <span class="arrow">↗</span></a><a class="button" href="#developers">Explore the runtime <span class="arrow">↑</span></a></div></div></section>
  </main>

  <footer class="footer"><div class="container"><div class="footer-grid">
    <div class="footer-lead"><a class="brand" href="#home"><span class="brand-mark">R8</span><span class="brand-copy"><span class="brand-name">Runtime 8</span><span class="brand-sub">Machine infrastructure</span></span></a><p>Application infrastructure for owner-controlled machines, resource exchange, live operations, and verifiable economic records.</p></div>
    <div class="footer-col"><h3>Platform</h3><a href="#runtime">Runtime</a><a href="#resources">Resources</a><a href="#console-preview">Machine Console</a><a href="#use-cases">Use Cases</a></div>
    <div class="footer-col"><h3>Developers</h3><a href="${GITHUB_URL}" target="_blank" rel="noreferrer">GitHub</a><a href="${NPM_URL}" target="_blank" rel="noreferrer">npm</a><a href="/api">API routes</a>${inspectorLink}</div>
    <div class="footer-col"><h3>Application</h3><a href="/console">Launch Console</a><a href="/console/machines">Machines</a><a href="/console/resources">Marketplace</a><a href="/console/telemetry">Telemetry</a></div>
  </div><div class="footer-bottom"><span>© 2026 Runtime 8 · Open runtime interfaces, production application services</span><span>Production network identity is checked server-side</span></div></div></footer>
</div>
</body>
</html>`;
}
