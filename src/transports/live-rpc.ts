export interface JsonRpcRequest { jsonrpc: '2.0'; id: number; method: string; params: unknown[]; }
export interface RpcTransport { request<T>(method: string, params?: unknown[]): Promise<T>; }
interface JsonRpcError { code?: number; message?: string; data?: unknown; }
interface JsonRpcResponse<T> { result?: T; error?: JsonRpcError; }

/** Caps decompressed provider data retained by one request. */
export const MAX_RPC_RESPONSE_BYTES = 1024 * 1024;
/** Caps in-flight outbound calls across all transport instances in this process. */
export const MAX_CONCURRENT_RPC_REQUESTS = 8;

let activeRpcRequests = 0;

function acquireRpcSlot(): void {
  if (activeRpcRequests >= MAX_CONCURRENT_RPC_REQUESTS) {
    throw new Error(`RPC concurrency limit of ${MAX_CONCURRENT_RPC_REQUESTS} reached`);
  }
  activeRpcRequests += 1;
}

function releaseRpcSlot(): void {
  activeRpcRequests = Math.max(0, activeRpcRequests - 1);
}

async function readBoundedBody(response: Response, controller: AbortController): Promise<string> {
  const announcedLength = response.headers.get('content-length');
  if (announcedLength !== null && /^\d+$/.test(announcedLength)) {
    const bytes = Number(announcedLength);
    if (bytes > MAX_RPC_RESPONSE_BYTES) {
      controller.abort();
      throw new Error(`RPC response exceeds ${MAX_RPC_RESPONSE_BYTES} bytes`);
    }
  }
  if (response.body === null) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > MAX_RPC_RESPONSE_BYTES) {
      controller.abort();
      void reader.cancel();
      throw new Error(`RPC response exceeds ${MAX_RPC_RESPONSE_BYTES} bytes`);
    }
    chunks.push(chunk.value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

export class LiveRpcTransport implements RpcTransport {
  constructor(readonly rpcUrl: string, readonly timeoutMs = 12000) {}
  async request<T>(method: string, params: unknown[] = []): Promise<T> {
    acquireRpcSlot();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params } satisfies JsonRpcRequest),
        signal: controller.signal,
        redirect: 'manual',
      });
      if (res.status >= 300 && res.status < 400) {
        throw new Error(`RPC redirects are not allowed (status ${res.status})`);
      }
      const text = await readBoundedBody(res, controller);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error('malformed JSON-RPC response');
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('malformed JSON-RPC response');
      }
      const body = parsed as JsonRpcResponse<T>;
      if (!res.ok || body.error) throw new Error(body.error?.message ?? `RPC ${res.status}`);
      if (!('result' in body)) throw new Error('malformed JSON-RPC response');
      return body.result as T;
    } finally {
      clearTimeout(timer);
      releaseRpcSlot();
    }
  }
}
