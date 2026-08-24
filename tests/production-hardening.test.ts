import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  getTransactionDecoder,
  partiallySignTransaction,
  type KeyPairSigner,
} from '@solana/kit';
import { afterEach, describe, expect, it } from 'vitest';
import { encodeBase58 } from '../src/adapters/solana/validation.js';
import { resolveServerConfig, type ServerConfig } from '../src/server/config.js';
import { createRuntimeServer } from '../src/server/index.js';
import { quotedSolToLamports } from '../src/server/production/app.js';
import { MemoryProductionStore } from '../src/server/production/memory-store.js';
import { verifySolanaNetwork } from '../src/server/production/network.js';
import { createProductionRuntime, type ProductionRuntime } from '../src/server/production/runtime.js';
import type { RpcTransport } from '../src/transports/live-rpc.js';

const GENESIS = '11111111111111111111111111111111';
const BLOCKHASH = 'Sysvar1111111111111111111111111111111111111';

class TestRpc implements RpcTransport {
  readonly calls: string[] = [];
  async request<T>(method: string, params: unknown[] = []): Promise<T> {
    this.calls.push(method);
    if (method === 'getGenesisHash') return GENESIS as T;
    if (method === 'getLatestBlockhash') return { value: { blockhash: BLOCKHASH, lastValidBlockHeight: 1234 } } as T;
    if (method === 'getBlockHeight') return 1200 as T;
    if (method === 'simulateTransaction') return { value: { err: null, unitsConsumed: 500 } } as T;
    if (method === 'sendTransaction') {
      const transaction = getTransactionDecoder().decode(Buffer.from(String(params[0]), 'base64'));
      return String(getSignatureFromTransaction(transaction)) as T;
    }
    if (method === 'getSignatureStatuses') return { value: [{ err: null, confirmationStatus: 'confirmed' }] } as T;
    throw new Error(`unexpected RPC method ${method}`);
  }
}

const config = (): ServerConfig => ({
  host: '127.0.0.1',
  port: 0,
  allowLive: true,
  liveRpcUrl: 'https://operator-rpc.example.invalid',
  dataMode: 'production',
  databaseUrl: 'postgres://unused-in-test/database?sslmode=require',
  publicOrigin: 'http://127.0.0.1',
  solanaGenesisHash: GENESIS,
  solanaCluster: 'custom',
  secureCookies: false,
});

const listen = async (server: Server): Promise<string> => {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

const close = async (server: Server): Promise<void> =>
  new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

const json = async (base: string, path: string, init?: RequestInit) => {
  const response = await fetch(`${base}${path}`, init);
  return { response, body: await response.json() as Record<string, unknown> };
};

const responseSetCookies = (response: Response): readonly string[] => {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = headers.getSetCookie?.();
  if (values?.length) return values;
  const combined = response.headers.get('set-cookie');
  return combined ? [combined] : [];
};

const requestCookieHeader = (response: Response): string => responseSetCookies(response)
  .map((value) => value.split(';')[0]!)
  .join('; ');

const cookieValue = (response: Response, name: string): string => {
  const pair = responseSetCookies(response)
    .map((value) => value.split(';')[0]!)
    .find((value) => value.startsWith(`${name}=`));
  expect(pair, `expected Set-Cookie for ${name}`).toBeDefined();
  return pair!.slice(name.length + 1);
};

const requiredString = (body: Record<string, unknown>, key: string): string => {
  const value = body[key];
  expect(value, `expected response field ${key}`).toBeTypeOf('string');
  return value as string;
};

const requiredObject = (body: Record<string, unknown>, key: string): Record<string, unknown> => {
  const value = body[key];
  expect(value, `expected response field ${key}`).toBeTypeOf('object');
  expect(value).not.toBeNull();
  expect(Array.isArray(value)).toBe(false);
  return value as Record<string, unknown>;
};

const requiredArray = (body: Record<string, unknown>, key: string): readonly unknown[] => {
  const value = body[key];
  expect(value, `expected response field ${key}`).toBeInstanceOf(Array);
  return value as readonly unknown[];
};

async function authenticate(base: string, signer: KeyPairSigner): Promise<{ cookie: string; csrf: string }> {
  const challenged = await json(base, '/api/auth/challenge', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ walletAddress: signer.address }),
  });
  expect(challenged.response.status).toBe(201);
  const [signatures] = await signer.signMessages([{ content: new TextEncoder().encode(requiredString(challenged.body, 'message')), signatures: {} }]);
  const signature = signatures?.[signer.address];
  expect(signature).toBeDefined();
  const verified = await json(base, '/api/auth/verify', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      challengeId: requiredString(challenged.body, 'challengeId'),
      walletAddress: signer.address,
      signature: encodeBase58(signature!),
    }),
  });
  expect(verified.response.status).toBe(200);
  return {
    cookie: requestCookieHeader(verified.response),
    csrf: requiredString(verified.body, 'csrfToken'),
  };
}

