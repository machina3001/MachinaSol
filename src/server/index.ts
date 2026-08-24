#!/usr/bin/env node
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { assertSafeServerConfig, isLoopbackHost, resolveServerConfig, type ServerConfig } from './config.js';
import {
  HttpError,
  assertHostAllowed,
  assertOriginAllowed,
  readJsonBody,
  sendHtml,
  sendJson,
  sendNoContent
} from './http.js';
import { READ_ROUTES, ROUTE_INDEX, RUNTIME_ROUTES, RUNTIME_VERSION, type Params } from './api.js';
import { renderIndexHtml } from './ui.js';
import { renderPublicSiteHtml } from './public-site.js';
import { isConsolePath, renderConsoleDocument, routeFromPath } from '../console/server/handler.js';
import { renderProductionConsoleDocument } from '../console/server/production-console.js';
import { handleProductionRequest } from './production/app.js';
import { createProductionRuntime, type ProductionRuntime } from './production/runtime.js';

const queryParams = (url: URL): Params => {
  const params: Params = {};
  for (const [key, value] of url.searchParams) params[key] = value;
  return params;
};

async function route(req: IncomingMessage, res: ServerResponse, config: ServerConfig, production?: ProductionRuntime): Promise<void> {
  assertHostAllowed(req, config);

  const method = req.method ?? 'GET';
  const host = req.headers.host ?? `${config.host}:${config.port}`;
  const url = new URL(req.url ?? '/', `http://${host}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const headOnly = method === 'HEAD';
  const isRead = method === 'GET' || headOnly;

  if (method === 'OPTIONS') {
    res.writeHead(204, { allow: 'GET, HEAD, POST, PATCH, OPTIONS', 'content-length': 0 });
    res.end();
    return;
  }

  if (path === '/' || path === '/index.html') {
    if (!isRead) throw new HttpError(405, `${method} is not allowed on ${path}`);
    const nonce = randomBytes(16).toString('hex');
    const html = renderPublicSiteHtml(nonce, {
      version: RUNTIME_VERSION,
      showRuntimeInspector: (config.dataMode ?? 'fixture') !== 'production',
    });
    if (headOnly) {
      sendNoContent(res, 200);
      return;
    }
    sendHtml(res, 200, html, nonce);
    return;
  }

  // The original fixture SDK inspector remains available for developers, but
  // it is no longer the public product homepage or part of the production UI.
  if (path === '/developers/runtime-inspector' && (config.dataMode ?? 'fixture') !== 'production') {
    if (!isRead) throw new HttpError(405, `${method} is not allowed on ${path}`);
    const nonce = randomBytes(16).toString('hex');
    const html = renderIndexHtml(nonce, {
      version: RUNTIME_VERSION,
      liveReadEnabled: config.allowLive,
      baseUrl: `http://${host}`
    });
    if (headOnly) {
      sendNoContent(res, 200);
      return;
    }
    sendHtml(res, 200, html, nonce);
    return;
  }

  // Machine Console feature. Self-contained under /console; reuses this
  // server's response helpers and CSP without altering the routes above.
  if (isConsolePath(path)) {
    if (!isRead) throw new HttpError(405, `${method} is not allowed on ${path}`);
    if ((config.dataMode ?? 'fixture') === 'production') {
      if (!production) throw new HttpError(503, 'production runtime is not initialized');
      const nonce = randomBytes(16).toString('hex');
      const rendered = await renderProductionConsoleDocument({
        req,
        pathname: path,
        nonce,
        version: RUNTIME_VERSION,
        config,
        runtime: production,
      });
      if (headOnly) {
        sendNoContent(res, rendered.status);
        return;
      }
      sendHtml(res, rendered.status, rendered.html, nonce);
      return;
    }
    const consoleStatus = routeFromPath(path).section === 'not-found' ? 404 : 200;
    const nonce = randomBytes(16).toString('hex');
    const html = renderConsoleDocument({
      pathname: path,
      nonce,
      version: RUNTIME_VERSION,
      liveReadEnabled: config.allowLive,
      bindHost: config.host,
    });
    if (headOnly) {
      sendNoContent(res, consoleStatus);
      return;
    }
    sendHtml(res, consoleStatus, html, nonce);
    return;
  }

  if (path === '/favicon.ico') {
    sendNoContent(res, 204);
    return;
  }

  if (production && await handleProductionRequest(req, res, path, config, production)) return;

  if ((config.dataMode ?? 'fixture') === 'production' && path === '/api' && isRead) {
    sendJson(res, 200, {
      service: 'Machina production application',
      authentication: 'Solana wallet message challenge + HttpOnly session + CSRF',
      endpoints: {
        'POST /api/auth/challenge': 'issue a single-use domain-bound wallet challenge',
        'POST /api/auth/verify': 'verify Ed25519 signature and establish an opaque session',
        'GET /api/auth/session': 'inspect the authenticated session',
        'POST /api/auth/logout': 'revoke the current session',
        'GET /api/production/network': 'read the startup-verified Solana cluster and genesis identity',
        'GET|POST /api/machines': 'list or register wallet-owned machines',
        'GET|POST /api/machines/:id/credentials': 'list metadata or provision a revocable telemetry:write machine credential',
        'POST /api/machine-credentials/:id/revoke': 'revoke an owned machine credential',
        'GET|POST /api/machines/:id/capabilities': 'read or replace owned machine capabilities',
        'GET|POST /api/machines/:id/telemetry': 'read owned or ingest credential-authenticated telemetry',
        'GET|POST /api/runtime/sessions': 'list or create durable runtime sessions',
        'POST /api/runtime/sessions/:id/end': 'end an owned active runtime session',
        'GET|POST /api/work-orders': 'list or create durable machine work orders',
        'GET /api/telemetry': 'bounded owner-scoped telemetry history or latest-per-machine reconciliation',
        'GET /api/telemetry/stream': 'ownership-filtered live SSE telemetry',
        'GET /api/marketplace/providers': 'discover available providers using resource, rail, and price filters',
        'GET|POST /api/marketplace/capabilities': 'persistent provider capability registry',
        'GET|PATCH /api/marketplace/capabilities/:id': 'read or owner-safely update a provider capability',
        'GET|POST /api/marketplace/requests': 'owned persistent resource requests',
        'GET /api/marketplace/provider/requests': 'provider-authorized request inbox',
        'GET /api/marketplace/requests/:id': 'authorized request, quote, grant, and receipt detail',
        'POST /api/marketplace/requests/:id/cancel': 'requester cancellation of a pending or quoted request',
        'POST /api/marketplace/requests/:id/reject': 'selected-provider rejection of a targeted request',
        'GET /api/marketplace/requests/:id/compatible-providers': 'discover compatible available providers',
        'POST /api/marketplace/requests/:id/select-provider': 'select a compatible provider capability',
        'GET|POST /api/marketplace/requests/:id/quotes': 'list authorized quotes or create a provider quote',
        'POST /api/marketplace/quotes/:id/withdraw': 'provider withdrawal of an offered quote',
        'POST /api/marketplace/requests/:id/quotes/:quoteId/accept': 'accept a selected persisted quote',
        'GET|POST /api/marketplace/requests/:id/grant': 'read or create a provider access grant',
        'POST /api/marketplace/grants/:id/:action': 'activate, revoke, or expire a provider grant',
        'GET|POST /api/marketplace/requests/:id/receipt': 'read or record a resource receipt',
        'POST /api/marketplace/receipts/:id/:action': 'requester verification or rejection of a receipt',
        'GET|POST /api/settlements': 'list settlements or derive/resume one from an accepted persisted quote',
        'GET /api/settlements/:id': 'read an owned settlement state',
        'POST /api/settlements/:id/prepare': 'construct an unsigned Solana transaction',
        'POST /api/settlements/:id/submit': 'validate and submit a caller-wallet signed transaction',
        'POST /api/settlements/:id/confirm': 'separately verify confirmation or on-chain failure',
        'POST /api/settlements/:id/cancel': 'cancel an unsubmitted wallet signing flow',
      },
    }, headOnly);
    return;
  }

  if ((config.dataMode ?? 'fixture') === 'production' && path.startsWith('/api/')) {
    if (path === '/api/health' && isRead) {
      sendJson(res, 200, {
        ok: true,
        name: 'Machina',
        version: RUNTIME_VERSION,
        mode: 'production',
        authenticatedApplication: true,
        solanaNetworkVerified: true,
      }, headOnly);
      return;
    }
    throw new HttpError(404, `no production route for ${path}`);
  }

  if (path === '/api') {
    if (!isRead) throw new HttpError(405, `${method} is not allowed on ${path}`);
    sendJson(res, 200, ROUTE_INDEX, headOnly);
    return;
  }

  const readHandler = READ_ROUTES[path];
  const runtimeHandler = RUNTIME_ROUTES[path];
  const handler = readHandler ?? runtimeHandler;

  if (!handler) {
    throw new HttpError(404, `no route for ${path}. See GET /api for the route index.`);
  }
  if (readHandler && !isRead) {
    throw new HttpError(405, `${method} is not allowed on ${path}, use GET`);
  }
  if (!isRead && method !== 'POST') {
    throw new HttpError(405, `${method} is not allowed on ${path}, use GET or POST`);
  }

  // Outbound live reads must use POST, where the Origin guard below applies.
  // This prevents a remote page from triggering blind localhost RPC requests
  // with a cross-site image/link GET when the operator enabled live reads.
  const fixtureValues = url.searchParams.getAll('fixture');
  const fixtureQuery = fixtureValues[fixtureValues.length - 1]?.trim().toLowerCase() ?? '';
  if (
    isRead &&
    (path === '/api/status' || path === '/api/verify') &&
    (url.searchParams.has('rpcUrl') || ['false', '0', 'no'].includes(fixtureQuery))
  ) {
    throw new HttpError(405, `live-read requests to ${path} must use POST`);
  }

  let params = queryParams(url);
  if (method === 'POST') {
    assertOriginAllowed(req, config);
    params = { ...params, ...(await readJsonBody(req)) };
  }

  const result = await handler(params, config);
  sendJson(res, result.status, result.payload, headOnly);
}

