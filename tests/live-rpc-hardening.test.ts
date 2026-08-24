import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveServerConfig } from '../src/server/config.js';
import { createRuntimeServer } from '../src/server/index.js';
import {
  LiveRpcTransport,
  MAX_CONCURRENT_RPC_REQUESTS,
  MAX_RPC_RESPONSE_BYTES,
} from '../src/transports/live-rpc.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const listen = async (server: Server): Promise<string> => {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
};

const close = async (server: Server): Promise<void> => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
};

describe('operator-owned HTTP live-read configuration', () => {
  it('requires a validated operator endpoint and rejects wildcard binds', () => {
    const config = resolveServerConfig({}, [
      '--allow-live',
      '--rpc-url',
      'https://rpc.example.invalid/path?token=secret',
    ]);
    expect(config).toMatchObject({
      host: '127.0.0.1',
      allowLive: true,
      liveRpcUrl: 'https://rpc.example.invalid/path?token=secret',
    });

    expect(() => resolveServerConfig({}, ['--allow-live'])).toThrow(/operator-configured Solana endpoint/);
    expect(() => resolveServerConfig({}, ['--host', '0.0.0.0'])).toThrow(/wildcard bind/);
    expect(() => resolveServerConfig({}, ['--host', '::'])).toThrow(/wildcard bind/);
    expect(() => resolveServerConfig({}, ['--allow-live', '--rpc-url', 'file:///tmp/rpc'])).toThrow(
      /must use http or https/
    );
    expect(() =>
      createRuntimeServer({ host: '127.0.0.1', port: 0, allowLive: true })
    ).toThrow(/operator-configured Solana endpoint/);

    const managedProduction = resolveServerConfig({
      MACHINEFI_DATA_MODE: 'production',
      MACHINEFI_HOST: '0.0.0.0',
      MACHINEFI_ALLOW_PUBLIC_BIND: 'true',
      MACHINEFI_DATABASE_URL: 'postgresql://user:password@db.example/app?sslmode=require',
      MACHINEFI_ALLOW_LIVE: 'true',
      MACHINEFI_SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com',
      MACHINEFI_SOLANA_CLUSTER: 'mainnet-beta',
      MACHINEFI_PUBLIC_ORIGIN: 'https://machinasol.xyz',
      MACHINEFI_SECURE_COOKIES: 'true',
      RENDER_EXTERNAL_HOSTNAME: 'machinasol.onrender.com',
    }, []);
    expect(managedProduction).toMatchObject({
      host: '0.0.0.0',
      allowPublicBind: true,
      platformHostname: 'machinasol.onrender.com',
    });
  });

  it('uses only the configured endpoint, rejects request overrides, and hides its value', async () => {
    let rpcCalls = 0;
    const rpcServer = createHttpServer((req, res) => {
      rpcCalls += 1;
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { 'solana-core': '1.18.0' } }));
      });
    });
    const rpcBaseUrl = await listen(rpcServer);
    const secretRpcUrl = `${rpcBaseUrl}/rpc?token=never-render-this`;
    const runtimeServer = createRuntimeServer({
      host: '127.0.0.1',
      port: 0,
      allowLive: true,
      liveRpcUrl: secretRpcUrl,
    });
    const runtimeBaseUrl = await listen(runtimeServer);

    try {
      const statusResponse = await fetch(`${runtimeBaseUrl}/api/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fixture: false }),
      });
      expect(statusResponse.status).toBe(200);
      expect(await statusResponse.json()).toMatchObject({ rpcReachable: true });
      expect(rpcCalls).toBe(1);

      const overrideResponse = await fetch(`${runtimeBaseUrl}/api/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fixture: false, rpcUrl: 'http://127.0.0.1:1/private' }),
      });
      expect(overrideResponse.status).toBe(400);
      expect(await overrideResponse.json()).toMatchObject({
        ok: false,
        error: { detail: expect.stringContaining('not accepted by the HTTP API') },
      });
      expect(rpcCalls).toBe(1);

      for (const path of ['/', '/console/settings', '/api/health']) {
        const rendered = await (await fetch(`${runtimeBaseUrl}${path}`)).text();
        expect(rendered).not.toContain('never-render-this');
        expect(rendered).not.toContain(secretRpcUrl);
      }
    } finally {
      await close(runtimeServer);
      await close(rpcServer);
    }
  });
});

describe.sequential('LiveRpcTransport outbound limits', () => {
  it('does not follow provider redirects', async () => {
    let redirectMode: RequestRedirect | undefined;
    globalThis.fetch = (async (_input, init) => {
      redirectMode = init?.redirect;
      return new Response('', { status: 302, headers: { location: 'http://127.0.0.1/private' } });
    }) as typeof fetch;

    await expect(new LiveRpcTransport('https://rpc.example.invalid').request('getVersion')).rejects.toThrow(
      /redirects are not allowed/
    );
    expect(redirectMode).toBe('manual');
  });

  it('rejects a provider body over the decompressed response cap', async () => {
    globalThis.fetch = (async () =>
      new Response('x'.repeat(MAX_RPC_RESPONSE_BYTES + 1), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;

    await expect(new LiveRpcTransport('https://rpc.example.invalid').request('getVersion')).rejects.toThrow(
      new RegExp(`exceeds ${MAX_RPC_RESPONSE_BYTES} bytes`)
    );
  });

  it('rejects calls above the process-wide outbound concurrency cap', async () => {
    const releases: Array<() => void> = [];
    globalThis.fetch = ((_input: string | URL | Request) =>
      new Promise<Response>((resolve) => {
        releases.push(() =>
          resolve(
            new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            })
          )
        );
      })) as typeof fetch;

    const transport = new LiveRpcTransport('https://rpc.example.invalid', 2_000);
    const inFlight = Array.from({ length: MAX_CONCURRENT_RPC_REQUESTS }, () =>
      transport.request<{ ok: boolean }>('getVersion')
    );
    expect(releases).toHaveLength(MAX_CONCURRENT_RPC_REQUESTS);
    await expect(transport.request('getVersion')).rejects.toThrow(
      new RegExp(`concurrency limit of ${MAX_CONCURRENT_RPC_REQUESTS}`)
    );

    for (const release of releases) release();
    await expect(Promise.all(inFlight)).resolves.toEqual(
      Array.from({ length: MAX_CONCURRENT_RPC_REQUESTS }, () => ({ ok: true }))
    );
  });
});
