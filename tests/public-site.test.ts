import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createRuntimeServer } from '../src/server/index.js';
import { renderPublicSiteHtml } from '../src/server/public-site.js';

let server: Server | undefined;

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  server = undefined;
});

const listen = async (): Promise<string> => {
  server = createRuntimeServer({ host: '127.0.0.1', port: 0, allowLive: false });
  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(0, '127.0.0.1', () => resolve());
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

describe('public website separation', () => {
  it('renders every requested public section with original Runtime 8 branding', () => {
    const html = renderPublicSiteHtml('nonce', { version: '0.9.4', showRuntimeInspector: true });

    for (const section of [
      'id="home"',
      'id="why-now"',
      'id="console-preview"',
      'id="runtime"',
      'id="stack"',
      'id="resources"',
      'id="use-cases"',
      'id="economy"',
      'id="developers"',
    ]) expect(html).toContain(section);

    expect(html).toContain('Runtime 8');
    expect(html).toContain('href="/console"');
    expect(html).toContain('Launch Machine Console');
    expect(html).toContain('https://github.com/Machine-Fi/runtime-8');
    expect(html).toContain('/developers/runtime-inspector');
    expect(html).toContain('class="mobile-menu"');
    expect(html).toContain('aria-label="Open navigation"');
    expect(html).not.toContain('mc-sidebar');
    expect(html).not.toContain('MachineFi for autonomous robots');
  });

  it('serves the public site at root and preserves Console and inspector routes', async () => {
    const base = await listen();
    const root = await fetch(`${base}/`, { redirect: 'manual' });
    const rootHtml = await root.text();

    expect(root.status).toBe(200);
    expect(root.headers.get('location')).toBeNull();
    expect(rootHtml).toContain('Infrastructure for the');
    expect(rootHtml).toContain('aria-label="Public website"');
    expect(rootHtml).not.toContain('mc-sidebar');

    const consolePage = await fetch(`${base}/console`);
    const consoleHtml = await consolePage.text();
    expect(consolePage.status).toBe(200);
    expect(consoleHtml).toContain('Machine Console');
    expect(consoleHtml).not.toContain('aria-label="Public website"');

    const inspector = await fetch(`${base}/developers/runtime-inspector`);
    expect(inspector.status).toBe(200);
    expect(await inspector.text()).toContain('Runtime visibility for every');
  });
});