export function createRuntimeServer(config: ServerConfig, production?: ProductionRuntime): Server {
  assertSafeServerConfig(config);
  if ((config.dataMode ?? 'fixture') === 'production' && !production) {
    throw new Error('production mode requires an initialized production runtime');
  }
  const server = createServer((req, res) => {
    const requestId = randomBytes(12).toString('hex');
    const started = Date.now();
    res.setHeader('x-request-id', requestId);
    if ((config.dataMode ?? 'fixture') === 'production' && config.secureCookies) {
      res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains');
    }
    res.once('finish', () => {
      console.log(JSON.stringify({
        level: 'info',
        event: 'http_request',
        requestId,
        method: req.method ?? 'GET',
        path: (req.url ?? '/').split('?')[0],
        status: res.statusCode,
        durationMs: Date.now() - started,
      }));
    });
    void route(req, res, config, production).catch((error: unknown) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (error instanceof HttpError) {
        sendJson(res, error.status, { ok: false, error: { code: error.status, detail: error.message } });
        return;
      }
      if (error instanceof URIError) {
        sendJson(res, 400, { ok: false, error: { code: 400, detail: 'invalid URL encoding or route identifier' } });
        return;
      }
      console.error(JSON.stringify({
        level: 'error',
        event: 'http_request_failed',
        requestId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      }));
      sendJson(res, 500, { ok: false, error: { code: 500, detail: 'internal server error' } });
    });
  });
  // Bound slow or abandoned clients before they can retain server resources
  // indefinitely. Reverse proxies should use equal or tighter limits.
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 100;
  server.maxRequestsPerSocket = 100;
  return server;
}

