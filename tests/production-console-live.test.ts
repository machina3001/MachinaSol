import { describe, expect, it } from 'vitest';
import {
  canCreateAccessGrant,
  canProviderRejectRequest,
  canReplaceResourceReceipt,
  effectiveGrantState,
  effectiveQuoteState,
  isProviderCapabilityCompatibleWithRequest,
  isSettlementEligibleRequest,
  productionClientScript,
  renderTelemetryTable,
  solanaClusterDisplayLabel,
  solanaExplorerTransactionUrl,
} from '../src/console/server/production-console.js';
import {
  classifyTelemetryFreshness,
  latestTelemetryByMachine,
} from '../src/console/server/production-console-live.js';
import type {
  OwnedMachineRecord,
  PersistentAccessGrant,
  PersistentResourceQuote,
  PersistentResourceReceipt,
  PersistentResourceRequest,
  ProviderCapabilityRow,
  TelemetryEventRecord,
} from '../src/server/production/types.js';

const NOW = new Date('2026-08-24T12:00:00.000Z');

const event = (
  machineId: string,
  observedAt: string,
  receivedAt = observedAt,
  health: TelemetryEventRecord['snapshot']['health'] = 'nominal'
): TelemetryEventRecord => ({
  id: `${machineId}-${receivedAt}`,
  machineId,
  receivedAt,
  snapshot: { machineId, observedAt, health },
});

const machine = (machineId: string, label = machineId): OwnedMachineRecord => ({
  machineId,
  ownerUserId: 'owner-1',
  label,
  role: 'sensor',
  walletAddress: '11111111111111111111111111111111',
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
});

describe('production telemetry freshness', () => {
  it('derives LIVE, DELAYED, OFFLINE, and UNKNOWN from durable timestamps', () => {
    expect(classifyTelemetryFreshness(event('live', '2026-08-24T11:59:00.000Z'), NOW)).toBe('LIVE');
    expect(classifyTelemetryFreshness(event('delayed', '2026-08-24T11:55:00.000Z'), NOW)).toBe('DELAYED');
    expect(classifyTelemetryFreshness(event('offline', '2026-08-24T11:40:00.000Z'), NOW)).toBe('OFFLINE');
    expect(classifyTelemetryFreshness(undefined, NOW)).toBe('UNKNOWN');
  });

  it('uses server receipt time and delivery lag instead of trusting observedAt alone', () => {
    expect(classifyTelemetryFreshness(event(
      'late-delivery',
      '2026-08-24T11:58:30.000Z',
      '2026-08-24T11:55:00.000Z'
    ), NOW)).toBe('DELAYED');
    expect(classifyTelemetryFreshness(event(
      'future',
      '2026-08-24T12:03:00.000Z',
      '2026-08-24T12:00:00.000Z'
    ), NOW)).toBe('UNKNOWN');
    expect(classifyTelemetryFreshness(event(
      'reported-offline',
      '2026-08-24T11:59:30.000Z',
      '2026-08-24T11:59:31.000Z',
      'offline'
    ), NOW)).toBe('OFFLINE');
  });

  it('selects the latest server-received event and renders machines without events as UNKNOWN', () => {
    const old = event('machine-1', '2026-08-24T11:50:00.000Z');
    const latest = event('machine-1', '2026-08-24T11:59:30.000Z');
    expect(latestTelemetryByMachine([latest, old]).get('machine-1')).toEqual(latest);

    const html = renderTelemetryTable(
      [machine('machine-1', '<Latest>'), machine('machine-2', 'Never seen')],
      [old, latest],
      NOW
    );
    expect(html).toContain('data-machine-telemetry="machine-1"');
    expect(html).toContain('data-freshness="live">LIVE');
    expect(html).toContain('data-machine-telemetry="machine-2"');
    expect(html).toContain('data-freshness="unknown">UNKNOWN');
    expect(html).toContain('&lt;Latest&gt;');
    expect(html).not.toContain('<Latest>');
  });
});

