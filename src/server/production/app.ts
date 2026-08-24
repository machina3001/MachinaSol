import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isSolanaAddress } from '../../adapters/solana/validation.js';
import { createWorkOrder } from '../../jobs/work-order.js';
import { isMachineCapability, isMachineRole, validateMachineId } from '../../machines/identity.js';
import { createMachineSession } from '../../sessions/session.js';
import { normalizeTelemetrySnapshot, type MachineTelemetrySnapshot } from '../../telemetry/snapshot.js';
import { isResourceType } from '../../console/services/resources.js';
import {
  DEFAULT_TELEMETRY_MAX_EVENTS_PER_MACHINE,
  DEFAULT_TELEMETRY_RETENTION_DAYS,
  type ServerConfig,
} from '../config.js';
import { HttpError, assertOriginAllowed, readJsonBody, sendJson, sendJsonWithHeaders } from '../http.js';
import { csrfCookie, expiredCsrfCookie, expiredSessionCookie, sessionCookie } from './auth.js';
import { opaqueToken, sha256 } from './crypto.js';
import { RequestRateLimiter } from './rate-limit.js';
import {
  assessTransactionLifecycle,
  checkBlockhashValidity,
  getTransactionConfirmation,
  inspectSignedTransaction,
  prepareSolTransfer,
  SolanaTransactionError,
  submitSignedTransaction,
} from './transactions.js';
import type { ProductionRuntime } from './runtime.js';
import { DEFAULT_PRODUCTION_LIST_LIMIT, MAX_PRODUCTION_LIST_LIMIT } from './types.js';
import type {
  PersistentAccessGrant,
  PersistentResourceQuote,
  PersistentResourceReceipt,
  PersistentResourceRequest,
  PersistentRuntimeSession,
  PersistentWorkOrder,
  ProviderCapabilityRow,
  SettlementRecord,
} from './types.js';

const telemetryLimiter = new RequestRateLimiter(120, 60_000);
const telemetryIpLimiter = new RequestRateLimiter(1_200, 60_000);
const telemetryGlobalLimiter = new RequestRateLimiter(10_000, 60_000, 1);
const mutationLimiter = new RequestRateLimiter(90, 60_000);
const settlementLimiter = new RequestRateLimiter(20, 60_000);
const MACHINE_CREDENTIAL_SCOPE = 'telemetry:write' as const;

const withoutOwner = <T extends { ownerUserId: string }>(record: T): Omit<T, 'ownerUserId'> => {
  const { ownerUserId: _ownerUserId, ...publicRecord } = record;
  return publicRecord;
};

const publicQuote = (record: PersistentResourceQuote): Omit<PersistentResourceQuote, 'providerOwnerUserId'> => {
  const { providerOwnerUserId: _providerOwnerUserId, ...publicRecord } = record;
  return publicRecord;
};

const publicGrant = (
  record: PersistentAccessGrant
): Omit<PersistentAccessGrant, 'providerOwnerUserId' | 'requesterOwnerUserId'> => {
  const { providerOwnerUserId: _providerOwnerUserId, requesterOwnerUserId: _requesterOwnerUserId, ...publicRecord } = record;
  return publicRecord;
};

const publicReceipt = (
  record: PersistentResourceReceipt
): Omit<PersistentResourceReceipt, 'providerOwnerUserId' | 'requesterOwnerUserId'> => {
  const { providerOwnerUserId: _providerOwnerUserId, requesterOwnerUserId: _requesterOwnerUserId, ...publicRecord } = record;
  return publicRecord;
};

const publicRuntimeSession = (
  record: PersistentRuntimeSession
): Omit<PersistentRuntimeSession, 'ownerUserId' | 'nonceHash'> => {
  const { ownerUserId: _ownerUserId, nonceHash: _nonceHash, ...publicRecord } = record;
  return publicRecord;
};

const publicWorkOrder = (record: PersistentWorkOrder): Omit<PersistentWorkOrder, 'ownerUserId'> => {
  const { ownerUserId: _ownerUserId, ...publicRecord } = record;
  return publicRecord;
};

const publicMachineCredential = (record: {
  id: string;
  label: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}) => ({
  id: record.id,
  label: record.label,
  createdAt: record.createdAt,
  expiresAt: record.expiresAt,
  revokedAt: record.revokedAt,
  scope: MACHINE_CREDENTIAL_SCOPE,
});

const textValue = (
  input: Record<string, unknown>,
  key: string,
  options: { required?: boolean; max?: number } = {}
): string | undefined => {
  const value = input[key];
  if (value === undefined || value === null) {
    if (options.required) throw new HttpError(400, `"${key}" is required`);
    return undefined;
  }
  if (typeof value !== 'string') throw new HttpError(400, `"${key}" must be a string`);
  const normalized = value.trim();
  if (!normalized && options.required) throw new HttpError(400, `"${key}" is required`);
  if (normalized.length > (options.max ?? 256)) throw new HttpError(400, `"${key}" is too long`);
  return normalized || undefined;
};

const stringList = (input: Record<string, unknown>, key: string, maxItems = 16): readonly string[] => {
  const value = input[key] ?? [];
  if (!Array.isArray(value) || value.length > maxItems || value.some((item) => typeof item !== 'string' || !item.trim() || item.length > 64)) {
    throw new HttpError(400, `"${key}" must be an array of at most ${maxItems} short strings`);
  }
  return [...new Set(value.map((item) => (item as string).trim()))];
};

const decimal = (input: Record<string, unknown>, key: string): string => {
  const raw = input[key];
  const value = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
  if (value.length > 32 || !/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/u.test(value) || Number(value) <= 0) {
    throw new HttpError(400, `"${key}" must be a positive decimal with at most 9 fractional digits`);
  }
  return value;
};

const nullablePrice = (
  input: Record<string, unknown>,
  current: { priceAmount: string | null; priceAsset: string | null } = { priceAmount: null, priceAsset: null }
): { priceAmount: string | null; priceAsset: string | null } => {
  if (!Object.prototype.hasOwnProperty.call(input, 'priceAmount')) {
    return { priceAmount: current.priceAmount, priceAsset: current.priceAsset };
  }
  if (input['priceAmount'] === null) return { priceAmount: null, priceAsset: null };
  const priceAmount = decimal(input, 'priceAmount');
  const priceAsset = textValue(input, 'priceAsset', { required: true, max: 16 });
  if (priceAsset !== 'SOL') throw new HttpError(400, 'SOL is the only executable settlement asset');
  return { priceAmount, priceAsset };
};

const optionalIsoTimestamp = (input: Record<string, unknown>, key: string): string | null => {
  const value = input[key];
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 64 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) ||
    !Number.isFinite(Date.parse(value))) {
    throw new HttpError(400, `"${key}" must be a valid ISO timestamp`);
  }
  return new Date(value).toISOString();
};

const optionalTextOrNull = (input: Record<string, unknown>, key: string, max: number): string | null =>
  textValue(input, key, { max }) ?? null;

const optionalFinite = (input: Record<string, unknown>, key: string): number | undefined => {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new HttpError(400, `"${key}" must be a finite number`);
  return value;
};

const optionalBoolean = (input: Record<string, unknown>, key: string, fallback: boolean): boolean => {
  const value = input[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new HttpError(400, `"${key}" must be a boolean`);
  return value;
};

const telemetryPoint = (input: Record<string, unknown>, key: 'location' | 'pose'): Record<string, number> | undefined => {
  const value = input[key];
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, `"${key}" must be an object`);
  const allowed = key === 'location' ? ['lat', 'lon', 'altitudeM'] : ['x', 'y', 'z', 'yawDeg'];
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((candidate) => !allowed.includes(candidate))) throw new HttpError(400, `"${key}" contains unsupported fields`);
  const normalized: Record<string, number> = {};
  for (const candidate of allowed) {
    const number = optionalFinite(record, candidate);
    if (number !== undefined) normalized[candidate] = number;
  }
  const required = key === 'location' ? ['lat', 'lon'] : ['x', 'y'];
  if (required.some((candidate) => normalized[candidate] === undefined)) throw new HttpError(400, `"${key}" is incomplete`);
  return normalized;
};

const safeSegment = (value: string): string => {
  const decoded = decodeURIComponent(value);
  if (!decoded || decoded.length > 128 || /[\/\u0000-\u001f\u007f]/u.test(decoded)) throw new HttpError(400, 'invalid route identifier');
  return decoded;
};

const requestedListLimit = (req: IncomingMessage): number => {
  const raw = new URL(req.url ?? '/', 'http://localhost').searchParams.get('limit');
  if (raw === null) return DEFAULT_PRODUCTION_LIST_LIMIT;
  if (!/^[1-9]\d*$/u.test(raw)) throw new HttpError(400, `limit must be an integer from 1 to ${MAX_PRODUCTION_LIST_LIMIT}`);
  const limit = Number(raw);
  if (!Number.isSafeInteger(limit) || limit > MAX_PRODUCTION_LIST_LIMIT) {
    throw new HttpError(400, `limit must be an integer from 1 to ${MAX_PRODUCTION_LIST_LIMIT}`);
  }
  return limit;
};