describe('production configuration and network identity', () => {
  it('fails closed when mandatory production inputs are absent', () => {
    expect(() => resolveServerConfig({ MACHINEFI_TELEMETRY_RETENTION_DAYS: '0' })).toThrow(/between 1 and 3650/);
    expect(() => resolveServerConfig({ MACHINEFI_TELEMETRY_MAX_EVENTS_PER_MACHINE: '1000001' })).toThrow(/between 1 and 1000000/);
    expect(resolveServerConfig({
      MACHINEFI_TELEMETRY_RETENTION_DAYS: '14',
      MACHINEFI_TELEMETRY_MAX_EVENTS_PER_MACHINE: '2500',
    })).toMatchObject({ telemetryRetentionDays: 14, telemetryMaxEventsPerMachine: 2500 });
    expect(() => resolveServerConfig({}, ['--mode', 'production'])).toThrow(/DATABASE_URL/);
    expect(() => resolveServerConfig({
      MACHINEFI_DATA_MODE: 'production',
      MACHINEFI_DATABASE_URL: 'postgres://db/database',
      MACHINEFI_ALLOW_LIVE: '1',
      MACHINEFI_SOLANA_RPC_URL: 'https://rpc.example',
      MACHINEFI_SOLANA_GENESIS_HASH: GENESIS,
      MACHINEFI_PUBLIC_ORIGIN: 'https://console.example',
    })).toThrow(/PostgreSQL connections must require TLS/);
    expect(() => resolveServerConfig({
      MACHINEFI_DATA_MODE: 'production',
      MACHINEFI_DATABASE_URL: 'postgres://db/database?sslmode=require',
      MACHINEFI_ALLOW_LIVE: '1',
      MACHINEFI_SOLANA_RPC_URL: 'https://rpc.example',
      MACHINEFI_SOLANA_GENESIS_HASH: GENESIS,
      MACHINEFI_PUBLIC_ORIGIN: 'http://console.example',
    })).toThrow(/must use https/);
    expect(() => resolveServerConfig({
      MACHINEFI_DATA_MODE: 'production',
      MACHINEFI_DATABASE_URL: 'postgres://db/database?sslmode=require',
      MACHINEFI_ALLOW_LIVE: '1',
      MACHINEFI_SOLANA_RPC_URL: 'http://rpc.example',
      MACHINEFI_SOLANA_GENESIS_HASH: GENESIS,
      MACHINEFI_PUBLIC_ORIGIN: 'https://console.example',
      MACHINEFI_SECURE_COOKIES: '1',
    })).toThrow(/production Solana RPC endpoints must use https/);
    expect(resolveServerConfig({
      MACHINEFI_DATA_MODE: 'production',
      MACHINEFI_DATABASE_URL: 'postgres://db/database?sslmode=require',
      MACHINEFI_ALLOW_LIVE: '1',
      MACHINEFI_SOLANA_RPC_URL: 'http://127.0.0.1:8899',
      MACHINEFI_SOLANA_GENESIS_HASH: GENESIS,
      MACHINEFI_PUBLIC_ORIGIN: 'http://127.0.0.1:8787',
    }).liveRpcUrl).toBe('http://127.0.0.1:8899/');
  });

  it('checks the actual RPC genesis hash and aborts mismatches', async () => {
    await expect(verifySolanaNetwork({ request: async <T>() => 'wrong-network' as T }, GENESIS)).rejects.toThrow(/network mismatch/);
    await expect(verifySolanaNetwork({ request: async <T>() => GENESIS as T }, GENESIS)).resolves.toMatchObject({ verified: true, actualGenesisHash: GENESIS });
  });
});

