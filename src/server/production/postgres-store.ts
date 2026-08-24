import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { PRODUCTION_SCHEMA_SQL } from './schema.js';
import { DEFAULT_PRODUCTION_LIST_LIMIT, MAX_PRODUCTION_LIST_LIMIT } from './types.js';
import type {
  AccessGrantState,
  AuthSessionRecord,
  CreateResourceQuoteInput,
  MachineCredentialRecord,
  OwnedMachineRecord,
  PersistentAccessGrant,
  PersistentMachineCapability,
  PersistentResourceRequest,
  PersistentResourceQuote,
  PersistentResourceReceipt,
  PersistentRuntimeSession,
  PersistentWorkOrder,
  ProductionStore,
  ProviderCapabilityPatch,
  ProviderCapabilityRow,
  ResourceReceiptState,
  ResourceRequestLifecycle,
  ResourceRequestState,
  ReceiptSettlementProjection,
  SettlementRecord,
  SettlementState,
  TelemetryEventRecord,
  WalletChallengeRecord,
} from './types.js';

const iso = (value: unknown): string => {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
};

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const boundedLimit = (limit = DEFAULT_PRODUCTION_LIST_LIMIT): number =>
  Number.isFinite(limit)
    ? Math.min(MAX_PRODUCTION_LIST_LIMIT, Math.max(1, Math.trunc(limit)))
    : DEFAULT_PRODUCTION_LIST_LIMIT;

const challengeRow = (row: QueryResultRow): WalletChallengeRecord => ({
  id: String(row['id']),
  walletAddress: String(row['wallet_address']),
  message: String(row['message']),
  nonceHash: String(row['nonce_hash']),
  expiresAt: iso(row['expires_at']),
  consumedAt: row['consumed_at'] === null ? null : iso(row['consumed_at']),
});

const sessionRow = (row: QueryResultRow): AuthSessionRecord => ({
  id: String(row['id']),
  userId: String(row['user_id']),
  walletAddress: String(row['wallet_address']),
  tokenHash: String(row['token_hash']),
  csrfHash: String(row['csrf_hash']),
  expiresAt: iso(row['expires_at']),
  revokedAt: row['revoked_at'] === null ? null : iso(row['revoked_at']),
});

const machineRow = (row: QueryResultRow): OwnedMachineRecord => ({
  machineId: String(row['machine_id']),
  ownerUserId: String(row['owner_user_id']),
  label: String(row['label']),
  role: String(row['role']),
  walletAddress: String(row['wallet_address']),
  createdAt: iso(row['created_at']),
  updatedAt: iso(row['updated_at']),
});

const credentialRow = (row: QueryResultRow): MachineCredentialRecord => ({
  id: String(row['id']),
  machineId: String(row['machine_id']),
  secretHash: String(row['secret_hash']),
  label: String(row['label']),
  createdAt: iso(row['created_at']),
  expiresAt: row['expires_at'] === null ? null : iso(row['expires_at']),
  revokedAt: row['revoked_at'] === null ? null : iso(row['revoked_at']),
});

const telemetryRow = (row: QueryResultRow): TelemetryEventRecord => ({
  id: String(row['id']),
  machineId: String(row['machine_id']),
  receivedAt: iso(row['received_at']),
  snapshot: row['snapshot'] as TelemetryEventRecord['snapshot'],
});

const machineCapabilityRow = (row: QueryResultRow): PersistentMachineCapability => ({
  machineId: String(row['machine_id']),
  ownerUserId: String(row['owner_user_id']),
  capability: String(row['capability']) as PersistentMachineCapability['capability'],
  createdAt: iso(row['created_at']),
});

const runtimeSessionRow = (row: QueryResultRow): PersistentRuntimeSession => ({
  sessionId: String(row['session_id']),
  ownerUserId: String(row['owner_user_id']),
  machineId: String(row['machine_id']),
  chain: row['chain'] as PersistentRuntimeSession['chain'],
  walletAddress: String(row['wallet_address']),
  operatorId: String(row['operator_id']),
  policyProfileId: String(row['policy_profile_id']),
  mode: row['mode'] as PersistentRuntimeSession['mode'],
  nonceHash: String(row['nonce_hash']),
  metadata: (row['metadata'] ?? {}) as Readonly<Record<string, unknown>>,
  createdAt: iso(row['created_at']),
  updatedAt: iso(row['updated_at']),
  endedAt: row['ended_at'] === null ? null : iso(row['ended_at']),
});

const workOrderRow = (row: QueryResultRow): PersistentWorkOrder => ({
  workOrderId: String(row['work_order_id']),
  ownerUserId: String(row['owner_user_id']),
  machineId: row['machine_id'] === null ? null : String(row['machine_id']),
  stage: row['stage'] as PersistentWorkOrder['stage'],
  requiredCapabilities: strings(row['required_capabilities']) as PersistentWorkOrder['requiredCapabilities'],
  telemetryRequired: Boolean(row['telemetry_required']),
  proofRequired: Boolean(row['proof_required']),
  expectedOutputs: strings(row['expected_outputs']),
  settlementChain: row['settlement_chain'] as PersistentWorkOrder['settlementChain'],
  settlementAmount: String(row['settlement_amount']),
  settlementAsset: String(row['settlement_asset']),
  settlementRecipient: String(row['settlement_recipient']),
  telemetryRef: row['telemetry_ref'] === null ? null : String(row['telemetry_ref']),
  proofId: row['proof_id'] === null ? null : String(row['proof_id']),
  settlementIntentId: row['settlement_intent_id'] === null ? null : String(row['settlement_intent_id']),
  resultRef: row['result_ref'] === null ? null : String(row['result_ref']),
  createdAt: iso(row['created_at']),
  updatedAt: iso(row['updated_at']),
});

const capabilityRow = (row: QueryResultRow): ProviderCapabilityRow => ({
  id: String(row['id']),
  providerMachineId: String(row['provider_machine_id']),
  ownerUserId: String(row['owner_user_id']),
  resourceType: row['resource_type'] as ProviderCapabilityRow['resourceType'],
  label: String(row['label']),
  unit: String(row['unit']),
  railTags: strings(row['rail_tags']),
  availability: row['availability'] as ProviderCapabilityRow['availability'],
  priceAmount: row['price_amount'] === null ? null : String(row['price_amount']),
  priceAsset: row['price_asset'] === null ? null : String(row['price_asset']),
  createdAt: iso(row['created_at']),
  updatedAt: iso(row['updated_at']),
});

const resourceRequestRow = (row: QueryResultRow): PersistentResourceRequest => ({
  id: String(row['id']),
  ownerUserId: String(row['owner_user_id']),
  requesterMachineId: String(row['requester_machine_id']),
  capabilityId: row['capability_id'] === null ? null : String(row['capability_id']),
  providerMachineId: row['provider_machine_id'] === null ? null : String(row['provider_machine_id']),
  resourceType: row['resource_type'] as PersistentResourceRequest['resourceType'],
  quantity: String(row['quantity']),
  maxPrice: String(row['max_price']),
  preferredRails: strings(row['preferred_rails']),
  purpose: String(row['purpose']),
  quoteAmount: row['quote_amount'] === null ? null : String(row['quote_amount']),
  quoteAsset: row['quote_asset'] === null ? null : String(row['quote_asset']),
  state: row['state'] as ResourceRequestState,
  createdAt: iso(row['created_at']),
  updatedAt: iso(row['updated_at']),
});

const resourceQuoteRow = (row: QueryResultRow): PersistentResourceQuote => ({
  id: String(row['id']),
  resourceRequestId: String(row['resource_request_id']),
  providerOwnerUserId: String(row['provider_owner_user_id']),
  providerMachineId: String(row['provider_machine_id']),
  capabilityId: String(row['capability_id']),
  amount: String(row['amount']),
  asset: String(row['asset']),
  state: row['state'] as PersistentResourceQuote['state'],
  expiresAt: row['expires_at'] === null ? null : iso(row['expires_at']),
  createdAt: iso(row['created_at']),
  updatedAt: iso(row['updated_at']),
});