const isPersistenceConstraintError = (error: unknown): boolean => {
  if (error === null || typeof error !== 'object') return false;
  const code = 'code' in error ? String(error.code) : '';
  if (code === '23503' || code === '23505' || code === '23514' || code === '22P02') return true;
  return error instanceof Error && /already exists|not owned|must be selected together|does not match provider request/u.test(error.message);
};

const requireOwnedMachine = async (runtime: ProductionRuntime, userId: string, machineId: string) => {
  const machine = await runtime.store.ownedMachine(userId, machineId);
  if (!machine) throw new HttpError(404, 'machine not found');
  return machine;
};

const bodyForMutation = async (req: IncomingMessage, config: ServerConfig): Promise<Record<string, unknown>> => {
  assertOriginAllowed(req, config);
  return readJsonBody(req);
};

function credentialFromRequest(req: IncomingMessage): { id: string; token: string } {
  // Machine credentials are for native runtimes/agents, not browser code. A
  // legitimate machine HTTP client does not send Origin; rejecting it here
  // also prevents accidental credential use from a frontend application.
  if (req.headers.origin !== undefined) {
    throw new HttpError(403, 'machine credentials are not accepted from browser-origin requests');
  }
  const authorization = req.headers.authorization ?? '';
  const match = /^Bearer\s+([0-9a-f-]{36})\.([A-Za-z0-9_-]{32,128})$/u.exec(authorization);
  if (!match) throw new HttpError(401, 'valid machine bearer credential required');
  return { id: match[1]!, token: match[2]! };
}

const decimalParts = (value: string): { integer: bigint; scale: number } => {
  const [whole = '0', fraction = ''] = value.split('.');
  return { integer: BigInt(`${whole}${fraction}`), scale: fraction.length };
};

/** Exact price-per-unit × quantity conversion; refuses sub-lamport rounding. */
export function quotedSolToLamports(price: string, quantity: string): bigint {
  const a = decimalParts(price);
  const b = decimalParts(quantity);
  const numerator = a.integer * b.integer * 1_000_000_000n;
  const denominator = 10n ** BigInt(a.scale + b.scale);
  if (numerator % denominator !== 0n) throw new HttpError(422, 'quoted settlement has sub-lamport precision');
  const lamports = numerator / denominator;
  if (lamports <= 0n || lamports > 100_000_000_000_000n) throw new HttpError(422, 'quoted settlement amount is outside policy bounds');
  return lamports;
}

function priceWithinLimit(price: string, maxPrice: string): boolean {
  const a = decimalParts(price);
  const b = decimalParts(maxPrice);
  const scale = Math.max(a.scale, b.scale);
  return a.integer * 10n ** BigInt(scale - a.scale) <= b.integer * 10n ** BigInt(scale - b.scale);
}

const jsonMutation = (req: IncomingMessage, res: ServerResponse, allowed = 'POST'): void => {
  if (req.method !== allowed) throw new HttpError(405, `${req.method ?? 'GET'} is not allowed; use ${allowed}`);
};

const assertMutationRate = (
  req: IncomingMessage,
  userId: string,
  scope: string,
  limiter: RequestRateLimiter = mutationLimiter
): void => limiter.assert(`${userId}:${scope}:${requestIp(req)}`);

const sendSolanaError = (res: ServerResponse, error: SolanaTransactionError): void => {
  const status = error.code === 'BLOCKHASH_EXPIRED' ? 409 : error.retryable ? 503 : 422;
  sendJson(res, status, {
    ok: false,
    error: { code: error.code, message: error.message, retryable: error.retryable },
  });
};

