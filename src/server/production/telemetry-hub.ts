import type { ServerResponse } from 'node:http';
import type { TelemetryEventRecord } from './types.js';

interface Subscriber {
  userId: string;
  machineIds: ReadonlySet<string>;
  response: ServerResponse;
  heartbeat: NodeJS.Timeout;
}

export const MAX_TELEMETRY_SUBSCRIBERS = 256;
export const MAX_TELEMETRY_SUBSCRIBERS_PER_USER = 8;

/** Process-local fanout backed by durable PostgreSQL event storage. */
export class TelemetryHub {
  private readonly subscribers = new Set<Subscriber>();

  private remove(subscriber: Subscriber, destroy = false): void {
    clearInterval(subscriber.heartbeat);
    this.subscribers.delete(subscriber);
    if (destroy && !subscriber.response.destroyed) subscriber.response.destroy();
  }

  canSubscribe(userId: string): boolean {
    if (this.subscribers.size >= MAX_TELEMETRY_SUBSCRIBERS) return false;
    let owned = 0;
    for (const subscriber of this.subscribers) {
      if (subscriber.userId === userId) owned += 1;
      if (owned >= MAX_TELEMETRY_SUBSCRIBERS_PER_USER) return false;
    }
    return true;
  }

  subscribe(userId: string, machineIds: readonly string[], response: ServerResponse): () => void {
    if (!this.canSubscribe(userId)) throw new RangeError('telemetry subscriber limit reached');
    let subscriber: Subscriber;
    const heartbeat = setInterval(() => {
      if (response.destroyed || !response.write(': keepalive\n\n')) this.remove(subscriber, true);
    }, 20_000);
    subscriber = {
      userId,
      machineIds: new Set(machineIds),
      response,
      heartbeat,
    };
    subscriber.heartbeat.unref();
    this.subscribers.add(subscriber);
    return () => {
      this.remove(subscriber);
    };
  }

  publish(ownerUserId: string, event: TelemetryEventRecord): void {
    const data = JSON.stringify(event).replace(/[\u2028\u2029]/gu, '');
    for (const subscriber of [...this.subscribers]) {
      if (subscriber.userId !== ownerUserId || !subscriber.machineIds.has(event.machineId)) continue;
      if (subscriber.response.destroyed || !subscriber.response.write(`event: telemetry\ndata: ${data}\n\n`)) {
        // SSE carries latest-state notifications and has no unbounded queue.
        // A durable reconciliation endpoint lets a reconnected client catch up.
        this.remove(subscriber, true);
      }
    }
  }

  /** Close live streams when an operator logs out or loses authorization. */
  disconnectUser(userId: string): void {
    for (const subscriber of [...this.subscribers]) {
      if (subscriber.userId !== userId) continue;
      this.remove(subscriber);
      subscriber.response.end();
    }
  }

  close(): void {
    for (const subscriber of this.subscribers) {
      this.remove(subscriber);
      subscriber.response.end();
    }
    this.subscribers.clear();
  }
}
