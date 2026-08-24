import type { ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_TELEMETRY_SUBSCRIBERS_PER_USER,
  TelemetryHub,
} from '../src/server/production/telemetry-hub.js';

const event = {
  id: 'telemetry-1',
  machineId: 'machine-1',
  receivedAt: '2026-08-24T00:00:00.000Z',
  snapshot: {
    machineId: 'machine-1',
    observedAt: '2026-08-24T00:00:00.000Z',
    health: 'nominal' as const,
  },
};

function response(writeResult: boolean): {
  response: ServerResponse;
  write: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
} {
  let destroyed = false;
  const write = vi.fn(() => writeResult);
  const destroy = vi.fn(() => { destroyed = true; });
  const value = {
    get destroyed() { return destroyed; },
    write,
    destroy,
    end: vi.fn(() => { destroyed = true; }),
  } as unknown as ServerResponse;
  return { response: value, write, destroy };
}

describe('production telemetry SSE fanout', () => {
  it('disconnects a slow subscriber instead of accumulating an unbounded response buffer', () => {
    const hub = new TelemetryHub();
    const slow = response(false);
    hub.subscribe('owner-1', ['machine-1'], slow.response);

    hub.publish('owner-1', event);

    expect(slow.write).toHaveBeenCalledOnce();
    expect(slow.destroy).toHaveBeenCalledOnce();
    expect(hub.canSubscribe('owner-1')).toBe(true);
    hub.close();
  });

  it('enforces the per-user subscriber bound and releases slots on unsubscribe', () => {
    const hub = new TelemetryHub();
    const unsubscribe: Array<() => void> = [];
    for (let index = 0; index < MAX_TELEMETRY_SUBSCRIBERS_PER_USER; index += 1) {
      unsubscribe.push(hub.subscribe('owner-1', ['machine-1'], response(true).response));
    }
    expect(hub.canSubscribe('owner-1')).toBe(false);
    unsubscribe[0]!();
    expect(hub.canSubscribe('owner-1')).toBe(true);
    hub.close();
  });
});