/** Returns true when the request belongs to the production application. */
export async function handleProductionRequest(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  config: ServerConfig,
  runtime: ProductionRuntime
): Promise<boolean> {
  if (!path.startsWith('/api/')) return false;

  if (path === '/api/auth/challenge') {
    jsonMutation(req, res);
    const body = await bodyForMutation(req, config);
    const result = await runtime.auth.challenge(textValue(body, 'walletAddress', { required: true, max: 44 })!, req);
    sendJson(res, 201, { ok: true, ...result });
    return true;
  }

  if (path === '/api/auth/verify') {
    jsonMutation(req, res);
    const body = await bodyForMutation(req, config);
    const result = await runtime.auth.verify({
      challengeId: textValue(body, 'challengeId', { required: true, max: 128 })!,
      walletAddress: textValue(body, 'walletAddress', { required: true, max: 44 })!,
      signature: textValue(body, 'signature', { required: true, max: 88 })!,
    }, req);
    sendJsonWithHeaders(res, 200, {
      ok: true,
      authenticated: true,
      userId: result.session.userId,
      walletAddress: result.session.walletAddress,
      expiresAt: result.session.expiresAt,
      csrfToken: result.csrfToken,
    }, { 'set-cookie': [
      sessionCookie(result.sessionToken, config),
      csrfCookie(result.csrfToken, config),
    ] });
    return true;
  }

  if (path === '/api/auth/session') {
    if (req.method !== 'GET') throw new HttpError(405, 'use GET');
    const { record } = await runtime.auth.authenticate(req);
    sendJson(res, 200, { ok: true, authenticated: true, userId: record.userId, walletAddress: record.walletAddress, expiresAt: record.expiresAt });
    return true;
  }

  if (path === '/api/auth/logout') {
    jsonMutation(req, res);
    assertOriginAllowed(req, config);
    const { record } = await runtime.auth.authenticate(req, true);
    await runtime.store.revokeSession(record.id, new Date().toISOString());
    runtime.telemetryHub.disconnectUser(record.userId);
    sendJsonWithHeaders(res, 200, { ok: true, authenticated: false }, { 'set-cookie': [
      expiredSessionCookie(config),
      expiredCsrfCookie(config),
    ] });
    return true;
  }

  if (path === '/api/production/network') {
    if (req.method !== 'GET') throw new HttpError(405, 'use GET');
    await runtime.auth.authenticate(req);
    sendJson(res, 200, { ok: true, ...runtime.network });
    return true;
  }

  if (path === '/api/machines') {
    const authenticated = await runtime.auth.authenticate(req, req.method === 'POST');
    if (req.method === 'GET') {
      const machines = await runtime.store.listOwnedMachines(authenticated.record.userId, requestedListLimit(req));
      sendJson(res, 200, { ok: true, machines: machines.map(withoutOwner) });
      return true;
    }
    jsonMutation(req, res);
    assertOriginAllowed(req, config);
    assertMutationRate(req, authenticated.record.userId, 'machines');
    const body = await readJsonBody(req);
    const machineId = textValue(body, 'machineId', { required: true, max: 64 })!;
    try { validateMachineId(machineId); } catch { throw new HttpError(400, 'invalid machineId'); }
    const role = textValue(body, 'role', { required: true, max: 32 })!;
    if (!isMachineRole(role)) throw new HttpError(400, 'invalid machine role');
    const now = new Date().toISOString();
    const machine = {
      machineId,
      ownerUserId: authenticated.record.userId,
      label: textValue(body, 'label', { required: true, max: 128 })!,
      role,
      walletAddress: authenticated.record.walletAddress,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await runtime.store.createOwnedMachine(machine);
    } catch (error) {
      if (isPersistenceConstraintError(error)) throw new HttpError(409, 'machineId is already registered');
      throw error;
    }
    sendJson(res, 201, { ok: true, machine: withoutOwner(machine) });
    return true;
  }

  const credentialMatch = /^\/api\/machines\/([^/]+)\/credentials$/u.exec(path);
  if (credentialMatch) {
    const authenticated = await runtime.auth.authenticate(req, req.method === 'POST');
    const machineId = safeSegment(credentialMatch[1]!);
    await requireOwnedMachine(runtime, authenticated.record.userId, machineId);
    if (req.method === 'GET') {
      const credentials = await runtime.store.listMachineCredentials(
        authenticated.record.userId,
        machineId,
        requestedListLimit(req)
      );
      sendJson(res, 200, { ok: true, credentials: credentials.map(publicMachineCredential) });
      return true;
    }
    jsonMutation(req, res);
    assertOriginAllowed(req, config);
    assertMutationRate(req, authenticated.record.userId, 'machine-credentials');
    const body = await readJsonBody(req);
    const id = randomUUID();
    const token = opaqueToken(36);
    const now = new Date();
    const expiresInDaysRaw = body['expiresInDays'] ?? 90;
    const expiresInDays = typeof expiresInDaysRaw === 'number' ? expiresInDaysRaw : Number(expiresInDaysRaw);
    if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 365) throw new HttpError(400, 'expiresInDays must be 1-365');
    const credential = {
      id,
      machineId,
      secretHash: sha256(token),
      label: textValue(body, 'label', { max: 80 }) ?? 'telemetry ingestion',
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + expiresInDays * 86_400_000).toISOString(),
      revokedAt: null,
    };
    if (!await runtime.store.createMachineCredential(authenticated.record.userId, credential)) {
      throw new HttpError(409, 'machine credential could not be created');
    }
    sendJson(res, 201, {
      ok: true,
      credential: `${id}.${token}`,
      machineId,
      scope: MACHINE_CREDENTIAL_SCOPE,
      expiresAt: credential.expiresAt,
      warning: 'This credential is shown once. Store it in the machine secret manager; do not place it in telemetry payloads.',
    });
    return true;
  }

  const revokeCredentialMatch = /^\/api\/machine-credentials\/([^/]+)\/revoke$/u.exec(path);
  if (revokeCredentialMatch) {
    jsonMutation(req, res);
    assertOriginAllowed(req, config);
    const authenticated = await runtime.auth.authenticate(req, true);
    assertMutationRate(req, authenticated.record.userId, 'machine-credentials');
    const revoked = await runtime.store.revokeMachineCredential(authenticated.record.userId, safeSegment(revokeCredentialMatch[1]!), new Date().toISOString());
    if (!revoked) throw new HttpError(404, 'machine credential not found');
    sendJson(res, 200, { ok: true, revoked: true });
    return true;
  }

  const machineCapabilitiesMatch = /^\/api\/machines\/([^/]+)\/capabilities$/u.exec(path);
  if (machineCapabilitiesMatch) {
    const authenticated = await runtime.auth.authenticate(req, req.method === 'POST');
    const machineId = safeSegment(machineCapabilitiesMatch[1]!);
    await requireOwnedMachine(runtime, authenticated.record.userId, machineId);
    if (req.method === 'GET') {
      const capabilities = await runtime.store.listMachineCapabilities(authenticated.record.userId, machineId);
      sendJson(res, 200, { ok: true, capabilities: capabilities.map(withoutOwner) });
      return true;
    }
    jsonMutation(req, res);
    assertOriginAllowed(req, config);
    assertMutationRate(req, authenticated.record.userId, 'machine-capabilities');
    const body = await readJsonBody(req);
    const capabilities = stringList(body, 'capabilities', 16);
    if (capabilities.length === 0 || capabilities.some((capability) => !isMachineCapability(capability))) {
      throw new HttpError(400, 'at least one supported machine capability is required');
    }
    const updated = await runtime.store.replaceMachineCapabilities(
      authenticated.record.userId,
      machineId,
      capabilities.filter(isMachineCapability),
      new Date().toISOString()
    );
    if (!updated) throw new HttpError(404, 'machine not found');
    sendJson(res, 200, { ok: true, capabilities: updated.map(withoutOwner) });
    return true;
  }

  if (path === '/api/runtime/sessions') {
    const authenticated = await runtime.auth.authenticate(req, req.method === 'POST');
    if (req.method === 'GET') {
      const machineId = new URL(req.url ?? path, 'http://localhost').searchParams.get('machineId');
      if (machineId !== null) await requireOwnedMachine(runtime, authenticated.record.userId, safeSegment(machineId));
      const sessions = await runtime.store.listRuntimeSessions(authenticated.record.userId, machineId, requestedListLimit(req));
      sendJson(res, 200, { ok: true, sessions: sessions.map(publicRuntimeSession) });
      return true;
    }
    jsonMutation(req, res);
    assertOriginAllowed(req, config);
    assertMutationRate(req, authenticated.record.userId, 'runtime-sessions');
    const body = await readJsonBody(req);
    const machineId = textValue(body, 'machineId', { required: true, max: 64 })!;
    const machine = await requireOwnedMachine(runtime, authenticated.record.userId, machineId);
    const capabilities = await runtime.store.listMachineCapabilities(authenticated.record.userId, machineId);
    let session: ReturnType<typeof createMachineSession>;
    try {
      session = createMachineSession({
        chain: 'solana',
        walletAddress: machine.walletAddress,
        machineId,
        machineLabel: machine.label,
        operatorId: authenticated.record.userId,
        policyProfileId: textValue(body, 'policyProfileId', { max: 128 }) ?? 'standard-machine-policy',
        mode: 'live-read',
        metadata: { capabilities: capabilities.map((record) => record.capability) },
      });
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : 'invalid runtime session');
    }
    const record: PersistentRuntimeSession = {
      sessionId: session.sessionId,
      ownerUserId: authenticated.record.userId,
      machineId: session.machineId,
      chain: session.chain,
      walletAddress: session.walletAddress,
      operatorId: session.operatorId,
      policyProfileId: session.policyProfileId,
      mode: session.mode,
      nonceHash: sha256(session.nonce),
      metadata: { ...(session.metadata ?? {}) },
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      endedAt: null,
    };
    if (!await runtime.store.createRuntimeSession(record)) throw new HttpError(409, 'runtime session could not be created');
    sendJson(res, 201, { ok: true, session: publicRuntimeSession(record) });
    return true;
  }

  const endRuntimeSessionMatch = /^\/api\/runtime\/sessions\/([^/]+)\/end$/u.exec(path);
  if (endRuntimeSessionMatch) {
    jsonMutation(req, res);
    assertOriginAllowed(req, config);
    const authenticated = await runtime.auth.authenticate(req, true);
    assertMutationRate(req, authenticated.record.userId, 'runtime-sessions');
    const session = await runtime.store.endRuntimeSession(
      authenticated.record.userId,
      safeSegment(endRuntimeSessionMatch[1]!),
      new Date().toISOString()
    );
    if (!session) throw new HttpError(409, 'runtime session was not found or is already ended');
    sendJson(res, 200, { ok: true, session: publicRuntimeSession(session) });
    return true;
  }

  if (path === '/api/work-orders') {
    const authenticated = await runtime.auth.authenticate(req, req.method === 'POST');
    if (req.method === 'GET') {
      const machineId = new URL(req.url ?? path, 'http://localhost').searchParams.get('machineId');
      if (machineId !== null) await requireOwnedMachine(runtime, authenticated.record.userId, safeSegment(machineId));
      const workOrders = await runtime.store.listWorkOrders(authenticated.record.userId, machineId, requestedListLimit(req));
      sendJson(res, 200, { ok: true, workOrders: workOrders.map(publicWorkOrder) });
      return true;
    }
    jsonMutation(req, res);
    assertOriginAllowed(req, config);
    assertMutationRate(req, authenticated.record.userId, 'work-orders');
    const body = await readJsonBody(req);
    const machineId = textValue(body, 'machineId', { max: 64 }) ?? null;
    if (machineId !== null) await requireOwnedMachine(runtime, authenticated.record.userId, machineId);
    const requiredCapabilities = stringList(body, 'requiredCapabilities', 16);
    if (requiredCapabilities.length === 0 || requiredCapabilities.some((capability) => !isMachineCapability(capability))) {
      throw new HttpError(400, 'at least one supported required capability is required');
    }
    const validatedRequiredCapabilities = requiredCapabilities.filter(isMachineCapability);
    if (machineId !== null) {
      const advertised = new Set((await runtime.store.listMachineCapabilities(authenticated.record.userId, machineId))
        .map((record) => record.capability));
      if (validatedRequiredCapabilities.some((capability) => !advertised.has(capability))) {
        throw new HttpError(422, 'assigned machine does not advertise all required capabilities');
      }
    }
    const settlementAsset = textValue(body, 'settlementAsset', { max: 16 }) ?? 'SOL';
    if (settlementAsset !== 'SOL') throw new HttpError(400, 'SOL is the only supported settlement asset');
    const settlementRecipient = textValue(body, 'settlementRecipient', { required: true, max: 44 })!;
    if (!isSolanaAddress(settlementRecipient)) throw new HttpError(400, 'invalid settlement recipient');
    const settlementAmount = decimal(body, 'settlementAmount');
    const expectedOutputs = stringList(body, 'expectedOutputs', 16);
    const now = new Date().toISOString();
    const workOrder = createWorkOrder({
      workOrderId: `wo_${randomUUID()}`,
      ...(machineId === null ? {} : { machineId }),
      requirement: {
        capabilities: validatedRequiredCapabilities,
        telemetryRequired: optionalBoolean(body, 'telemetryRequired', false),
        proofRequired: optionalBoolean(body, 'proofRequired', false),
        expectedOutputs: [...expectedOutputs],
      },
      settlement: { chain: 'solana', amount: settlementAmount, asset: settlementAsset, recipient: settlementRecipient },
    }, now);
    const record: PersistentWorkOrder = {
      workOrderId: workOrder.workOrderId,
      ownerUserId: authenticated.record.userId,
      machineId: workOrder.machineId ?? null,
      stage: workOrder.stage,
      requiredCapabilities: workOrder.requirement.capabilities,
      telemetryRequired: workOrder.requirement.telemetryRequired ?? false,
      proofRequired: workOrder.requirement.proofRequired ?? false,
      expectedOutputs: workOrder.requirement.expectedOutputs ?? [],
      settlementChain: workOrder.settlement.chain,
      settlementAmount: workOrder.settlement.amount,
      settlementAsset: workOrder.settlement.asset,
      settlementRecipient: workOrder.settlement.recipient,
      telemetryRef: null,
      proofId: null,
      settlementIntentId: null,
      resultRef: null,
      createdAt: workOrder.createdAt,
      updatedAt: workOrder.updatedAt,
    };
    if (!await runtime.store.createWorkOrder(record)) throw new HttpError(409, 'work order could not be created');
    sendJson(res, 201, { ok: true, workOrder: publicWorkOrder(record) });
    return true;
  }

  const machineTelemetryMatch = /^\/api\/machines\/([^/]+)\/telemetry$/u.exec(path);
  if (machineTelemetryMatch) {
    const machineId = safeSegment(machineTelemetryMatch[1]!);
    if (req.method === 'GET') {
      const authenticated = await runtime.auth.authenticate(req);
      await requireOwnedMachine(runtime, authenticated.record.userId, machineId);
      sendJson(res, 200, { ok: true, events: await runtime.store.recentTelemetry(
        authenticated.record.userId,
        machineId,
        requestedListLimit(req)
      ) });
      return true;
    }
    jsonMutation(req, res);
    const bearer = credentialFromRequest(req);
    const ip = requestIp(req);
    telemetryGlobalLimiter.assert('global');
    telemetryIpLimiter.assert(ip);
    const now = new Date();
    const credential = await runtime.store.machineCredential(bearer.id, sha256(bearer.token), now.toISOString());
    if (!credential || credential.machineId !== machineId) throw new HttpError(403, 'machine credential is invalid for this machine');
    telemetryLimiter.assert(bearer.id);
    const machine = await runtime.store.machine(machineId);
    if (!machine) throw new HttpError(404, 'machine not found');
    const body = await readJsonBody(req);
    const health = body['health'];
    if (health !== 'nominal' && health !== 'degraded' && health !== 'faulted' && health !== 'offline') throw new HttpError(400, 'invalid telemetry health');
    const observedAt = textValue(body, 'observedAt', { required: true, max: 64 })!;
    const batteryPct = optionalFinite(body, 'batteryPct');
    const signalPct = optionalFinite(body, 'signalPct');
    const progressPct = optionalFinite(body, 'progressPct');
    const telemetryRef = textValue(body, 'telemetryRef', { max: 128 });
    const location = telemetryPoint(body, 'location');
    const pose = telemetryPoint(body, 'pose');
    let snapshot: MachineTelemetrySnapshot;
    try {
      snapshot = normalizeTelemetrySnapshot({
        machineId,
        observedAt,
        health,
        ...(batteryPct === undefined ? {} : { batteryPct }),
        ...(signalPct === undefined ? {} : { signalPct }),
        ...(progressPct === undefined ? {} : { progressPct }),
        ...(telemetryRef === undefined ? {} : { telemetryRef }),
        ...(location === undefined ? {} : { location: location as unknown as NonNullable<MachineTelemetrySnapshot['location']> }),
        ...(pose === undefined ? {} : { pose: pose as unknown as NonNullable<MachineTelemetrySnapshot['pose']> }),
      });
    }
    catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'invalid telemetry snapshot'); }
    const observedMs = Date.parse(snapshot.observedAt);
    if (observedMs > now.getTime() + 2 * 60_000 || observedMs < now.getTime() - 24 * 60 * 60_000) {
      throw new HttpError(422, 'telemetry observedAt is outside the accepted clock-skew window');
    }
    const event = { id: randomUUID(), machineId, receivedAt: now.toISOString(), snapshot };
    const retentionDays = config.telemetryRetentionDays ?? DEFAULT_TELEMETRY_RETENTION_DAYS;
    const maxEventsPerMachine = config.telemetryMaxEventsPerMachine ?? DEFAULT_TELEMETRY_MAX_EVENTS_PER_MACHINE;
    await runtime.store.insertTelemetry(
      event,
      new Date(now.getTime() - retentionDays * 86_400_000).toISOString(),
      maxEventsPerMachine
    );
    runtime.telemetryHub.publish(machine.ownerUserId, event);
    sendJson(res, 202, { ok: true, accepted: true, eventId: event.id, receivedAt: event.receivedAt });
    return true;
  }

  if (path === '/api/telemetry') {
    if (req.method !== 'GET') throw new HttpError(405, 'use GET');
    const authenticated = await runtime.auth.authenticate(req);
    const params = new URL(req.url ?? path, 'http://localhost').searchParams;
    const machineId = params.get('machineId');
    const latestRaw = params.get('latest');
    if (latestRaw !== null && latestRaw !== 'true' && latestRaw !== 'false') {
      throw new HttpError(400, 'latest must be true or false');
    }
    const latest = latestRaw === 'true';
    if (latest && machineId !== null) throw new HttpError(400, 'latest=true cannot be combined with machineId');
    if (machineId !== null) await requireOwnedMachine(runtime, authenticated.record.userId, safeSegment(machineId));
    const limit = requestedListLimit(req);
    const events = latest
      ? await runtime.store.latestTelemetry(authenticated.record.userId, limit)
      : await runtime.store.recentTelemetry(authenticated.record.userId, machineId, limit);
    sendJson(res, 200, { ok: true, events });
    return true;
  }

  if (path === '/api/telemetry/stream') {
    if (req.method !== 'GET') throw new HttpError(405, 'use GET');
    const authenticated = await runtime.auth.authenticate(req);
    const machines = await runtime.store.listOwnedMachines(authenticated.record.userId);
    if (!runtime.telemetryHub.canSubscribe(authenticated.record.userId)) {
      throw new HttpError(429, 'telemetry stream subscriber limit reached; retry later');
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-content-type-options': 'nosniff',
      'x-accel-buffering': 'no',
    });
    res.write('event: ready\ndata: {"ok":true}\n\n');
    const unsubscribe = runtime.telemetryHub.subscribe(authenticated.record.userId, machines.map((machine) => machine.machineId), res);
    const expiresInMs = Math.max(1, Date.parse(authenticated.record.expiresAt) - Date.now());
    const expiryTimer = setTimeout(() => {
      unsubscribe();
      if (!res.destroyed) res.end();
    }, expiresInMs);
    expiryTimer.unref();
    req.once('close', () => {
      clearTimeout(expiryTimer);
      unsubscribe();
    });
    return true;
  }

  if (path === '/api/marketplace/providers') {
    if (req.method !== 'GET') throw new HttpError(405, 'use GET');
    await runtime.auth.authenticate(req);
    const params = new URL(req.url ?? path, 'http://localhost').searchParams;
    const resourceType = params.get('resourceType')?.trim() ?? '';
    if (!isResourceType(resourceType)) throw new HttpError(400, 'resourceType must be a supported resource type');
    const preferredRails = [...new Set(params.getAll('preferredRail')
      .flatMap((value) => value.split(','))
      .map((value) => value.trim())
      .filter(Boolean))];
    if (preferredRails.length > 16 || preferredRails.some((rail) => rail.length > 64)) {
      throw new HttpError(400, 'preferredRail must contain at most 16 short rail identifiers');
    }
    const maxPriceInput = params.get('maxPrice');
    const maxPrice = maxPriceInput === null ? null : decimal({ maxPrice: maxPriceInput }, 'maxPrice');
    const providers = await runtime.store.findProviderCapabilities({
      resourceType,
      preferredRails,
      maxPrice,
      capabilityId: null,
    }, requestedListLimit(req));
    sendJson(res, 200, { ok: true, providers: providers.map(withoutOwner) });
    return true;
  }

  if (path === '/api/marketplace/capabilities') {
    const authenticated = await runtime.auth.authenticate(req, req.method === 'POST');
    if (req.method === 'GET') {
      const capabilities = await runtime.store.listProviderCapabilities(authenticated.record.userId, requestedListLimit(req));
      sendJson(res, 200, { ok: true, capabilities: capabilities.map(withoutOwner) });
      return true;
    }
    jsonMutation(req, res);
    assertOriginAllowed(req, config);
    assertMutationRate(req, authenticated.record.userId, 'marketplace-capabilities');
    const body = await readJsonBody(req);
    const providerMachineId = textValue(body, 'providerMachineId', { required: true, max: 64 })!;
    await requireOwnedMachine(runtime, authenticated.record.userId, providerMachineId);
    const resourceType = textValue(body, 'resourceType', { required: true, max: 64 })!;
    if (!isResourceType(resourceType)) throw new HttpError(400, 'unsupported resourceType');
    const availability = textValue(body, 'availability', { max: 32 }) ?? 'available';
    if (availability !== 'available' && availability !== 'limited' && availability !== 'unavailable') throw new HttpError(400, 'invalid availability');
    const { priceAmount, priceAsset } = nullablePrice(body);
    const now = new Date().toISOString();
    const capability = await runtime.store.createProviderCapability(authenticated.record.userId, {
      providerMachineId,
      resourceType,
      label: textValue(body, 'label', { required: true, max: 128 })!,
      unit: textValue(body, 'unit', { required: true, max: 64 })!,
      railTags: stringList(body, 'railTags'),
      availability,
      priceAmount,
      priceAsset,
    }, now);
    if (!capability) throw new HttpError(409, 'provider capability already exists or machine ownership changed');
    sendJson(res, 201, { ok: true, capability: withoutOwner(capability) });
    return true;
  }

  const capabilityMatch = /^\/api\/marketplace\/capabilities\/([^/]+)$/u.exec(path);
  if (capabilityMatch) {
    const authenticated = await runtime.auth.authenticate(req, req.method === 'PATCH');
    const capabilityId = safeSegment(capabilityMatch[1]!);
    if (req.method === 'GET') {
      const capability = await runtime.store.providerCapability(authenticated.record.userId, capabilityId);
      if (!capability) throw new HttpError(404, 'provider capability not found');
      sendJson(res, 200, { ok: true, capability: withoutOwner(capability) });
      return true;
    }
    jsonMutation(req, res, 'PATCH');
    assertOriginAllowed(req, config);
    assertMutationRate(req, authenticated.record.userId, 'marketplace-capabilities');
    const current = await runtime.store.providerCapability(authenticated.record.userId, capabilityId);
    if (!current || current.ownerUserId !== authenticated.record.userId) throw new HttpError(404, 'provider capability not found');
    const body = await readJsonBody(req);
    const availability = textValue(body, 'availability', { max: 32 }) ?? current.availability;
    if (availability !== 'available' && availability !== 'limited' && availability !== 'unavailable') throw new HttpError(400, 'invalid availability');
    const price = nullablePrice(body, current);
    let updated: ProviderCapabilityRow | null;
    try {
      updated = await runtime.store.updateProviderCapability(authenticated.record.userId, capabilityId, {
        label: textValue(body, 'label', { max: 128 }) ?? current.label,
        unit: textValue(body, 'unit', { max: 64 }) ?? current.unit,
        railTags: body['railTags'] === undefined ? current.railTags : stringList(body, 'railTags'),
        availability,
        ...price,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (isPersistenceConstraintError(error)) throw new HttpError(409, 'provider capability label conflicts on this machine');
      throw error;
    }
    if (!updated) throw new HttpError(409, 'provider capability label conflicts or capability changed');
    sendJson(res, 200, { ok: true, capability: withoutOwner(updated) });
    return true;
  }

  if (path === '/api/marketplace/provider/requests') {
    if (req.method !== 'GET') throw new HttpError(405, 'use GET');
    const authenticated = await runtime.auth.authenticate(req);
    const requests = await runtime.store.listProviderResourceRequests(authenticated.record.userId, requestedListLimit(req));
    sendJson(res, 200, { ok: true, requests: requests.map(withoutOwner) });
    return true;
  }

  if (path === '/api/marketplace/requests') {
    const authenticated = await runtime.auth.authenticate(req, req.method === 'POST');
    if (req.method === 'GET') {
      const requests = await runtime.store.listResourceRequests(authenticated.record.userId, requestedListLimit(req));
      sendJson(res, 200, { ok: true, requests: requests.map(withoutOwner) });
      return true;
    }
    jsonMutation(req, res);
    assertOriginAllowed(req, config);
    assertMutationRate(req, authenticated.record.userId, 'marketplace-requests');
    const body = await readJsonBody(req);
    const requesterMachineId = textValue(body, 'requesterMachineId', { required: true, max: 64 })!;
    await requireOwnedMachine(runtime, authenticated.record.userId, requesterMachineId);
    const resourceType = textValue(body, 'resourceType', { required: true, max: 64 })!;
    if (!isResourceType(resourceType)) throw new HttpError(400, 'unsupported resourceType');
    const preferredRails = stringList(body, 'preferredRails');
    const quantity = decimal(body, 'quantity');
    const maxPrice = decimal(body, 'maxPrice');
    const capabilityId = textValue(body, 'capabilityId', { max: 128 }) ?? null;
    let capability: ProviderCapabilityRow | null = null;
    if (capabilityId !== null) {
      capability = await runtime.store.providerCapability(null, capabilityId);
      if (!capability || capability.availability === 'unavailable') throw new HttpError(404, 'provider capability not found or unavailable');
      if (capability.resourceType !== resourceType) throw new HttpError(422, 'selected capability does not match resourceType');
      if (preferredRails.length && !preferredRails.some((rail) => capability?.railTags.includes(rail))) {
        throw new HttpError(422, 'selected capability has no compatible runtime rail');
      }
      if (capability.priceAmount !== null && !priceWithinLimit(capability.priceAmount, maxPrice)) {
        throw new HttpError(422, 'provider advertised price exceeds maxPrice');
      }
    }
    const now = new Date().toISOString();
    const request: PersistentResourceRequest = {
      id: randomUUID(),
      ownerUserId: authenticated.record.userId,
      requesterMachineId,
      capabilityId,
      providerMachineId: capability?.providerMachineId ?? null,
      resourceType,
      quantity,
      maxPrice,
      preferredRails,
      purpose: textValue(body, 'purpose', { required: true, max: 256 })!,
      quoteAmount: null,
      quoteAsset: null,
      state: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    try {
      await runtime.store.createResourceRequest(request);
    } catch (error) {
      if (isPersistenceConstraintError(error)) throw new HttpError(409, 'resource request could not be created');
      throw error;
    }
    sendJson(res, 201, { ok: true, request: withoutOwner(request) });
    return true;
  }

  const requestStateActionMatch = /^\/api\/marketplace\/requests\/([^/]+)\/(cancel|reject)$/u.exec(path);
  if (requestStateActionMatch) {
    jsonMutation(req, res);
    assertOriginAllowed(req, config);
    const authenticated = await runtime.auth.authenticate(req, true);
    assertMutationRate(req, authenticated.record.userId, 'marketplace-requests');
    const requestId = safeSegment(requestStateActionMatch[1]!);
    const action = requestStateActionMatch[2]!;
    if (action === 'cancel' && !await runtime.store.resourceRequest(authenticated.record.userId, requestId)) {
      throw new HttpError(404, 'resource request not found');
    }
    const updated = action === 'cancel'
      ? await runtime.store.cancelResourceRequest(authenticated.record.userId, requestId, new Date().toISOString())
      : await runtime.store.rejectResourceRequest(authenticated.record.userId, requestId, new Date().toISOString());
    if (!updated) {
      throw new HttpError(409, action === 'cancel'
        ? 'resource request is no longer cancellable'
        : 'only the selected provider can reject a targeted pending request');
    }
    sendJson(res, 200, { ok: true, [action === 'cancel' ? 'cancelled' : 'rejected']: true, request: withoutOwner(updated) });
    return true;
  }

  const compatibleProvidersMatch = /^\/api\/marketplace\/requests\/([^/]+)\/compatible-providers$/u.exec(path);
  if (compatibleProvidersMatch) {
    if (req.method !== 'GET') throw new HttpError(405, 'use GET');
    const authenticated = await runtime.auth.authenticate(req);
    const request = await runtime.store.resourceRequest(authenticated.record.userId, safeSegment(compatibleProvidersMatch[1]!));
    if (!request) throw new HttpError(404, 'resource request not found');
    const capabilities = await runtime.store.findProviderCapabilities({
      resourceType: request.resourceType,
      preferredRails: request.preferredRails,
      maxPrice: request.maxPrice,
      capabilityId: request.capabilityId,
    }, requestedListLimit(req));
    sendJson(res, 200, { ok: true, capabilities: capabilities.map(withoutOwner) });
    return true;
  }

  const selectProviderMatch = /^\/api\/marketplace\/requests\/([^/]+)\/select-provider$/u.exec(path);
  if (selectProviderMatch) {
    jsonMutation(req, res);
    assertOriginAllowed(req, config);
    const authenticated = await runtime.auth.authenticate(req, true);
    assertMutationRate(req, authenticated.record.userId, 'marketplace-requests');
    const requestId = safeSegment(selectProviderMatch[1]!);
    const request = await runtime.store.resourceRequest(authenticated.record.userId, requestId);
    if (!request) throw new HttpError(404, 'resource request not found');
    const body = await readJsonBody(req);
    const capability = await runtime.store.providerCapability(null, textValue(body, 'capabilityId', { required: true, max: 128 })!);
    if (!capability || capability.availability === 'unavailable') throw new HttpError(404, 'provider capability not found or unavailable');
    if (capability.resourceType !== request.resourceType ||
      (request.preferredRails.length > 0 && !request.preferredRails.some((rail) => capability.railTags.includes(rail))) ||
      (capability.priceAmount !== null && !priceWithinLimit(capability.priceAmount, request.maxPrice))) {
      throw new HttpError(422, 'provider capability is not compatible with this request');
    }
    const updated = await runtime.store.transitionResourceRequest(
      authenticated.record.userId,
      requestId,
      ['pending'],
      'pending',
      capability.providerMachineId,
      capability.id,
      new Date().toISOString()
    );
    if (!updated) throw new HttpError(409, 'resource request is no longer selectable');
    sendJson(res, 200, { ok: true, request: withoutOwner(updated), capability: withoutOwner(capability) });
    return true;
  }

  const requestQuotesMatch = /^\/api\/marketplace\/requests\/([^/]+)\/quotes$/u.exec(path);
  if (requestQuotesMatch) {
    const authenticated = await runtime.auth.authenticate(req, req.method === 'POST');
    const requestId = safeSegment(requestQuotesMatch[1]!);
    if (req.method === 'GET') {
      const request = await runtime.store.resourceRequest(authenticated.record.userId, requestId) ??
        await runtime.store.providerResourceRequest(authenticated.record.userId, requestId);
      if (!request) throw new HttpError(404, 'resource request not found');
      const quotes = await runtime.store.listResourceQuotes(
        authenticated.record.userId,
        requestId,
        requestedListLimit(req),
        new Date().toISOString()
      );
      sendJson(res, 200, { ok: true, quotes: quotes.map(publicQuote) });
      return true;
    }
    jsonMutation(req, res);
    assertOriginAllowed(req, config);
    assertMutationRate(req, authenticated.record.userId, 'marketplace-quotes');
    const body = await readJsonBody(req);
    const expiresAt = optionalIsoTimestamp(body, 'expiresAt');
    const now = new Date().toISOString();
    if (expiresAt !== null && expiresAt <= now) throw new HttpError(422, 'quote expiresAt must be in the future');
    const asset = textValue(body, 'asset', { max: 16 }) ?? 'SOL';
    if (asset !== 'SOL') throw new HttpError(400, 'SOL is the only executable settlement asset');
    const quote = await runtime.store.createResourceQuote(authenticated.record.userId, {
      resourceRequestId: requestId,
      capabilityId: textValue(body, 'capabilityId', { required: true, max: 128 })!,
      amount: decimal(body, 'amount'),
      asset,
      expiresAt,
    }, now);
    if (!quote) throw new HttpError(409, 'quote is unauthorized, incompatible, duplicate, or outside request limits');
    sendJson(res, 201, { ok: true, quote: publicQuote(quote) });
    return true;
  }

  const withdrawQuoteMatch = /^\/api\/marketplace\/quotes\/([^/]+)\/withdraw$/u.exec(path);
  if (withdrawQuoteMatch) {
    jsonMutation(req, res);
    assertOriginAllowed(req, config);
    const authenticated = await runtime.auth.authenticate(req, true);
    assertMutationRate(req, authenticated.record.userId, 'marketplace-quotes');
    const withdrawn = await runtime.store.withdrawResourceQuote(
      authenticated.record.userId,
      safeSegment(withdrawQuoteMatch[1]!),
      new Date().toISOString()
    );
    if (!withdrawn) throw new HttpError(409, 'quote is unauthorized, expired, accepted, or already withdrawn');
    sendJson(res, 200, {
      ok: true,
      withdrawn: true,
      request: withoutOwner(withdrawn.request),
      quote: publicQuote(withdrawn.quote),
    });
    return true;
  }

  const acceptRequestMatch = /^\/api\/marketplace\/requests\/([^/]+)\/accept$/u.exec(path);
  const acceptQuoteMatch = /^\/api\/marketplace\/requests\/([^/]+)\/quotes\/([^/]+)\/accept$/u.exec(path);
  if (acceptQuoteMatch) {
    jsonMutation(req, res);
    assertOriginAllowed(req, config);
    const authenticated = await runtime.auth.authenticate(req, true);
    assertMutationRate(req, authenticated.record.userId, 'marketplace-quotes');
    const accepted = await runtime.store.acceptResourceQuote(
      authenticated.record.userId,
      safeSegment(acceptQuoteMatch[1]!),
      safeSegment(acceptQuoteMatch[2]!),
      new Date().toISOString()
    );
    if (!accepted) throw new HttpError(409, 'quote is unavailable, expired, or resource request is not selectable');
    sendJson(res, 200, { ok: true, request: withoutOwner(accepted.request), quote: publicQuote(accepted.quote) });
    return true;
  }

  if (acceptRequestMatch) {
    jsonMutation(req, res);
    assertOriginAllowed(req, config);
    const authenticated = await runtime.auth.authenticate(req, true);
    assertMutationRate(req, authenticated.record.userId, 'marketplace-quotes');
    const body = await readJsonBody(req);
    const accepted = await runtime.store.acceptResourceQuote(
      authenticated.record.userId,
      safeSegment(acceptRequestMatch[1]!),
      textValue(body, 'quoteId', { required: true, max: 128 })!,
      new Date().toISOString()
    );
    if (!accepted) throw new HttpError(409, 'quote is unavailable, expired, or resource request is not selectable');
    sendJson(res, 200, { ok: true, request: withoutOwner(accepted.request), quote: publicQuote(accepted.quote) });
    return true;
  }

  const requestGrantMatch = /^\/api\/marketplace\/requests\/([^/]+)\/grant$/u.exec(path);
  if (requestGrantMatch) {
    const authenticated = await runtime.auth.authenticate(req, req.method === 'POST');
    const requestId = safeSegment(requestGrantMatch[1]!);
    if (req.method === 'GET') {
      const grant = await runtime.store.accessGrant(authenticated.record.userId, requestId, new Date().toISOString());
      sendJson(res, 200, { ok: true, grant: grant ? publicGrant(grant) : null });
      return true;
    }
    jsonMutation(req, res);
    assertOriginAllowed(req, config);
    assertMutationRate(req, authenticated.record.userId, 'marketplace-grants');
    const body = await readJsonBody(req);
    const expiresAt = optionalIsoTimestamp(body, 'expiresAt');
    const now = new Date().toISOString();
    if (expiresAt !== null && expiresAt <= now) throw new HttpError(422, 'grant expiresAt must be in the future');
    const grant = await runtime.store.createAccessGrant(authenticated.record.userId, {
      resourceRequestId: requestId,
      resourceQuoteId: textValue(body, 'quoteId', { required: true, max: 128 })!,
      accessReference: optionalTextOrNull(body, 'accessReference', 256),
      expiresAt,
    }, now);
    if (!grant) throw new HttpError(409, 'access grant requires an accepted provider-owned quote and must be unique');
    sendJson(res, 201, { ok: true, grant: publicGrant(grant) });
    return true;
  }

  const grantActionMatch = /^\/api\/marketplace\/grants\/([^/]+)\/(activate|revoke|expire)$/u.exec(path);
  if (grantActionMatch) {
    jsonMutation(req, res);
    assertOriginAllowed(req, config);
    const authenticated = await runtime.auth.authenticate(req, true);
    assertMutationRate(req, authenticated.record.userId, 'marketplace-grants');
    const action = grantActionMatch[2]!;
    const from = action === 'activate' || action === 'revoke' ? 'pending' : 'active';
    let grant = await runtime.store.transitionAccessGrant(
      authenticated.record.userId,
      safeSegment(grantActionMatch[1]!),
      from,
      action === 'activate' ? 'active' : action === 'expire' ? 'expired' : 'revoked',
      new Date().toISOString()
    );
    if (!grant && action === 'revoke') {
      grant = await runtime.store.transitionAccessGrant(
        authenticated.record.userId,
        safeSegment(grantActionMatch[1]!),
        'active',
        'revoked',
        new Date().toISOString()
      );
    }
    if (!grant && action === 'expire') {
      grant = await runtime.store.transitionAccessGrant(
        authenticated.record.userId,
        safeSegment(grantActionMatch[1]!),
        'pending',
        'expired',
        new Date().toISOString()
      );
    }
    if (!grant) throw new HttpError(409, 'access grant transition is unauthorized or invalid');
    sendJson(res, 200, { ok: true, grant: publicGrant(grant) });
    return true;
  }

  const receiptSettlementMatch = /^\/api\/marketplace\/requests\/([^/]+)\/receipt-settlement$/u.exec(path);
  if (receiptSettlementMatch) {
    if (req.method !== 'GET') throw new HttpError(405, 'use GET');
    const authenticated = await runtime.auth.authenticate(req);
    const settlement = await runtime.store.receiptSettlement(
      authenticated.record.userId,
      safeSegment(receiptSettlementMatch[1]!)
    );
    if (!settlement) throw new HttpError(404, 'confirmed receipt-linked settlement not found');
    sendJson(res, 200, { ok: true, settlement });
    return true;
  }

  const requestReceiptMatch = /^\/api\/marketplace\/requests\/([^/]+)\/receipt$/u.exec(path);
  if (requestReceiptMatch) {
    const authenticated = await runtime.auth.authenticate(req, req.method === 'POST');
    const requestId = safeSegment(requestReceiptMatch[1]!);
    if (req.method === 'GET') {
      const receipt = await runtime.store.resourceReceipt(authenticated.record.userId, requestId);
      sendJson(res, 200, { ok: true, receipt: receipt ? publicReceipt(receipt) : null });
      return true;
    }
    jsonMutation(req, res);
    assertOriginAllowed(req, config);
    assertMutationRate(req, authenticated.record.userId, 'marketplace-receipts');
    const body = await readJsonBody(req);
    const accessGrantId = textValue(body, 'accessGrantId', { max: 128 }) ??
      textValue(body, 'grantId', { required: true, max: 128 })!;
    const receipt = await runtime.store.createResourceReceipt(authenticated.record.userId, {
      resourceRequestId: requestId,
      accessGrantId,
      settlementId: optionalTextOrNull(body, 'settlementId', 128),
      evidenceReference: optionalTextOrNull(body, 'evidenceReference', 256),
      resultReference: optionalTextOrNull(body, 'resultReference', 256),
    }, new Date().toISOString());
    if (!receipt) throw new HttpError(409, 'receipt requires an active provider-owned grant and valid confirmed settlement linkage');
    sendJson(res, 201, { ok: true, receipt: publicReceipt(receipt) });
    return true;
  }

  const receiptActionMatch = /^\/api\/marketplace\/receipts\/([^/]+)\/(verify|reject)$/u.exec(path);
  if (receiptActionMatch) {
    jsonMutation(req, res);
    assertOriginAllowed(req, config);
    const authenticated = await runtime.auth.authenticate(req, true);
    assertMutationRate(req, authenticated.record.userId, 'marketplace-receipts');
    const receipt = await runtime.store.transitionResourceReceipt(
      authenticated.record.userId,
      safeSegment(receiptActionMatch[1]!),
      'recorded',
      receiptActionMatch[2] === 'verify' ? 'verified' : 'rejected',
      new Date().toISOString()
    );
    if (!receipt) throw new HttpError(409, 'receipt transition is unauthorized or invalid');
    sendJson(res, 200, { ok: true, receipt: publicReceipt(receipt) });
    return true;
  }

  const requestDetailMatch = /^\/api\/marketplace\/requests\/([^/]+)$/u.exec(path);
  if (requestDetailMatch) {
    if (req.method !== 'GET') throw new HttpError(405, 'use GET');
    const authenticated = await runtime.auth.authenticate(req);
    const requestId = safeSegment(requestDetailMatch[1]!);
    const request = await runtime.store.resourceRequest(authenticated.record.userId, requestId) ??
      await runtime.store.providerResourceRequest(authenticated.record.userId, requestId);
    if (!request) throw new HttpError(404, 'resource request not found');
    const [quotes, grant, receipt] = await Promise.all([
      runtime.store.listResourceQuotes(
        authenticated.record.userId,
        requestId,
        requestedListLimit(req),
        new Date().toISOString()
      ),
      runtime.store.accessGrant(authenticated.record.userId, requestId, new Date().toISOString()),
      runtime.store.resourceReceipt(authenticated.record.userId, requestId),
    ]);
    const effectiveRequest = await runtime.store.resourceRequest(authenticated.record.userId, requestId) ??
      await runtime.store.providerResourceRequest(authenticated.record.userId, requestId) ?? request;
    sendJson(res, 200, {
      ok: true,
      request: withoutOwner(effectiveRequest),
      quotes: quotes.map(publicQuote),
      grant: grant ? publicGrant(grant) : null,
      receipt: receipt ? publicReceipt(receipt) : null,
    });
    return true;
  }

  if (path === '/api/settlements') {
    const authenticated = await runtime.auth.authenticate(req, req.method === 'POST');
    if (req.method === 'GET') {
      const settlements = await runtime.store.listSettlements(authenticated.record.userId, requestedListLimit(req));
      sendJson(res, 200, { ok: true, settlements: settlements.map(withoutOwner) });
      return true;
    }
    jsonMutation(req, res);
    assertOriginAllowed(req, config);
    assertMutationRate(req, authenticated.record.userId, 'settlements', settlementLimiter);
    const body = await readJsonBody(req);
    const resourceRequestId = textValue(body, 'resourceRequestId', { required: true, max: 128 })!;
    const resourceRequest = await runtime.store.resourceRequest(authenticated.record.userId, resourceRequestId);
    if (!resourceRequest || !['accepted', 'granted'].includes(resourceRequest.state) || resourceRequest.providerMachineId === null) {
      throw new HttpError(422, 'settlement requires an accepted or granted resource request with a persisted SOL quote');
    }
    const existing = await runtime.store.settlementForResourceRequest(authenticated.record.userId, resourceRequestId);
    if (existing) {
      if (existing.state === 'submitting' || existing.state === 'submitted' || existing.state === 'confirmed') {
        throw new HttpError(409, 'settlement already reached submission; resume status reconciliation instead');
      }
      sendJson(res, 200, {
        ok: true,
        settlement: withoutOwner(existing),
        resumed: true,
        resumable: existing.state !== 'failed' || existing.errorCode !== 'SUBMISSION_UNAVAILABLE',
      });
      return true;
    }
    const acceptedQuote = await runtime.store.acceptedResourceQuote(authenticated.record.userId, resourceRequestId);
    if (!acceptedQuote || acceptedQuote.asset !== 'SOL' || acceptedQuote.providerMachineId !== resourceRequest.providerMachineId ||
      acceptedQuote.capabilityId !== resourceRequest.capabilityId) {
      throw new HttpError(422, 'settlement requires the selected accepted SOL quote');
    }
    const requester = await requireOwnedMachine(runtime, authenticated.record.userId, resourceRequest.requesterMachineId);
    const provider = await runtime.store.machine(acceptedQuote.providerMachineId);
    if (!provider) throw new HttpError(409, 'provider machine is unavailable');
    const now = new Date().toISOString();
    const settlement: SettlementRecord = {
      id: randomUUID(),
      resourceRequestId: resourceRequest.id,
      resourceQuoteId: acceptedQuote.id,
      ownerUserId: authenticated.record.userId,
      machineId: requester.machineId,
      sourceWallet: authenticated.record.walletAddress,
      recipientWallet: provider.walletAddress,
      amountLamports: quotedSolToLamports(acceptedQuote.amount, resourceRequest.quantity).toString(),
      state: 'created',
      unsignedTransaction: null,
      transactionSignature: null,
      lastValidBlockHeight: null,
      errorCode: null,
      createdAt: now,
      updatedAt: now,
    };
    const created = await runtime.store.createSettlementForAcceptedRequest(settlement);
    if (!created) throw new HttpError(409, 'settlement already exists or trusted request/quote linkage changed');
    sendJson(res, 201, { ok: true, settlement: withoutOwner(created) });
    return true;
  }

  const settlementDetailMatch = /^\/api\/settlements\/([^/]+)$/u.exec(path);
  if (settlementDetailMatch) {
    if (req.method !== 'GET') throw new HttpError(405, 'use GET');
    const authenticated = await runtime.auth.authenticate(req);
    const settlement = await runtime.store.settlement(authenticated.record.userId, safeSegment(settlementDetailMatch[1]!));
    if (!settlement) throw new HttpError(404, 'settlement not found');
    sendJson(res, 200, { ok: true, settlement: withoutOwner(settlement) });
    return true;
  }

  const settlementActionMatch = /^\/api\/settlements\/([^/]+)\/(prepare|submit|confirm|cancel)$/u.exec(path);
  if (settlementActionMatch) {
    jsonMutation(req, res);
    assertOriginAllowed(req, config);
    const authenticated = await runtime.auth.authenticate(req, true);
    assertMutationRate(req, authenticated.record.userId, 'settlements', settlementLimiter);
    const settlementId = safeSegment(settlementActionMatch[1]!);
    const action = settlementActionMatch[2]!;
    const settlement = await runtime.store.settlement(authenticated.record.userId, settlementId);
    if (!settlement) throw new HttpError(404, 'settlement not found');
    const now = new Date().toISOString();
    if (action === 'cancel') {
      if (settlement.state !== 'created' && settlement.state !== 'awaiting_signature') {
        throw new HttpError(409, 'only an unsubmitted settlement can be cancelled');
      }
      const updated = await runtime.store.transitionSettlement(authenticated.record.userId, settlementId, settlement.state, {
        state: 'cancelled', updatedAt: now, errorCode: 'SIGNING_CANCELLED',
      });
      if (!updated) throw new HttpError(409, 'settlement state changed while cancelling');
      sendJson(res, 200, { ok: true, cancelled: true, settlement: withoutOwner(updated) });
      return true;
    }
    if (action === 'prepare') {
      if (settlement.state === 'awaiting_signature' && settlement.unsignedTransaction !== null && settlement.lastValidBlockHeight !== null) {
        sendJson(res, 200, {
          ok: true,
          settlement: withoutOwner(settlement),
          unsignedTransaction: settlement.unsignedTransaction,
          signingMode: 'caller-wallet',
          broadcast: false,
          resumed: true,
        });
        return true;
      }
      if (settlement.state !== 'created' && settlement.state !== 'cancelled' && settlement.state !== 'failed') {
        throw new HttpError(409, 'settlement is not ready to prepare');
      }
      let prepared: Awaited<ReturnType<typeof prepareSolTransfer>>;
      try {
        prepared = await prepareSolTransfer(
          runtime.rpc,
          settlement.sourceWallet,
          settlement.recipientWallet,
          BigInt(settlement.amountLamports),
          settlement.id
        );
      } catch (error) {
        if (error instanceof SolanaTransactionError) {
          sendSolanaError(res, error);
          return true;
        }
        sendSolanaError(res, new SolanaTransactionError('INVALID_BLOCKHASH_RESPONSE', true, error));
        return true;
      }
      const updated = await runtime.store.transitionSettlement(authenticated.record.userId, settlementId, settlement.state, {
        state: 'awaiting_signature',
        updatedAt: now,
        unsignedTransaction: prepared.base64,
        transactionSignature: null,
        lastValidBlockHeight: prepared.lastValidBlockHeight,
        errorCode: null,
      });
      if (!updated) throw new HttpError(409, 'settlement state changed while preparing');
      sendJson(res, 200, { ok: true, settlement: updated ? withoutOwner(updated) : null, unsignedTransaction: prepared.base64, signingMode: 'caller-wallet', broadcast: false });
      return true;
    }
    if (action === 'submit') {
      if (settlement.state !== 'awaiting_signature' || settlement.unsignedTransaction === null || settlement.lastValidBlockHeight === null) {
        throw new HttpError(409, 'settlement is not awaiting a valid wallet signature');
      }
      const body = await readJsonBody(req);
      let inspected: ReturnType<typeof inspectSignedTransaction>;
      try { inspected = inspectSignedTransaction(textValue(body, 'signedTransaction', { required: true, max: 2048 })!, settlement.unsignedTransaction); }
      catch (error) {
        if (error instanceof SolanaTransactionError) {
          sendSolanaError(res, error);
          return true;
        }
        sendSolanaError(res, new SolanaTransactionError('INVALID_SIGNED_TRANSACTION', false, error));
        return true;
      }
      let claimed: SettlementRecord | null;
      try {
        claimed = await runtime.store.transitionSettlement(authenticated.record.userId, settlementId, 'awaiting_signature', {
          state: 'submitting', updatedAt: now, transactionSignature: inspected.signature, errorCode: null,
        });
      } catch (error) {
        if (isPersistenceConstraintError(error)) throw new HttpError(409, 'transaction signature is already claimed by another settlement');
        throw error;
      }
      if (!claimed) throw new HttpError(409, 'settlement state changed or transaction signature is already claimed');
      try {
        const rpcSignature = await submitSignedTransaction(runtime.rpc, inspected.bytes, { lastValidBlockHeight: settlement.lastValidBlockHeight });
        if (rpcSignature !== inspected.signature) throw new SolanaTransactionError('INVALID_SUBMISSION_RESPONSE');
        const updated = await runtime.store.transitionSettlement(authenticated.record.userId, settlementId, 'submitting', { state: 'submitted', updatedAt: new Date().toISOString(), transactionSignature: rpcSignature });
        if (!updated) {
          sendJson(res, 503, {
            ok: false,
            error: { code: 'SETTLEMENT_STATE_PERSISTENCE_FAILED', message: 'transaction was submitted but settlement state persistence requires reconciliation', retryable: false },
            transactionSignature: rpcSignature,
            reconciliationRequired: true,
          });
          return true;
        }
        sendJson(res, 202, { ok: true, settlement: updated ? withoutOwner(updated) : null, submitted: true, confirmed: false });
      } catch (error) {
        const safeError = error instanceof SolanaTransactionError
          ? error
          : new SolanaTransactionError('SUBMISSION_UNAVAILABLE', true, error);
        if (safeError.code === 'SUBMISSION_UNAVAILABLE' || safeError.code === 'INVALID_SUBMISSION_RESPONSE') {
          const reconciling = await runtime.store.transitionSettlement(authenticated.record.userId, settlementId, 'submitting', {
            state: 'submitting',
            updatedAt: new Date().toISOString(),
            transactionSignature: inspected.signature,
            errorCode: safeError.code,
          });
          sendJson(res, 202, {
            ok: true,
            settlement: reconciling ? withoutOwner(reconciling) : withoutOwner(claimed),
            submitted: false,
            confirmed: false,
            submissionState: 'unknown',
            reconciliationRequired: true,
            error: { code: safeError.code, message: safeError.message, retryable: safeError.retryable },
          });
          return true;
        }
        await runtime.store.transitionSettlement(authenticated.record.userId, settlementId, 'submitting', {
          state: 'failed', updatedAt: new Date().toISOString(), errorCode: safeError.code,
        });
        sendSolanaError(res, safeError);
      }
      return true;
    }
    if ((settlement.state !== 'submitting' && settlement.state !== 'submitted') || settlement.transactionSignature === null) {
      throw new HttpError(409, 'settlement has not entered submission reconciliation');
    }
    let confirmation: Awaited<ReturnType<typeof getTransactionConfirmation>>;
    try {
      confirmation = await getTransactionConfirmation(runtime.rpc, settlement.transactionSignature);
    } catch (error) {
      sendSolanaError(res, error instanceof SolanaTransactionError
        ? error
        : new SolanaTransactionError('CONFIRMATION_UNAVAILABLE', true, error));
      return true;
    }
    let blockhashValidity: Awaited<ReturnType<typeof checkBlockhashValidity>> | undefined;
    if (confirmation.state === 'pending' && confirmation.visibility === 'not_found') {
      if (settlement.lastValidBlockHeight === null) throw new HttpError(409, 'submitted settlement is missing blockhash lifetime data');
      try { blockhashValidity = await checkBlockhashValidity(runtime.rpc, settlement.lastValidBlockHeight); }
      catch (error) {
        sendSolanaError(res, error instanceof SolanaTransactionError
          ? error
          : new SolanaTransactionError('BLOCKHEIGHT_UNAVAILABLE', true, error));
        return true;
      }
    }
    let reconcilingSettlement = settlement;
    if (settlement.state === 'submitting' && confirmation.state === 'pending' && confirmation.visibility === 'observed') {
      const observed = await runtime.store.transitionSettlement(authenticated.record.userId, settlementId, 'submitting', {
        state: 'submitted', updatedAt: now, transactionSignature: settlement.transactionSignature, errorCode: null,
      });
      if (!observed) throw new HttpError(409, 'settlement state changed while reconciling submission');
      reconcilingSettlement = observed;
    }
    const lifecycle = assessTransactionLifecycle({
      confirmation,
      submittedAt: settlement.updatedAt,
      ...(blockhashValidity === undefined ? {} : { blockhashValidity }),
    });
    if (lifecycle.state === 'pending') {
      sendJson(res, 200, {
        ok: true, settlement: withoutOwner(reconcilingSettlement), submitted: reconcilingSettlement.state === 'submitted', confirmed: false,
        state: 'pending', lifecycle: 'pending', retryAfterMs: lifecycle.retryAfterMs,
      });
      return true;
    }
    if (lifecycle.state === 'timed_out') {
      sendJson(res, 200, {
        ok: true, settlement: withoutOwner(reconcilingSettlement), submitted: reconcilingSettlement.state === 'submitted', confirmed: false,
        state: 'timed_out', lifecycle: 'timed_out', errorCode: lifecycle.errorCode, reconciliationRequired: true,
      });
      return true;
    }
    const failed = lifecycle.state === 'failed' || lifecycle.state === 'dropped';
    const updated = await runtime.store.transitionSettlement(authenticated.record.userId, settlementId, reconcilingSettlement.state, {
      state: failed ? 'failed' : 'confirmed',
      updatedAt: now,
      errorCode: failed ? lifecycle.errorCode : null,
    });
    if (!updated) throw new HttpError(409, 'settlement state changed while confirming');
    sendJson(res, 200, {
      ok: true,
      settlement: withoutOwner(updated),
      submitted: reconcilingSettlement.state === 'submitted' || lifecycle.state === 'confirmed' || lifecycle.state === 'failed',
      confirmed: lifecycle.state === 'confirmed',
      state: lifecycle.state,
      lifecycle: lifecycle.state,
      ...(lifecycle.state === 'dropped' ? { mayPrepareAgain: lifecycle.mayPrepareAgain } : {}),
    });
    return true;
  }

  return false;
}

function requestIp(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? 'unknown';
}
