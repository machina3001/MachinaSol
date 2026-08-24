import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createResourceMarketplaceService,
  validateResourceRequestDraft,
  type ResourceOffer,
  type ResourceRequestDraftInput,
} from '../src/console/services/resources.js';
import { loadMachineRuntime, loadRuntimeConsole } from '../src/console/services/runtime.js';
import {
  ECONOMY_SUPPORT,
  economyJobDetail,
  economyJobs,
  economyReceipts,
  economySettlements,
  genuineSolanaExplorerUrl,
} from '../src/console/services/economy.js';
import { createRuntimeServer } from '../src/server/index.js';

const validDraft: ResourceRequestDraftInput = {
  id: ' request-weather-1 ',
  requesterId: ' drone-9 ',
  resourceType: 'weather-data',
  quantity: 4,
  maxPrice: 2.5,
  preferredRails: [' solana-local '],
  purpose: ' route planning ',
  metadata: { zone: 'dock-4' },
};

const offer = (overrides: Partial<ResourceOffer> = {}): ResourceOffer => ({
  resourceId: 'resource-weather-1',
  providerName: 'Weather provider',
  providerMachineId: 'sensor-provider-1',
  capability: {
    id: 'capability-weather-1',
    providerId: 'provider-1',
    resourceType: 'weather-data',
    label: 'Dock weather feed',
    unit: 'observation',
    railTags: ['solana-local'],
    metadata: { resolution: '5m' },
  },
  availability: 'available',
  providerStatus: 'online',
  runtimeRails: [
    {
      id: 'solana-local',
      label: 'Local Solana rail',
      network: 'solana',
      asset: 'SOL',
      maxSettlementAmount: 10,
    },
  ],
  quote: null,
  ...overrides,
});