const accessGrantRow = (row: QueryResultRow): PersistentAccessGrant => ({
  id: String(row['id']),
  resourceRequestId: String(row['resource_request_id']),
  resourceQuoteId: String(row['resource_quote_id']),
  providerOwnerUserId: String(row['provider_owner_user_id']),
  providerMachineId: String(row['provider_machine_id']),
  requesterOwnerUserId: String(row['requester_owner_user_id']),
  requesterMachineId: String(row['requester_machine_id']),
  state: row['state'] as AccessGrantState,
  accessReference: row['access_reference'] === null ? null : String(row['access_reference']),
  expiresAt: row['expires_at'] === null ? null : iso(row['expires_at']),
  createdAt: iso(row['created_at']),
  updatedAt: iso(row['updated_at']),
});

const resourceReceiptRow = (row: QueryResultRow): PersistentResourceReceipt => ({
  id: String(row['id']),
  resourceRequestId: String(row['resource_request_id']),
  accessGrantId: String(row['access_grant_id']),
  settlementId: row['settlement_id'] === null ? null : String(row['settlement_id']),
  providerOwnerUserId: String(row['provider_owner_user_id']),
  requesterOwnerUserId: String(row['requester_owner_user_id']),
  state: row['state'] as ResourceReceiptState,
  evidenceReference: row['evidence_reference'] === null ? null : String(row['evidence_reference']),
  resultReference: row['result_reference'] === null ? null : String(row['result_reference']),
  createdAt: iso(row['created_at']),
  updatedAt: iso(row['updated_at']),
});

const settlementRow = (row: QueryResultRow): SettlementRecord => ({
  id: String(row['id']),
  resourceRequestId: String(row['resource_request_id']),
  resourceQuoteId: String(row['resource_quote_id']),
  ownerUserId: String(row['owner_user_id']),
  machineId: String(row['machine_id']),
  sourceWallet: String(row['source_wallet']),
  recipientWallet: String(row['recipient_wallet']),
  amountLamports: String(row['amount_lamports']),
  state: row['state'] as SettlementState,
  unsignedTransaction: row['unsigned_transaction'] === null ? null : String(row['unsigned_transaction']),
  transactionSignature: row['transaction_signature'] === null ? null : String(row['transaction_signature']),
  lastValidBlockHeight: row['last_valid_block_height'] === null ? null : String(row['last_valid_block_height']),
  errorCode: row['error_code'] === null ? null : String(row['error_code']),
  createdAt: iso(row['created_at']),
  updatedAt: iso(row['updated_at']),
});

