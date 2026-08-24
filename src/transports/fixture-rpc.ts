import type { RpcTransport } from './live-rpc.js';
export class FixtureRpcTransport implements RpcTransport {
  constructor(private readonly responses: Record<string, unknown>, private readonly failMethod?: string) {}
  async request<T>(method: string): Promise<T> {
    if (this.failMethod === method) throw new Error(`fixture RPC failure for ${method}`);
    if (!(method in this.responses)) throw new Error(`fixture response missing for ${method}`);
    return this.responses[method] as T;
  }
}