export async function startRuntimeServer(config: ServerConfig): Promise<Server> {
  assertSafeServerConfig(config);
  const production = (config.dataMode ?? 'fixture') === 'production'
    ? await createProductionRuntime(config)
    : undefined;
  const server = createRuntimeServer(config, production);
  if (production) {
    server.once('close', () => { void production.close(); });
  }
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.removeListener('error', reject);
      resolvePromise();
    });
  });
  return server;
}

const isMainModule = (): boolean => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return resolve(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
};

if (isMainModule()) {
  const config = resolveServerConfig(process.env, process.argv.slice(2));
  const server = await startRuntimeServer(config);
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : config.port;
  const displayHost = isLoopbackHost(config.host) ? 'localhost' : config.host;

  console.log(`Machina v${RUNTIME_VERSION} listening on http://${displayHost}:${port}`);
  console.log(`  website   http://${displayHost}:${port}/`);
  console.log(`  console   http://${displayHost}:${port}/console`);
  console.log(`  routes    http://${displayHost}:${port}/api`);
  console.log(`  mode      ${(config.dataMode ?? 'fixture') === 'production'
    ? `production · PostgreSQL · authenticated · Solana ${config.solanaCluster ?? 'custom'} genesis verified`
    : config.allowLive
      ? 'fixture + live-read (outbound RPC permitted)'
      : 'fixture-only (no outbound RPC)'}`);
  if (!isLoopbackHost(config.host)) {
    console.warn(`  warning   bound to ${config.host}; terminate TLS at the configured public origin.`);
  }
  console.log('  stop      Ctrl+C');

  const shutdown = (signal: string) => {
    console.log(`\n${signal} received, closing server`);
    server.close();
    // Do not let a hung keep-alive socket block shutdown.
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
