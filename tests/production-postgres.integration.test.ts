import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresProductionStore } from '../src/server/production/postgres-store.js';
import type { AuthSessionRecord, OwnedMachineRecord, PersistentResourceRequest } from '../src/server/production/types.js';

const databaseUrl = process.env.MACHINEFI_TEST_DATABASE_URL?.trim() ?? '';
const postgresDescribe = databaseUrl ? describe : describe.skip;
const schemaName = (prefix: string): string => `${prefix}_${randomUUID().replaceAll('-', '')}`;
const quotedIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`;

const directIntegrationUrl = (value: string): string => {
  const parsed = new URL(value);
  // Neon transaction-pooler sessions do not preserve a session search_path.
  // Integration schemas therefore use the corresponding direct endpoint.
  parsed.hostname = parsed.hostname.replace(/-pooler(?=\.)/u, '');
  return parsed.toString();
};

const isolatedPool = (connectionString: string, schema: string, max: number): Pool => new Pool({
  connectionString,
  max,
  options: `-c search_path=${schema},public`,
});

postgresDescribe('PostgreSQL production schema integration', () => {
  const applicationSchema = schemaName('mc_application_test');
  const migrationSchema = schemaName('mc_migration_test');
  let admin: Pool;
  let applicationPool: Pool;
  let migrationPool: Pool;
  let store: PostgresProductionStore;

  beforeAll(async () => {
    const connectionString = directIntegrationUrl(databaseUrl);
    admin = new Pool({ connectionString, max: 1 });
    await admin.query(`CREATE SCHEMA ${quotedIdentifier(applicationSchema)}`);
    await admin.query(`CREATE SCHEMA ${quotedIdentifier(migrationSchema)}`);
    applicationPool = isolatedPool(connectionString, applicationSchema, 4);
    migrationPool = isolatedPool(connectionString, migrationSchema, 1);
    store = new PostgresProductionStore(connectionString, applicationPool);
  }, 30_000);

  afterAll(async () => {
    await applicationPool?.end();
    await migrationPool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${quotedIdentifier(applicationSchema)} CASCADE`);
      await admin.query(`DROP SCHEMA IF EXISTS ${quotedIdentifier(migrationSchema)} CASCADE`);
      await admin.end();
    }
  }, 30_000);

  it('applies both executable and checked-in schemas idempotently with critical indexes', async () => {
    await store.migrate();
    await store.migrate();

    const migrationSql = await readFile(
      new URL('../migrations/001_machine_console_production.sql', import.meta.url),
      'utf8'
    );
    const validationSql = await readFile(
      new URL('../migrations/002_validate_production_constraints.sql', import.meta.url),
      'utf8'
    );
    await migrationPool.query(migrationSql);
    await migrationPool.query(validationSql);
    await migrationPool.query(migrationSql);
    await migrationPool.query(validationSql);

    for (const pool of [applicationPool, migrationPool]) {
      const result = await pool.query<{ name: string | null }>(
        `SELECT to_regclass('mc_access_grants_one_live_request')::text AS name
         UNION ALL SELECT to_regclass('mc_resource_receipts_one_live_request')::text
         UNION ALL SELECT to_regclass('mc_settlements_transaction_signature_unique')::text
         UNION ALL SELECT to_regclass('mc_telemetry_retention')::text`
      );
      expect(result.rows.map((row) => row.name)).toEqual([
        'mc_access_grants_one_live_request',
        'mc_resource_receipts_one_live_request',
        'mc_settlements_transaction_signature_unique',
        'mc_telemetry_retention',
      ]);
      const unvalidated = await pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM pg_constraint
         WHERE connamespace=current_schema()::regnamespace
           AND conrelid::regclass::text LIKE 'mc_%'
           AND NOT convalidated`
      );
      expect(unvalidated.rows[0]?.count).toBe(0);
    }
  }, 30_000);

  it('atomically consumes a single-use wallet challenge under concurrent requests', async () => {
    const now = '2026-08-24T00:00:00.000Z';
    const challenge = {
      id: randomUUID(),
      walletAddress: 'integration-wallet',
      message: 'integration challenge',
      nonceHash: 'sha256:integration',
      expiresAt: '2026-08-24T00:05:00.000Z',
      consumedAt: null,
    };
    await store.createChallenge(challenge, now);
    const overlapping = { ...challenge, id: randomUUID(), message: 'overlapping integration challenge' };
    await store.createChallenge(overlapping, now);
    expect(await store.activeChallenge(challenge.id, challenge.walletAddress, '2026-08-24T00:01:00.000Z'))
      .toMatchObject({ id: challenge.id, consumedAt: null });
    expect(await store.activeChallenge(overlapping.id, overlapping.walletAddress, '2026-08-24T00:01:00.000Z'))
      .toMatchObject({ id: overlapping.id, consumedAt: null });
    const consumed = await Promise.all([
      store.consumeChallenge(challenge.id, challenge.walletAddress, '2026-08-24T00:01:00.000Z'),
      store.consumeChallenge(challenge.id, challenge.walletAddress, '2026-08-24T00:01:00.000Z'),
    ]);
    expect(consumed.filter((record) => record !== null)).toHaveLength(1);
    expect(await store.activeChallenge(overlapping.id, overlapping.walletAddress, '2026-08-24T00:01:00.000Z'))
      .toMatchObject({ id: overlapping.id, consumedAt: null });
  }, 30_000);

  it('serializes concurrent first login for one wallet onto one user', async () => {
    const now = '2026-08-24T00:02:00.000Z';
    const walletAddress = `integration-wallet-${randomUUID()}`;
    const session = (suffix: string): AuthSessionRecord => ({
      id: randomUUID(),
      userId: randomUUID(),
      walletAddress,
      tokenHash: `token:${suffix}:${randomUUID()}`,
      csrfHash: `csrf:${suffix}:${randomUUID()}`,
      expiresAt: '2026-08-24T12:02:00.000Z',
      revokedAt: null,
    });
    const sessions = await Promise.all(['a', 'b'].map((suffix) => {
      const record = session(suffix);
      return store.createAuthenticatedSession({ session: record, walletAddress, now });
    }));
    expect(new Set(sessions.map((record) => record.userId)).size).toBe(1);
    const rows = await applicationPool.query<{ users: string; wallets: string; sessions: string }>(
      `SELECT
         (SELECT count(*)::text FROM mc_users WHERE id=ANY($1::text[])) AS users,
         (SELECT count(*)::text FROM mc_wallets WHERE address=$2) AS wallets,
         (SELECT count(*)::text FROM mc_auth_sessions WHERE wallet_address=$2) AS sessions`,
      [sessions.map((record) => record.userId), walletAddress]
    );
    expect(rows.rows[0]).toEqual({ users: '1', wallets: '1', sessions: '2' });
  }, 30_000);

  it('binds each session user to the wallet that passed verification', async () => {
    const now = '2026-08-24T00:02:30.000Z';
    const walletA = `integration-wallet-a-${randomUUID()}`;
    const walletB = `integration-wallet-b-${randomUUID()}`;
    const proposed = (walletAddress: string): AuthSessionRecord => ({
      id: randomUUID(),
      userId: randomUUID(),
      walletAddress,
      tokenHash: `token:${randomUUID()}`,
      csrfHash: `csrf:${randomUUID()}`,
      expiresAt: '2026-08-24T12:02:30.000Z',
      revokedAt: null,
    });
    const sessionA = await store.createAuthenticatedSession({ session: proposed(walletA), walletAddress: walletA, now });
    const sessionB = await store.createAuthenticatedSession({
      session: proposed(walletA),
      walletAddress: walletB,
      now,
    });

    expect(sessionB.walletAddress).toBe(walletB);
    const persisted = await applicationPool.query<{ user_id: string; wallet_address: string; wallet_user_id: string }>(
      `SELECT s.user_id, s.wallet_address, w.user_id AS wallet_user_id
       FROM mc_auth_sessions s JOIN mc_wallets w ON w.address=s.wallet_address
       WHERE s.id=$1`,
      [sessionB.id]
    );
    expect(persisted.rows[0]).toEqual({
      user_id: sessionB.userId,
      wallet_address: walletB,
      wallet_user_id: sessionB.userId,
    });

    await expect(applicationPool.query(
      `INSERT INTO mc_auth_sessions(id,user_id,wallet_address,token_hash,csrf_hash,created_at,expires_at,revoked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NULL)`,
      [randomUUID(), sessionB.userId, sessionA.walletAddress, `token:${randomUUID()}`, `csrf:${randomUUID()}`, now, '2026-08-24T12:02:30.000Z']
    )).rejects.toMatchObject({ code: '23503' });
  }, 30_000);

  it('atomically scopes machine credential creation to the machine owner', async () => {
    const now = '2026-08-24T00:02:45.000Z';
    const createIdentity = async (prefix: string) => {
      const walletAddress = `${prefix}-wallet-${randomUUID()}`;
      return store.createAuthenticatedSession({
        walletAddress,
        now,
        session: {
          id: randomUUID(), userId: randomUUID(), walletAddress,
          tokenHash: `token:${randomUUID()}`, csrfHash: `csrf:${randomUUID()}`,
          expiresAt: '2026-08-24T12:02:45.000Z', revokedAt: null,
        },
      });
    };
    const owner = await createIdentity('credential-owner');
    const attacker = await createIdentity('credential-attacker');
    const ownedMachine: OwnedMachineRecord = {
      machineId: `credential-machine-${randomUUID()}`,
      ownerUserId: owner.userId,
      walletAddress: owner.walletAddress,
      label: 'Credential integration machine',
      role: 'sensor',
      createdAt: now,
      updatedAt: now,
    };
    await store.createOwnedMachine(ownedMachine);
    const credential = {
      id: randomUUID(), machineId: ownedMachine.machineId,
      secretHash: `secret:${randomUUID()}`, label: 'integration ingestion',
      createdAt: now, expiresAt: null, revokedAt: null,
    };

    expect(await store.createMachineCredential(attacker.userId, credential)).toBe(false);
    expect(await store.createMachineCredential(owner.userId, credential)).toBe(true);
    expect(await store.createMachineCredential(owner.userId, credential)).toBe(false);
    expect(await store.listMachineCredentials(attacker.userId, ownedMachine.machineId)).toEqual([]);
    expect(await store.listMachineCredentials(owner.userId, ownedMachine.machineId))
      .toMatchObject([{ id: credential.id, machineId: ownedMachine.machineId }]);
  }, 30_000);

  it('preserves provider authorization for an outstanding quote after capability changes', async () => {
    const now = '2026-08-24T00:03:00.000Z';
    const requesterWallet = `requester-wallet-${randomUUID()}`;
    const requesterSession = await store.createAuthenticatedSession({
      walletAddress: requesterWallet,
      now,
      session: {
        id: randomUUID(), userId: randomUUID(), walletAddress: requesterWallet,
        tokenHash: `token:${randomUUID()}`, csrfHash: `csrf:${randomUUID()}`,
        expiresAt: '2026-08-24T12:03:00.000Z', revokedAt: null,
      },
    });
    const providerWallet = `provider-wallet-${randomUUID()}`;
    const providerSession = await store.createAuthenticatedSession({
      walletAddress: providerWallet,
      now,
      session: {
        id: randomUUID(), userId: randomUUID(), walletAddress: providerWallet,
        tokenHash: `token:${randomUUID()}`, csrfHash: `csrf:${randomUUID()}`,
        expiresAt: '2026-08-24T12:03:00.000Z', revokedAt: null,
      },
    });
    const requesterMachine: OwnedMachineRecord = {
      machineId: `requester-${randomUUID()}`, ownerUserId: requesterSession.userId,
      walletAddress: requesterSession.walletAddress, label: 'Integration requester', role: 'edge_node',
      createdAt: now, updatedAt: now,
    };
    const providerMachine: OwnedMachineRecord = {
      machineId: `provider-${randomUUID()}`, ownerUserId: providerSession.userId,
      walletAddress: providerSession.walletAddress, label: 'Integration provider', role: 'edge_node',
      createdAt: now, updatedAt: now,
    };
    await store.createOwnedMachine(requesterMachine);
    await store.createOwnedMachine(providerMachine);
    const capability = await store.createProviderCapability(providerSession.userId, {
      providerMachineId: providerMachine.machineId,
      resourceType: 'compute-burst', label: `Integration GPU ${randomUUID()}`, unit: 'second',
      railTags: ['solana'], availability: 'available', priceAmount: null, priceAsset: null,
    }, now);
    expect(capability).not.toBeNull();
    const request: PersistentResourceRequest = {
      id: randomUUID(), ownerUserId: requesterSession.userId,
      requesterMachineId: requesterMachine.machineId, capabilityId: null, providerMachineId: null,
      resourceType: 'compute-burst', quantity: '1', maxPrice: '0.000002', preferredRails: ['solana'],
      purpose: 'PostgreSQL authorization regression', quoteAmount: null, quoteAsset: null,
      state: 'pending', createdAt: now, updatedAt: now,
    };
    await store.createResourceRequest(request);
    const quote = await store.createResourceQuote(providerSession.userId, {
      resourceRequestId: request.id, capabilityId: capability!.id,
      amount: '0.000001', asset: 'SOL', expiresAt: null,
    }, now);
    expect(quote).not.toBeNull();
    await store.updateProviderCapability(providerSession.userId, capability!.id, {
      label: capability!.label, unit: capability!.unit, railTags: capability!.railTags,
      availability: 'unavailable', priceAmount: capability!.priceAmount,
      priceAsset: capability!.priceAsset, updatedAt: '2026-08-24T00:04:00.000Z',
    });
    expect(await store.providerResourceRequest(providerSession.userId, request.id))
      .toMatchObject({ id: request.id, state: 'quoted' });
  }, 30_000);
});