describe('authenticated production vertical slice', () => {
  let server: Server | undefined;
  let runtime: ProductionRuntime | undefined;
  afterEach(async () => {
    if (server?.listening) await close(server);
    else if (runtime) await runtime.close();
    server = undefined;
    runtime = undefined;
  });

  it('verifies before atomic challenge consumption, rejects replay and expiry, and revokes sessions', async () => {
    const store = new MemoryProductionStore();
    const serverConfig = config();
    runtime = await createProductionRuntime(serverConfig, { store, rpc: new TestRpc() });
    server = createRuntimeServer(serverConfig, runtime);
    const base = await listen(server);
    serverConfig.publicOrigin = base;
    const signer = await generateKeyPairSigner();
    const attacker = await generateKeyPairSigner();

    const challenge = await json(base, '/api/auth/challenge', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ walletAddress: signer.address }),
    });
    const challengeId = requiredString(challenge.body, 'challengeId');
    const message = requiredString(challenge.body, 'message');
    const [signatures] = await signer.signMessages([{ content: new TextEncoder().encode(message), signatures: {} }]);
    const signature = signatures?.[signer.address];
    expect(signature).toBeDefined();
    const overlapping = await json(base, '/api/auth/challenge', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ walletAddress: signer.address }),
    });
    expect(overlapping.response.status).toBe(201);
    const overlappingId = requiredString(overlapping.body, 'challengeId');
    expect(await store.activeChallenge(challengeId, signer.address, new Date().toISOString())).not.toBeNull();
    expect(await store.activeChallenge(overlappingId, signer.address, new Date().toISOString())).not.toBeNull();

    const [attackerSignatures] = await attacker.signMessages([{
      content: new TextEncoder().encode(message), signatures: {},
    }]);
    const attackerSignature = attackerSignatures?.[attacker.address];
    expect(attackerSignature).toBeDefined();
    expect((await json(base, '/api/auth/verify', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        challengeId,
        walletAddress: signer.address,
        signature: encodeBase58(attackerSignature!),
      }),
    })).response.status).toBe(401);
    expect(await store.activeChallenge(challengeId, signer.address, new Date().toISOString())).not.toBeNull();

    const verificationRequest: RequestInit = {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ challengeId, walletAddress: signer.address, signature: encodeBase58(signature!) }),
    };
    const concurrent = await Promise.all([
      json(base, '/api/auth/verify', verificationRequest),
      json(base, '/api/auth/verify', verificationRequest),
    ]);
    expect(concurrent.map(({ response }) => response.status).sort()).toEqual([200, 401]);
    const verified = concurrent.find(({ response }) => response.status === 200)!;
    const issuedCookies = responseSetCookies(verified.response);
    expect(issuedCookies).toHaveLength(2);
    expect(issuedCookies.find((value) => value.startsWith('mfi_console_session='))).toContain('HttpOnly');
    const csrfSetCookie = issuedCookies.find((value) => value.startsWith('mfi_console_csrf='));
    expect(csrfSetCookie).toContain('SameSite=Strict');
    expect(csrfSetCookie).not.toContain('HttpOnly');
    expect((await json(base, '/api/auth/verify', verificationRequest)).response.status).toBe(401);
    expect(store.sessions.size).toBe(1);
    expect(await store.activeChallenge(overlappingId, signer.address, new Date().toISOString())).not.toBeNull();

    const cookie = requestCookieHeader(verified.response);
    const restoredCsrf = cookieValue(verified.response, 'mfi_console_csrf');
    expect(restoredCsrf).toBe(requiredString(verified.body, 'csrfToken'));
    expect((await json(base, '/api/machines', {
      method: 'POST', headers: {
        'content-type': 'application/json', cookie, 'x-csrf-token': restoredCsrf,
        origin: 'https://hostile.example.invalid',
      },
      body: JSON.stringify({ machineId: 'csrf-restored-machine', label: 'Rotated', role: 'sensor' }),
    })).response.status).toBe(403);
    expect((await json(base, '/api/machines', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': restoredCsrf, origin: base },
      body: JSON.stringify({ machineId: 'csrf-restored-machine', label: 'Rotated', role: 'sensor' }),
    })).response.status).toBe(201);

    const expired = await json(base, '/api/auth/challenge', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ walletAddress: signer.address }),
    });
    const expiredId = requiredString(expired.body, 'challengeId');
    const persisted = store.challenges.get(expiredId);
    expect(persisted).toBeDefined();
    store.challenges.set(expiredId, { ...persisted!, expiresAt: '1970-01-01T00:00:00.000Z' });
    const [expiredSignatures] = await signer.signMessages([{
      content: new TextEncoder().encode(requiredString(expired.body, 'message')), signatures: {},
    }]);
    const expiredSignature = expiredSignatures?.[signer.address];
    expect(expiredSignature).toBeDefined();
    expect((await json(base, '/api/auth/verify', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ challengeId: expiredId, walletAddress: signer.address, signature: encodeBase58(expiredSignature!) }),
    })).response.status).toBe(401);

    const logout = await json(base, '/api/auth/logout', {
      method: 'POST', headers: { cookie, 'x-csrf-token': restoredCsrf, origin: base },
    });
    expect(logout.response.status).toBe(200);
    expect(responseSetCookies(logout.response)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^mfi_console_session=.*Max-Age=0/u),
      expect.stringMatching(/^mfi_console_csrf=.*Max-Age=0/u),
    ]));
    expect((await json(base, '/api/auth/session', { headers: { cookie } })).response.status).toBe(401);
  });

  it('enforces wallet proof, CSRF, ownership, machine credentials, marketplace state, and non-custodial settlement states', async () => {
    const store = new MemoryProductionStore();
    const rpc = new TestRpc();
    runtime = await createProductionRuntime(config(), { store, rpc, now: new Date('2026-08-24T00:00:00.000Z') });
    server = createRuntimeServer(config(), runtime);
    const base = await listen(server);
    const signer = await generateKeyPairSigner();
    const publicResponse = await fetch(`${base}/`, { redirect: 'manual' });
    const publicPage = await publicResponse.text();
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.headers.get('location')).toBeNull();
    expect(publicPage).toContain('Infrastructure for the');
    expect(publicPage).toContain('href="/console"');
    expect(publicPage).not.toContain('mc-sidebar');
    const loginPage = await (await fetch(`${base}/console/overview`)).text();
    expect(loginPage).toContain('Authenticate with your wallet');
    expect(loginPage).not.toContain('Roof Inspector 09');
    const auth = await authenticate(base, signer);
    const headers = { 'content-type': 'application/json', cookie: auth.cookie, 'x-csrf-token': auth.csrf };
    const productionPage = await (await fetch(`${base}/console/overview`, { headers: { cookie: auth.cookie } })).text();
    expect(productionPage).toContain('Authenticated production data');
    expect(productionPage).toContain(GENESIS);
    expect(productionPage).toContain('--mc-accent: #c9f36b');
    expect(productionPage).toContain('<span>M</span>');
    expect(productionPage).not.toContain('#7c6cff');
    expect(productionPage).toContain('data-machine-open');
    expect(productionPage).toContain('id="mc-machine-dialog"');
    expect(productionPage).not.toContain('Roof Inspector 09');
    expect(productionPage).not.toContain('operator-rpc.example.invalid');
    expect(server.requestTimeout).toBe(30_000);
    expect(server.headersTimeout).toBe(15_000);
    expect(server.maxHeadersCount).toBe(100);
    expect(server.maxRequestsPerSocket).toBe(100);
    for (const fixturePath of ['/api/fixtures', '/api/status?fixture=true']) {
      const fixtureResponse = await json(base, fixturePath);
      expect(fixtureResponse.response.status, fixturePath).toBe(404);
      expect(fixtureResponse.body).not.toHaveProperty('receipts');
    }

    const noCsrf = await json(base, '/api/machines', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: auth.cookie },
      body: JSON.stringify({ machineId: 'requester-1', label: 'Requester', role: 'edge_node' }),
    });
    expect(noCsrf.response.status).toBe(403);

    for (const machine of [
      { machineId: 'requester-1', label: 'Requester', role: 'edge_node' },
      { machineId: 'provider-1', label: 'Provider', role: 'edge_node' },
    ]) {
      expect((await json(base, '/api/machines', { method: 'POST', headers, body: JSON.stringify(machine) })).response.status).toBe(201);
    }

    const credentialResult = await json(base, '/api/machines/requester-1/credentials', {
      method: 'POST', headers, body: JSON.stringify({ label: 'ingest', expiresInDays: 30 }),
    });
    expect(credentialResult.response.status).toBe(201);
    expect(credentialResult.body['scope']).toBe('telemetry:write');
    const credential = requiredString(credentialResult.body, 'credential');
    expect((await json(base, '/api/machines/provider-1/telemetry', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${credential}` },
      body: JSON.stringify({ observedAt: new Date().toISOString(), health: 'nominal' }),
    })).response.status).toBe(403);
    expect((await json(base, '/api/machines/requester-1/telemetry', {
      method: 'POST', headers: {
        'content-type': 'application/json', authorization: `Bearer ${credential}`, origin: base,
      },
      body: JSON.stringify({ observedAt: new Date().toISOString(), health: 'nominal' }),
    })).response.status).toBe(403);
    const telemetry = await json(base, '/api/machines/requester-1/telemetry', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${credential}` },
      body: JSON.stringify({ observedAt: new Date().toISOString(), health: 'nominal', batteryPct: 73 }),
    });
    expect(telemetry.response.status).toBe(202);
    expect(store.telemetry.size).toBe(1);
    const credentialId = credential.split('.')[0]!;
    expect((await json(base, `/api/machine-credentials/${credentialId}/revoke`, {
      method: 'POST', headers,
    })).response.status).toBe(200);
    expect((await json(base, '/api/machines/requester-1/telemetry', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${credential}` },
      body: JSON.stringify({ observedAt: new Date().toISOString(), health: 'nominal' }),
    })).response.status).toBe(403);
    const machineOnboardingPage = await (await fetch(`${base}/console/machines/requester-1`, {
      headers: { cookie: auth.cookie },
    })).text();
    expect(machineOnboardingPage).toContain('Configure runtime capabilities');
    expect(machineOnboardingPage).toContain('Machine authentication');
    expect(machineOnboardingPage).toContain('data-machine-capability-form');
    expect(machineOnboardingPage).toContain('ingest');
    expect(machineOnboardingPage).toContain('revoked');
    expect(machineOnboardingPage).toContain('telemetry:write');
    expect(machineOnboardingPage).not.toContain(credential);
    const runtimeOnboardingPage = await (await fetch(`${base}/console/machines/requester-1/runtime`, {
      headers: { cookie: auth.cookie },
    })).text();
    expect(runtimeOnboardingPage).toContain('data-runtime-session-form');
    const jobsOnboardingPage = await (await fetch(`${base}/console/jobs`, {
      headers: { cookie: auth.cookie },
    })).text();
    expect(jobsOnboardingPage).toContain('data-work-order-open');
    expect(jobsOnboardingPage).toContain('id="mc-work-order-dialog"');

    const capabilityResult = await json(base, '/api/marketplace/capabilities', {
      method: 'POST', headers,
      body: JSON.stringify({ providerMachineId: 'provider-1', resourceType: 'compute-burst', label: 'GPU second', unit: 'second', railTags: ['solana'], priceAmount: '0.000001', priceAsset: 'SOL' }),
    });
    expect(capabilityResult.response.status).toBe(201);
    const capabilityId = requiredString(requiredObject(capabilityResult.body, 'capability'), 'id');
    const requestResult = await json(base, '/api/marketplace/requests', {
      method: 'POST', headers,
      body: JSON.stringify({ requesterMachineId: 'requester-1', capabilityId, resourceType: 'compute-burst', quantity: '2', maxPrice: '0.000002', preferredRails: ['solana'], purpose: 'inference' }),
    });
    expect(requestResult.body['request']).toMatchObject({ state: 'pending', quoteAmount: null, quoteAsset: null });
    const requestId = requiredString(requiredObject(requestResult.body, 'request'), 'id');
    const quoteResult = await json(base, `/api/marketplace/requests/${requestId}/quotes`, {
      method: 'POST', headers, body: JSON.stringify({ capabilityId, amount: '0.000001', asset: 'SOL' }),
    });
    expect(quoteResult.response.status).toBe(201);
    const quoteId = requiredString(requiredObject(quoteResult.body, 'quote'), 'id');
    const accepted = await json(base, `/api/marketplace/requests/${requestId}/accept`, {
      method: 'POST', headers, body: JSON.stringify({ quoteId }),
    });
    expect(requiredObject(accepted.body, 'request')['state']).toBe('accepted');

    const settlementResult = await json(base, '/api/settlements', {
      method: 'POST', headers, body: JSON.stringify({
        resourceRequestId: requestId,
        recipientWallet: 'attacker-controlled-value-is-ignored',
        amountLamports: '999999999999999999999999',
      }),
    });
    const settlement = requiredObject(settlementResult.body, 'settlement');
    expect(settlement).toMatchObject({
      state: 'created', sourceWallet: signer.address, recipientWallet: signer.address, amountLamports: '2000',
    });
    const settlementId = requiredString(settlement, 'id');
    const prepared = await json(base, `/api/settlements/${settlementId}/prepare`, { method: 'POST', headers });
    expect(prepared.body).toMatchObject({ signingMode: 'caller-wallet', broadcast: false, settlement: { state: 'awaiting_signature' } });
    const unsigned = getTransactionDecoder().decode(Buffer.from(requiredString(prepared.body, 'unsignedTransaction'), 'base64'));
    const signed = await partiallySignTransaction([signer.keyPair], unsigned);
    const submitted = await json(base, `/api/settlements/${settlementId}/submit`, {
      method: 'POST', headers, body: JSON.stringify({ signedTransaction: getBase64EncodedWireTransaction(signed) }),
    });
    expect(submitted.response.status).toBe(202);
    expect(submitted.body).toMatchObject({ submitted: true, confirmed: false, settlement: { state: 'submitted' } });
    const replay = await json(base, `/api/settlements/${settlementId}/submit`, {
      method: 'POST', headers, body: JSON.stringify({ signedTransaction: getBase64EncodedWireTransaction(signed) }),
    });
    expect(replay.response.status).toBe(409);
    const confirmed = await json(base, `/api/settlements/${settlementId}/confirm`, { method: 'POST', headers });
    expect(confirmed.body).toMatchObject({ confirmed: true, settlement: { state: 'confirmed' } });
    expect(rpc.calls).toEqual(expect.arrayContaining(['getGenesisHash', 'getLatestBlockhash', 'sendTransaction', 'getSignatureStatuses']));
  });

  it('enforces requester/provider roles through quote, selection, cancellation, grant, and receipt APIs', async () => {
    const store = new MemoryProductionStore();
    runtime = await createProductionRuntime(config(), { store, rpc: new TestRpc() });
    server = createRuntimeServer(config(), runtime);
    const base = await listen(server);
    const requesterSigner = await generateKeyPairSigner();
    const providerASigner = await generateKeyPairSigner();
    const providerBSigner = await generateKeyPairSigner();
    const requesterAuth = await authenticate(base, requesterSigner);
    const providerAAuth = await authenticate(base, providerASigner);
    const providerBAuth = await authenticate(base, providerBSigner);
    const requesterHeaders = {
      'content-type': 'application/json', cookie: requesterAuth.cookie, 'x-csrf-token': requesterAuth.csrf,
    };
    const providerAHeaders = {
      'content-type': 'application/json', cookie: providerAAuth.cookie, 'x-csrf-token': providerAAuth.csrf,
    };
    const providerBHeaders = {
      'content-type': 'application/json', cookie: providerBAuth.cookie, 'x-csrf-token': providerBAuth.csrf,
    };

    expect((await json(base, '/api/machines', {
      method: 'POST', headers: requesterHeaders,
      body: JSON.stringify({ machineId: 'requester-open', label: 'Requester', role: 'edge_node' }),
    })).response.status).toBe(201);
    expect((await json(base, '/api/machines', {
      method: 'POST', headers: providerAHeaders,
      body: JSON.stringify({ machineId: 'provider-a', label: 'Provider A', role: 'edge_node' }),
    })).response.status).toBe(201);
    expect((await json(base, '/api/machines', {
      method: 'POST', headers: providerBHeaders,
      body: JSON.stringify({ machineId: 'provider-b', label: 'Provider B', role: 'edge_node' }),
    })).response.status).toBe(201);

    const createCapability = async (
      machineId: string,
      label: string,
      headers: Record<string, string>
    ): Promise<string> => {
      const result = await json(base, '/api/marketplace/capabilities', {
        method: 'POST', headers,
        body: JSON.stringify({
          id: 'client-controlled-id-must-be-ignored', providerMachineId: machineId,
          resourceType: 'compute-burst', label, unit: 'second', railTags: ['solana'],
        }),
      });
      expect(result.response.status).toBe(201);
      const id = requiredString(requiredObject(result.body, 'capability'), 'id');
      expect(id).toMatch(/^[0-9a-f-]{36}$/u);
      expect(id).not.toBe('client-controlled-id-must-be-ignored');
      return id;
    };
    const capabilityA = await createCapability('provider-a', 'GPU A', providerAHeaders);
    const capabilityB = await createCapability('provider-b', 'GPU B', providerBHeaders);

    expect((await json(base, `/api/marketplace/capabilities/${capabilityB}`, {
      method: 'PATCH', headers: providerAHeaders, body: JSON.stringify({ label: 'stolen' }),
    })).response.status).toBe(404);
    const updatedCapability = await json(base, `/api/marketplace/capabilities/${capabilityB}`, {
      method: 'PATCH', headers: providerBHeaders, body: JSON.stringify({ availability: 'limited' }),
    });
    expect(updatedCapability.response.status).toBe(200);
    expect(requiredObject(updatedCapability.body, 'capability')['availability']).toBe('limited');
    const weatherCapability = async (label: string): Promise<string> => {
      const result = await json(base, '/api/marketplace/capabilities', {
        method: 'POST', headers: providerBHeaders,
        body: JSON.stringify({
          providerMachineId: 'provider-b', resourceType: 'weather-data', label, unit: 'reading', railTags: ['solana'],
        }),
      });
      expect(result.response.status).toBe(201);
      return requiredString(requiredObject(result.body, 'capability'), 'id');
    };
    await weatherCapability('Weather primary');
    const weatherBackup = await weatherCapability('Weather backup');
    expect((await json(base, `/api/marketplace/capabilities/${weatherBackup}`, {
      method: 'PATCH', headers: providerBHeaders, body: JSON.stringify({ label: 'Weather primary' }),
    })).response.status).toBe(409);

    const cancellable = await json(base, '/api/marketplace/requests', {
      method: 'POST', headers: requesterHeaders,
      body: JSON.stringify({
        requesterMachineId: 'requester-open', resourceType: 'compute-burst', quantity: '1',
        maxPrice: '0.000002', preferredRails: ['solana'], purpose: 'cancel lifecycle',
      }),
    });
    const cancellableId = requiredString(requiredObject(cancellable.body, 'request'), 'id');
    const withdrawable = await json(base, `/api/marketplace/requests/${cancellableId}/quotes`, {
      method: 'POST', headers: providerAHeaders,
      body: JSON.stringify({ capabilityId: capabilityA, amount: '0.000001', asset: 'SOL' }),
    });
    const withdrawableId = requiredString(requiredObject(withdrawable.body, 'quote'), 'id');
    expect((await json(base, `/api/marketplace/quotes/${withdrawableId}/withdraw`, {
      method: 'POST', headers: providerBHeaders,
    })).response.status).toBe(409);
    expect((await json(base, `/api/marketplace/quotes/${withdrawableId}/withdraw`, {
      method: 'POST', headers: providerAHeaders,
    })).body).toMatchObject({ withdrawn: true, request: { state: 'pending' }, quote: { state: 'withdrawn' } });
    const replacementQuote = await json(base, `/api/marketplace/requests/${cancellableId}/quotes`, {
      method: 'POST', headers: providerAHeaders,
      body: JSON.stringify({ capabilityId: capabilityA, amount: '0.000001', asset: 'SOL' }),
    });
    const replacementQuoteId = requiredString(requiredObject(replacementQuote.body, 'quote'), 'id');
    expect((await json(base, `/api/marketplace/requests/${cancellableId}/cancel`, {
      method: 'POST', headers: providerAHeaders,
    })).response.status).toBe(404);
    expect((await json(base, `/api/marketplace/requests/${cancellableId}/cancel`, {
      method: 'POST', headers: requesterHeaders,
    })).body).toMatchObject({ cancelled: true, request: { state: 'cancelled' } });
    expect(store.quotes.get(replacementQuoteId)?.state).toBe('declined');

    const targeted = await json(base, '/api/marketplace/requests', {
      method: 'POST', headers: requesterHeaders,
      body: JSON.stringify({
        requesterMachineId: 'requester-open', capabilityId: capabilityA, resourceType: 'compute-burst',
        quantity: '1', maxPrice: '0.000002', preferredRails: ['solana'], purpose: 'provider rejection',
      }),
    });
    const targetedId = requiredString(requiredObject(targeted.body, 'request'), 'id');
    expect((await json(base, `/api/marketplace/requests/${targetedId}/reject`, {
      method: 'POST', headers: providerBHeaders,
    })).response.status).toBe(409);
    expect((await json(base, `/api/marketplace/requests/${targetedId}/reject`, {
      method: 'POST', headers: providerAHeaders,
    })).body).toMatchObject({ rejected: true, request: { state: 'rejected' } });

    const createdRequest = await json(base, '/api/marketplace/requests', {
      method: 'POST', headers: requesterHeaders,
      body: JSON.stringify({
        requesterMachineId: 'requester-open', resourceType: 'compute-burst', quantity: '2',
        maxPrice: '0.000002', preferredRails: ['solana'], purpose: 'compare two providers',
      }),
    });
    expect(createdRequest.response.status).toBe(201);
    const request = requiredObject(createdRequest.body, 'request');
    const requestId = requiredString(request, 'id');
    expect(request).toMatchObject({
      state: 'pending', providerMachineId: null, capabilityId: null, quoteAmount: null, quoteAsset: null,
    });
    const compatible = await json(base, `/api/marketplace/requests/${requestId}/compatible-providers`, {
      headers: { cookie: requesterAuth.cookie },
    });
    expect(compatible.response.status).toBe(200);
    expect(requiredArray(compatible.body, 'capabilities')).toHaveLength(2);
    for (const [auth, expectedCount] of [[providerAAuth, 2], [providerBAuth, 1]] as const) {
      const inbox = await json(base, '/api/marketplace/provider/requests', { headers: { cookie: auth.cookie } });
      expect(requiredArray(inbox.body, 'requests')).toHaveLength(expectedCount);
    }

    expect((await json(base, `/api/marketplace/requests/${requestId}/quotes`, {
      method: 'POST', headers: requesterHeaders,
      body: JSON.stringify({ capabilityId: capabilityA, amount: '0.000001', asset: 'SOL' }),
    })).response.status).toBe(409);
    const quoteAResult = await json(base, `/api/marketplace/requests/${requestId}/quotes`, {
      method: 'POST', headers: providerAHeaders,
      body: JSON.stringify({ capabilityId: capabilityA, amount: '0.000002', asset: 'SOL' }),
    });
    const quoteAId = requiredString(requiredObject(quoteAResult.body, 'quote'), 'id');
    const quoteBResult = await json(base, `/api/marketplace/requests/${requestId}/quotes`, {
      method: 'POST', headers: providerBHeaders,
      body: JSON.stringify({ capabilityId: capabilityB, amount: '0.000001', asset: 'SOL' }),
    });
    const quoteBId = requiredString(requiredObject(quoteBResult.body, 'quote'), 'id');
    const requestBeforeSelection = await json(base, `/api/marketplace/requests/${requestId}`, {
      headers: { cookie: requesterAuth.cookie },
    });
    expect(requiredObject(requestBeforeSelection.body, 'request')).toMatchObject({
      state: 'quoted', providerMachineId: null, capabilityId: null, quoteAmount: null, quoteAsset: null,
    });
    expect(requiredArray(requestBeforeSelection.body, 'quotes')).toHaveLength(2);

    expect((await json(base, `/api/marketplace/requests/${requestId}/quotes/${quoteBId}/accept`, {
      method: 'POST', headers: providerAHeaders,
    })).response.status).toBe(409);
    const accepted = await json(base, `/api/marketplace/requests/${requestId}/quotes/${quoteBId}/accept`, {
      method: 'POST', headers: requesterHeaders,
    });
    expect(accepted.response.status).toBe(200);
    expect(requiredObject(accepted.body, 'request')).toMatchObject({
      state: 'accepted', providerMachineId: 'provider-b', capabilityId: capabilityB,
      quoteAmount: '0.000001', quoteAsset: 'SOL',
    });
    expect(store.quotes.get(quoteAId)?.state).toBe('declined');
    expect((await json(base, `/api/marketplace/requests/${requestId}`, {
      headers: { cookie: providerAAuth.cookie },
    })).response.status).toBe(404);

    const settlementResult = await json(base, '/api/settlements', {
      method: 'POST', headers: requesterHeaders,
      body: JSON.stringify({ resourceRequestId: requestId, recipientWallet: providerASigner.address, amountLamports: '999' }),
    });
    expect(settlementResult.response.status).toBe(201);
    const settlement = requiredObject(settlementResult.body, 'settlement');
    expect(settlement).toMatchObject({
      recipientWallet: providerBSigner.address, amountLamports: '2000', resourceRequestId: requestId, resourceQuoteId: quoteBId,
    });
    const settlementId = requiredString(settlement, 'id');
    expect((await json(base, `/api/settlements/${settlementId}`, {
      headers: { cookie: providerBAuth.cookie },
    })).response.status).toBe(404);
    const cancelled = await json(base, `/api/settlements/${settlementId}/cancel`, {
      method: 'POST', headers: requesterHeaders,
    });
    expect(cancelled.body).toMatchObject({ cancelled: true, settlement: { state: 'cancelled', errorCode: 'SIGNING_CANCELLED' } });
    const resumedCreation = await json(base, '/api/settlements', {
      method: 'POST', headers: requesterHeaders, body: JSON.stringify({ resourceRequestId: requestId }),
    });
    expect(resumedCreation.body).toMatchObject({ resumed: true, settlement: { id: settlementId, state: 'cancelled' } });
    const resumedPreparation = await json(base, `/api/settlements/${settlementId}/prepare`, {
      method: 'POST', headers: requesterHeaders,
    });
    expect(resumedPreparation.body).toMatchObject({ settlement: { id: settlementId, state: 'awaiting_signature' } });
    expect(store.settlements.size).toBe(1);
    expect((await json(base, `/api/settlements/${settlementId}/cancel`, {
      method: 'POST', headers: requesterHeaders,
    })).body).toMatchObject({ cancelled: true, settlement: { state: 'cancelled' } });

    expect((await json(base, `/api/marketplace/requests/${requestId}/grant`, {
      method: 'POST', headers: requesterHeaders,
      body: JSON.stringify({ quoteId: quoteBId, accessReference: 'vault:forged' }),
    })).response.status).toBe(409);
    const grantResult = await json(base, `/api/marketplace/requests/${requestId}/grant`, {
      method: 'POST', headers: providerBHeaders,
      body: JSON.stringify({ quoteId: quoteBId, accessReference: 'vault:grant-b' }),
    });
    expect(grantResult.response.status).toBe(201);
    const grantId = requiredString(requiredObject(grantResult.body, 'grant'), 'id');
    expect((await json(base, `/api/marketplace/grants/${grantId}/activate`, {
      method: 'POST', headers: requesterHeaders,
    })).response.status).toBe(409);
    expect((await json(base, `/api/marketplace/grants/${grantId}/activate`, {
      method: 'POST', headers: providerBHeaders,
    })).body).toMatchObject({ grant: { state: 'active' } });

    expect((await json(base, `/api/marketplace/requests/${requestId}/receipt`, {
      method: 'POST', headers: requesterHeaders,
      body: JSON.stringify({ grantId, evidenceReference: 'sha256:forged' }),
    })).response.status).toBe(409);
    const receiptResult = await json(base, `/api/marketplace/requests/${requestId}/receipt`, {
      method: 'POST', headers: providerBHeaders,
      body: JSON.stringify({ grantId, evidenceReference: 'sha256:evidence-b', resultReference: 'result:b' }),
    });
    expect(receiptResult.response.status).toBe(201);
    const receiptId = requiredString(requiredObject(receiptResult.body, 'receipt'), 'id');
    expect((await json(base, `/api/marketplace/receipts/${receiptId}/verify`, {
      method: 'POST', headers: providerBHeaders,
    })).response.status).toBe(409);
    expect((await json(base, `/api/marketplace/receipts/${receiptId}/verify`, {
      method: 'POST', headers: requesterHeaders,
    })).body).toMatchObject({ receipt: { state: 'verified' } });
    const finalDetail = await json(base, `/api/marketplace/requests/${requestId}`, {
      headers: { cookie: requesterAuth.cookie },
    });
    expect(finalDetail.body).toMatchObject({
      request: { state: 'fulfilled' }, grant: { state: 'active' }, receipt: { state: 'verified' },
    });
  });

  it('does not expose or mutate another wallet owner\'s machine through scoped Console and API identifiers', async () => {
    const store = new MemoryProductionStore();
    runtime = await createProductionRuntime(config(), { store, rpc: new TestRpc() });
    server = createRuntimeServer(config(), runtime);
    const base = await listen(server);
    const owner = await generateKeyPairSigner();
    const attacker = await generateKeyPairSigner();
    const ownerAuth = await authenticate(base, owner);
    await json(base, '/api/machines', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: ownerAuth.cookie, 'x-csrf-token': ownerAuth.csrf },
      body: JSON.stringify({ machineId: 'private-machine', label: 'Private', role: 'sensor' }),
    });
    const ownerHeaders = { 'content-type': 'application/json', cookie: ownerAuth.cookie, 'x-csrf-token': ownerAuth.csrf };
    const ownerCredentialResult = await json(base, '/api/machines/private-machine/credentials', {
      method: 'POST', headers: ownerHeaders, body: JSON.stringify({ label: 'field sensor' }),
    });
    expect(ownerCredentialResult.response.status).toBe(201);
    const ownerCredentialId = requiredString(ownerCredentialResult.body, 'credential').split('.')[0]!;
    const listed = await json(base, '/api/machines/private-machine/credentials', {
      headers: { cookie: ownerAuth.cookie },
    });
    expect(listed.response.status).toBe(200);
    expect(requiredArray(listed.body, 'credentials')).toHaveLength(1);
    expect(Object.keys(requiredArray(listed.body, 'credentials')[0] as Record<string, unknown>).sort()).toEqual([
      'createdAt', 'expiresAt', 'id', 'label', 'revokedAt', 'scope',
    ]);
    const attackerAuth = await authenticate(base, attacker);
    const response = await json(base, '/api/machines/private-machine/credentials', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: attackerAuth.cookie, 'x-csrf-token': attackerAuth.csrf }, body: '{}',
    });
    expect(response.response.status).toBe(404);
    expect((await json(base, '/api/machines/private-machine/credentials', {
      headers: { cookie: attackerAuth.cookie },
    })).response.status).toBe(404);
    expect((await json(base, `/api/machine-credentials/${ownerCredentialId}/revoke`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: attackerAuth.cookie, 'x-csrf-token': attackerAuth.csrf },
    })).response.status).toBe(404);

    const attackerHeaders = {
      'content-type': 'application/json',
      cookie: attackerAuth.cookie,
      'x-csrf-token': attackerAuth.csrf,
    };
    const foreignMachineAttempts: readonly [string, RequestInit][] = [
      ['/api/machines/private-machine/capabilities', { headers: { cookie: attackerAuth.cookie } }],
      ['/api/machines/private-machine/capabilities', { method: 'POST', headers: attackerHeaders, body: '{}' }],
      ['/api/runtime/sessions?machineId=private-machine', { headers: { cookie: attackerAuth.cookie } }],
      ['/api/runtime/sessions', { method: 'POST', headers: attackerHeaders, body: JSON.stringify({ machineId: 'private-machine' }) }],
      ['/api/work-orders?machineId=private-machine', { headers: { cookie: attackerAuth.cookie } }],
      ['/api/work-orders', { method: 'POST', headers: attackerHeaders, body: JSON.stringify({ machineId: 'private-machine' }) }],
      ['/api/machines/private-machine/telemetry', { headers: { cookie: attackerAuth.cookie } }],
      ['/api/telemetry?machineId=private-machine', { headers: { cookie: attackerAuth.cookie } }],
      ['/api/marketplace/capabilities', { method: 'POST', headers: attackerHeaders, body: JSON.stringify({ providerMachineId: 'private-machine' }) }],
      ['/api/marketplace/requests', { method: 'POST', headers: attackerHeaders, body: JSON.stringify({ requesterMachineId: 'private-machine' }) }],
    ];
    for (const [path, init] of foreignMachineAttempts) {
      expect((await json(base, path, init)).response.status, path).toBe(404);
    }

    const attackerMachines = await json(base, '/api/machines', { headers: { cookie: attackerAuth.cookie } });
    expect(requiredArray(attackerMachines.body, 'machines')).toEqual([]);
    const attackerConsole = await fetch(`${base}/console/machines/private-machine`, {
      headers: { cookie: attackerAuth.cookie },
    });
    expect(attackerConsole.status).toBe(404);
    const attackerConsoleHtml = await attackerConsole.text();
    expect(attackerConsoleHtml).toContain('Machine not found');
    expect(attackerConsoleHtml).not.toContain('Private');
    expect(store.credentials.get(ownerCredentialId)?.revokedAt).toBeNull();
  });
});

describe('settlement amount precision', () => {
  it('converts exact SOL quotes and rejects sub-lamport amounts', () => {
    expect(quotedSolToLamports('0.000001', '2')).toBe(2000n);
    expect(() => quotedSolToLamports('0.000000001', '0.1')).toThrow(/sub-lamport/);
  });
});
