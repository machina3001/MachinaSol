import type { TelemetryEventRecord } from '../../server/production/types.js';

/** A recent event must be observed and received inside this window to be live. */
export const TELEMETRY_LIVE_WINDOW_MS = 2 * 60_000;
/** Past this window, a machine is offline until a newer event is persisted. */
export const TELEMETRY_OFFLINE_WINDOW_MS = 15 * 60_000;
/** Small positive clock skew is tolerated by ingestion and by the Console. */
export const TELEMETRY_FUTURE_TOLERANCE_MS = 2 * 60_000;

export type TelemetryFreshness = 'LIVE' | 'DELAYED' | 'OFFLINE' | 'UNKNOWN';

const timestamp = (value: string): number | null => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Classify connection freshness from persisted event time, device observation
 * time, and server render time. Health is deliberately rendered separately;
 * only an explicit device `offline` report overrides the timestamp state.
 */
export function classifyTelemetryFreshness(
  event: TelemetryEventRecord | null | undefined,
  renderTime: Date | number
): TelemetryFreshness {
  if (!event) return 'UNKNOWN';
  const now = typeof renderTime === 'number' ? renderTime : renderTime.getTime();
  const observed = timestamp(event.snapshot.observedAt);
  const received = timestamp(event.receivedAt);
  if (!Number.isFinite(now) || observed === null || received === null) return 'UNKNOWN';

  const observedAge = now - observed;
  const receivedAge = now - received;
  if (observedAge < -TELEMETRY_FUTURE_TOLERANCE_MS || receivedAge < -TELEMETRY_FUTURE_TOLERANCE_MS) {
    return 'UNKNOWN';
  }
  if (event.snapshot.health === 'offline') return 'OFFLINE';
  if (observedAge > TELEMETRY_OFFLINE_WINDOW_MS || receivedAge > TELEMETRY_OFFLINE_WINDOW_MS) {
    return 'OFFLINE';
  }

  const deliveryDelay = received - observed;
  if (
    observedAge <= TELEMETRY_LIVE_WINDOW_MS &&
    receivedAge <= TELEMETRY_LIVE_WINDOW_MS &&
    deliveryDelay <= TELEMETRY_LIVE_WINDOW_MS
  ) {
    return 'LIVE';
  }
  return 'DELAYED';
}

/** Select one durable, most recently received event for each machine. */
export function latestTelemetryByMachine(
  events: readonly TelemetryEventRecord[]
): ReadonlyMap<string, TelemetryEventRecord> {
  const latest = new Map<string, TelemetryEventRecord>();
  for (const event of events) {
    const current = latest.get(event.machineId);
    if (!current) {
      latest.set(event.machineId, event);
      continue;
    }
    const candidateTime = timestamp(event.receivedAt);
    const currentTime = timestamp(current.receivedAt);
    if (candidateTime !== null && (currentTime === null || candidateTime > currentTime)) {
      latest.set(event.machineId, event);
    }
  }
  return latest;
}
