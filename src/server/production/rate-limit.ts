import { HttpError } from '../http.js';

interface Bucket { count: number; resetAt: number; }

/** Small bounded fixed-window limiter for a single server process. */
export class RequestRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000
  ) {}

  assert(key: string, now = Date.now()): void {
    const current = this.buckets.get(key);
    if (!current || current.resetAt <= now) {
      if (this.buckets.size >= this.maxKeys) this.prune(now);
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return;
    }
    current.count += 1;
    if (current.count > this.limit) throw new HttpError(429, 'request rate limit exceeded; retry later');
  }

  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
      if (this.buckets.size < this.maxKeys) return;
    }
    const oldest = this.buckets.keys().next().value as string | undefined;
    if (oldest !== undefined) this.buckets.delete(oldest);
  }
}
