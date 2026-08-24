import { describe, expect, it } from 'vitest';
import { renderConsoleDocument, routeFromPath } from '../src/console/server/handler.js';

describe('Machine Console route parsing', () => {
  it.each([
    ['/console', { section: 'overview' }],
    ['/console/resources', { section: 'resources' }],
    [
      '/console/resources/weather%3Acapability-1',
      { section: 'resources', detailId: 'weather:capability-1' },
    ],
    [
      '/console/machines/drone-9/runtime',
      { section: 'machines', detailId: 'drone-9', tab: 'runtime' },
    ],
    ['/console/telemetry', { section: 'telemetry' }],
    [
      '/console/machines/drone-9/telemetry',
      { section: 'machines', detailId: 'drone-9', tab: 'telemetry' },
    ],
    ['/console/jobs', { section: 'jobs' }],
    ['/console/jobs/wo-roof-scan-12', { section: 'jobs', detailId: 'wo-roof-scan-12' }],
    ['/console/settlements', { section: 'settlements' }],
    ['/console/receipts', { section: 'receipts' }],
  ] as const)('maps %s to the expected application route', (pathname, expected) => {
    expect(routeFromPath(pathname)).toEqual(expected);
  });

  it('defaults machine detail to overview and rejects unknown sections', () => {
    expect(routeFromPath('/console/machines/edge-3/')).toEqual({
      section: 'machines',
      detailId: 'edge-3',
      tab: 'overview',
    });
    expect(routeFromPath('/console/not-a-section')).toEqual({ section: 'not-found' });
    expect(routeFromPath('/console/jobs/wo-roof-scan-12/extra')).toEqual({ section: 'not-found' });
  });

  it('escapes decoded detail identifiers in the document title', () => {
    const document = renderConsoleDocument({
      pathname: '/console/jobs/%3Cimg%20src%3Dx%3E',
      nonce: 'console-test-nonce',
      version: 'test-version',
      liveReadEnabled: false,
    });
    expect(document).toContain('<title>&lt;img src=x&gt; · Jobs · Machine Console</title>');
    expect(document).not.toContain('<title><img');
  });
});

describe('Machine Console document rendering', () => {
  it('labels snapshot history as records and omits manufactured receipt verification', () => {
    const document = renderConsoleDocument({
      pathname: '/console/overview',
      nonce: 'console-test-nonce',
      version: 'test-version',
      liveReadEnabled: false,
    });
    expect(document).toContain('Work-order record created');
    expect(document).toContain('Work-order record last updated');
    expect(document).not.toContain('Job started ·');
    expect(document).not.toContain('Receipt verified');
  });

  it.each([
    ['/console/resources', 'Resources', 'Resource-layer capability boundary'],
    ['/console/resources/unregistered-resource', 'Resources', 'Resource unavailable'],
    ['/console/machines/drone-9/runtime', 'Machines', 'Runtime header'],
    ['/console/machines/edge-3/runtime', 'Machines', 'Latest telemetry observation is 18 minutes old'],
    ['/console/telemetry', 'Telemetry', 'Recent telemetry and runtime events'],
    ['/console/machines/drone-9/telemetry', 'Machines', 'Current readings'],
    ['/console/jobs', 'Jobs', 'Relationship coverage'],
    ['/console/jobs/wo-roof-scan-12', 'Jobs', 'Recorded timeline'],
    ['/console/settlements', 'Settlements', 'Settlement boundary'],
    ['/console/receipts', 'Receipts', 'Receipt evidence boundary'],
  ] as const)('renders a complete document for %s', (pathname, sectionLabel, marker) => {
    const document = renderConsoleDocument({
      pathname,
      nonce: 'console-test-nonce',
      version: 'test-version',
      liveReadEnabled: false,
    });

    expect(document).toMatch(/^<!doctype html>/);
    expect(document).toContain(`<title>`);
    expect(document).toContain(`${sectionLabel} · Machine Console`);
    expect(document).toContain('id="mc-main"');
    expect(document).toContain(marker);
    expect(document.match(/nonce="console-test-nonce"/g)).toHaveLength(3);
    expect(document).not.toContain('[object Object]');
  });
});