describe('resource marketplace application adapter', () => {
  it('validates and normalizes the audited ResourceRequest draft fields', () => {
    const result = validateResourceRequestDraft(validDraft);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toMatchObject({
      id: 'request-weather-1',
      requesterId: 'drone-9',
      resourceType: 'weather-data',
      quantity: 4,
      maxPrice: 2.5,
      preferredRails: ['solana-local'],
      purpose: 'route planning',
      metadata: { zone: 'dock-4' },
    });
  });

  it('returns field-level issues for unsupported and invalid drafts', () => {
    const result = validateResourceRequestDraft({
      id: '',
      requesterId: '',
      resourceType: 'imaginary-resource',
      quantity: 0,
      maxPrice: Number.NaN,
      preferredRails: [''],
      metadata: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(new Set(result.issues.map((issue) => issue.code))).toEqual(
      new Set([
        'REQUIRED',
        'UNSUPPORTED_RESOURCE_TYPE',
        'NOT_POSITIVE_NUMBER',
        'INVALID_RAILS',
        'INVALID_METADATA',
      ])
    );
  });

  it('matches only compatible injected capabilities and reports unavailable providers', () => {
    const service = createResourceMarketplaceService({
      state: 'ready',
      availableResources: [offer()],
    });
    const matched = service.discoverProviders(validDraft);
    expect(matched.status).toBe('matched');
    expect(matched.providers.map((provider) => provider.resourceId)).toEqual(['resource-weather-1']);

    const unsupported = service.discoverProviders({ ...validDraft, resourceType: 'imaginary-resource' });
    expect(unsupported).toMatchObject({ status: 'unsupported-capability', providers: [] });

    const noMatch = service.discoverProviders({ ...validDraft, resourceType: 'soil-sensor-data' });
    expect(noMatch).toMatchObject({ status: 'no-matching-providers', providers: [] });

    const offlineService = createResourceMarketplaceService({
      state: 'ready',
      availableResources: [offer({ availability: 'unavailable', providerStatus: 'offline' })],
    });
    expect(offlineService.discoverProviders(validDraft)).toMatchObject({
      status: 'unavailable-provider',
      providers: [{ resourceId: 'resource-weather-1' }],
    });
  });

  it('fails closed on every submission even when local validation succeeds', () => {
    const service = createResourceMarketplaceService({ state: 'ready', availableResources: [offer()] });
    const result = service.submitRequest(validDraft);

    expect(result).toMatchObject({
      ok: false,
      status: 'rejected',
      code: 'REQUEST_SUBMISSION_UNAVAILABLE',
      validation: { ok: true },
    });
    expect(service.capabilities).toMatchObject({
      requestSubmission: false,
      persistence: false,
      accessGrants: false,
      resourceReceipts: false,
    });
  });

  it('rejects requester machines outside an injected session scope', () => {
    const service = createResourceMarketplaceService({
      state: 'ready',
      requesterMachines: [{ machineId: 'drone-9', label: 'Drone 9', runtimeRail: 'solana' }],
      availableResources: [offer()],
    });
    const result = service.submitRequest({ ...validDraft, requesterId: 'unmanaged-machine' });
    expect(result.validation).toMatchObject({
      ok: false,
      issues: [{ field: 'requesterId', code: 'REQUESTER_NOT_MANAGED' }],
    });
  });

  it('validates injected capability/provider selections as one available offer', () => {
    const service = createResourceMarketplaceService({ state: 'ready', availableResources: [offer()] });
    const selected = service.submitRequest({
      ...validDraft,
      metadata: {
        selectedCapabilityId: 'capability-weather-1',
        selectedProviderId: 'provider-1',
      },
    });
    expect(selected.validation).toMatchObject({ ok: true });

    const mismatched = service.submitRequest({
      ...validDraft,
      metadata: {
        selectedCapabilityId: 'capability-weather-1',
        selectedProviderId: 'different-provider',
      },
    });
    expect(mismatched.validation).toMatchObject({
      ok: false,
      issues: [{ field: 'metadata', code: 'SELECTION_MISMATCH' }],
    });
  });
});

describe('runtime and telemetry application adapter', () => {
  it('normalizes timestamp-derived states without claiming network reachability', () => {
    const state = loadRuntimeConsole();
    expect(state.status).toBe('ready');
    if (state.status !== 'ready') return;

    const byId = Object.fromEntries(state.data.machines.map((machine) => [machine.machineId, machine]));
    expect(byId['drone-9']?.connection.state).toBe('live');
    expect(byId['edge-3']?.connection.state).toBe('offline');
    expect(byId['rover-2']?.connection.state).toBe('delayed');
    expect(state.data.machines.every((machine) => machine.network.state === 'unknown')).toBe(true);
    expect(state.data.support).toMatchObject({
      realtimeUpdates: false,
      telemetryHistory: false,
      networkReachability: false,
      telemetrySnapshots: true,
    });
  });

  it('keeps recent runtime events bounded, machine-scoped, and newest-first', () => {
    const state = loadRuntimeConsole();
    if (state.status !== 'ready') throw new Error(`expected ready runtime, received ${state.status}`);

    expect(state.data.recentEvents.length).toBeLessThanOrEqual(40);
    const times = state.data.recentEvents.map((event) => Date.parse(event.occurredAt));
    expect(times).toEqual([...times].sort((left, right) => right - left));
    for (const machine of state.data.machines) {
      expect(machine.events.length).toBeLessThanOrEqual(40);
      expect(machine.events.every((event) => event.machineId === machine.machineId)).toBe(true);
    }
  });

  it('preserves loading/unavailable states and reports missing machines explicitly', () => {
    expect(loadMachineRuntime('drone-9', { status: 'loading' })).toEqual({ status: 'loading' });
    expect(loadMachineRuntime('drone-9', { status: 'unavailable', reason: 'backend disabled' })).toEqual({
      status: 'unavailable',
      reason: 'backend disabled',
    });

    const current = loadRuntimeConsole();
    expect(loadMachineRuntime('missing-machine', current)).toEqual({
      status: 'not-found',
      machineId: 'missing-machine',
    });
  });
});

describe('economy relationships and explorer safety', () => {
  it('joins only explicit work-order relationships', () => {
    const jobs = economyJobs();
    expect(jobs.map((job) => job.jobId)).toContain('wo-roof-scan-12');

    const detail = economyJobDetail('wo-roof-scan-12');
    expect(detail?.job.machineId).toBe('drone-9');
    expect(detail?.telemetry?.telemetryRef).toBe('telemetry:drone-9:cycle-1');
    expect(detail?.job.providerId).toBeUndefined();
    expect(detail?.job.resourceId).toBeUndefined();
    expect(detail?.linkedReceipts).toEqual([]);
    expect(ECONOMY_SUPPORT).toMatchObject({
      providerRelationships: false,
      resourceRelationships: false,
      receiptJobRelationships: false,
    });
  });

  it('does not imply transaction or explorer evidence for fixtures or unsigned intents', () => {
    const settlement = economySettlements()[0];
    expect(settlement).toMatchObject({ status: 'unsigned', signingMode: 'caller-wallet', broadcast: false });
    expect(settlement?.transactionSignature).toBeUndefined();
    expect(settlement?.explorerUrl).toBeUndefined();

    const receipt = economyReceipts()[0];
    expect(receipt).toMatchObject({
      source: 'repository-fixture',
      liveConfirmation: false,
      verificationState: 'not-run',
      amount: '0.5',
      sessionId: 'mfi_solana_fixture_session',
      confirmations: 32,
    });
    expect(receipt?.explorerUrl).toBeUndefined();
    expect(genuineSolanaExplorerUrl(receipt!.transactionSignature, 'devnet', false)).toBeUndefined();
    expect(genuineSolanaExplorerUrl('not-a-solana-signature', 'devnet', true)).toBeUndefined();
    expect(genuineSolanaExplorerUrl(receipt!.transactionSignature, 'devnet', true)).toBe(
      `https://explorer.solana.com/tx/${receipt!.transactionSignature}?cluster=devnet`
    );
  });
});

describe('resource HTTP API status contracts', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createRuntimeServer({ host: '127.0.0.1', port: 0, allowLive: false });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it('reports an honest empty capability snapshot', async () => {
    const response = await fetch(`${baseUrl}/api/resources`);
    const body = (await response.json()) as {
      ok: boolean;
      state: string;
      availableResources: unknown[];
      capabilities: { requestSubmission: boolean; remoteProviderDiscovery: boolean };
    };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      state: 'unavailable',
      availableResources: [],
      capabilities: { requestSubmission: false, remoteProviderDiscovery: false },
    });
  });

  it('uses 422 for invalid drafts and 501 for a valid but unsupported submission', async () => {
    const invalid = await fetch(`${baseUrl}/api/resources/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: '', requesterId: '', resourceType: 'weather-data', quantity: 0, maxPrice: 0 }),
    });
    expect(invalid.status).toBe(422);

    const valid = await fetch(`${baseUrl}/api/resources/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validDraft),
    });
    const body = (await valid.json()) as {
      ok: boolean;
      error: { code: string };
      validation: { ok: boolean };
    };

    expect(valid.status).toBe(501);
    expect(body).toMatchObject({
      ok: false,
      error: { code: 'REQUEST_SUBMISSION_UNAVAILABLE' },
      validation: { ok: true },
    });
  });

  it('returns unavailable and validation HTTP statuses for discovery', async () => {
    const noMatch = await fetch(`${baseUrl}/api/resources/discover`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validDraft),
    });
    expect(noMatch.status).toBe(503);
    expect(await noMatch.json()).toMatchObject({
      ok: false,
      result: { status: 'marketplace-unavailable', providers: [] },
    });

    const invalid = await fetch(`${baseUrl}/api/resources/discover`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resourceType: 'weather-data' }),
    });
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toMatchObject({ ok: false, result: { status: 'invalid-request' } });
  });

  it('blocks cross-site/GET live-read triggers and framing', async () => {
    const liveGet = await fetch(`${baseUrl}/api/status?fixture=0`);
    expect(liveGet.status).toBe(405);

    const duplicateBypass = await fetch(`${baseUrl}/api/status?fixture=true&fixture=false`);
    expect(duplicateBypass.status).toBe(405);

    const opaqueOrigin = await fetch(`${baseUrl}/api/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'null' },
      body: JSON.stringify({ fixture: true }),
    });
    expect(opaqueOrigin.status).toBe(403);

    const consolePage = await fetch(`${baseUrl}/console`);
    expect(consolePage.headers.get('x-frame-options')).toBe('DENY');
    expect(consolePage.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  it('returns a real 404 console page for unknown routes', async () => {
    const response = await fetch(`${baseUrl}/console/not-a-route`);
    expect(response.status).toBe(404);
    expect(await response.text()).toContain('Console route not found');
  });

  it('withholds unverified explorer links and enforces fixture-only mode', async () => {
    const receipt = economyReceipts()[0]!;
    const verifyResponse = await fetch(`${baseUrl}/api/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fixture: true, signature: receipt.transactionSignature }),
    });
    const verification = (await verifyResponse.json()) as { value?: { explorerUrl?: string } };
    expect(verifyResponse.status).toBe(200);
    expect(verification.value?.explorerUrl).toBeUndefined();

    for (const route of ['/api/pair', '/api/intent/build']) {
      const response = await fetch(`${baseUrl}${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fixture: false }),
      });
      expect(response.status).toBe(403);
    }
  });

  it('validates the runtime session role at the pairing boundary', async () => {
    const invalid = await fetch(`${baseUrl}/api/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fixture: true, role: 'robot_arm' }),
    });
    expect(invalid.status).toBe(400);

    const valid = await fetch(`${baseUrl}/api/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fixture: true, role: 'edge-node' }),
    });
    expect(valid.status).toBe(200);
    const session = (await valid.json()) as { metadata?: { role?: string } };
    expect(session.metadata?.role).toBe('edge-node');
  });
});
