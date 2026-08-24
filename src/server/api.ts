import { readFileSync } from 'node:fs';
import { inspect } from '../cli/commands/inspect.js';
import { buildIntent } from '../cli/commands/intent.js';
import { pair } from '../cli/commands/pair.js';
import { status } from '../cli/commands/status.js';
import { verify } from '../cli/commands/verify.js';
import type { ReceiptExpectation, RuntimeChain } from '../adapters/shared/types.js';
import {
  consoleResourceMarketplaceService,
  type ResourceRequestDraftInput,
} from '../console/services/resources.js';
import { fixtureData } from '../transports/fixture.js';
import { HttpError } from './http.js';
import type { ServerConfig } from './config.js';

/** A merged view of query-string parameters and JSON body fields. */
export type Params = Record<string, unknown>;

export interface ApiResponse {
  status: number;
  payload: unknown;
}

export type ApiHandler = (params: Params, config: ServerConfig) => Promise<ApiResponse> | ApiResponse;

export const RUNTIME_VERSION: string = ((): string => {
  try {
    const url = new URL('../../package.json', import.meta.url);
    const parsed = JSON.parse(readFileSync(url, 'utf8')) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : 'unknown';
  } catch {
    return 'unknown';
  }
})();

// ---------------------------------------------------------------------------
// parameter coercion
// ---------------------------------------------------------------------------

function optionalString(params: Params, key: string): string | undefined {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new HttpError(400, `"${key}" must be a string`);
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function requiredString(params: Params, key: string): string {
  const value = optionalString(params, key);
  if (value === undefined) throw new HttpError(400, `"${key}" is required`);
  return value;
}

function handleInput<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, error instanceof Error ? error.message : 'invalid request input');
  }
}

function optionalBoolean(params: Params, key: string): boolean | undefined {
  const value = params[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  }
  throw new HttpError(400, `"${key}" must be a boolean`);
}

function optionalPositiveInt(params: Params, key: string, max: number): number | undefined {
  const value = params[key];
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max) {
    throw new HttpError(400, `"${key}" must be an integer between 1 and ${max}`);
  }
  return parsed;
}

function numericDraftValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : Number(trimmed);
}

/** Normalizes browser form fields without asserting that they are valid. */
function resourceDraft(params: Params): ResourceRequestDraftInput {
  const preferredRail = optionalString(params, 'preferredRail');
  const preferredRails = params['preferredRails'];
  const normalizedRails =
    preferredRails === undefined
      ? preferredRail === undefined
        ? undefined
        : [preferredRail]
      : preferredRails;

  return {
    id: params['id'],
    requesterId: params['requesterId'],
    resourceType: params['resourceType'],
    quantity: numericDraftValue(params['quantity']),
    maxPrice: numericDraftValue(params['maxPrice']),
    ...(normalizedRails === undefined ? {} : { preferredRails: normalizedRails }),
    ...(params['purpose'] === undefined ? {} : { purpose: params['purpose'] }),
    ...(params['metadata'] === undefined ? {} : { metadata: params['metadata'] }),
  };
}

function parseChain(params: Params): RuntimeChain {
  // Solana is the only supported rail; an explicit chain is still accepted so
  // existing callers and the CLI stay interchangeable.
  const value = optionalString(params, 'chain') ?? 'solana';
  if (value !== 'solana') {
    throw new HttpError(400, `invalid chain "${value}", solana is the only supported rail`);
  }
  return value;
}

/**
 * Resolves fixture vs live-read mode.
 *
 * The server defaults to fixture mode (the CLI defaults to live-read) because a
 * browser-driven request should not reach out to a public RPC endpoint unless
 * the operator asked for it. Live-read additionally requires `--allow-live`
 * and an operator-configured endpoint; HTTP callers cannot choose the target.
 */
function resolveFixture(params: Params, config: ServerConfig): boolean {
  const fixture = optionalBoolean(params, 'fixture') ?? true;
  if (!fixture && !config.allowLive) {
    throw new HttpError(
      403,
      'live-read mode is disabled on this server. Restart with --allow-live (or MACHINEFI_ALLOW_LIVE=1) to permit outbound RPC calls, or send "fixture": true.'
    );
  }
  if (!fixture && config.liveRpcUrl === undefined) {
    throw new HttpError(503, 'live-read mode has no operator-configured Solana endpoint');
  }
  return fixture;
}