describe('production Console client hooks', () => {
  it('uses Wallet Standard raw-byte signing and server submit/confirm APIs', () => {
    const script = productionClientScript();
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain('wallet-standard:app-ready');
    expect(script).toContain("'solana:signTransaction'");
    expect(script).toContain("'/api/settlements'");
    expect(script).toContain("'/prepare'");
    expect(script).toContain("'/submit'");
    expect(script).toContain("'/confirm'");
    expect(script).toContain("'x-csrf-token'");
    expect(script).toContain("sessionStorage.getItem('mfi_csrf')");
    expect(script).toContain("document.cookie.split(';')");
    expect(script).toContain("'mfi_console_csrf='");
    expect(script).toContain('Wallet signing was rejected. Nothing was submitted');
    expect(script).toContain("version === 0");
    expect(script).toContain("account.chains?.includes(chain)");
    expect(script).toContain("'/cancel'");
    expect(script).toContain('data-reconcile-settlement');
    expect(script).toContain("'/confirm'");
    expect(script).toContain("'/api/marketplace/quotes/'");
    expect(script).toContain("'/withdraw'");
    expect(script).toContain("'/api/marketplace/requests/'");
    expect(script).not.toContain('signAndSendTransaction');
    expect(script).not.toContain('privateKey');
    expect(script).not.toContain('secretKey');
    expect(script).not.toContain('seedPhrase');
    expect(script).not.toContain('mnemonic');
    expect(script.match(/\.signMessage\(/gu)).toHaveLength(1);
  });

  it('sends only the connected address, server challenge id, and message signature during mocked login', async () => {
    type Handler = () => void | Promise<void>;
    const handlers = new Map<string, Handler>();
    const attributes = new Map<string, string>();
    const connect = {
      disabled: false,
      addEventListener: (name: string, handler: Handler) => handlers.set(name, handler),
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      removeAttribute: (name: string) => attributes.delete(name),
    };
    const status = { textContent: '', dataset: {} as Record<string, string> };
    const requests: Array<{ path: string; init: Record<string, unknown> }> = [];
    const signedMessages: Array<{ message: Uint8Array; encoding: string }> = [];
    const stored = new Map<string, string>();
    let reloads = 0;
    const walletAddress = '11111111111111111111111111111111';
    const challengeId = 'challenge-id';
    const challengeMessage = 'Machina Console authentication\n\nSign this message to authenticate.';
    const csrfToken = 'csrf-token';
    const fakeFetch = async (path: string, init: Record<string, unknown>) => {
      requests.push({ path, init });
      if (path === '/api/auth/challenge') return {
        ok: true,
        status: 201,
        json: async () => ({ challengeId, message: challengeMessage, expiresAt: new Date(Date.now() + 60_000).toISOString() }),
      };
      if (path === '/api/auth/verify') return {
        ok: true,
        status: 200,
        json: async () => ({ csrfToken }),
      };
      throw new Error(`unexpected request ${path}`);
    };
    const fakeWindow = {
      solana: {
        publicKey: walletAddress,
        connect: async () => ({ publicKey: walletAddress }),
        signMessage: async (message: Uint8Array, encoding: string) => {
          signedMessages.push({ message, encoding });
          return { signature: new Uint8Array(64).fill(7) };
        },
      },
      addEventListener: () => undefined,
      dispatchEvent: () => true,
    };
    const fakeDocument = {
      cookie: '',
      querySelector: (selector: string) => selector === '#mc-production-connect' ? connect : selector === '#mc-production-status' ? status : null,
      querySelectorAll: () => [],
      createElement: () => ({}),
    };
    const fakeStorage = {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    };
    const run = new Function(
      'document', 'window', 'navigator', 'sessionStorage', 'location', 'fetch', 'CustomEvent',
      productionClientScript()
    );
    run(
      fakeDocument,
      fakeWindow,
      { wallets: [] },
      fakeStorage,
      { reload: () => { reloads += 1; } },
      fakeFetch,
      class { constructor(readonly _name: string, readonly init: unknown) {} }
    );

    await handlers.get('click')?.();

    expect(connect.disabled).toBe(true);
    expect(attributes.get('aria-busy')).toBe('true');
    expect(signedMessages).toHaveLength(1);
    expect(new TextDecoder().decode(signedMessages[0]!.message)).toBe(challengeMessage);
    expect(signedMessages[0]!.encoding).toBe('utf8');
    expect(requests.map(({ path }) => path)).toEqual(['/api/auth/challenge', '/api/auth/verify']);
    expect(JSON.parse(String(requests[0]!.init.body))).toEqual({ walletAddress });
    expect(JSON.parse(String(requests[1]!.init.body))).toEqual({
      challengeId,
      walletAddress,
      signature: expect.any(String),
    });
    expect(Object.keys(JSON.parse(String(requests[1]!.init.body))).sort()).toEqual([
      'challengeId', 'signature', 'walletAddress',
    ]);
    expect(stored.get('mfi_csrf')).toBe(csrfToken);
    expect(reloads).toBe(1);
  });

  it('uses the current CSRF cookie for logout and tolerates unavailable tab storage', async () => {
    type Handler = () => void | Promise<void>;
    let logoutHandler: Handler | undefined;
    let reloads = 0;
    let sentToken: unknown;
    const logout = {
      disabled: false,
      addEventListener: (_name: string, handler: Handler) => { logoutHandler = handler; },
      setAttribute: () => undefined,
      removeAttribute: () => undefined,
    };
    const status = { textContent: '', dataset: {} as Record<string, string> };
    const fakeDocument = {
      cookie: 'mfi_console_csrf=current-cookie-token',
      querySelector: (selector: string) => selector === '#mc-production-logout' ? logout : selector === '#mc-production-status' ? status : null,
      querySelectorAll: () => [],
      createElement: () => ({}),
    };
    const blockedStorage = {
      getItem: () => { throw new Error('storage disabled'); },
      setItem: () => { throw new Error('storage disabled'); },
      removeItem: () => { throw new Error('storage disabled'); },
    };
    const fakeFetch = async (_path: string, init: { headers?: Record<string, unknown> }) => {
      sentToken = init.headers?.['x-csrf-token'];
      return { ok: true, status: 200, json: async () => ({ ok: true, authenticated: false }) };
    };
    const run = new Function(
      'document', 'window', 'navigator', 'sessionStorage', 'location', 'fetch', 'CustomEvent',
      productionClientScript()
    );
    run(
      fakeDocument,
      { addEventListener: () => undefined, dispatchEvent: () => true },
      { wallets: [] },
      blockedStorage,
      { reload: () => { reloads += 1; } },
      fakeFetch,
      class { constructor(readonly _name: string, readonly init: unknown) {} }
    );

    await logoutHandler?.();

    expect(sentToken).toBe('current-cookie-token');
    expect(reloads).toBe(1);
    expect(logout.disabled).toBe(true);
  });

  it('updates the containing telemetry row and surfaces stream disconnects', () => {
    const script = productionClientScript();
    expect(script).toContain("document.querySelectorAll('[data-machine-telemetry]')");
    expect(script).toContain("row.querySelector('[data-live-state]')");
    expect(script).toContain("row.dataset.receivedAt = payload.receivedAt");
    expect(script).toContain("'/api/telemetry?latest=true&limit=100'");
    expect(script).toContain("'/api/telemetry?machineId='");
    expect(script).toContain('scopedMachineId');
    expect(script).toContain('incoming < current');
    expect(script).toContain('stored snapshots remain visible while the browser retries');
  });

  it('keeps accepted and granted SOL requests settlement-eligible', () => {
    const request: PersistentResourceRequest = {
      id: 'request-1', ownerUserId: 'owner-1', requesterMachineId: 'machine-1',
      capabilityId: 'capability-1', providerMachineId: 'provider-1', resourceType: 'compute-burst',
      quantity: '1', maxPrice: '1', preferredRails: ['solana:devnet'], purpose: 'test',
      quoteAmount: '0.1', quoteAsset: 'SOL', state: 'accepted',
      createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
    };
    expect(isSettlementEligibleRequest(request)).toBe(true);
    expect(isSettlementEligibleRequest({ ...request, state: 'granted' })).toBe(true);
    expect(isSettlementEligibleRequest({ ...request, state: 'fulfilled' })).toBe(false);
    expect(isSettlementEligibleRequest({ ...request, quoteAsset: null })).toBe(false);
  });

  it('links signatures only to the verified public cluster explorer', () => {
    expect(solanaClusterDisplayLabel('mainnet-beta')).toBe('mainnet');
    expect(solanaClusterDisplayLabel('devnet')).toBe('devnet');
    expect(solanaExplorerTransactionUrl('signature', 'mainnet-beta')).toBe(
      'https://explorer.solana.com/tx/signature'
    );
    expect(solanaExplorerTransactionUrl('signature', 'devnet')).toBe(
      'https://explorer.solana.com/tx/signature?cluster=devnet'
    );
    expect(solanaExplorerTransactionUrl('signature', 'custom')).toBeNull();
    expect(productionClientScript()).toContain('navigator.clipboard.writeText');
  });

  it('treats elapsed quote and grant expiries as expired before rendering actions', () => {
    const quote: PersistentResourceQuote = {
      id: 'quote-1', resourceRequestId: 'request-1', providerOwnerUserId: 'provider-owner',
      providerMachineId: 'provider-1', capabilityId: 'capability-1', amount: '0.1', asset: 'SOL',
      state: 'offered', expiresAt: '2026-08-24T11:59:59.000Z',
      createdAt: '2026-08-24T11:00:00.000Z', updatedAt: '2026-08-24T11:00:00.000Z',
    };
    const grant: PersistentAccessGrant = {
      id: 'grant-1', resourceRequestId: 'request-1', resourceQuoteId: quote.id,
      providerOwnerUserId: 'provider-owner', providerMachineId: 'provider-1',
      requesterOwnerUserId: 'owner-1', requesterMachineId: 'machine-1', state: 'active',
      accessReference: null, expiresAt: quote.expiresAt,
      createdAt: quote.createdAt, updatedAt: quote.updatedAt,
    };
    expect(effectiveQuoteState(quote, NOW)).toBe('expired');
    expect(effectiveQuoteState({ ...quote, state: 'accepted' }, NOW)).toBe('accepted');
    expect(effectiveGrantState(grant, NOW)).toBe('expired');
    expect(effectiveQuoteState({ ...quote, expiresAt: '2026-08-24T12:01:00.000Z' }, NOW)).toBe('offered');
  });

  it('offers only backend-compatible provider capabilities and targeted rejection', () => {
    const request: PersistentResourceRequest = {
      id: 'request-1', ownerUserId: 'requester-owner', requesterMachineId: 'requester-1',
      capabilityId: 'capability-1', providerMachineId: 'provider-1', resourceType: 'compute-burst',
      quantity: '1', maxPrice: '1', preferredRails: ['solana:devnet'], purpose: 'test',
      quoteAmount: null, quoteAsset: null, state: 'pending',
      createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
    };
    const capability: ProviderCapabilityRow = {
      id: 'capability-1', providerMachineId: 'provider-1', ownerUserId: 'provider-owner',
      resourceType: 'compute-burst', label: 'Compute', unit: 'minute',
      railTags: ['solana:devnet'], availability: 'available', priceAmount: '0.5', priceAsset: 'SOL',
      createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
    };
    expect(isProviderCapabilityCompatibleWithRequest(capability, request)).toBe(true);
    expect(isProviderCapabilityCompatibleWithRequest({ ...capability, id: 'other' }, request)).toBe(false);
    expect(isProviderCapabilityCompatibleWithRequest({ ...capability, railTags: ['solana:mainnet'] }, request)).toBe(false);
    expect(isProviderCapabilityCompatibleWithRequest({ ...capability, priceAmount: '2' }, request)).toBe(false);
    expect(isProviderCapabilityCompatibleWithRequest({ ...capability, availability: 'unavailable' }, request)).toBe(false);
    expect(canProviderRejectRequest(request, [machine('provider-1')])).toBe(true);
    expect(canProviderRejectRequest({ ...request, providerMachineId: null }, [machine('provider-1')])).toBe(false);
  });

  it('allows explicit replacement after terminal grants or rejected receipts only', () => {
    const grant: PersistentAccessGrant = {
      id: 'grant-1', resourceRequestId: 'request-1', resourceQuoteId: 'quote-1',
      providerOwnerUserId: 'provider-owner', providerMachineId: 'provider-1',
      requesterOwnerUserId: 'requester-owner', requesterMachineId: 'requester-1',
      state: 'active', accessReference: null, expiresAt: '2026-08-24T12:30:00.000Z',
      createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
    };
    const receipt: PersistentResourceReceipt = {
      id: 'receipt-1', resourceRequestId: 'request-1', accessGrantId: grant.id,
      settlementId: null, providerOwnerUserId: 'provider-owner', requesterOwnerUserId: 'requester-owner',
      state: 'recorded', evidenceReference: null, resultReference: null,
      createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
    };
    expect(canCreateAccessGrant(null, NOW)).toBe(true);
    expect(canCreateAccessGrant({ ...grant, state: 'revoked' }, NOW)).toBe(true);
    expect(canCreateAccessGrant({ ...grant, expiresAt: '2026-08-24T11:59:00.000Z' }, NOW)).toBe(true);
    expect(canCreateAccessGrant(grant, NOW)).toBe(false);
    expect(canReplaceResourceReceipt(null)).toBe(true);
    expect(canReplaceResourceReceipt({ ...receipt, state: 'rejected' })).toBe(true);
    expect(canReplaceResourceReceipt(receipt)).toBe(false);
  });
});
