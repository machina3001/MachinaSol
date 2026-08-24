import type { MachineTelemetrySnapshot } from '../../telemetry/snapshot.js';
import type { ResourceType } from '../../console/services/resources.js';
import type { RuntimeChain, RuntimeMode } from '../../adapters/shared/types.js';
import type { MachineCapability } from '../../machines/identity.js';
import type { WorkOrderStage } from '../../jobs/work-order.js';

export interface WalletChallengeRecord {
  id: string;
  walletAddress: string;
  message: string;
  nonceHash: string;
  expiresAt: string;
  consumedAt: string | null;
}

export interface AuthSessionRecord {
  id: string;
  userId: string;
  walletAddress: string;
  tokenHash: string;
  csrfHash: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface OwnedMachineRecord {
  machineId: string;
  ownerUserId: string;
  label: string;
  role: string;
  walletAddress: string;
  createdAt: string;
  updatedAt: string;
}

export interface MachineCredentialRecord {
  id: string;
  machineId: string;
  secretHash: string;
  label: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface TelemetryEventRecord {
  id: string;
  machineId: string;
  receivedAt: string;
  snapshot: MachineTelemetrySnapshot;
}

export interface PersistentMachineCapability {
  machineId: string;
  ownerUserId: string;
  capability: MachineCapability;
  createdAt: string;
}

/** Durable projection of the runtime-8 MachineSession; only a nonce hash is stored. */
export interface PersistentRuntimeSession {
  sessionId: string;
  ownerUserId: string;
  machineId: string;
  chain: RuntimeChain;
  walletAddress: string;
  operatorId: string;
  policyProfileId: string;
  mode: RuntimeMode;
  nonceHash: string;
  metadata: Readonly<Record<string, unknown>>;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
}

/** Durable projection of runtime-8 MachineWorkOrder. */
export interface PersistentWorkOrder {
  workOrderId: string;
  ownerUserId: string;
  machineId: string | null;
  stage: WorkOrderStage;
  requiredCapabilities: readonly MachineCapability[];
  telemetryRequired: boolean;
  proofRequired: boolean;
  expectedOutputs: readonly string[];
  settlementChain: RuntimeChain;
  settlementAmount: string;
  settlementAsset: string;
  settlementRecipient: string;
  telemetryRef: string | null;
  proofId: string | null;
  settlementIntentId: string | null;
  resultRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderCapabilityRow {
  id: string;
  providerMachineId: string;
  ownerUserId: string;
  resourceType: ResourceType;
  label: string;
  unit: string;
  railTags: readonly string[];
  availability: 'available' | 'limited' | 'unavailable';
  priceAmount: string | null;
  priceAsset: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ProviderCapabilityPatch = Pick<
  ProviderCapabilityRow,
  'label' | 'unit' | 'railTags' | 'availability' | 'priceAmount' | 'priceAsset' | 'updatedAt'
>;

export type ResourceRequestState =
  | 'pending'
  | 'quoted'
  | 'accepted'
  | 'granted'
  | 'fulfilled'
  | 'rejected'
  | 'cancelled';

export interface PersistentResourceRequest {
  id: string;
  ownerUserId: string;
  requesterMachineId: string;
  capabilityId: string | null;
  providerMachineId: string | null;
  resourceType: ResourceType;
  quantity: string;
  maxPrice: string;
  preferredRails: readonly string[];
  purpose: string;
  quoteAmount: string | null;
  quoteAsset: string | null;
  state: ResourceRequestState;
  createdAt: string;
  updatedAt: string;
}

export type ResourceQuoteState = 'offered' | 'accepted' | 'declined' | 'withdrawn' | 'expired';

export interface PersistentResourceQuote {
  id: string;
  resourceRequestId: string;
  providerOwnerUserId: string;
  providerMachineId: string;
  capabilityId: string;
  amount: string;
  asset: string;
  state: ResourceQuoteState;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateResourceQuoteInput {
  resourceRequestId: string;
  capabilityId: string;
  amount: string;
  asset: string;
  expiresAt: string | null;
}

export type AccessGrantState = 'pending' | 'active' | 'revoked' | 'expired';

export interface PersistentAccessGrant {
  id: string;
  resourceRequestId: string;
  resourceQuoteId: string;
  providerOwnerUserId: string;
  providerMachineId: string;
  requesterOwnerUserId: string;
  requesterMachineId: string;
  state: AccessGrantState;
  accessReference: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ResourceReceiptState = 'recorded' | 'verified' | 'rejected';

export interface PersistentResourceReceipt {
  id: string;
  resourceRequestId: string;
  accessGrantId: string;
  settlementId: string | null;
  providerOwnerUserId: string;
  requesterOwnerUserId: string;
  state: ResourceReceiptState;
  evidenceReference: string | null;
  resultReference: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResourceRequestLifecycle {
  resourceRequestId: string;
  quotes: readonly PersistentResourceQuote[];
  grant: PersistentAccessGrant | null;
  receipt: PersistentResourceReceipt | null;
  receiptSettlement: ReceiptSettlementProjection | null;
}

export type SettlementState =
  | 'created'
  | 'awaiting_signature'
  | 'submitting'
  | 'submitted'
  | 'confirmed'
  | 'failed'
  | 'cancelled';

export interface SettlementRecord {
  id: string;
  resourceRequestId: string;
  resourceQuoteId: string;
  ownerUserId: string;
  machineId: string;
  sourceWallet: string;
  recipientWallet: string;
  amountLamports: string;
  state: SettlementState;
  unsignedTransaction: string | null;
  transactionSignature: string | null;
  lastValidBlockHeight: string | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ReceiptSettlementProjection = Pick<
  SettlementRecord,
  'id' | 'resourceRequestId' | 'state' | 'transactionSignature' | 'updatedAt'
>;

/** Hard bounds used by durable list reads when the caller does not provide a smaller page size. */
export const DEFAULT_PRODUCTION_LIST_LIMIT = 100;
export const MAX_PRODUCTION_LIST_LIMIT = 200;

export interface ProductionStore {
  migrate(): Promise<void>;
  close(): Promise<void>;

  createChallenge(record: WalletChallengeRecord, now?: string): Promise<void>;
  activeChallenge(id: string, walletAddress: string, now: string): Promise<WalletChallengeRecord | null>;
  consumeChallenge(id: string, walletAddress: string, now: string): Promise<WalletChallengeRecord | null>;
  createAuthenticatedSession(input: {
    session: AuthSessionRecord;
    walletAddress: string;
    now: string;
  }): Promise<AuthSessionRecord>;
  sessionByTokenHash(tokenHash: string, now: string): Promise<AuthSessionRecord | null>;
  revokeSession(id: string, now: string): Promise<void>;

  listOwnedMachines(userId: string, limit?: number): Promise<readonly OwnedMachineRecord[]>;
  ownedMachine(userId: string, machineId: string): Promise<OwnedMachineRecord | null>;
  machine(machineId: string): Promise<OwnedMachineRecord | null>;
  createOwnedMachine(machine: OwnedMachineRecord): Promise<void>;

  createMachineCredential(userId: string, record: MachineCredentialRecord): Promise<boolean>;
  listMachineCredentials(userId: string, machineId: string, limit?: number): Promise<readonly MachineCredentialRecord[]>;
  machineCredential(id: string, secretHash: string, now: string): Promise<MachineCredentialRecord | null>;
  revokeMachineCredential(userId: string, credentialId: string, now: string): Promise<boolean>;

  insertTelemetry(event: TelemetryEventRecord, retentionBefore: string, maxPerMachine: number): Promise<void>;
  recentTelemetry(userId: string, machineId: string | null, limit: number): Promise<readonly TelemetryEventRecord[]>;
  latestTelemetry(userId: string, limit?: number): Promise<readonly TelemetryEventRecord[]>;
  replaceMachineCapabilities(userId: string, machineId: string, capabilities: readonly MachineCapability[], now: string): Promise<readonly PersistentMachineCapability[] | null>;
  listMachineCapabilities(userId: string, machineId: string): Promise<readonly PersistentMachineCapability[]>;
  createRuntimeSession(record: PersistentRuntimeSession): Promise<boolean>;
  listRuntimeSessions(userId: string, machineId: string | null, limit?: number): Promise<readonly PersistentRuntimeSession[]>;
  endRuntimeSession(userId: string, sessionId: string, now: string): Promise<PersistentRuntimeSession | null>;
  createWorkOrder(record: PersistentWorkOrder): Promise<boolean>;
  listWorkOrders(userId: string, machineId: string | null, limit?: number): Promise<readonly PersistentWorkOrder[]>;
  workOrder(userId: string, workOrderId: string): Promise<PersistentWorkOrder | null>;

  listProviderCapabilities(userId: string | null, limit?: number): Promise<readonly ProviderCapabilityRow[]>;
  findProviderCapabilities(
    filters: {
      resourceType: ResourceType;
      preferredRails: readonly string[];
      maxPrice: string | null;
      capabilityId: string | null;
    },
    limit?: number
  ): Promise<readonly ProviderCapabilityRow[]>;
  providerCapability(userId: string | null, capabilityId: string): Promise<ProviderCapabilityRow | null>;
  createProviderCapability(
    userId: string,
    input: Omit<ProviderCapabilityRow, 'id' | 'ownerUserId' | 'createdAt' | 'updatedAt'>,
    now: string
  ): Promise<ProviderCapabilityRow | null>;
  updateProviderCapability(userId: string, capabilityId: string, patch: ProviderCapabilityPatch): Promise<ProviderCapabilityRow | null>;
  /** @deprecated Compatibility surface. New routes must use create/updateProviderCapability. */
  upsertProviderCapability(record: ProviderCapabilityRow): Promise<void>;
  createResourceRequest(record: PersistentResourceRequest): Promise<void>;
  listResourceRequests(userId: string, limit?: number): Promise<readonly PersistentResourceRequest[]>;
  listProviderResourceRequests(userId: string, limit?: number): Promise<readonly PersistentResourceRequest[]>;
  resourceRequest(userId: string, requestId: string): Promise<PersistentResourceRequest | null>;
  providerResourceRequest(userId: string, requestId: string): Promise<PersistentResourceRequest | null>;
  transitionResourceRequest(
    userId: string,
    requestId: string,
    from: readonly ResourceRequestState[],
    to: ResourceRequestState,
    providerMachineId: string | null,
    capabilityId: string | null,
    now: string
  ): Promise<PersistentResourceRequest | null>;
  cancelResourceRequest(userId: string, requestId: string, now: string): Promise<PersistentResourceRequest | null>;
  rejectResourceRequest(userId: string, requestId: string, now: string): Promise<PersistentResourceRequest | null>;

  createResourceQuote(userId: string, input: CreateResourceQuoteInput, now: string): Promise<PersistentResourceQuote | null>;
  listResourceQuotes(userId: string, requestId: string, limit?: number, now?: string): Promise<readonly PersistentResourceQuote[]>;
  acceptedResourceQuote(userId: string, requestId: string): Promise<PersistentResourceQuote | null>;
  withdrawResourceQuote(
    userId: string,
    quoteId: string,
    now: string
  ): Promise<{ request: PersistentResourceRequest; quote: PersistentResourceQuote } | null>;
  acceptResourceQuote(
    userId: string,
    requestId: string,
    quoteId: string,
    now: string
  ): Promise<{ request: PersistentResourceRequest; quote: PersistentResourceQuote } | null>;
  createAccessGrant(
    userId: string,
    input: { resourceRequestId: string; resourceQuoteId: string; accessReference: string | null; expiresAt: string | null },
    now: string
  ): Promise<PersistentAccessGrant | null>;
  accessGrant(userId: string, requestId: string, now?: string): Promise<PersistentAccessGrant | null>;
  transitionAccessGrant(
    userId: string,
    grantId: string,
    from: AccessGrantState,
    to: AccessGrantState,
    now: string
  ): Promise<PersistentAccessGrant | null>;
  createResourceReceipt(
    userId: string,
    input: { resourceRequestId: string; accessGrantId: string; settlementId: string | null; evidenceReference: string | null; resultReference: string | null },
    now: string
  ): Promise<PersistentResourceReceipt | null>;
  resourceReceipt(userId: string, requestId: string): Promise<PersistentResourceReceipt | null>;
  transitionResourceReceipt(
    userId: string,
    receiptId: string,
    from: ResourceReceiptState,
    to: Extract<ResourceReceiptState, 'verified' | 'rejected'>,
    now: string
  ): Promise<PersistentResourceReceipt | null>;
  resourceRequestLifecycles(
    userId: string,
    requestIds: readonly string[],
    now?: string
  ): Promise<readonly ResourceRequestLifecycle[]>;

  createSettlement(record: SettlementRecord): Promise<void>;
  createSettlementForAcceptedRequest(record: SettlementRecord): Promise<SettlementRecord | null>;
  listSettlements(userId: string, limit?: number): Promise<readonly SettlementRecord[]>;
  settlementForResourceRequest(userId: string, resourceRequestId: string): Promise<SettlementRecord | null>;
  receiptSettlement(userId: string, resourceRequestId: string): Promise<ReceiptSettlementProjection | null>;
  settlement(userId: string, settlementId: string): Promise<SettlementRecord | null>;
  transitionSettlement(
    userId: string,
    settlementId: string,
    from: SettlementState,
    patch: Pick<SettlementRecord, 'state' | 'updatedAt'> &
      Partial<Pick<SettlementRecord, 'unsignedTransaction' | 'transactionSignature' | 'lastValidBlockHeight' | 'errorCode'>>
  ): Promise<SettlementRecord | null>;
}