function resolveRpcUrl(params: Params, fixture: boolean, config: ServerConfig): string | undefined {
  if (Object.prototype.hasOwnProperty.call(params, 'rpcUrl')) {
    throw new HttpError(
      400,
      '"rpcUrl" is not accepted by the HTTP API. Configure --rpc-url or MACHINEFI_SOLANA_RPC_URL when starting the server.'
    );
  }
  return fixture ? undefined : config.liveRpcUrl;
}

const EXPECTATION_KEYS = ['status', 'from', 'to', 'recipient', 'amount', 'asset', 'memo', 'sessionId', 'machineId'] as const;

/** Accepts expectation fields either flat (CLI style) or nested under `expectation`. */
function readExpectation(params: Params): ReceiptExpectation {
  const nested = params['expectation'];
  if (nested !== undefined && (typeof nested !== 'object' || nested === null || Array.isArray(nested))) {
    throw new HttpError(400, '"expectation" must be an object');
  }
  const source: Params = { ...(nested as Params | undefined), ...params };
  const expectation: ReceiptExpectation = {};
  for (const key of EXPECTATION_KEYS) {
    const value = optionalString(source, key);
    if (value === undefined) continue;
    if (key === 'status') {
      if (value !== 'success' && value !== 'failed' && value !== 'pending') {
        throw new HttpError(400, '"status" must be success, failed, or pending');
      }
      expectation.status = value;
    } else {
      expectation[key] = value;
    }
  }
  return expectation;
}

// ---------------------------------------------------------------------------
// handlers
// ---------------------------------------------------------------------------

const startedAt = Date.now();

export const handleHealth: ApiHandler = (_params, config) => ({
  status: 200,
  payload: {
    ok: true,
    name: 'Machina',
    version: RUNTIME_VERSION,
    mode: config.allowLive ? 'fixture + live-read' : 'fixture-only',
    liveReadEnabled: config.allowLive,
    chains: ['solana'],
    node: process.version,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000)
  }
});

export const handleInspect: ApiHandler = (params) => ({
  status: 200,
  payload: inspect(parseChain(params))
});

export const handleStatus: ApiHandler = async (params, config) => {
  const chain = parseChain(params);
  const fixture = resolveFixture(params, config);
  const result = await status(chain, {
    fixture,
    rpcUrl: resolveRpcUrl(params, fixture, config),
    timeoutMs: optionalPositiveInt(params, 'timeoutMs', 60_000)
  });
  // A reachable-but-mismatched chain is a legitimate answer, not a server fault.
  return { status: 200, payload: result };
};

export const handlePair: ApiHandler = (params, config) => {
  const chain = parseChain(params);
  const fixture = resolveFixture(params, config);
  const now = optionalString(params, 'now');
  const session = handleInput(() => pair({
    chain,
    fixture,
    machineId: optionalString(params, 'machineId'),
    machineLabel: optionalString(params, 'machineLabel'),
    wallet: optionalString(params, 'wallet'),
    operator: optionalString(params, 'operator'),
    policy: optionalString(params, 'policy'),
    role: optionalString(params, 'role'),
    ...(now === undefined ? {} : { now })
  }));
  return { status: 200, payload: session };
};

export const handleIntentBuild: ApiHandler = (params, config) => {
  const chain = parseChain(params);
  const fixture = resolveFixture(params, config);
  const intent = handleInput(() => buildIntent({
    chain,
    source: requiredString({ ...params, source: params['source'] ?? params['from'] }, 'source'),
    recipient: requiredString({ ...params, recipient: params['recipient'] ?? params['to'] }, 'recipient'),
    amount: requiredString(params, 'amount'),
    asset: optionalString(params, 'asset'),
    machineId: requiredString(params, 'machineId'),
    sessionId: requiredString(params, 'sessionId'),
    policyId: optionalString(params, 'policy') ?? optionalString(params, 'policyId') ?? 'standard-machine-policy',
    memo: optionalString(params, 'memo'),
    reference: optionalString(params, 'reference'),
    fixture
  }));
  return { status: 200, payload: intent };
};

