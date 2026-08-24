import { describe, expect, it } from 'vitest';
import { MemoryProductionStore } from '../src/server/production/memory-store.js';
import type { OwnedMachineRecord, PersistentResourceRequest, SettlementRecord } from '../src/server/production/types.js';

const NOW = '2026-08-24T00:00:00.000Z';
const LATER = '2026-08-24T00:01:00.000Z';
const MUCH_LATER = '2026-08-24T00:03:00.000Z';

const machine = (machineId: string, ownerUserId: string, walletAddress: string): OwnedMachineRecord => ({
  machineId,
  ownerUserId,
  walletAddress,
  label: machineId,
  role: 'edge_node',
  createdAt: NOW,
  updatedAt: NOW,
});

const request = (ownerUserId: string, requesterMachineId: string): PersistentResourceRequest => ({
  id: 'request-1',
  ownerUserId,
  requesterMachineId,
  capabilityId: null,
  providerMachineId: null,
  resourceType: 'compute-burst',
  quantity: '2',
  maxPrice: '0.000002',
  preferredRails: ['solana'],
  purpose: 'inference',
  quoteAmount: null,
  quoteAsset: null,
  state: 'pending',
  createdAt: NOW,
  updatedAt: NOW,
});

describe('marketplace persistence authorization', () => {
  it('generates capability IDs and scopes updates to the provider owner', async () => {
    const store = new MemoryProductionStore();
    await store.createOwnedMachine(machine('provider-1', 'provider-user', 'provider-wallet'));
    const capability = await store.createProviderCapability('provider-user', {
      providerMachineId: 'provider-1',
      resourceType: 'compute-burst',
      label: 'GPU second',
      unit: 'second',
      railTags: ['solana'],
      availability: 'available',
      priceAmount: null,
      priceAsset: null,
    }, NOW);
    expect(capability?.id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(await store.updateProviderCapability('attacker', capability!.id, {
      label: 'stolen', unit: capability!.unit, railTags: capability!.railTags,
      availability: capability!.availability, priceAmount: null, priceAsset: null, updatedAt: LATER,
    })).toBeNull();
    expect((await store.providerCapability('provider-user', capability!.id))?.label).toBe('GPU second');

    const second = await store.createProviderCapability('provider-user', {
      providerMachineId: 'provider-1', resourceType: 'compute-burst', label: 'GPU minute', unit: 'minute',
      railTags: ['solana'], availability: 'available', priceAmount: null, priceAsset: null,
    }, NOW);
    expect(await store.updateProviderCapability('provider-user', second!.id, {
      label: 'GPU second', unit: second!.unit, railTags: second!.railTags,
      availability: second!.availability, priceAmount: null, priceAsset: null, updatedAt: LATER,
    })).toBeNull();
    expect((await store.providerCapability('provider-user', second!.id))?.label).toBe('GPU minute');
  });

  it('atomically cancels, rejects, and withdraws only for the authorized marketplace party', async () => {
    const store = new MemoryProductionStore();
    await store.createOwnedMachine(machine('requester-1', 'requester-user', 'requester-wallet'));
    await store.createOwnedMachine(machine('provider-1', 'provider-user', 'provider-wallet'));
    const capability = await store.createProviderCapability('provider-user', {
      providerMachineId: 'provider-1', resourceType: 'compute-burst', label: 'GPU second', unit: 'second',
      railTags: ['solana'], availability: 'available', priceAmount: null, priceAsset: null,
    }, NOW);
    await store.createResourceRequest(request('requester-user', 'requester-1'));
    const quote = await store.createResourceQuote('provider-user', {
      resourceRequestId: 'request-1', capabilityId: capability!.id, amount: '0.000001', asset: 'SOL', expiresAt: null,
    }, NOW);
    expect(await store.withdrawResourceQuote('attacker', quote!.id, LATER)).toBeNull();
    expect(await store.withdrawResourceQuote('provider-user', quote!.id, LATER)).toMatchObject({
      request: { state: 'pending' }, quote: { state: 'withdrawn' },
    });

    const replacement = await store.createResourceQuote('provider-user', {
      resourceRequestId: 'request-1', capabilityId: capability!.id, amount: '0.000001', asset: 'SOL', expiresAt: null,
    }, LATER);
    expect(await store.cancelResourceRequest('attacker', 'request-1', MUCH_LATER)).toBeNull();
    expect(await store.cancelResourceRequest('requester-user', 'request-1', MUCH_LATER)).toMatchObject({ state: 'cancelled' });
    expect(store.quotes.get(replacement!.id)?.state).toBe('declined');

    await store.createResourceRequest({
      ...request('requester-user', 'requester-1'), id: 'targeted-request',
      capabilityId: capability!.id, providerMachineId: 'provider-1',
    });
    expect(await store.rejectResourceRequest('attacker', 'targeted-request', LATER)).toBeNull();
    expect(await store.rejectResourceRequest('provider-user', 'targeted-request', LATER)).toMatchObject({ state: 'rejected' });

    await store.createResourceRequest({ ...request('requester-user', 'requester-1'), id: 'open-request' });
    expect(await store.rejectResourceRequest('provider-user', 'open-request', LATER)).toBeNull();
  });

  it('expires grants before activation or receipt and permits a replacement grant', async () => {
    const store = new MemoryProductionStore();
    await store.createOwnedMachine(machine('requester-1', 'requester-user', 'requester-wallet'));
    await store.createOwnedMachine(machine('provider-1', 'provider-user', 'provider-wallet'));
    const capability = await store.createProviderCapability('provider-user', {
      providerMachineId: 'provider-1', resourceType: 'compute-burst', label: 'GPU second', unit: 'second',
      railTags: ['solana'], availability: 'available', priceAmount: null, priceAsset: null,
    }, NOW);
    await store.createResourceRequest(request('requester-user', 'requester-1'));
    const quote = await store.createResourceQuote('provider-user', {
      resourceRequestId: 'request-1', capabilityId: capability!.id, amount: '0.000001', asset: 'SOL', expiresAt: null,
    }, NOW);
    await store.acceptResourceQuote('requester-user', 'request-1', quote!.id, NOW);
    const stale = await store.createAccessGrant('provider-user', {
      resourceRequestId: 'request-1', resourceQuoteId: quote!.id,
      accessReference: 'vault:stale', expiresAt: '2026-08-24T00:00:30.000Z',
    }, NOW);
    expect(await store.transitionAccessGrant('provider-user', stale!.id, 'pending', 'active', LATER)).toBeNull();
    expect(store.grants.get(stale!.id)?.state).toBe('expired');

    const replacement = await store.createAccessGrant('provider-user', {
      resourceRequestId: 'request-1', resourceQuoteId: quote!.id,
      accessReference: 'vault:fresh', expiresAt: '2026-08-24T00:02:00.000Z',
    }, LATER);
    expect(await store.transitionAccessGrant('provider-user', replacement!.id, 'pending', 'active', LATER)).toMatchObject({ state: 'active' });
    expect(await store.createResourceReceipt('provider-user', {
      resourceRequestId: 'request-1', accessGrantId: replacement!.id, settlementId: null,
      evidenceReference: 'sha256:evidence', resultReference: null,
    }, MUCH_LATER)).toBeNull();
    expect(store.grants.get(replacement!.id)?.state).toBe('expired');
    expect(await store.resourceRequest('requester-user', 'request-1')).toMatchObject({ state: 'accepted' });
    expect(await store.createAccessGrant('provider-user', {
      resourceRequestId: 'request-1', resourceQuoteId: quote!.id, accessReference: 'vault:third', expiresAt: null,
    }, MUCH_LATER)).toMatchObject({ state: 'pending' });
  });

  it('separates provider quotes, grants, and requester-verified receipts', async () => {
    const store = new MemoryProductionStore();
    await store.createOwnedMachine(machine('requester-1', 'requester-user', 'requester-wallet'));
    await store.createOwnedMachine(machine('provider-1', 'provider-user', 'provider-wallet'));
    const capability = await store.createProviderCapability('provider-user', {
      providerMachineId: 'provider-1', resourceType: 'compute-burst', label: 'GPU second', unit: 'second',
      railTags: ['solana'], availability: 'available', priceAmount: null, priceAsset: null,
    }, NOW);
    await store.createResourceRequest(request('requester-user', 'requester-1'));

    expect(await store.createResourceQuote('attacker', { resourceRequestId: 'request-1', capabilityId: capability!.id, amount: '0.000001', asset: 'SOL', expiresAt: null }, NOW)).toBeNull();
    const quote = await store.createResourceQuote('provider-user', { resourceRequestId: 'request-1', capabilityId: capability!.id, amount: '0.000001', asset: 'SOL', expiresAt: null }, NOW);
    expect(quote).toMatchObject({ state: 'offered', providerOwnerUserId: 'provider-user' });
    expect(await store.providerResourceRequest('attacker', 'request-1')).toBeNull();
    expect(await store.providerResourceRequest('provider-user', 'request-1')).not.toBeNull();

    const accepted = await store.acceptResourceQuote('requester-user', 'request-1', quote!.id, LATER);
    expect(accepted?.request).toMatchObject({ state: 'accepted', quoteAmount: '0.000001', quoteAsset: 'SOL' });
    expect(await store.acceptResourceQuote('requester-user', 'request-1', quote!.id, LATER)).toBeNull();

    const grant = await store.createAccessGrant('provider-user', { resourceRequestId: 'request-1', resourceQuoteId: quote!.id, accessReference: 'vault:grant-1', expiresAt: null }, LATER);
    expect(grant?.state).toBe('pending');
    expect(await store.transitionAccessGrant('requester-user', grant!.id, 'pending', 'active', LATER)).toBeNull();
    expect((await store.transitionAccessGrant('provider-user', grant!.id, 'pending', 'active', LATER))?.state).toBe('active');

    const receipt = await store.createResourceReceipt('provider-user', { resourceRequestId: 'request-1', accessGrantId: grant!.id, settlementId: null, evidenceReference: 'sha256:evidence', resultReference: 'result:1' }, LATER);
    expect(receipt?.state).toBe('recorded');
    expect(await store.transitionAccessGrant('provider-user', grant!.id, 'active', 'expired', MUCH_LATER)).toMatchObject({ state: 'expired' });
    expect(await store.resourceRequest('requester-user', 'request-1')).toMatchObject({ state: 'granted' });
    expect(await store.transitionResourceReceipt('provider-user', receipt!.id, 'recorded', 'verified', MUCH_LATER)).toBeNull();
    expect((await store.transitionResourceReceipt(
      'requester-user', receipt!.id, 'recorded', 'verified', '2026-08-24T00:04:00.000Z'
    ))?.state).toBe('verified');
    expect((await store.resourceRequest('requester-user', 'request-1'))?.state).toBe('fulfilled');
  });

  it('keeps an active grant usable for a corrected receipt after requester rejection', async () => {
    const store = new MemoryProductionStore();
    await store.createOwnedMachine(machine('requester-1', 'requester-user', 'requester-wallet'));
    await store.createOwnedMachine(machine('provider-1', 'provider-user', 'provider-wallet'));
    const capability = await store.createProviderCapability('provider-user', {
      providerMachineId: 'provider-1', resourceType: 'compute-burst', label: 'GPU second', unit: 'second',
      railTags: ['solana'], availability: 'available', priceAmount: null, priceAsset: null,
    }, NOW);
    await store.createResourceRequest(request('requester-user', 'requester-1'));
    const quote = await store.createResourceQuote('provider-user', {
      resourceRequestId: 'request-1', capabilityId: capability!.id, amount: '0.000001', asset: 'SOL', expiresAt: null,
    }, NOW);
    await store.acceptResourceQuote('requester-user', 'request-1', quote!.id, LATER);
    const grant = await store.createAccessGrant('provider-user', {
      resourceRequestId: 'request-1', resourceQuoteId: quote!.id, accessReference: 'vault:grant', expiresAt: null,
    }, LATER);
    await store.transitionAccessGrant('provider-user', grant!.id, 'pending', 'active', LATER);
    const rejectedReceipt = await store.createResourceReceipt('provider-user', {
      resourceRequestId: 'request-1', accessGrantId: grant!.id, settlementId: null,
      evidenceReference: 'sha256:bad', resultReference: 'result:bad',
    }, LATER);
    expect(await store.transitionResourceReceipt(
      'requester-user', rejectedReceipt!.id, 'recorded', 'rejected', MUCH_LATER
    )).toMatchObject({ state: 'rejected' });
    expect(await store.resourceRequest('requester-user', 'request-1')).toMatchObject({ state: 'granted' });
    const corrected = await store.createResourceReceipt('provider-user', {
      resourceRequestId: 'request-1', accessGrantId: grant!.id, settlementId: null,
      evidenceReference: 'sha256:corrected', resultReference: 'result:corrected',
    }, '2026-08-24T00:04:00.000Z');
    expect(corrected).toMatchObject({ state: 'recorded', evidenceReference: 'sha256:corrected' });
    expect((await store.resourceReceipt('requester-user', 'request-1'))?.id).toBe(corrected!.id);
    expect(await store.transitionResourceReceipt(
      'requester-user', corrected!.id, 'recorded', 'verified', '2026-08-24T00:05:00.000Z'
    )).toMatchObject({ state: 'verified' });
    expect(await store.resourceRequest('requester-user', 'request-1')).toMatchObject({ state: 'fulfilled' });
    expect(await store.resourceRequestLifecycles(
      'requester-user', ['request-1', 'request-1', 'unknown'], '2026-08-24T00:05:00.000Z'
    )).toMatchObject([{
      resourceRequestId: 'request-1',
      quotes: [{ id: quote!.id, state: 'accepted' }],
      grant: { id: grant!.id, state: 'active' },
      receipt: { id: corrected!.id, state: 'verified' },
    }]);
  });

  it('keeps an open request unbound while two providers quote and binds only the accepted offer', async () => {
    const store = new MemoryProductionStore();
    await store.createOwnedMachine(machine('requester-1', 'requester-user', 'requester-wallet'));
    await store.createOwnedMachine(machine('provider-a', 'provider-a-user', 'provider-a-wallet'));
    await store.createOwnedMachine(machine('provider-b', 'provider-b-user', 'provider-b-wallet'));
    const capabilityA = await store.createProviderCapability('provider-a-user', {
      providerMachineId: 'provider-a', resourceType: 'compute-burst', label: 'GPU A', unit: 'second',
      railTags: ['solana'], availability: 'available', priceAmount: null, priceAsset: null,
    }, NOW);
    const capabilityB = await store.createProviderCapability('provider-b-user', {
      providerMachineId: 'provider-b', resourceType: 'compute-burst', label: 'GPU B', unit: 'second',
      railTags: ['solana'], availability: 'available', priceAmount: null, priceAsset: null,
    }, NOW);
    await store.createResourceRequest(request('requester-user', 'requester-1'));

    expect(await store.providerResourceRequest('provider-a-user', 'request-1')).not.toBeNull();
    expect(await store.providerResourceRequest('provider-b-user', 'request-1')).not.toBeNull();
    const quoteA = await store.createResourceQuote('provider-a-user', {
      resourceRequestId: 'request-1', capabilityId: capabilityA!.id, amount: '0.000002', asset: 'SOL', expiresAt: null,
    }, NOW);
    const quoteB = await store.createResourceQuote('provider-b-user', {
      resourceRequestId: 'request-1', capabilityId: capabilityB!.id, amount: '0.000001', asset: 'SOL', expiresAt: null,
    }, NOW);
    expect(quoteA?.state).toBe('offered');
    expect(quoteB?.state).toBe('offered');
    expect(await store.resourceRequest('requester-user', 'request-1')).toMatchObject({
      state: 'quoted', capabilityId: null, providerMachineId: null, quoteAmount: null, quoteAsset: null,
    });

    const accepted = await store.acceptResourceQuote('requester-user', 'request-1', quoteB!.id, LATER);
    expect(accepted?.request).toMatchObject({
      state: 'accepted', capabilityId: capabilityB!.id, providerMachineId: 'provider-b',
      quoteAmount: '0.000001', quoteAsset: 'SOL',
    });
    expect(store.quotes.get(quoteA!.id)?.state).toBe('declined');
    expect(store.quotes.get(quoteB!.id)?.state).toBe('accepted');
    expect(await store.providerResourceRequest('provider-a-user', 'request-1')).toBeNull();
    expect(await store.providerResourceRequest('provider-b-user', 'request-1')).toMatchObject({ state: 'accepted' });
  });

  it('rejects an incompatible-rail capability even when its provider owns another compatible capability', async () => {
    const store = new MemoryProductionStore();
    await store.createOwnedMachine(machine('requester-1', 'requester-user', 'requester-wallet'));
    await store.createOwnedMachine(machine('provider-1', 'provider-user', 'provider-wallet'));
    const incompatible = await store.createProviderCapability('provider-user', {
      providerMachineId: 'provider-1', resourceType: 'compute-burst', label: 'Wrong rail', unit: 'second',
      railTags: ['robinhood'], availability: 'available', priceAmount: null, priceAsset: null,
    }, NOW);
    const compatible = await store.createProviderCapability('provider-user', {
      providerMachineId: 'provider-1', resourceType: 'compute-burst', label: 'Solana rail', unit: 'second',
      railTags: ['solana'], availability: 'available', priceAmount: null, priceAsset: null,
    }, NOW);
    await store.createResourceRequest(request('requester-user', 'requester-1'));

    expect(await store.providerResourceRequest('provider-user', 'request-1')).not.toBeNull();
    expect(await store.createResourceQuote('provider-user', {
      resourceRequestId: 'request-1', capabilityId: incompatible!.id,
      amount: '0.000001', asset: 'SOL', expiresAt: null,
    }, NOW)).toBeNull();
    expect(await store.createResourceQuote('provider-user', {
      resourceRequestId: 'request-1', capabilityId: compatible!.id,
      amount: '0.000001', asset: 'SOL', expiresAt: null,
    }, NOW)).toMatchObject({ state: 'offered', capabilityId: compatible!.id });
  });

  it('expires a stale offered quote and lets the same provider create a replacement', async () => {
    const store = new MemoryProductionStore();
    await store.createOwnedMachine(machine('requester-1', 'requester-user', 'requester-wallet'));
    await store.createOwnedMachine(machine('provider-1', 'provider-user', 'provider-wallet'));
    const capability = await store.createProviderCapability('provider-user', {
      providerMachineId: 'provider-1', resourceType: 'compute-burst', label: 'GPU second', unit: 'second',
      railTags: ['solana'], availability: 'available', priceAmount: null, priceAsset: null,
    }, NOW);
    await store.createResourceRequest(request('requester-user', 'requester-1'));
    const original = await store.createResourceQuote('provider-user', {
      resourceRequestId: 'request-1', capabilityId: capability!.id,
      amount: '0.000002', asset: 'SOL', expiresAt: '2026-08-24T00:00:30.000Z',
    }, NOW);

    const replacement = await store.createResourceQuote('provider-user', {
      resourceRequestId: 'request-1', capabilityId: capability!.id,
      amount: '0.000001', asset: 'SOL', expiresAt: null,
    }, LATER);
    expect(replacement).toMatchObject({ state: 'offered', amount: '0.000001' });
    expect(replacement?.id).not.toBe(original?.id);
    expect(store.quotes.get(original!.id)).toMatchObject({ state: 'expired', updatedAt: LATER });
    expect(store.quotes.get(replacement!.id)?.state).toBe('offered');
  });

  it('links at most one trusted settlement to an accepted request', async () => {
    const store = new MemoryProductionStore();
    store.walletUsers.set('requester-wallet', 'requester-user');
    await store.createOwnedMachine(machine('requester-1', 'requester-user', 'requester-wallet'));
    await store.createOwnedMachine(machine('provider-1', 'provider-user', 'provider-wallet'));
    const capability = await store.createProviderCapability('provider-user', {
      providerMachineId: 'provider-1', resourceType: 'compute-burst', label: 'GPU second', unit: 'second', railTags: ['solana'], availability: 'available', priceAmount: null, priceAsset: null,
    }, NOW);
    await store.createResourceRequest(request('requester-user', 'requester-1'));
    const quote = await store.createResourceQuote('provider-user', { resourceRequestId: 'request-1', capabilityId: capability!.id, amount: '0.000001', asset: 'SOL', expiresAt: null }, NOW);
    await store.acceptResourceQuote('requester-user', 'request-1', quote!.id, LATER);
    const grant = await store.createAccessGrant('provider-user', {
      resourceRequestId: 'request-1', resourceQuoteId: quote!.id, accessReference: 'vault:settlement', expiresAt: null,
    }, LATER);
    await store.transitionAccessGrant('provider-user', grant!.id, 'pending', 'active', LATER);
    expect(await store.resourceRequest('requester-user', 'request-1')).toMatchObject({ state: 'granted' });
    const settlement: SettlementRecord = {
      id: 'settlement-1', resourceRequestId: 'request-1', resourceQuoteId: quote!.id, ownerUserId: 'requester-user', machineId: 'requester-1', sourceWallet: 'requester-wallet', recipientWallet: 'provider-wallet', amountLamports: '2000', state: 'created', unsignedTransaction: null, transactionSignature: null, lastValidBlockHeight: null, errorCode: null, createdAt: LATER, updatedAt: LATER,
    };
    expect(await store.createSettlementForAcceptedRequest(settlement)).toMatchObject({ id: 'settlement-1' });
    expect(await store.createSettlementForAcceptedRequest({ ...settlement, id: 'settlement-2' })).toBeNull();
    expect(await store.createSettlementForAcceptedRequest({ ...settlement, id: 'settlement-3', resourceRequestId: 'other' })).toBeNull();
    store.settlements.set('settlement-1', {
      ...settlement, state: 'confirmed', transactionSignature: 'confirmed-signature', updatedAt: MUCH_LATER,
    });
    expect(await store.createResourceReceipt('provider-user', {
      resourceRequestId: 'request-1', accessGrantId: grant!.id, settlementId: 'settlement-1',
      evidenceReference: 'sha256:receipt', resultReference: 'result:settled',
    }, MUCH_LATER)).toMatchObject({ settlementId: 'settlement-1' });
    expect(await store.receiptSettlement('provider-user', 'request-1')).toEqual({
      id: 'settlement-1', resourceRequestId: 'request-1', state: 'confirmed',
      transactionSignature: 'confirmed-signature', updatedAt: MUCH_LATER,
    });
    expect(await store.receiptSettlement('attacker', 'request-1')).toBeNull();
  });

  it('does not attach one transaction signature to two settlement records', async () => {
    const store = new MemoryProductionStore();
    const base: SettlementRecord = {
      id: 'settlement-a', resourceRequestId: 'request-a', resourceQuoteId: 'quote-a', ownerUserId: 'owner',
      machineId: 'machine-a', sourceWallet: 'source', recipientWallet: 'recipient', amountLamports: '1',
      state: 'awaiting_signature', unsignedTransaction: 'unsigned-a', transactionSignature: null,
      lastValidBlockHeight: '100', errorCode: null, createdAt: NOW, updatedAt: NOW,
    };
    store.settlements.set(base.id, base);
    store.settlements.set('settlement-b', {
      ...base, id: 'settlement-b', resourceRequestId: 'request-b', resourceQuoteId: 'quote-b', unsignedTransaction: 'unsigned-b',
    });
    expect(await store.transitionSettlement('owner', 'settlement-a', 'awaiting_signature', {
      state: 'submitting', updatedAt: LATER, transactionSignature: 'same-signature',
    })).toMatchObject({ transactionSignature: 'same-signature' });
    expect(await store.transitionSettlement('owner', 'settlement-b', 'awaiting_signature', {
      state: 'submitting', updatedAt: LATER, transactionSignature: 'same-signature',
    })).toBeNull();
    expect(store.settlements.get('settlement-b')?.state).toBe('awaiting_signature');
  });

  it('bounds list reads and applies provider discovery filters before the limit', async () => {
    const store = new MemoryProductionStore();
    for (let index = 0; index < 205; index += 1) {
      await store.createOwnedMachine(machine(`machine-${index}`, 'owner', `wallet-${index}`));
    }
    expect(await store.listOwnedMachines('owner')).toHaveLength(100);
    expect(await store.listOwnedMachines('owner', 10_000)).toHaveLength(200);

    await store.createOwnedMachine(machine('provider', 'provider-owner', 'provider-wallet'));
    await store.createProviderCapability('provider-owner', {
      providerMachineId: 'provider', resourceType: 'weather-data', label: 'A unrelated', unit: 'reading',
      railTags: ['solana'], availability: 'available', priceAmount: null, priceAsset: null,
    }, NOW);
    const expected = await store.createProviderCapability('provider-owner', {
      providerMachineId: 'provider', resourceType: 'compute-burst', label: 'Z matching', unit: 'second',
      railTags: ['solana'], availability: 'available', priceAmount: '0.000001', priceAsset: 'SOL',
    }, NOW);
    expect(await store.findProviderCapabilities({
      resourceType: 'compute-burst', preferredRails: ['solana'], maxPrice: '0.000001', capabilityId: null,
    }, 1)).toEqual([expected]);
  });
});
