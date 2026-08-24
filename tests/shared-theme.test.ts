import { describe, expect, it } from 'vitest';
import { stylesheet } from '../src/console/design/stylesheet.js';
import { color, font, radius } from '../src/console/design/tokens.js';
import { renderConsoleDocument } from '../src/console/server/handler.js';
import { sharedTheme, sharedThemeCssVars } from '../src/design/theme.js';
import { renderPublicSiteHtml } from '../src/server/public-site.js';

describe('shared Machina design language', () => {
  it('maps the Console token API to the shared semantic source', () => {
    expect(color.ground).toBe(sharedTheme.color.background);
    expect(color.surface).toBe(sharedTheme.color.surface);
    expect(color.accent).toBe(sharedTheme.color.accent);
    expect(color.textPrimary).toBe(sharedTheme.color.foreground);
    expect(color.statusOnline).toBe(sharedTheme.color.success);
    expect(font).toEqual(sharedTheme.font);
    expect(radius).toEqual(sharedTheme.radius);

    const css = stylesheet();
    expect(css).toContain(`--mc-accent: ${sharedTheme.color.accent}`);
    expect(css).toContain(`--mc-ground: ${sharedTheme.color.background}`);
    expect(css).toContain('color: var(--mc-accent-fg)');
    expect(css).not.toContain('#7c6cff');
    expect(css).not.toContain('#c78a2a');
  });

  it('emits the same semantic variables and Machina identity in both renderers', () => {
    const publicHtml = renderPublicSiteHtml('nonce', { version: '0.9.4', showRuntimeInspector: false });
    const consoleHtml = renderConsoleDocument({
      pathname: '/console',
      nonce: 'nonce',
      version: '0.9.4',
      liveReadEnabled: false,
      bindHost: '127.0.0.1',
    });

    expect(sharedThemeCssVars()).toContain(`--background: ${sharedTheme.color.background}`);
    expect(publicHtml).toContain(`--accent: ${sharedTheme.color.accent}`);
    expect(publicHtml).toContain('class="brand-mark">M</span>');
    expect(consoleHtml).toContain('<span aria-hidden="true">M</span>');
    expect(consoleHtml).toContain(`--mc-accent: ${sharedTheme.color.accent}`);
  });
});