async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export class PostgresProductionStore implements ProductionStore {
  readonly pool: Pool;

  constructor(databaseUrl: string, pool?: Pool) {
    this.pool = pool ?? new Pool({ connectionString: databaseUrl, max: 10, idleTimeoutMillis: 30_000 });
    // node-postgres emits idle-client failures on the Pool itself. Without a
    // listener Node treats the event as unhandled and terminates the process.
    // The pool has already discarded that client, so log safe metadata and let
    // subsequent requests acquire a healthy replacement connection.
    this.pool.on('error', (error: Error & { code?: string }) => {
      console.error(JSON.stringify({
        level: 'error',
        event: 'postgres_idle_client_error',
        errorName: error.name,
        ...(error.code === undefined ? {} : { errorCode: error.code }),
      }));
    });
  }

  async migrate(): Promise<void> {
    await this.pool.query(PRODUCTION_SCHEMA_SQL);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async createChallenge(record: WalletChallengeRecord, now = new Date().toISOString()): Promise<void> {
    await transaction(this.pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [record.walletAddress]);
      // Keep opportunistic cleanup bounded so challenge issuance cannot become
      // a table-wide maintenance operation under load.
      await client.query(
        `DELETE FROM mc_auth_challenges WHERE id IN (
           SELECT id FROM mc_auth_challenges WHERE expires_at<=$1 ORDER BY expires_at ASC LIMIT 250
         )`,
        [now]
      );
      await client.query(
        `DELETE FROM mc_auth_challenges WHERE id IN (
           SELECT id FROM mc_auth_challenges WHERE consumed_at IS NOT NULL
           ORDER BY consumed_at ASC LIMIT 250
         )`,
        []
      );
      await client.query(
        `INSERT INTO mc_auth_challenges(id,wallet_address,message,nonce_hash,expires_at,consumed_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [record.id, record.walletAddress, record.message, record.nonceHash, record.expiresAt, record.consumedAt]
      );
    });
  }

  async activeChallenge(id: string, walletAddress: string, now: string): Promise<WalletChallengeRecord | null> {
    const result = await this.pool.query(
      `SELECT * FROM mc_auth_challenges
       WHERE id=$1 AND wallet_address=$2 AND consumed_at IS NULL AND expires_at>$3`,
      [id, walletAddress, now]
    );
    return result.rows[0] ? challengeRow(result.rows[0]) : null;
  }

  async consumeChallenge(id: string, walletAddress: string, now: string): Promise<WalletChallengeRecord | null> {
    const result = await this.pool.query(
      `UPDATE mc_auth_challenges SET consumed_at=$3
       WHERE id=$1 AND wallet_address=$2 AND consumed_at IS NULL AND expires_at>$3
       RETURNING *`,
      [id, walletAddress, now]
    );
    return result.rows[0] ? challengeRow(result.rows[0]) : null;
  }

  async createAuthenticatedSession(input: {
    session: AuthSessionRecord;
    walletAddress: string;
    now: string;
  }): Promise<AuthSessionRecord> {
    return transaction(this.pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [input.walletAddress]);
      await client.query(
        `DELETE FROM mc_auth_sessions WHERE id IN (
           SELECT id FROM mc_auth_sessions
           WHERE expires_at<=$1 OR (revoked_at IS NOT NULL AND revoked_at<=$1::timestamptz-interval '1 day')
           ORDER BY expires_at ASC LIMIT 250
         )`,
        [input.now]
      );
      const existing = await client.query('SELECT user_id FROM mc_wallets WHERE address=$1 FOR UPDATE', [input.walletAddress]);
      const userId = existing.rows[0] ? String(existing.rows[0]['user_id']) : input.session.userId;
      if (!existing.rows[0]) {
        await client.query('INSERT INTO mc_users(id,created_at,updated_at) VALUES ($1,$2,$2)', [userId, input.now]);
        await client.query('INSERT INTO mc_wallets(address,user_id,verified_at) VALUES ($1,$2,$3)', [input.walletAddress, userId, input.now]);
      } else {
        await client.query('UPDATE mc_wallets SET verified_at=$2 WHERE address=$1', [input.walletAddress, input.now]);
      }
      // `input.walletAddress` is the identity that passed wallet verification.
      // Normalize the persisted row to that value so an internal caller cannot
      // associate the resolved user with a different verified wallet.
      const session = { ...input.session, userId, walletAddress: input.walletAddress };
      const result = await client.query(
        `INSERT INTO mc_auth_sessions(id,user_id,wallet_address,token_hash,csrf_hash,created_at,expires_at,revoked_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [session.id, userId, session.walletAddress, session.tokenHash, session.csrfHash, input.now, session.expiresAt, session.revokedAt]
      );
      return sessionRow(result.rows[0]!);
    });
  }

  async sessionByTokenHash(tokenHash: string, now: string): Promise<AuthSessionRecord | null> {
    const result = await this.pool.query(
      `SELECT s.* FROM mc_auth_sessions s
       JOIN mc_wallets w ON w.user_id=s.user_id AND w.address=s.wallet_address
       WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>$2`,
      [tokenHash, now]
    );
    return result.rows[0] ? sessionRow(result.rows[0]) : null;
  }

  async revokeSession(id: string, now: string): Promise<void> {
    await this.pool.query('UPDATE mc_auth_sessions SET revoked_at=$2 WHERE id=$1 AND revoked_at IS NULL', [id, now]);
  }

  async listOwnedMachines(userId: string, limit?: number): Promise<readonly OwnedMachineRecord[]> {
    const result = await this.pool.query(
      'SELECT * FROM mc_machines WHERE owner_user_id=$1 ORDER BY created_at DESC LIMIT $2',
      [userId, boundedLimit(limit)]
    );
    return result.rows.map(machineRow);
  }

  async ownedMachine(userId: string, machineId: string): Promise<OwnedMachineRecord | null> {
    const result = await this.pool.query('SELECT * FROM mc_machines WHERE owner_user_id=$1 AND machine_id=$2', [userId, machineId]);
    return result.rows[0] ? machineRow(result.rows[0]) : null;
  }

  async machine(machineId: string): Promise<OwnedMachineRecord | null> {
    const result = await this.pool.query('SELECT * FROM mc_machines WHERE machine_id=$1', [machineId]);
    return result.rows[0] ? machineRow(result.rows[0]) : null;
  }

  async createOwnedMachine(machine: OwnedMachineRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO mc_machines(machine_id,owner_user_id,label,role,wallet_address,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [machine.machineId, machine.ownerUserId, machine.label, machine.role, machine.walletAddress, machine.createdAt, machine.updatedAt]
    );
  }

  async createMachineCredential(userId: string, record: MachineCredentialRecord): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO mc_machine_credentials(id,machine_id,secret_hash,label,created_at,expires_at,revoked_at)
       SELECT $1,m.machine_id,$3,$4,$5,$6,$7 FROM mc_machines m
       WHERE m.machine_id=$2 AND m.owner_user_id=$8
       ON CONFLICT DO NOTHING RETURNING id`,
      [record.id, record.machineId, record.secretHash, record.label, record.createdAt, record.expiresAt, record.revokedAt, userId]
    );
    return result.rowCount === 1;
  }

  async listMachineCredentials(userId: string, machineId: string, limit?: number): Promise<readonly MachineCredentialRecord[]> {
    const result = await this.pool.query(
      `SELECT c.* FROM mc_machine_credentials c JOIN mc_machines m ON m.machine_id=c.machine_id
       WHERE m.owner_user_id=$1 AND c.machine_id=$2 ORDER BY c.created_at DESC LIMIT $3`,
      [userId, machineId, boundedLimit(limit)]
    );
    return result.rows.map(credentialRow);
  }

  async machineCredential(id: string, secretHash: string, now: string): Promise<MachineCredentialRecord | null> {
    const result = await this.pool.query(
      `SELECT * FROM mc_machine_credentials
       WHERE id=$1 AND secret_hash=$2 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>$3)`,
      [id, secretHash, now]
    );
    return result.rows[0] ? credentialRow(result.rows[0]) : null;
  }

  async revokeMachineCredential(userId: string, credentialId: string, now: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE mc_machine_credentials c SET revoked_at=$3 FROM mc_machines m
       WHERE c.id=$2 AND c.machine_id=m.machine_id AND m.owner_user_id=$1 AND c.revoked_at IS NULL
       RETURNING c.id`,
      [userId, credentialId, now]
    );
    return result.rowCount === 1;
  }

  async insertTelemetry(event: TelemetryEventRecord, retentionBefore: string, maxPerMachine: number): Promise<void> {
    await transaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO mc_telemetry_events(id,machine_id,observed_at,received_at,snapshot)
         VALUES ($1,$2,$3,$4,$5::jsonb)`,
        [event.id, event.machineId, event.snapshot.observedAt, event.receivedAt, JSON.stringify(event.snapshot)]
      );
      await client.query(
        `DELETE FROM mc_telemetry_events WHERE id IN (
           SELECT id FROM mc_telemetry_events WHERE received_at<$1 ORDER BY received_at ASC LIMIT 1000
         )`,
        [retentionBefore]
      );
      await client.query(
        `DELETE FROM mc_telemetry_events WHERE id IN (
          SELECT id FROM mc_telemetry_events WHERE machine_id=$1 ORDER BY received_at DESC OFFSET $2
        )`,
        [event.machineId, maxPerMachine]
      );
    });
  }

  async recentTelemetry(userId: string, machineId: string | null, limit: number): Promise<readonly TelemetryEventRecord[]> {
    const result = await this.pool.query(
      `SELECT t.* FROM mc_telemetry_events t JOIN mc_machines m ON m.machine_id=t.machine_id
       WHERE m.owner_user_id=$1 AND ($2::text IS NULL OR t.machine_id=$2)
       ORDER BY t.received_at DESC LIMIT $3`,
      [userId, machineId, boundedLimit(limit)]
    );
    return result.rows.map(telemetryRow);
  }

  async latestTelemetry(userId: string, limit?: number): Promise<readonly TelemetryEventRecord[]> {
    const result = await this.pool.query(
      `SELECT latest.* FROM (
         SELECT DISTINCT ON (t.machine_id) t.*
         FROM mc_telemetry_events t JOIN mc_machines m ON m.machine_id=t.machine_id
         WHERE m.owner_user_id=$1
         ORDER BY t.machine_id,t.received_at DESC,t.id DESC
       ) latest
       ORDER BY latest.received_at DESC,latest.id DESC LIMIT $2`,
      [userId, boundedLimit(limit)]
    );
    return result.rows.map(telemetryRow);
  }

  async replaceMachineCapabilities(userId: string, machineId: string, capabilities: readonly PersistentMachineCapability['capability'][], now: string): Promise<readonly PersistentMachineCapability[] | null> {
    return transaction(this.pool, async (client) => {
      const owned = await client.query('SELECT 1 FROM mc_machines WHERE owner_user_id=$1 AND machine_id=$2 FOR UPDATE', [userId, machineId]);
      if (!owned.rows[0]) return null;
      await client.query('DELETE FROM mc_machine_capabilities WHERE owner_user_id=$1 AND machine_id=$2', [userId, machineId]);
      const records: PersistentMachineCapability[] = [];
      for (const capability of new Set(capabilities)) {
        const result = await client.query(
          `INSERT INTO mc_machine_capabilities(machine_id,owner_user_id,capability,created_at) VALUES ($1,$2,$3,$4) RETURNING *`,
          [machineId, userId, capability, now]
        );
        records.push(machineCapabilityRow(result.rows[0]!));
      }
      return records;
    });
  }

  async listMachineCapabilities(userId: string, machineId: string): Promise<readonly PersistentMachineCapability[]> {
    const result = await this.pool.query('SELECT * FROM mc_machine_capabilities WHERE owner_user_id=$1 AND machine_id=$2 ORDER BY capability', [userId, machineId]);
    return result.rows.map(machineCapabilityRow);
  }

  async createRuntimeSession(record: PersistentRuntimeSession): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO mc_runtime_sessions(session_id,owner_user_id,machine_id,chain,wallet_address,operator_id,policy_profile_id,mode,nonce_hash,metadata,created_at,updated_at,ended_at)
       SELECT $1,$2,m.machine_id,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13 FROM mc_machines m
       WHERE m.owner_user_id=$2 AND m.machine_id=$3 ON CONFLICT DO NOTHING RETURNING session_id`,
      [record.sessionId, record.ownerUserId, record.machineId, record.chain, record.walletAddress, record.operatorId, record.policyProfileId, record.mode, record.nonceHash, JSON.stringify(record.metadata), record.createdAt, record.updatedAt, record.endedAt]
    );
    return result.rowCount === 1;
  }

  async listRuntimeSessions(userId: string, machineId: string | null, limit?: number): Promise<readonly PersistentRuntimeSession[]> {
    const result = await this.pool.query(
      `SELECT * FROM mc_runtime_sessions WHERE owner_user_id=$1 AND ($2::text IS NULL OR machine_id=$2)
       ORDER BY created_at DESC LIMIT $3`,
      [userId, machineId, boundedLimit(limit)]
    );
    return result.rows.map(runtimeSessionRow);
  }

  async endRuntimeSession(userId: string, sessionId: string, now: string): Promise<PersistentRuntimeSession | null> {
    const result = await this.pool.query(
      `UPDATE mc_runtime_sessions SET ended_at=$3,updated_at=$3 WHERE owner_user_id=$1 AND session_id=$2 AND ended_at IS NULL RETURNING *`,
      [userId, sessionId, now]
    );
    return result.rows[0] ? runtimeSessionRow(result.rows[0]) : null;
  }

  async createWorkOrder(record: PersistentWorkOrder): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO mc_work_orders(work_order_id,owner_user_id,machine_id,stage,required_capabilities,telemetry_required,proof_required,expected_outputs,settlement_chain,settlement_amount,settlement_asset,settlement_recipient,telemetry_ref,proof_id,settlement_intent_id,result_ref,created_at,updated_at)
       SELECT $1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
       WHERE $3::text IS NULL OR EXISTS (SELECT 1 FROM mc_machines WHERE owner_user_id=$2 AND machine_id=$3)
       ON CONFLICT DO NOTHING RETURNING work_order_id`,
      [record.workOrderId, record.ownerUserId, record.machineId, record.stage, JSON.stringify(record.requiredCapabilities), record.telemetryRequired, record.proofRequired, JSON.stringify(record.expectedOutputs), record.settlementChain, record.settlementAmount, record.settlementAsset, record.settlementRecipient, record.telemetryRef, record.proofId, record.settlementIntentId, record.resultRef, record.createdAt, record.updatedAt]
    );
    return result.rowCount === 1;
  }

  async listWorkOrders(userId: string, machineId: string | null, limit?: number): Promise<readonly PersistentWorkOrder[]> {
    const result = await this.pool.query(
      `SELECT * FROM mc_work_orders WHERE owner_user_id=$1 AND ($2::text IS NULL OR machine_id=$2)
       ORDER BY created_at DESC LIMIT $3`,
      [userId, machineId, boundedLimit(limit)]
    );
    return result.rows.map(workOrderRow);
  }

  async workOrder(userId: string, workOrderId: string): Promise<PersistentWorkOrder | null> {
    const result = await this.pool.query(
      'SELECT * FROM mc_work_orders WHERE owner_user_id=$1 AND work_order_id=$2',
      [userId, workOrderId]
    );
    return result.rows[0] ? workOrderRow(result.rows[0]) : null;
  }

  async listProviderCapabilities(userId: string | null, limit?: number): Promise<readonly ProviderCapabilityRow[]> {
    const result = await this.pool.query(
      `SELECT * FROM mc_provider_capabilities
       WHERE availability<>'unavailable' OR ($1::text IS NOT NULL AND owner_user_id=$1)
       ORDER BY resource_type,label LIMIT $2`,
      [userId, boundedLimit(limit)]
    );
    return result.rows.map(capabilityRow);
  }

  async findProviderCapabilities(filters: {
    resourceType: ProviderCapabilityRow['resourceType'];
    preferredRails: readonly string[];
    maxPrice: string | null;
    capabilityId: string | null;
  }, limit?: number): Promise<readonly ProviderCapabilityRow[]> {
    const result = await this.pool.query(
      `SELECT * FROM mc_provider_capabilities
       WHERE availability<>'unavailable' AND resource_type=$1
         AND ($2::text IS NULL OR id=$2)
         AND (cardinality($3::text[])=0 OR rail_tags ?| $3::text[])
         AND ($4::numeric IS NULL OR price_amount IS NULL OR price_amount<=$4::numeric)
       ORDER BY label,id LIMIT $5`,
      [filters.resourceType, filters.capabilityId, [...filters.preferredRails], filters.maxPrice, boundedLimit(limit)]
    );
    return result.rows.map(capabilityRow);
  }

  async providerCapability(userId: string | null, capabilityId: string): Promise<ProviderCapabilityRow | null> {
    const result = await this.pool.query(
      `SELECT * FROM mc_provider_capabilities
       WHERE id=$2 AND (availability<>'unavailable' OR ($1::text IS NOT NULL AND owner_user_id=$1))`,
      [userId, capabilityId]
    );
    return result.rows[0] ? capabilityRow(result.rows[0]) : null;
  }

  async createProviderCapability(userId: string, input: Omit<ProviderCapabilityRow, 'id' | 'ownerUserId' | 'createdAt' | 'updatedAt'>, now: string): Promise<ProviderCapabilityRow | null> {
    const result = await this.pool.query(
      `INSERT INTO mc_provider_capabilities(id,provider_machine_id,owner_user_id,resource_type,label,unit,rail_tags,availability,price_amount,price_asset,created_at,updated_at)
       SELECT $1,m.machine_id,$2,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$11 FROM mc_machines m
       WHERE m.machine_id=$3 AND m.owner_user_id=$2
       ON CONFLICT DO NOTHING RETURNING *`,
      [randomUUID(), userId, input.providerMachineId, input.resourceType, input.label, input.unit, JSON.stringify(input.railTags), input.availability, input.priceAmount, input.priceAsset, now]
    );
    return result.rows[0] ? capabilityRow(result.rows[0]) : null;
  }

  async updateProviderCapability(userId: string, capabilityId: string, patch: ProviderCapabilityPatch): Promise<ProviderCapabilityRow | null> {
    const result = await this.pool.query(
      `UPDATE mc_provider_capabilities target
       SET label=$3,unit=$4,rail_tags=$5::jsonb,availability=$6,price_amount=$7,price_asset=$8,updated_at=$9
       WHERE target.owner_user_id=$1 AND target.id=$2 AND NOT EXISTS (
         SELECT 1 FROM mc_provider_capabilities duplicate
         WHERE duplicate.id<>target.id AND duplicate.provider_machine_id=target.provider_machine_id
           AND duplicate.resource_type=target.resource_type AND duplicate.label=$3
       ) RETURNING target.*`,
      [userId, capabilityId, patch.label, patch.unit, JSON.stringify(patch.railTags), patch.availability, patch.priceAmount, patch.priceAsset, patch.updatedAt]
    );
    return result.rows[0] ? capabilityRow(result.rows[0]) : null;
  }

  async upsertProviderCapability(record: ProviderCapabilityRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO mc_provider_capabilities(id,provider_machine_id,owner_user_id,resource_type,label,unit,rail_tags,availability,price_amount,price_asset,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO UPDATE SET label=EXCLUDED.label,unit=EXCLUDED.unit,rail_tags=EXCLUDED.rail_tags,
       availability=EXCLUDED.availability,price_amount=EXCLUDED.price_amount,price_asset=EXCLUDED.price_asset,updated_at=EXCLUDED.updated_at
       WHERE mc_provider_capabilities.owner_user_id=EXCLUDED.owner_user_id
         AND mc_provider_capabilities.provider_machine_id=EXCLUDED.provider_machine_id`,
      [record.id, record.providerMachineId, record.ownerUserId, record.resourceType, record.label, record.unit, JSON.stringify(record.railTags), record.availability, record.priceAmount, record.priceAsset, record.createdAt, record.updatedAt]
    );
  }

  async createResourceRequest(record: PersistentResourceRequest): Promise<void> {
    await this.pool.query(
      `INSERT INTO mc_resource_requests(id,owner_user_id,requester_machine_id,capability_id,provider_machine_id,resource_type,quantity,max_price,preferred_rails,purpose,quote_amount,quote_asset,state,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15)`,
      [record.id, record.ownerUserId, record.requesterMachineId, record.capabilityId, record.providerMachineId, record.resourceType, record.quantity, record.maxPrice, JSON.stringify(record.preferredRails), record.purpose, record.quoteAmount, record.quoteAsset, record.state, record.createdAt, record.updatedAt]
    );
  }

  async listResourceRequests(userId: string, limit?: number): Promise<readonly PersistentResourceRequest[]> {
    const result = await this.pool.query(
      'SELECT * FROM mc_resource_requests WHERE owner_user_id=$1 ORDER BY created_at DESC LIMIT $2',
      [userId, boundedLimit(limit)]
    );
    return result.rows.map(resourceRequestRow);
  }

  async listProviderResourceRequests(userId: string, limit?: number): Promise<readonly PersistentResourceRequest[]> {
    const result = await this.pool.query(
      `SELECT DISTINCT r.* FROM mc_resource_requests r
       LEFT JOIN mc_machines selected ON selected.machine_id=r.provider_machine_id
       LEFT JOIN mc_provider_capabilities c ON c.owner_user_id=$1
         AND c.resource_type=r.resource_type AND c.availability<>'unavailable'
         AND (r.capability_id IS NULL OR r.capability_id=c.id)
         AND (jsonb_array_length(r.preferred_rails)=0 OR EXISTS (
           SELECT 1 FROM jsonb_array_elements_text(r.preferred_rails) rail
           WHERE c.rail_tags ? rail
         ))
       WHERE selected.owner_user_id=$1
          OR (r.provider_machine_id IS NULL AND r.state IN ('pending','quoted') AND (
            c.id IS NOT NULL OR EXISTS (
              SELECT 1 FROM mc_resource_quotes own
              WHERE own.resource_request_id=r.id AND own.provider_owner_user_id=$1
            )
          ))
       ORDER BY r.created_at DESC LIMIT $2`,
      [userId, boundedLimit(limit)]
    );
    return result.rows.map(resourceRequestRow);
  }

  async resourceRequest(userId: string, requestId: string): Promise<PersistentResourceRequest | null> {
    const result = await this.pool.query('SELECT * FROM mc_resource_requests WHERE owner_user_id=$1 AND id=$2', [userId, requestId]);
    return result.rows[0] ? resourceRequestRow(result.rows[0]) : null;
  }


  async providerResourceRequest(userId: string, requestId: string): Promise<PersistentResourceRequest | null> {
    const result = await this.pool.query(
      `SELECT DISTINCT r.* FROM mc_resource_requests r
       LEFT JOIN mc_machines selected ON selected.machine_id=r.provider_machine_id
       LEFT JOIN mc_provider_capabilities c ON c.owner_user_id=$1
         AND c.resource_type=r.resource_type AND c.availability<>'unavailable'
         AND (r.capability_id IS NULL OR r.capability_id=c.id)
         AND (jsonb_array_length(r.preferred_rails)=0 OR EXISTS (
           SELECT 1 FROM jsonb_array_elements_text(r.preferred_rails) rail
           WHERE c.rail_tags ? rail
         ))
       WHERE r.id=$2 AND (
         selected.owner_user_id=$1 OR
         (r.provider_machine_id IS NULL AND r.state IN ('pending','quoted') AND (
           c.id IS NOT NULL OR EXISTS (
             SELECT 1 FROM mc_resource_quotes own
             WHERE own.resource_request_id=r.id AND own.provider_owner_user_id=$1
           )
         ))
       )`,
      [userId, requestId]
    );
    return result.rows[0] ? resourceRequestRow(result.rows[0]) : null;
  }

  async transitionResourceRequest(userId: string, requestId: string, from: readonly ResourceRequestState[], to: ResourceRequestState, providerMachineId: string | null, capabilityId: string | null, now: string): Promise<PersistentResourceRequest | null> {
    const result = await this.pool.query(
      `UPDATE mc_resource_requests SET state=$4,provider_machine_id=COALESCE($5,provider_machine_id),capability_id=COALESCE($6,capability_id),updated_at=$7
       WHERE owner_user_id=$1 AND id=$2 AND state=ANY($3::text[]) RETURNING *`,
      [userId, requestId, [...from], to, providerMachineId, capabilityId, now]
    );
    return result.rows[0] ? resourceRequestRow(result.rows[0]) : null;
  }

  async cancelResourceRequest(userId: string, requestId: string, now: string): Promise<PersistentResourceRequest | null> {
    return transaction(this.pool, async (client) => {
      const result = await client.query(
        `UPDATE mc_resource_requests SET state='cancelled',updated_at=$3
         WHERE owner_user_id=$1 AND id=$2 AND state IN ('pending','quoted') RETURNING *`,
        [userId, requestId, now]
      );
      if (!result.rows[0]) return null;
      await client.query(
        `UPDATE mc_resource_quotes SET state='declined',updated_at=$2
         WHERE resource_request_id=$1 AND state='offered'`,
        [requestId, now]
      );
      return resourceRequestRow(result.rows[0]);
    });
  }

  async rejectResourceRequest(userId: string, requestId: string, now: string): Promise<PersistentResourceRequest | null> {
    return transaction(this.pool, async (client) => {
      const result = await client.query(
        `UPDATE mc_resource_requests r SET state='rejected',updated_at=$3
         FROM mc_machines m
         WHERE r.id=$2 AND r.provider_machine_id IS NOT NULL AND r.provider_machine_id=m.machine_id
           AND m.owner_user_id=$1 AND r.state IN ('pending','quoted') RETURNING r.*`,
        [userId, requestId, now]
      );
      if (!result.rows[0]) return null;
      await client.query(
        `UPDATE mc_resource_quotes SET state='declined',updated_at=$2
         WHERE resource_request_id=$1 AND state='offered'`,
        [requestId, now]
      );
      return resourceRequestRow(result.rows[0]);
    });
  }

  async createResourceQuote(userId: string, input: CreateResourceQuoteInput, now: string): Promise<PersistentResourceQuote | null> {
    return transaction(this.pool, async (client) => {
      const locked = await client.query(
        `SELECT r.id FROM mc_resource_requests r JOIN mc_provider_capabilities c ON c.id=$3
         WHERE r.id=$2 AND c.owner_user_id=$1 AND c.availability<>'unavailable'
           AND c.resource_type=r.resource_type AND r.state IN ('pending','quoted')
           AND (r.capability_id IS NULL OR r.capability_id=c.id)
           AND (jsonb_array_length(r.preferred_rails)=0 OR EXISTS (
             SELECT 1 FROM jsonb_array_elements_text(r.preferred_rails) rail WHERE c.rail_tags ? rail
           )) FOR UPDATE OF r`,
        [userId, input.resourceRequestId, input.capabilityId]
      );
      if (!locked.rows[0]) return null;
      await client.query(
        `UPDATE mc_resource_quotes q SET state='expired',updated_at=$4
         FROM mc_provider_capabilities c
         WHERE c.id=$3 AND c.owner_user_id=$1 AND q.resource_request_id=$2
           AND q.provider_machine_id=c.provider_machine_id AND q.state='offered'
           AND q.expires_at IS NOT NULL AND q.expires_at<=$4::timestamptz`,
        [userId, input.resourceRequestId, input.capabilityId, now]
      );
      const result = await client.query(
        `INSERT INTO mc_resource_quotes(id,resource_request_id,provider_owner_user_id,provider_machine_id,capability_id,amount,asset,state,expires_at,created_at,updated_at)
         SELECT $1,r.id,$2,c.provider_machine_id,c.id,$5,$6,'offered',$7,$8,$8
         FROM mc_resource_requests r JOIN mc_provider_capabilities c ON c.id=$4
         WHERE r.id=$3 AND c.owner_user_id=$2 AND c.availability<>'unavailable'
           AND c.resource_type=r.resource_type AND r.state IN ('pending','quoted')
           AND (r.capability_id IS NULL OR r.capability_id=c.id)
           AND (jsonb_array_length(r.preferred_rails)=0 OR EXISTS (
             SELECT 1 FROM jsonb_array_elements_text(r.preferred_rails) rail
             WHERE c.rail_tags ? rail
           ))
           AND $5::numeric>0 AND $5::numeric<=r.max_price
           AND ($7::timestamptz IS NULL OR $7::timestamptz>$8::timestamptz)
         ON CONFLICT DO NOTHING RETURNING *`,
        [randomUUID(), userId, input.resourceRequestId, input.capabilityId, input.amount, input.asset, input.expiresAt, now]
      );
      if (!result.rows[0]) return null;
      // Offering a quote does not select a provider. Selection and the trusted
      // accepted price are persisted only by acceptResourceQuote.
      await client.query(
        `UPDATE mc_resource_requests SET state='quoted',updated_at=$2
         WHERE id=$1 AND state IN ('pending','quoted')`,
        [input.resourceRequestId, now]
      );
      return resourceQuoteRow(result.rows[0]);
    });
  }

  async listResourceQuotes(userId: string, requestId: string, limit?: number, now = new Date().toISOString()): Promise<readonly PersistentResourceQuote[]> {
    return transaction(this.pool, async (client) => {
      const authorized = await client.query(
        `SELECT 1 FROM mc_resource_requests r WHERE r.id=$2 AND (
           r.owner_user_id=$1 OR EXISTS (
             SELECT 1 FROM mc_resource_quotes own
             WHERE own.resource_request_id=r.id AND own.provider_owner_user_id=$1
           )
         )`,
        [userId, requestId]
      );
      if (!authorized.rows[0]) return [];
      await client.query(
        `UPDATE mc_resource_quotes SET state='expired',updated_at=$2
         WHERE resource_request_id=$1 AND state='offered' AND expires_at IS NOT NULL AND expires_at<=$2`,
        [requestId, now]
      );
      await client.query(
        `UPDATE mc_resource_requests SET state='pending',updated_at=$2
         WHERE id=$1 AND state='quoted' AND NOT EXISTS (
           SELECT 1 FROM mc_resource_quotes WHERE resource_request_id=$1 AND state='offered'
         )`,
        [requestId, now]
      );
      const result = await client.query(
        `SELECT q.* FROM mc_resource_quotes q JOIN mc_resource_requests r ON r.id=q.resource_request_id
         WHERE q.resource_request_id=$2 AND (r.owner_user_id=$1 OR q.provider_owner_user_id=$1)
         ORDER BY q.created_at DESC LIMIT $3`,
        [userId, requestId, boundedLimit(limit)]
      );
      return result.rows.map(resourceQuoteRow);
    });
  }

  async acceptedResourceQuote(userId: string, requestId: string): Promise<PersistentResourceQuote | null> {
    const result = await this.pool.query(
      `SELECT q.* FROM mc_resource_quotes q JOIN mc_resource_requests r ON r.id=q.resource_request_id
       WHERE r.owner_user_id=$1 AND r.id=$2 AND q.state='accepted'`,
      [userId, requestId]
    );
    return result.rows[0] ? resourceQuoteRow(result.rows[0]) : null;
  }

  async withdrawResourceQuote(userId: string, quoteId: string, now: string): Promise<{ request: PersistentResourceRequest; quote: PersistentResourceQuote } | null> {
    return transaction(this.pool, async (client) => {
      const selected = await client.query(
        `SELECT q.resource_request_id,q.expires_at FROM mc_resource_quotes q
         JOIN mc_resource_requests r ON r.id=q.resource_request_id
         WHERE q.id=$2 AND q.provider_owner_user_id=$1 AND q.state='offered'
           AND r.state IN ('pending','quoted') FOR UPDATE OF r,q`,
        [userId, quoteId]
      );
      if (!selected.rows[0]) return null;
      const requestId = String(selected.rows[0]['resource_request_id']);
      await client.query(
        `UPDATE mc_resource_quotes SET state='expired',updated_at=$2
         WHERE resource_request_id=$1 AND state='offered' AND expires_at IS NOT NULL AND expires_at<=$2`,
        [requestId, now]
      );
      const quoteResult = await client.query(
        `UPDATE mc_resource_quotes SET state='withdrawn',updated_at=$3
         WHERE provider_owner_user_id=$1 AND id=$2 AND state='offered' RETURNING *`,
        [userId, quoteId, now]
      );
      const requestResult = await client.query(
        `UPDATE mc_resource_requests SET state=CASE
           WHEN EXISTS (SELECT 1 FROM mc_resource_quotes WHERE resource_request_id=$1 AND state='offered')
             THEN 'quoted' ELSE 'pending' END,
         updated_at=$2 WHERE id=$1 AND state IN ('pending','quoted') RETURNING *`,
        [requestId, now]
      );
      if (!quoteResult.rows[0] || !requestResult.rows[0]) return null;
      return { request: resourceRequestRow(requestResult.rows[0]), quote: resourceQuoteRow(quoteResult.rows[0]) };
    });
  }

  async acceptResourceQuote(userId: string, requestId: string, quoteId: string, now: string): Promise<{ request: PersistentResourceRequest; quote: PersistentResourceQuote } | null> {
    return transaction(this.pool, async (client) => {
      const selected = await client.query(
        `SELECT q.* FROM mc_resource_quotes q JOIN mc_resource_requests r ON r.id=q.resource_request_id
         WHERE r.owner_user_id=$1 AND r.id=$2 AND r.state IN ('pending','quoted') AND q.id=$3
           AND q.resource_request_id=r.id AND q.state='offered'
           AND (q.expires_at IS NULL OR q.expires_at>$4) FOR UPDATE OF r,q`,
        [userId, requestId, quoteId, now]
      );
      if (!selected.rows[0]) return null;
      const quoteResult = await client.query(
        `UPDATE mc_resource_quotes SET state='accepted',updated_at=$3
         WHERE id=$1 AND resource_request_id=$2 AND state='offered' RETURNING *`,
        [quoteId, requestId, now]
      );
      if (!quoteResult.rows[0]) return null;
      await client.query(
        `UPDATE mc_resource_quotes SET state='declined',updated_at=$3
         WHERE resource_request_id=$1 AND id<>$2 AND state='offered'`,
        [requestId, quoteId, now]
      );
      const q = quoteResult.rows[0];
      const requestResult = await client.query(
        `UPDATE mc_resource_requests SET state='accepted',capability_id=$3,provider_machine_id=$4,
         quote_amount=$5,quote_asset=$6,updated_at=$7 WHERE owner_user_id=$1 AND id=$2 RETURNING *`,
        [userId, requestId, q['capability_id'], q['provider_machine_id'], q['amount'], q['asset'], now]
      );
      return { request: resourceRequestRow(requestResult.rows[0]!), quote: resourceQuoteRow(q) };
    });
  }

  async createAccessGrant(userId: string, input: { resourceRequestId: string; resourceQuoteId: string; accessReference: string | null; expiresAt: string | null }, now: string): Promise<PersistentAccessGrant | null> {
    const result = await this.pool.query(
      `INSERT INTO mc_access_grants(id,resource_request_id,resource_quote_id,provider_owner_user_id,provider_machine_id,requester_owner_user_id,requester_machine_id,state,access_reference,expires_at,created_at,updated_at)
       SELECT $1,r.id,q.id,$2,q.provider_machine_id,r.owner_user_id,r.requester_machine_id,'pending',$5,$6,$7,$7
       FROM mc_resource_requests r JOIN mc_resource_quotes q ON q.resource_request_id=r.id
       WHERE r.id=$3 AND q.id=$4 AND r.state='accepted' AND q.state='accepted' AND q.provider_owner_user_id=$2
         AND ($6::timestamptz IS NULL OR $6::timestamptz>$7::timestamptz)
       ON CONFLICT DO NOTHING RETURNING *`,
      [randomUUID(), userId, input.resourceRequestId, input.resourceQuoteId, input.accessReference, input.expiresAt, now]
    );
    return result.rows[0] ? accessGrantRow(result.rows[0]) : null;
  }

  async accessGrant(userId: string, requestId: string, now = new Date().toISOString()): Promise<PersistentAccessGrant | null> {
    return transaction(this.pool, async (client) => {
      const result = await client.query(
        `SELECT * FROM mc_access_grants WHERE resource_request_id=$2
         AND (provider_owner_user_id=$1 OR requester_owner_user_id=$1)
         ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE`,
        [userId, requestId]
      );
      if (!result.rows[0]) return null;
      const grant = accessGrantRow(result.rows[0]);
      if ((grant.state === 'pending' || grant.state === 'active') && grant.expiresAt !== null && grant.expiresAt <= now) {
        const expired = await client.query(
          `UPDATE mc_access_grants SET state='expired',updated_at=$2 WHERE id=$1 RETURNING *`,
          [grant.id, now]
        );
        await client.query(
          `UPDATE mc_resource_requests SET state='accepted',updated_at=$2
           WHERE id=$1 AND state='granted' AND NOT EXISTS (
             SELECT 1 FROM mc_resource_receipts WHERE resource_request_id=$1 AND state<>'rejected'
           )`,
          [requestId, now]
        );
        return accessGrantRow(expired.rows[0]!);
      }
      return grant;
    });
  }

  async transitionAccessGrant(userId: string, grantId: string, from: AccessGrantState, to: AccessGrantState, now: string): Promise<PersistentAccessGrant | null> {
    const allowed = (from === 'pending' && (to === 'active' || to === 'revoked' || to === 'expired')) ||
      (from === 'active' && (to === 'revoked' || to === 'expired'));
    if (!allowed) return null;
    return transaction(this.pool, async (client) => {
      if (from === 'pending' && to === 'active') {
        await client.query(
          `UPDATE mc_access_grants SET state='expired',updated_at=$3
           WHERE provider_owner_user_id=$1 AND id=$2 AND state='pending'
             AND expires_at IS NOT NULL AND expires_at<=$3`,
          [userId, grantId, now]
        );
      }
      const result = await client.query(
        `UPDATE mc_access_grants SET state=$4,updated_at=$5
         WHERE provider_owner_user_id=$1 AND id=$2 AND state=$3
           AND ($4<>'active' OR expires_at IS NULL OR expires_at>$5) RETURNING *`,
        [userId, grantId, from, to, now]
      );
      if (!result.rows[0]) return null;
      if (to === 'active') await client.query(`UPDATE mc_resource_requests SET state='granted',updated_at=$2 WHERE id=$1 AND state='accepted'`, [result.rows[0]['resource_request_id'], now]);
      if (to === 'revoked' || to === 'expired') {
        await client.query(
          `UPDATE mc_resource_requests SET state='accepted',updated_at=$2
           WHERE id=$1 AND state='granted' AND NOT EXISTS (
             SELECT 1 FROM mc_resource_receipts WHERE resource_request_id=$1 AND state<>'rejected'
           )`,
          [result.rows[0]['resource_request_id'], now]
        );
      }
      return accessGrantRow(result.rows[0]);
    });
  }

  async createResourceReceipt(userId: string, input: { resourceRequestId: string; accessGrantId: string; settlementId: string | null; evidenceReference: string | null; resultReference: string | null }, now: string): Promise<PersistentResourceReceipt | null> {
    return transaction(this.pool, async (client) => {
      const locked = await client.query(
        `SELECT id FROM mc_access_grants
         WHERE provider_owner_user_id=$1 AND resource_request_id=$2 AND id=$3 AND state='active'
         FOR UPDATE`,
        [userId, input.resourceRequestId, input.accessGrantId]
      );
      if (!locked.rows[0]) return null;
      const expired = await client.query(
        `UPDATE mc_access_grants SET state='expired',updated_at=$4
         WHERE provider_owner_user_id=$1 AND resource_request_id=$2 AND id=$3 AND state='active'
           AND expires_at IS NOT NULL AND expires_at<=$4 RETURNING resource_request_id`,
        [userId, input.resourceRequestId, input.accessGrantId, now]
      );
      if (expired.rows[0]) {
        await client.query(
          `UPDATE mc_resource_requests SET state='accepted',updated_at=$2
           WHERE id=$1 AND state='granted' AND NOT EXISTS (
             SELECT 1 FROM mc_resource_receipts WHERE resource_request_id=$1 AND state<>'rejected'
           )`,
          [input.resourceRequestId, now]
        );
      }
      const result = await client.query(
        `INSERT INTO mc_resource_receipts(id,resource_request_id,access_grant_id,settlement_id,provider_owner_user_id,requester_owner_user_id,state,evidence_reference,result_reference,created_at,updated_at)
         SELECT $1,g.resource_request_id,g.id,$5,g.provider_owner_user_id,g.requester_owner_user_id,'recorded',$6,$7,$8,$8
         FROM mc_access_grants g LEFT JOIN mc_settlements s ON s.id=$5
         WHERE g.provider_owner_user_id=$2 AND g.resource_request_id=$3 AND g.id=$4 AND g.state='active'
           AND (g.expires_at IS NULL OR g.expires_at>$8)
           AND ($5::text IS NULL OR (s.resource_request_id=g.resource_request_id AND s.state='confirmed'))
         ON CONFLICT DO NOTHING RETURNING *`,
        [randomUUID(), userId, input.resourceRequestId, input.accessGrantId, input.settlementId, input.evidenceReference, input.resultReference, now]
      );
      return result.rows[0] ? resourceReceiptRow(result.rows[0]) : null;
    });
  }

  async resourceReceipt(userId: string, requestId: string): Promise<PersistentResourceReceipt | null> {
    const result = await this.pool.query(
      `SELECT * FROM mc_resource_receipts WHERE resource_request_id=$2
       AND (provider_owner_user_id=$1 OR requester_owner_user_id=$1)
       ORDER BY created_at DESC,id DESC LIMIT 1`,
      [userId, requestId]
    );
    return result.rows[0] ? resourceReceiptRow(result.rows[0]) : null;
  }

  async transitionResourceReceipt(userId: string, receiptId: string, from: ResourceReceiptState, to: Extract<ResourceReceiptState, 'verified' | 'rejected'>, now: string): Promise<PersistentResourceReceipt | null> {
    if (from !== 'recorded') return null;
    return transaction(this.pool, async (client) => {
      const result = await client.query(
        `UPDATE mc_resource_receipts SET state=$4,updated_at=$5
         WHERE requester_owner_user_id=$1 AND id=$2 AND state=$3 RETURNING *`,
        [userId, receiptId, from, to, now]
      );
      if (!result.rows[0]) return null;
      if (to === 'verified') await client.query(
        `UPDATE mc_resource_requests SET state='fulfilled',updated_at=$2
         WHERE id=$1 AND state IN ('accepted','granted')`,
        [result.rows[0]['resource_request_id'], now]
      );
      return resourceReceiptRow(result.rows[0]);
    });
  }

  async resourceRequestLifecycles(userId: string, requestIds: readonly string[], now = new Date().toISOString()): Promise<readonly ResourceRequestLifecycle[]> {
    const ids = [...new Set(requestIds)].slice(0, MAX_PRODUCTION_LIST_LIMIT);
    if (ids.length === 0) return [];
    return transaction(this.pool, async (client) => {
      const authorizedResult = await client.query(
        `SELECT DISTINCT r.id FROM mc_resource_requests r
         LEFT JOIN mc_machines selected ON selected.machine_id=r.provider_machine_id
         WHERE r.id=ANY($2::text[]) AND (
           r.owner_user_id=$1 OR selected.owner_user_id=$1 OR
           EXISTS (SELECT 1 FROM mc_resource_quotes own
             WHERE own.resource_request_id=r.id AND own.provider_owner_user_id=$1) OR
           (r.provider_machine_id IS NULL AND r.state IN ('pending','quoted') AND EXISTS (
             SELECT 1 FROM mc_provider_capabilities c
             WHERE c.owner_user_id=$1 AND c.availability<>'unavailable' AND c.resource_type=r.resource_type
               AND (r.capability_id IS NULL OR r.capability_id=c.id)
               AND (jsonb_array_length(r.preferred_rails)=0 OR EXISTS (
                 SELECT 1 FROM jsonb_array_elements_text(r.preferred_rails) rail WHERE c.rail_tags ? rail
               ))
           ))
         )`,
        [userId, ids]
      );
      const authorizedIds = authorizedResult.rows.map((row) => String(row['id']));
      if (authorizedIds.length === 0) return [];

      await client.query(
        `UPDATE mc_resource_quotes SET state='expired',updated_at=$2
         WHERE resource_request_id=ANY($1::text[]) AND state='offered'
           AND expires_at IS NOT NULL AND expires_at<=$2`,
        [authorizedIds, now]
      );
      await client.query(
        `UPDATE mc_access_grants SET state='expired',updated_at=$2
         WHERE resource_request_id=ANY($1::text[]) AND state IN ('pending','active')
           AND expires_at IS NOT NULL AND expires_at<=$2`,
        [authorizedIds, now]
      );
      await client.query(
        `UPDATE mc_resource_requests r SET state=CASE
           WHEN r.state='quoted' THEN 'pending' ELSE 'accepted' END,
         updated_at=$2
         WHERE r.id=ANY($1::text[]) AND (
           (r.state='quoted' AND NOT EXISTS (
             SELECT 1 FROM mc_resource_quotes q WHERE q.resource_request_id=r.id AND q.state='offered'
           )) OR
           (r.state='granted' AND NOT EXISTS (
             SELECT 1 FROM mc_access_grants g WHERE g.resource_request_id=r.id AND g.state='active'
           ) AND NOT EXISTS (
             SELECT 1 FROM mc_resource_receipts receipt
             WHERE receipt.resource_request_id=r.id AND receipt.state<>'rejected'
           ))
         )`,
        [authorizedIds, now]
      );

      const [quoteResult, grantResult, receiptResult, receiptSettlementResult] = await Promise.all([
        client.query(
          `SELECT q.* FROM mc_resource_quotes q JOIN mc_resource_requests r ON r.id=q.resource_request_id
           WHERE q.resource_request_id=ANY($2::text[]) AND
             (r.owner_user_id=$1 OR q.provider_owner_user_id=$1)
           ORDER BY q.resource_request_id,q.created_at DESC,q.id DESC`,
          [userId, authorizedIds]
        ),
        client.query(
          `SELECT DISTINCT ON (resource_request_id) * FROM mc_access_grants
           WHERE resource_request_id=ANY($2::text[]) AND
             (provider_owner_user_id=$1 OR requester_owner_user_id=$1)
           ORDER BY resource_request_id,created_at DESC,id DESC`,
          [userId, authorizedIds]
        ),
        client.query(
          `SELECT DISTINCT ON (resource_request_id) * FROM mc_resource_receipts
           WHERE resource_request_id=ANY($2::text[]) AND
             (provider_owner_user_id=$1 OR requester_owner_user_id=$1)
           ORDER BY resource_request_id,created_at DESC,id DESC`,
          [userId, authorizedIds]
        ),
        client.query(
          `WITH latest_receipt AS (
             SELECT DISTINCT ON (resource_request_id) * FROM mc_resource_receipts
             WHERE resource_request_id=ANY($2::text[]) AND
               (provider_owner_user_id=$1 OR requester_owner_user_id=$1)
             ORDER BY resource_request_id,created_at DESC,id DESC
           )
           SELECT s.* FROM latest_receipt receipt
           JOIN mc_settlements s ON s.id=receipt.settlement_id
             AND s.resource_request_id=receipt.resource_request_id
           WHERE s.state='confirmed'`,
          [userId, authorizedIds]
        ),
      ]);
      const authorized = new Set(authorizedIds);
      const quotes = new Map<string, PersistentResourceQuote[]>();
      for (const row of quoteResult.rows) {
        const quote = resourceQuoteRow(row);
        const records = quotes.get(quote.resourceRequestId) ?? [];
        records.push(quote);
        quotes.set(quote.resourceRequestId, records);
      }
      const grants = new Map(grantResult.rows.map((row) => {
        const grant = accessGrantRow(row);
        return [grant.resourceRequestId, grant] as const;
      }));
      const receipts = new Map(receiptResult.rows.map((row) => {
        const receipt = resourceReceiptRow(row);
        return [receipt.resourceRequestId, receipt] as const;
      }));
      const receiptSettlements = new Map(receiptSettlementResult.rows.map((row) => {
        const settlement = settlementRow(row);
        return [settlement.resourceRequestId, {
          id: settlement.id,
          resourceRequestId: settlement.resourceRequestId,
          state: settlement.state,
          transactionSignature: settlement.transactionSignature,
          updatedAt: settlement.updatedAt,
        } satisfies ReceiptSettlementProjection] as const;
      }));
      return ids.filter((id) => authorized.has(id)).map((resourceRequestId) => ({
        resourceRequestId,
        quotes: quotes.get(resourceRequestId) ?? [],
        grant: grants.get(resourceRequestId) ?? null,
        receipt: receipts.get(resourceRequestId) ?? null,
        receiptSettlement: receiptSettlements.get(resourceRequestId) ?? null,
      }));
    });
  }

  async createSettlement(record: SettlementRecord): Promise<void> {
    const created = await this.createSettlementForAcceptedRequest(record);
    if (!created) throw new Error('settlement requires a unique accepted resource request and quote');
  }

  async createSettlementForAcceptedRequest(record: SettlementRecord): Promise<SettlementRecord | null> {
    if (record.state !== 'created' || record.unsignedTransaction !== null || record.transactionSignature !== null || record.lastValidBlockHeight !== null || record.errorCode !== null) return null;
    const result = await this.pool.query(
      `INSERT INTO mc_settlements(id,resource_request_id,resource_quote_id,owner_user_id,machine_id,source_wallet,recipient_wallet,amount_lamports,state,unsigned_transaction,transaction_signature,last_valid_block_height,error_code,created_at,updated_at)
       SELECT $1,r.id,q.id,$4,r.requester_machine_id,w.address,pm.wallet_address,$8,$9,$10,$11,$12,$13,$14,$15
       FROM mc_resource_requests r
       JOIN mc_resource_quotes q ON q.id=$3 AND q.resource_request_id=r.id
       JOIN mc_machines pm ON pm.machine_id=q.provider_machine_id
       JOIN mc_wallets w ON w.address=$6 AND w.user_id=$4
       WHERE r.id=$2 AND r.owner_user_id=$4 AND r.requester_machine_id=$5 AND r.state IN ('accepted','granted')
         AND q.state='accepted' AND q.asset='SOL' AND pm.wallet_address=$7
         AND (q.amount*r.quantity*1000000000)=$8::numeric
       ON CONFLICT DO NOTHING RETURNING *`,
      [record.id, record.resourceRequestId, record.resourceQuoteId, record.ownerUserId, record.machineId, record.sourceWallet, record.recipientWallet, record.amountLamports, record.state, record.unsignedTransaction, record.transactionSignature, record.lastValidBlockHeight, record.errorCode, record.createdAt, record.updatedAt]
    );
    return result.rows[0] ? settlementRow(result.rows[0]) : null;
  }

  async listSettlements(userId: string, limit?: number): Promise<readonly SettlementRecord[]> {
    const result = await this.pool.query(
      'SELECT * FROM mc_settlements WHERE owner_user_id=$1 ORDER BY created_at DESC LIMIT $2',
      [userId, boundedLimit(limit)]
    );
    return result.rows.map(settlementRow);
  }

  async settlementForResourceRequest(userId: string, resourceRequestId: string): Promise<SettlementRecord | null> {
    const result = await this.pool.query(
      'SELECT * FROM mc_settlements WHERE owner_user_id=$1 AND resource_request_id=$2',
      [userId, resourceRequestId]
    );
    return result.rows[0] ? settlementRow(result.rows[0]) : null;
  }

  async receiptSettlement(userId: string, resourceRequestId: string): Promise<ReceiptSettlementProjection | null> {
    const result = await this.pool.query(
      `WITH latest_receipt AS (
         SELECT * FROM mc_resource_receipts
         WHERE resource_request_id=$2
           AND (provider_owner_user_id=$1 OR requester_owner_user_id=$1)
         ORDER BY created_at DESC,id DESC LIMIT 1
       )
       SELECT s.* FROM latest_receipt receipt
       JOIN mc_settlements s ON s.id=receipt.settlement_id AND s.resource_request_id=receipt.resource_request_id
       WHERE s.state='confirmed'`,
      [userId, resourceRequestId]
    );
    if (!result.rows[0]) return null;
    const settlement = settlementRow(result.rows[0]);
    return {
      id: settlement.id,
      resourceRequestId: settlement.resourceRequestId,
      state: settlement.state,
      transactionSignature: settlement.transactionSignature,
      updatedAt: settlement.updatedAt,
    };
  }

  async settlement(userId: string, settlementId: string): Promise<SettlementRecord | null> {
    const result = await this.pool.query('SELECT * FROM mc_settlements WHERE owner_user_id=$1 AND id=$2', [userId, settlementId]);
    return result.rows[0] ? settlementRow(result.rows[0]) : null;
  }

  async transitionSettlement(userId: string, settlementId: string, from: SettlementState, patch: Pick<SettlementRecord, 'state' | 'updatedAt'> & Partial<Pick<SettlementRecord, 'unsignedTransaction' | 'transactionSignature' | 'lastValidBlockHeight' | 'errorCode'>>): Promise<SettlementRecord | null> {
    const hasUnsignedTransaction = Object.prototype.hasOwnProperty.call(patch, 'unsignedTransaction');
    const hasTransactionSignature = Object.prototype.hasOwnProperty.call(patch, 'transactionSignature');
    const hasLastValidBlockHeight = Object.prototype.hasOwnProperty.call(patch, 'lastValidBlockHeight');
    const hasErrorCode = Object.prototype.hasOwnProperty.call(patch, 'errorCode');
    const result = await this.pool.query(
      `UPDATE mc_settlements SET state=$4,
       unsigned_transaction=CASE WHEN $5 THEN $6 ELSE unsigned_transaction END,
       transaction_signature=CASE WHEN $7 THEN $8 ELSE transaction_signature END,
       last_valid_block_height=CASE WHEN $9 THEN $10 ELSE last_valid_block_height END,
       error_code=CASE WHEN $11 THEN $12 ELSE error_code END,updated_at=$13
       WHERE owner_user_id=$1 AND id=$2 AND state=$3 RETURNING *`,
      [
        userId, settlementId, from, patch.state,
        hasUnsignedTransaction, patch.unsignedTransaction ?? null,
        hasTransactionSignature, patch.transactionSignature ?? null,
        hasLastValidBlockHeight, patch.lastValidBlockHeight ?? null,
        hasErrorCode, patch.errorCode ?? null,
        patch.updatedAt,
      ]
    );
    return result.rows[0] ? settlementRow(result.rows[0]) : null;
  }
}