export const handleVerify: ApiHandler = async (params, config) => {
  const chain = parseChain(params);
  const id = optionalString(params, 'id') ?? optionalString(params, 'tx') ?? optionalString(params, 'signature');
  if (id === undefined) {
    throw new HttpError(400, 'verify requires a Solana transaction "signature"');
  }
  const fixture = resolveFixture(params, config);
  const rpcUrl = resolveRpcUrl(params, fixture, config);
  const timeoutMs = optionalPositiveInt(params, 'timeoutMs', 60_000);
  const result = await verify({
    chain,
    id,
    fixture,
    expectation: readExpectation(params),
    ...(rpcUrl === undefined ? {} : { rpcUrl }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  if (result.ok) return { status: 200, payload: result };
  // invalid_input is a caller error; an RPC failure is an upstream failure.
  const status = result.error.code === 'invalid_input' ? 400 : result.error.code === 'rpc_error' ? 502 : 404;
  return { status, payload: result };
};

export const handleFixtures: ApiHandler = () => {
  const receipts = fixtureData.solana.receipts.map((receipt) => ({
    chain: 'solana' as const,
    id: receipt.id,
    describe: `${receipt.machineId} / ${receipt.memo}`,
    expectation: {
      amount: receipt.amount,
      memo: receipt.memo,
      machineId: receipt.machineId,
      sessionId: receipt.sessionId
    },
    expectedOutcome: { verified: true },
    accounts: receipt.transaction.message.accountKeys,
    note:
      'Adding both "from" and "to" returns verified:false with "transfer direction evidence unavailable", because this fixture carries no pre/post lamport balances to prove transfer direction.'
  }));
  return { status: 200, payload: { receipts } };
};

/** Read-only capability/snapshot boundary for the Resource Marketplace UI. */
export const handleResources: ApiHandler = () => ({
  status: 200,
  payload: {
    ok: true,
    ...consoleResourceMarketplaceService.snapshot(),
  },
});

/** Validate and match a local draft against an injected provider registry. */
export const handleResourceDiscovery: ApiHandler = (params) => {
  const result = consoleResourceMarketplaceService.discoverProviders(resourceDraft(params));
  const status =
    result.status === 'matched'
      ? 200
      : result.status === 'invalid-request'
        ? 422
        : result.status === 'marketplace-unavailable'
          ? 503
          : 404;
  return { status, payload: { ok: result.status === 'matched', result } };
};

/**
 * Fail-closed submission boundary. The repository has no authenticated
 * resource backend, persistence, grants, or resource receipts, so this route
 * can validate a draft but can never report a successful request.
 */
export const handleResourceRequest: ApiHandler = (params) => {
  const result = consoleResourceMarketplaceService.submitRequest(resourceDraft(params));
  return {
    status: result.validation.ok ? 501 : 422,
    payload: {
      ok: false,
      error: result.validation.ok
        ? { code: result.code, detail: result.message }
        : { code: 'INVALID_RESOURCE_REQUEST', detail: 'The resource request draft failed validation.' },
      validation: result.validation,
    },
  };
};

/** GET-only routes, keyed by pathname. */
export const READ_ROUTES: Readonly<Record<string, ApiHandler>> = {
  '/api/health': handleHealth,
  '/api/inspect': handleInspect,
  '/api/fixtures': handleFixtures,
  '/api/resources': handleResources,
};

/** Routes that accept GET (query params) or POST (JSON body). */
export const RUNTIME_ROUTES: Readonly<Record<string, ApiHandler>> = {
  '/api/status': handleStatus,
  '/api/pair': handlePair,
  '/api/intent/build': handleIntentBuild,
  '/api/verify': handleVerify,
  '/api/resources/discover': handleResourceDiscovery,
  '/api/resources/request': handleResourceRequest,
};

export const ROUTE_INDEX = {
  service: '@machinefi/runtime local server',
  version: RUNTIME_VERSION,
  rail: 'solana',
  ui: '/',
  endpoints: {
    'GET /api/health': 'server version and runtime mode',
    'GET /api/inspect': 'Solana rail constants and RPC env var',
    'GET /api/fixtures': 'deterministic fixture receipts available for verification',
    'GET /api/resources': 'resource marketplace capability flags and current provider/request snapshot',
    'GET|POST /api/status': 'rail reachability (fixture, timeoutMs; live endpoint is operator-configured)',
    'GET|POST /api/pair': 'create a machine session (fixture, machineId, wallet, operator, policy, role, machineLabel)',
    'GET|POST /api/intent/build': 'build an unsigned settlement intent (source, recipient, amount, asset, machineId, sessionId, policy, memo, reference, fixture)',
    'GET|POST /api/verify': 'verify receipt evidence (signature, fixture, timeoutMs, from, to, amount, asset, memo, machineId, sessionId, status; live endpoint is operator-configured)',
    'GET|POST /api/resources/discover': 'validate a ResourceRequest draft and match injected provider capabilities',
    'GET|POST /api/resources/request': 'validate then reject submission until an authenticated marketplace backend is configured',
  }
} as const;
