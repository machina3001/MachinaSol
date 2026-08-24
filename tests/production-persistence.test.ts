import { describe, expect, it } from 'vitest';
import { MemoryProductionStore } from '../src/server/production/memory-store.js';
import type {
  AuthSessionRecord,
  OwnedMachineRecord,
  PersistentRuntimeSession,
  PersistentWorkOrder,
} from '../src/server/production/types.js';

const NOW = '2026-08-24T00:00:00.000Z';
const LATER = '2026-08-24T00:01:00.000Z';

const machine = (machineId: string, ownerUserId: string): OwnedMachineRecord => ({
  machineId,
  ownerUserId,
  walletAddress: '11111111111111111111111111111111',
  label: machineId,
  role: 'edge_node',
  createdAt: NOW,
  updatedAt: NOW,
});

describe('grounded production persistence projections', () => {
  it('keeps overlapping challenges independently usable and consumes each only once', async () => {
    const store = new MemoryProductionStore();
    const challenge = (id: string) => ({
      id,
      walletAddress: 'wallet-address',
      message: `challenge:${id}`,
      nonceHash: `hash:${id}`,
      expiresAt: '2026-08-24T00:05:00.000Z',
      consumedAt: null,
    });
    await store.createChallenge(challenge('first'), NOW);
    await store.createChallenge(challenge('second'), '2026-08-24T00:00:01.000Z');
    expect(await store.activeChallenge('first', 'wallet-address', LATER)).toMatchObject({ id: 'first', consumedAt: null });
    expect(await store.activeChallenge('second', 'wallet-address', LATER)).toMatchObject({ id: 'second', consumedAt: null });
    expect(await store.consumeChallenge('first', 'wallet-address', LATER)).toMatchObject({ id: 'first', consumedAt: LATER });
    expect(await store.consumeChallenge('first', 'wallet-address', LATER)).toBeNull();
    expect(await store.consumeChallenge('second', 'wallet-address', LATER)).toMatchObject({ id: 'second', consumedAt: LATER });
  });

  it('binds an authenticated session to the wallet identity supplied by verification', async () => {
    const store = new MemoryProductionStore();
    const session = (id: string, userId: string, walletAddress: string): AuthSessionRecord => ({
      id,
      userId,
      walletAddress,
      tokenHash: `token:${id}`,
      csrfHash: `csrf:${id}`,
      expiresAt: '2026-08-24T12:00:00.000Z',
      revokedAt: null,
    });

    const first = await store.createAuthenticatedSession({
      session: session('session-a', 'user-a', 'wallet-a'),
      walletAddress: 'wallet-a',
      now: NOW,
    });
    const second = await store.createAuthenticatedSession({
      // Simulate a mismatched internal caller. The separately trusted field is
      // the wallet that completed challenge verification.
      session: session('session-b', 'user-b', first.walletAddress),
      walletAddress: 'wallet-b',
      now: NOW,
    });

    expect(first).toMatchObject({ userId: 'user-a', walletAddress: 'wallet-a' });
    expect(second).toMatchObject({ userId: 'user-b', walletAddress: 'wallet-b' });
    expect(store.walletUsers.get('wallet-b')).toBe(second.userId);
  });

  it('replaces machine capabilities only for the machine owner', async () => {
    const store = new MemoryProductionStore();
    await store.createOwnedMachine(machine('machine-1', 'owner-1'));

    expect(await store.replaceMachineCapabilities('attacker', 'machine-1', ['mapping'], NOW)).toBeNull();
    expect(await store.replaceMachineCapabilities('owner-1', 'machine-1', ['mapping', 'inspection', 'mapping'], NOW))
      .toMatchObject([{ capability: 'mapping' }, { capability: 'inspection' }]);
    expect(await store.listMachineCapabilities('attacker', 'machine-1')).toEqual([]);
    expect(await store.listMachineCapabilities('owner-1', 'machine-1')).toHaveLength(2);
  });

  it('creates machine credentials only through an owner-scoped store operation', async () => {
    const store = new MemoryProductionStore();
    await store.createOwnedMachine(machine('machine-1', 'owner-1'));
    const credential = {
      id: 'credential-1',
      machineId: 'machine-1',
      secretHash: 'sha256:credential-secret',
      label: 'telemetry ingestion',
      createdAt: NOW,
      expiresAt: null,
      revokedAt: null,
    };

    expect(await store.createMachineCredential('attacker', credential)).toBe(false);
    expect(await store.createMachineCredential('owner-1', { ...credential, machineId: 'missing-machine' })).toBe(false);
    expect(await store.listMachineCredentials('owner-1', 'machine-1')).toEqual([]);
    expect(await store.createMachineCredential('owner-1', credential)).toBe(true);
    expect(await store.createMachineCredential('owner-1', credential)).toBe(false);
    expect(await store.listMachineCredentials('attacker', 'machine-1')).toEqual([]);
    expect(await store.listMachineCredentials('owner-1', 'machine-1')).toMatchObject([{ id: credential.id }]);
  });

  it('stores a nonce hash in the runtime-session projection and scopes session lifecycle by owner', async () => {
    const store = new MemoryProductionStore();
    await store.createOwnedMachine(machine('machine-1', 'owner-1'));
    const session: PersistentRuntimeSession = {
      sessionId: 'session-1',
      ownerUserId: 'owner-1',
      machineId: 'machine-1',
      chain: 'solana',
      walletAddress: '11111111111111111111111111111111',
      operatorId: 'operator-1',
      policyProfileId: 'field-policy',
      mode: 'live-read',
      nonceHash: 'sha256:opaque-session-nonce',
      metadata: { role: 'edge_node' },
      createdAt: NOW,
      updatedAt: NOW,
      endedAt: null,
    };

    expect(await store.createRuntimeSession({ ...session, ownerUserId: 'attacker' })).toBe(false);
    expect(await store.createRuntimeSession(session)).toBe(true);
    expect(await store.createRuntimeSession(session)).toBe(false);
    expect(await store.listRuntimeSessions('attacker', null)).toEqual([]);
    expect(await store.listRuntimeSessions('owner-1', 'machine-1')).toEqual([session]);
    expect(await store.endRuntimeSession('attacker', session.sessionId, LATER)).toBeNull();
    expect(await store.endRuntimeSession('owner-1', session.sessionId, LATER)).toMatchObject({ endedAt: LATER });
    expect(await store.endRuntimeSession('owner-1', session.sessionId, LATER)).toBeNull();
  });

  it('persists runtime-8 work-order state only against an owned machine', async () => {
    const store = new MemoryProductionStore();
    await store.createOwnedMachine(machine('machine-1', 'owner-1'));
    const workOrder: PersistentWorkOrder = {
      workOrderId: 'work-order-1',
      ownerUserId: 'owner-1',
      machineId: 'machine-1',
      stage: 'queued',
      requiredCapabilities: ['mapping'],
      telemetryRequired: true,
      proofRequired: true,
      expectedOutputs: ['map'],
      settlementChain: 'solana',
      settlementAmount: '0.01',
      settlementAsset: 'SOL',
      settlementRecipient: '11111111111111111111111111111111',
      telemetryRef: null,
      proofId: null,
      settlementIntentId: null,
      resultRef: null,
      createdAt: NOW,
      updatedAt: NOW,
    };

    expect(await store.createWorkOrder({ ...workOrder, ownerUserId: 'attacker' })).toBe(false);
    expect(await store.createWorkOrder(workOrder)).toBe(true);
    expect(await store.createWorkOrder(workOrder)).toBe(false);
    expect(await store.listWorkOrders('attacker', null)).toEqual([]);
    expect(await store.listWorkOrders('owner-1', 'machine-1')).toEqual([workOrder]);
    expect(await store.workOrder('attacker', workOrder.workOrderId)).toBeNull();
    expect(await store.workOrder('owner-1', workOrder.workOrderId)).toEqual(workOrder);
  });

  it('returns one newest telemetry event per owned machine without noisy-machine starvation', async () => {
    const store = new MemoryProductionStore();
    await store.createOwnedMachine(machine('machine-1', 'owner-1'));
    await store.createOwnedMachine(machine('machine-2', 'owner-1'));
    await store.createOwnedMachine(machine('machine-private', 'owner-2'));
    const insert = async (id: string, machineId: string, receivedAt: string) => store.insertTelemetry({
      id,
      machineId,
      receivedAt,
      snapshot: { machineId, observedAt: receivedAt, health: 'nominal' },
    }, '2026-08-01T00:00:00.000Z', 100);
    await insert('m1-old', 'machine-1', NOW);
    await insert('m1-new', 'machine-1', LATER);
    await insert('m2', 'machine-2', '2026-08-24T00:00:30.000Z');
    await insert('private', 'machine-private', '2026-08-24T00:02:00.000Z');

    expect(await store.latestTelemetry('owner-1')).toMatchObject([
      { id: 'm1-new', machineId: 'machine-1' },
      { id: 'm2', machineId: 'machine-2' },
    ]);
    expect(await store.latestTelemetry('owner-1', 1)).toHaveLength(1);
  });
});
