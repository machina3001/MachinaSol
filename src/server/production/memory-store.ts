import { randomUUID } from 'node:crypto';
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

const copy = <T>(value: T): T => structuredClone(value);

const boundedLimit = (limit = DEFAULT_PRODUCTION_LIST_LIMIT): number =>
  Number.isFinite(limit)
    ? Math.min(MAX_PRODUCTION_LIST_LIMIT, Math.max(1, Math.trunc(limit)))
    : DEFAULT_PRODUCTION_LIST_LIMIT;

const decimalAtMost = (value: string, maximum: string): boolean => {
  const parts = (input: string): { digits: bigint; scale: number } => {
    const [whole = '0', fraction = ''] = input.split('.');
    return { digits: BigInt(`${whole}${fraction}`), scale: fraction.length };
  };
  const left = parts(value);
  const right = parts(maximum);
  const scale = Math.max(left.scale, right.scale);
  return left.digits * 10n ** BigInt(scale - left.scale) <= right.digits * 10n ** BigInt(scale - right.scale);
};

const exactLamports = (unitPrice: string, quantity: string): string | null => {
  const parse = (value: string): { digits: bigint; scale: number } | null => {
    const match = /^(\d+)(?:\.(\d+))?$/u.exec(value);
    if (!match) return null;
    const fraction = match[2] ?? '';
    return { digits: BigInt(`${match[1]}${fraction}`), scale: fraction.length };
  };
  const price = parse(unitPrice);
  const count = parse(quantity);
  if (!price || !count) return null;
  const numerator = price.digits * count.digits * 1_000_000_000n;
  const divisor = 10n ** BigInt(price.scale + count.scale);
  return numerator % divisor === 0n ? (numerator / divisor).toString() : null;
};

/** Test/local composition store. Production startup always selects PostgreSQL. */
export class MemoryProductionStore implements ProductionStore {
  readonly challenges = new Map<string, WalletChallengeRecord>();
  readonly sessions = new Map<string, AuthSessionRecord>();
  readonly walletUsers = new Map<string, string>();
  readonly machines = new Map<string, OwnedMachineRecord>();
  readonly credentials = new Map<string, MachineCredentialRecord>();
  readonly telemetry = new Map<string, TelemetryEventRecord>();
  readonly capabilities = new Map<string, ProviderCapabilityRow>();
  readonly machineCapabilities = new Map<string, PersistentMachineCapability>();
  readonly runtimeSessions = new Map<string, PersistentRuntimeSession>();
  readonly workOrders = new Map<string, PersistentWorkOrder>();
  readonly requests = new Map<string, PersistentResourceRequest>();
  readonly quotes = new Map<string, PersistentResourceQuote>();
  readonly grants = new Map<string, PersistentAccessGrant>();
  readonly resourceReceipts = new Map<string, PersistentResourceReceipt>();
  readonly settlements = new Map<string, SettlementRecord>();

  async migrate(): Promise<void> {}
  async close(): Promise<void> {}

  async createChallenge(record: WalletChallengeRecord, now = new Date().toISOString()): Promise<void> {
    for (const [id, challenge] of this.challenges) {
      if (challenge.expiresAt <= now || challenge.consumedAt !== null) this.challenges.delete(id);
    }
    this.challenges.set(record.id, copy(record));
  }

  async activeChallenge(id: string, walletAddress: string, now: string): Promise<WalletChallengeRecord | null> {
    const found = this.challenges.get(id);
    return found && found.walletAddress === walletAddress && found.consumedAt === null && found.expiresAt > now
      ? copy(found)
      : null;
  }

  async consumeChallenge(id: string, walletAddress: string, now: string): Promise<WalletChallengeRecord | null> {
    const found = this.challenges.get(id);
    if (!found || found.walletAddress !== walletAddress || found.consumedAt !== null || found.expiresAt <= now) return null;
    const consumed = { ...found, consumedAt: now };
    this.challenges.set(id, consumed);
    return copy(consumed);
  }

  async createAuthenticatedSession(input: { session: AuthSessionRecord; walletAddress: string; now: string }): Promise<AuthSessionRecord> {
    const userId = this.walletUsers.get(input.walletAddress) ?? input.session.userId;
    this.walletUsers.set(input.walletAddress, userId);
    // `walletAddress` is the identity that passed challenge verification. Do
    // not trust a second, caller-supplied copy embedded in the proposed row.
    const session = { ...input.session, userId, walletAddress: input.walletAddress };
    this.sessions.set(session.id, copy(session));
    return copy(session);
  }

  async sessionByTokenHash(tokenHash: string, now: string): Promise<AuthSessionRecord | null> {
    const session = [...this.sessions.values()].find((candidate) =>
      candidate.tokenHash === tokenHash && candidate.revokedAt === null && candidate.expiresAt > now
    );
    return session ? copy(session) : null;
  }

  async revokeSession(id: string, now: string): Promise<void> {
    const found = this.sessions.get(id);
    if (found && found.revokedAt === null) this.sessions.set(id, { ...found, revokedAt: now });
  }

  async listOwnedMachines(userId: string, limit?: number): Promise<readonly OwnedMachineRecord[]> {
    return [...this.machines.values()]
      .filter((machine) => machine.ownerUserId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, boundedLimit(limit))
      .map(copy);
  }

  async ownedMachine(userId: string, machineId: string): Promise<OwnedMachineRecord | null> {
    const machine = this.machines.get(machineId);
    return machine?.ownerUserId === userId ? copy(machine) : null;
  }

  async machine(machineId: string): Promise<OwnedMachineRecord | null> {
    const machine = this.machines.get(machineId);
    return machine ? copy(machine) : null;
  }

  async createOwnedMachine(machine: OwnedMachineRecord): Promise<void> {
    if (this.machines.has(machine.machineId)) throw new Error('machine already exists');
    this.machines.set(machine.machineId, copy(machine));
  }

  async createMachineCredential(userId: string, record: MachineCredentialRecord): Promise<boolean> {
    if (this.credentials.has(record.id) || this.machines.get(record.machineId)?.ownerUserId !== userId) return false;
    this.credentials.set(record.id, copy(record));
    return true;
  }

  async listMachineCredentials(userId: string, machineId: string, limit?: number): Promise<readonly MachineCredentialRecord[]> {
    if (this.machines.get(machineId)?.ownerUserId !== userId) return [];
    return [...this.credentials.values()]
      .filter((credential) => credential.machineId === machineId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, boundedLimit(limit))
      .map(copy);
  }

  async machineCredential(id: string, secretHash: string, now: string): Promise<MachineCredentialRecord | null> {
    const credential = this.credentials.get(id);
    if (!credential || credential.secretHash !== secretHash || credential.revokedAt !== null || (credential.expiresAt !== null && credential.expiresAt <= now)) return null;
    return copy(credential);
  }

  async revokeMachineCredential(userId: string, credentialId: string, now: string): Promise<boolean> {
    const credential = this.credentials.get(credentialId);
    const machine = credential ? this.machines.get(credential.machineId) : undefined;
    if (!credential || machine?.ownerUserId !== userId || credential.revokedAt !== null) return false;
    this.credentials.set(credentialId, { ...credential, revokedAt: now });
    return true;
  }

  async insertTelemetry(event: TelemetryEventRecord, retentionBefore: string, maxPerMachine: number): Promise<void> {
    this.telemetry.set(event.id, copy(event));
    for (const [id, candidate] of this.telemetry) if (candidate.receivedAt < retentionBefore) this.telemetry.delete(id);
    const machineEvents = [...this.telemetry.values()]
      .filter((candidate) => candidate.machineId === event.machineId)
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    for (const candidate of machineEvents.slice(maxPerMachine)) this.telemetry.delete(candidate.id);
  }

  async recentTelemetry(userId: string, machineId: string | null, limit: number): Promise<readonly TelemetryEventRecord[]> {
    const owned = new Set([...this.machines.values()].filter((machine) => machine.ownerUserId === userId).map((machine) => machine.machineId));
    return [...this.telemetry.values()]
      .filter((event) => owned.has(event.machineId) && (machineId === null || event.machineId === machineId))
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      .slice(0, boundedLimit(limit))
      .map(copy);
  }

  async latestTelemetry(userId: string, limit?: number): Promise<readonly TelemetryEventRecord[]> {
    const owned = new Set([...this.machines.values()]
      .filter((machine) => machine.ownerUserId === userId)
      .map((machine) => machine.machineId));
    const latest = new Map<string, TelemetryEventRecord>();
    for (const event of this.telemetry.values()) {
      if (!owned.has(event.machineId)) continue;
      const current = latest.get(event.machineId);
      if (!current || event.receivedAt > current.receivedAt ||
        (event.receivedAt === current.receivedAt && event.id > current.id)) latest.set(event.machineId, event);
    }
    return [...latest.values()]
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.id.localeCompare(a.id))
      .slice(0, boundedLimit(limit))
      .map(copy);
  }

  async replaceMachineCapabilities(userId: string, machineId: string, capabilities: readonly PersistentMachineCapability['capability'][], now: string): Promise<readonly PersistentMachineCapability[] | null> {
    if (this.machines.get(machineId)?.ownerUserId !== userId) return null;
    for (const key of this.machineCapabilities.keys()) if (key.startsWith(`${machineId}\0`)) this.machineCapabilities.delete(key);
    const records = [...new Set(capabilities)].map((capability) => ({ machineId, ownerUserId: userId, capability, createdAt: now }));
    for (const record of records) this.machineCapabilities.set(`${machineId}\0${record.capability}`, record);
    return records.map(copy);
  }

  async listMachineCapabilities(userId: string, machineId: string): Promise<readonly PersistentMachineCapability[]> {
    if (this.machines.get(machineId)?.ownerUserId !== userId) return [];
    return [...this.machineCapabilities.values()].filter((record) => record.machineId === machineId).map(copy);
  }

  async createRuntimeSession(record: PersistentRuntimeSession): Promise<boolean> {
    if (
      this.runtimeSessions.has(record.sessionId) ||
      this.machines.get(record.machineId)?.ownerUserId !== record.ownerUserId ||
      [...this.runtimeSessions.values()].some((candidate) => candidate.machineId === record.machineId && candidate.endedAt === null)
    ) return false;
    this.runtimeSessions.set(record.sessionId, copy(record));
    return true;
  }

  async listRuntimeSessions(userId: string, machineId: string | null, limit?: number): Promise<readonly PersistentRuntimeSession[]> {
    return [...this.runtimeSessions.values()]
      .filter((record) => record.ownerUserId === userId && (machineId === null || record.machineId === machineId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, boundedLimit(limit))
      .map(copy);
  }

  async endRuntimeSession(userId: string, sessionId: string, now: string): Promise<PersistentRuntimeSession | null> {
    const record = this.runtimeSessions.get(sessionId);
    if (!record || record.ownerUserId !== userId || record.endedAt !== null) return null;
    const ended = { ...record, endedAt: now, updatedAt: now };
    this.runtimeSessions.set(sessionId, ended);
    return copy(ended);
  }

  async createWorkOrder(record: PersistentWorkOrder): Promise<boolean> {
    if (this.workOrders.has(record.workOrderId)) return false;
    if (record.machineId !== null && this.machines.get(record.machineId)?.ownerUserId !== record.ownerUserId) return false;
    this.workOrders.set(record.workOrderId, copy(record));
    return true;
  }

  async listWorkOrders(userId: string, machineId: string | null, limit?: number): Promise<readonly PersistentWorkOrder[]> {
    return [...this.workOrders.values()]
      .filter((record) => record.ownerUserId === userId && (machineId === null || record.machineId === machineId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, boundedLimit(limit))
      .map(copy);
  }

  async workOrder(userId: string, workOrderId: string): Promise<PersistentWorkOrder | null> {
    const record = this.workOrders.get(workOrderId);
    return record?.ownerUserId === userId ? copy(record) : null;
  }

  async listProviderCapabilities(userId: string | null, limit?: number): Promise<readonly ProviderCapabilityRow[]> {
    return [...this.capabilities.values()]
      .filter((capability) => capability.availability !== 'unavailable' || capability.ownerUserId === userId)
      .sort((a, b) => a.resourceType.localeCompare(b.resourceType) || a.label.localeCompare(b.label))
      .slice(0, boundedLimit(limit))
      .map(copy);
  }

  async findProviderCapabilities(filters: {
    resourceType: ProviderCapabilityRow['resourceType'];
    preferredRails: readonly string[];
    maxPrice: string | null;
    capabilityId: string | null;
  }, limit?: number): Promise<readonly ProviderCapabilityRow[]> {
    return [...this.capabilities.values()]
      .filter((capability) =>
        capability.availability !== 'unavailable' &&
        capability.resourceType === filters.resourceType &&
        (filters.capabilityId === null || capability.id === filters.capabilityId) &&
        (filters.preferredRails.length === 0 || filters.preferredRails.some((rail) => capability.railTags.includes(rail))) &&
        (filters.maxPrice === null || capability.priceAmount === null || decimalAtMost(capability.priceAmount, filters.maxPrice))
      )
      .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
      .slice(0, boundedLimit(limit))
      .map(copy);
  }

  async providerCapability(userId: string | null, capabilityId: string): Promise<ProviderCapabilityRow | null> {
    const capability = this.capabilities.get(capabilityId);
    return capability && (capability.availability !== 'unavailable' || capability.ownerUserId === userId) ? copy(capability) : null;
  }

  async createProviderCapability(userId: string, input: Omit<ProviderCapabilityRow, 'id' | 'ownerUserId' | 'createdAt' | 'updatedAt'>, now: string): Promise<ProviderCapabilityRow | null> {
    const machine = this.machines.get(input.providerMachineId);
    if (machine?.ownerUserId !== userId) return null;
    const duplicate = [...this.capabilities.values()].some((candidate) => candidate.providerMachineId === input.providerMachineId && candidate.resourceType === input.resourceType && candidate.label === input.label);
    if (duplicate) return null;
    const capability: ProviderCapabilityRow = { ...copy(input), id: randomUUID(), ownerUserId: userId, createdAt: now, updatedAt: now };
    this.capabilities.set(capability.id, capability);
    return copy(capability);
  }

  async updateProviderCapability(userId: string, capabilityId: string, patch: ProviderCapabilityPatch): Promise<ProviderCapabilityRow | null> {
    const capability = this.capabilities.get(capabilityId);
    if (!capability || capability.ownerUserId !== userId) return null;
    if ([...this.capabilities.values()].some((candidate) =>
      candidate.id !== capabilityId &&
      candidate.providerMachineId === capability.providerMachineId &&
      candidate.resourceType === capability.resourceType &&
      candidate.label === patch.label
    )) return null;
    const updated: ProviderCapabilityRow = {
      ...capability,
      label: patch.label,
      unit: patch.unit,
      railTags: copy(patch.railTags),
      availability: patch.availability,
      priceAmount: patch.priceAmount,
      priceAsset: patch.priceAsset,
      updatedAt: patch.updatedAt,
    };
    this.capabilities.set(capabilityId, updated);
    return copy(updated);
  }

  async upsertProviderCapability(record: ProviderCapabilityRow): Promise<void> {
    const current = this.capabilities.get(record.id);
    if (current && (current.ownerUserId !== record.ownerUserId || current.providerMachineId !== record.providerMachineId)) return;
    const machine = this.machines.get(record.providerMachineId);
    if (machine?.ownerUserId !== record.ownerUserId) return;
    this.capabilities.set(record.id, copy(record));
  }

  async createResourceRequest(record: PersistentResourceRequest): Promise<void> {
    if (this.requests.has(record.id)) throw new Error('resource request already exists');
    if (this.machines.get(record.requesterMachineId)?.ownerUserId !== record.ownerUserId) throw new Error('requester machine is not owned by request owner');
    if ((record.capabilityId === null) !== (record.providerMachineId === null)) throw new Error('capability and provider must be selected together');
    if (record.capabilityId !== null) {
      const capability = this.capabilities.get(record.capabilityId);
      if (!capability || capability.providerMachineId !== record.providerMachineId || capability.resourceType !== record.resourceType) throw new Error('selected capability does not match provider request');
    }
    this.requests.set(record.id, copy(record));
  }

  async listResourceRequests(userId: string, limit?: number): Promise<readonly PersistentResourceRequest[]> {
    return [...this.requests.values()]
      .filter((request) => request.ownerUserId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, boundedLimit(limit))
      .map(copy);
  }

  async listProviderResourceRequests(userId: string, limit?: number): Promise<readonly PersistentResourceRequest[]> {
    const machineIds = new Set([...this.machines.values()]
      .filter((machine) => machine.ownerUserId === userId)
      .map((machine) => machine.machineId));
    const quotedRequestIds = new Set([...this.quotes.values()]
      .filter((quote) => quote.providerOwnerUserId === userId)
      .map((quote) => quote.resourceRequestId));
    const capabilities = [...this.capabilities.values()].filter((capability) =>
      capability.ownerUserId === userId && capability.availability !== 'unavailable'
    );
    return [...this.requests.values()].filter((request) => {
      if (request.providerMachineId !== null) return machineIds.has(request.providerMachineId);
      if (request.state !== 'pending' && request.state !== 'quoted') return false;
      if (quotedRequestIds.has(request.id)) return true;
      return capabilities.some((capability) =>
        capability.resourceType === request.resourceType &&
        (request.capabilityId === null || request.capabilityId === capability.id) &&
        (request.preferredRails.length === 0 || request.preferredRails.some((rail) => capability.railTags.includes(rail)))
      );
    })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, boundedLimit(limit))
      .map(copy);
  }

  async resourceRequest(userId: string, requestId: string): Promise<PersistentResourceRequest | null> {
    const request = this.requests.get(requestId);
    return request?.ownerUserId === userId ? copy(request) : null;
  }


  async providerResourceRequest(userId: string, requestId: string): Promise<PersistentResourceRequest | null> {
    const request = this.requests.get(requestId);
    if (!request) return null;
    if (request.providerMachineId !== null) {
      return this.machines.get(request.providerMachineId)?.ownerUserId === userId ? copy(request) : null;
    }
    if (request.state !== 'pending' && request.state !== 'quoted') return null;
    if ([...this.quotes.values()].some((quote) =>
      quote.resourceRequestId === request.id && quote.providerOwnerUserId === userId
    )) return copy(request);
    const compatible = [...this.capabilities.values()].some((capability) =>
      capability.ownerUserId === userId && capability.availability !== 'unavailable' &&
      capability.resourceType === request.resourceType &&
      (request.capabilityId === null || request.capabilityId === capability.id) &&
      (request.preferredRails.length === 0 || request.preferredRails.some((rail) => capability.railTags.includes(rail)))
    );
    return compatible ? copy(request) : null;
  }

  async transitionResourceRequest(userId: string, requestId: string, from: readonly ResourceRequestState[], to: ResourceRequestState, providerMachineId: string | null, capabilityId: string | null, now: string): Promise<PersistentResourceRequest | null> {
    const request = this.requests.get(requestId);
    if (!request || request.ownerUserId !== userId || !from.includes(request.state)) return null;
    const updated = { ...request, state: to, providerMachineId: providerMachineId ?? request.providerMachineId, capabilityId: capabilityId ?? request.capabilityId, updatedAt: now };
    this.requests.set(requestId, updated);
    return copy(updated);
  }

  async cancelResourceRequest(userId: string, requestId: string, now: string): Promise<PersistentResourceRequest | null> {
    const request = this.requests.get(requestId);
    if (!request || request.ownerUserId !== userId || !['pending', 'quoted'].includes(request.state)) return null;
    const cancelled: PersistentResourceRequest = { ...request, state: 'cancelled', updatedAt: now };
    this.requests.set(requestId, cancelled);
    for (const [id, quote] of this.quotes) {
      if (quote.resourceRequestId === requestId && quote.state === 'offered') {
        this.quotes.set(id, { ...quote, state: 'declined', updatedAt: now });
      }
    }
    return copy(cancelled);
  }

  async rejectResourceRequest(userId: string, requestId: string, now: string): Promise<PersistentResourceRequest | null> {
    const request = this.requests.get(requestId);
    if (!request || request.providerMachineId === null ||
      this.machines.get(request.providerMachineId)?.ownerUserId !== userId ||
      !['pending', 'quoted'].includes(request.state)) return null;
    const rejected: PersistentResourceRequest = { ...request, state: 'rejected', updatedAt: now };
    this.requests.set(requestId, rejected);
    for (const [id, quote] of this.quotes) {
      if (quote.resourceRequestId === requestId && quote.state === 'offered') {
        this.quotes.set(id, { ...quote, state: 'declined', updatedAt: now });
      }
    }
    return copy(rejected);
  }

  async createResourceQuote(userId: string, input: CreateResourceQuoteInput, now: string): Promise<PersistentResourceQuote | null> {
    const request = this.requests.get(input.resourceRequestId);
    const capability = this.capabilities.get(input.capabilityId);
    const machine = capability ? this.machines.get(capability.providerMachineId) : undefined;
    if (!request || !capability || machine?.ownerUserId !== userId || capability.ownerUserId !== userId ||
      capability.availability === 'unavailable' || capability.resourceType !== request.resourceType ||
      (request.preferredRails.length > 0 && !request.preferredRails.some((rail) => capability.railTags.includes(rail))) ||
      !['pending', 'quoted'].includes(request.state) || Number(input.amount) <= 0 ||
      Number(input.amount) > Number(request.maxPrice) || (input.expiresAt !== null && input.expiresAt <= now)) return null;
    if (request.capabilityId !== null && request.capabilityId !== capability.id) return null;
    for (const [id, quote] of this.quotes) {
      if (quote.resourceRequestId === request.id && quote.providerMachineId === capability.providerMachineId &&
        quote.state === 'offered' && quote.expiresAt !== null && quote.expiresAt <= now) {
        this.quotes.set(id, { ...quote, state: 'expired', updatedAt: now });
      }
    }
    if ([...this.quotes.values()].some((quote) => quote.resourceRequestId === request.id && quote.providerMachineId === capability.providerMachineId && !['declined', 'withdrawn', 'expired'].includes(quote.state))) return null;
    const quote: PersistentResourceQuote = { id: randomUUID(), resourceRequestId: request.id, providerOwnerUserId: userId, providerMachineId: capability.providerMachineId, capabilityId: capability.id, amount: input.amount, asset: input.asset, state: 'offered', expiresAt: input.expiresAt, createdAt: now, updatedAt: now };
    this.quotes.set(quote.id, quote);
    // A quote is an offer, not provider selection. Keep provider/capability and
    // accepted price fields unset until the requester explicitly accepts one.
    this.requests.set(request.id, { ...request, state: 'quoted', updatedAt: now });
    return copy(quote);
  }

  async listResourceQuotes(userId: string, requestId: string, limit?: number, now = new Date().toISOString()): Promise<readonly PersistentResourceQuote[]> {
    const request = this.requests.get(requestId);
    if (!request) return [];
    const requester = request.ownerUserId === userId;
    const provider = [...this.quotes.values()].some((quote) =>
      quote.resourceRequestId === requestId && quote.providerOwnerUserId === userId
    );
    if (!requester && !provider) return [];
    for (const [id, quote] of this.quotes) {
      if (quote.resourceRequestId === requestId && quote.state === 'offered' &&
        quote.expiresAt !== null && quote.expiresAt <= now) {
        this.quotes.set(id, { ...quote, state: 'expired', updatedAt: now });
      }
    }
    if (request.state === 'quoted' && ![...this.quotes.values()].some((quote) =>
      quote.resourceRequestId === requestId && quote.state === 'offered'
    )) this.requests.set(requestId, { ...request, state: 'pending', updatedAt: now });
    return [...this.quotes.values()]
      .filter((quote) => quote.resourceRequestId === requestId && (requester || quote.providerOwnerUserId === userId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, boundedLimit(limit))
      .map(copy);
  }

  async acceptedResourceQuote(userId: string, requestId: string): Promise<PersistentResourceQuote | null> {
    const request = this.requests.get(requestId);
    if (!request || request.ownerUserId !== userId) return null;
    const quote = [...this.quotes.values()].find((candidate) =>
      candidate.resourceRequestId === requestId && candidate.state === 'accepted'
    );
    return quote ? copy(quote) : null;
  }

  async withdrawResourceQuote(userId: string, quoteId: string, now: string): Promise<{ request: PersistentResourceRequest; quote: PersistentResourceQuote } | null> {
    const quote = this.quotes.get(quoteId);
    const request = quote ? this.requests.get(quote.resourceRequestId) : undefined;
    if (!quote || quote.providerOwnerUserId !== userId || quote.state !== 'offered' ||
      !request || !['pending', 'quoted'].includes(request.state)) return null;

    if (quote.expiresAt !== null && quote.expiresAt <= now) {
      this.quotes.set(quoteId, { ...quote, state: 'expired', updatedAt: now });
    } else {
      this.quotes.set(quoteId, { ...quote, state: 'withdrawn', updatedAt: now });
    }
    for (const [id, candidate] of this.quotes) {
      if (candidate.resourceRequestId === request.id && candidate.state === 'offered' &&
        candidate.expiresAt !== null && candidate.expiresAt <= now) {
        this.quotes.set(id, { ...candidate, state: 'expired', updatedAt: now });
      }
    }
    const hasOffer = [...this.quotes.values()].some((candidate) =>
      candidate.resourceRequestId === request.id && candidate.state === 'offered'
    );
    const updatedRequest: PersistentResourceRequest = {
      ...request,
      state: hasOffer ? 'quoted' : 'pending',
      updatedAt: now,
    };
    this.requests.set(request.id, updatedRequest);
    if (quote.expiresAt !== null && quote.expiresAt <= now) return null;
    return { request: copy(updatedRequest), quote: copy(this.quotes.get(quoteId)!) };
  }

  async acceptResourceQuote(userId: string, requestId: string, quoteId: string, now: string): Promise<{ request: PersistentResourceRequest; quote: PersistentResourceQuote } | null> {
    const request = this.requests.get(requestId);
    const quote = this.quotes.get(quoteId);
    if (!request || request.ownerUserId !== userId || !quote || quote.resourceRequestId !== requestId || quote.state !== 'offered' || !['pending', 'quoted'].includes(request.state) || (quote.expiresAt !== null && quote.expiresAt <= now)) return null;
    const accepted = { ...quote, state: 'accepted' as const, updatedAt: now };
    this.quotes.set(quoteId, accepted);
    for (const [id, candidate] of this.quotes) if (candidate.resourceRequestId === requestId && id !== quoteId && candidate.state === 'offered') this.quotes.set(id, { ...candidate, state: 'declined', updatedAt: now });
    const updated = { ...request, capabilityId: quote.capabilityId, providerMachineId: quote.providerMachineId, quoteAmount: quote.amount, quoteAsset: quote.asset, state: 'accepted' as const, updatedAt: now };
    this.requests.set(requestId, updated);
    return { request: copy(updated), quote: copy(accepted) };
  }

  async createAccessGrant(userId: string, input: { resourceRequestId: string; resourceQuoteId: string; accessReference: string | null; expiresAt: string | null }, now: string): Promise<PersistentAccessGrant | null> {
    const request = this.requests.get(input.resourceRequestId);
    const quote = this.quotes.get(input.resourceQuoteId);
    if (!request || !quote || request.state !== 'accepted' || quote.state !== 'accepted' || quote.resourceRequestId !== request.id ||
      quote.providerOwnerUserId !== userId || (input.expiresAt !== null && input.expiresAt <= now) ||
      [...this.grants.values()].some((grant) =>
        grant.resourceRequestId === request.id && (grant.state === 'pending' || grant.state === 'active')
      )) return null;
    const grant: PersistentAccessGrant = { id: randomUUID(), resourceRequestId: request.id, resourceQuoteId: quote.id, providerOwnerUserId: userId, providerMachineId: quote.providerMachineId, requesterOwnerUserId: request.ownerUserId, requesterMachineId: request.requesterMachineId, state: 'pending', accessReference: input.accessReference, expiresAt: input.expiresAt, createdAt: now, updatedAt: now };
    this.grants.set(grant.id, grant);
    return copy(grant);
  }

  async accessGrant(userId: string, requestId: string, now = new Date().toISOString()): Promise<PersistentAccessGrant | null> {
    const grant = [...this.grants.values()]
      .filter((candidate) => candidate.resourceRequestId === requestId &&
        (candidate.providerOwnerUserId === userId || candidate.requesterOwnerUserId === userId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0];
    if (grant && (grant.state === 'pending' || grant.state === 'active') &&
      grant.expiresAt !== null && grant.expiresAt <= now) {
      const expired: PersistentAccessGrant = { ...grant, state: 'expired', updatedAt: now };
      this.grants.set(grant.id, expired);
      const request = this.requests.get(grant.resourceRequestId);
      const hasLiveReceipt = [...this.resourceReceipts.values()].some((receipt) =>
        receipt.resourceRequestId === grant.resourceRequestId && receipt.state !== 'rejected'
      );
      if (request?.state === 'granted' && !hasLiveReceipt) {
        this.requests.set(request.id, { ...request, state: 'accepted', updatedAt: now });
      }
      return copy(expired);
    }
    return grant ? copy(grant) : null;
  }

  async transitionAccessGrant(userId: string, grantId: string, from: AccessGrantState, to: AccessGrantState, now: string): Promise<PersistentAccessGrant | null> {
    const grant = this.grants.get(grantId);
    if (!grant || grant.providerOwnerUserId !== userId || grant.state !== from) return null;
    if (!((from === 'pending' && (to === 'active' || to === 'revoked' || to === 'expired')) ||
      (from === 'active' && (to === 'revoked' || to === 'expired')))) return null;
    if (to === 'active' && grant.expiresAt !== null && grant.expiresAt <= now) {
      this.grants.set(grantId, { ...grant, state: 'expired', updatedAt: now });
      return null;
    }
    const updated = { ...grant, state: to, updatedAt: now };
    this.grants.set(grantId, updated);
    if (to === 'active') {
      const request = this.requests.get(grant.resourceRequestId);
      if (request?.state === 'accepted') this.requests.set(request.id, { ...request, state: 'granted', updatedAt: now });
    } else if (to === 'revoked' || to === 'expired') {
      const request = this.requests.get(grant.resourceRequestId);
      const hasLiveReceipt = [...this.resourceReceipts.values()].some((receipt) =>
        receipt.resourceRequestId === grant.resourceRequestId && receipt.state !== 'rejected'
      );
      if (request?.state === 'granted' && !hasLiveReceipt) {
        this.requests.set(request.id, { ...request, state: 'accepted', updatedAt: now });
      }
    }
    return copy(updated);
  }

  async createResourceReceipt(userId: string, input: { resourceRequestId: string; accessGrantId: string; settlementId: string | null; evidenceReference: string | null; resultReference: string | null }, now: string): Promise<PersistentResourceReceipt | null> {
    const grant = this.grants.get(input.accessGrantId);
    if (!grant || grant.resourceRequestId !== input.resourceRequestId || grant.providerOwnerUserId !== userId || grant.state !== 'active') return null;
    if (grant.expiresAt !== null && grant.expiresAt <= now) {
      this.grants.set(grant.id, { ...grant, state: 'expired', updatedAt: now });
      const request = this.requests.get(grant.resourceRequestId);
      const hasLiveReceipt = [...this.resourceReceipts.values()].some((receipt) =>
        receipt.resourceRequestId === grant.resourceRequestId && receipt.state !== 'rejected'
      );
      if (request?.state === 'granted' && !hasLiveReceipt) {
        this.requests.set(request.id, { ...request, state: 'accepted', updatedAt: now });
      }
      return null;
    }
    if ([...this.resourceReceipts.values()].some((receipt) =>
      receipt.resourceRequestId === input.resourceRequestId && receipt.state !== 'rejected'
    )) return null;
    if (input.settlementId !== null) {
      const settlement = this.settlements.get(input.settlementId);
      if (!settlement || settlement.resourceRequestId !== input.resourceRequestId || settlement.state !== 'confirmed') return null;
    }
    const receipt: PersistentResourceReceipt = { id: randomUUID(), resourceRequestId: input.resourceRequestId, accessGrantId: grant.id, settlementId: input.settlementId, providerOwnerUserId: userId, requesterOwnerUserId: grant.requesterOwnerUserId, state: 'recorded', evidenceReference: input.evidenceReference, resultReference: input.resultReference, createdAt: now, updatedAt: now };
    this.resourceReceipts.set(receipt.id, receipt);
    return copy(receipt);
  }

  async resourceReceipt(userId: string, requestId: string): Promise<PersistentResourceReceipt | null> {
    const receipt = [...this.resourceReceipts.values()]
      .filter((candidate) => candidate.resourceRequestId === requestId &&
        (candidate.providerOwnerUserId === userId || candidate.requesterOwnerUserId === userId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0];
    return receipt ? copy(receipt) : null;
  }

  async transitionResourceReceipt(userId: string, receiptId: string, from: ResourceReceiptState, to: Extract<ResourceReceiptState, 'verified' | 'rejected'>, now: string): Promise<PersistentResourceReceipt | null> {
    const receipt = this.resourceReceipts.get(receiptId);
    if (!receipt || receipt.requesterOwnerUserId !== userId || receipt.state !== from || from !== 'recorded') return null;
    const updated = { ...receipt, state: to, updatedAt: now };
    this.resourceReceipts.set(receiptId, updated);
    if (to === 'verified') {
      const request = this.requests.get(receipt.resourceRequestId);
      if (request && (request.state === 'granted' || request.state === 'accepted')) {
        this.requests.set(request.id, { ...request, state: 'fulfilled', updatedAt: now });
      }
    }
    return copy(updated);
  }

  async resourceRequestLifecycles(userId: string, requestIds: readonly string[], now = new Date().toISOString()): Promise<readonly ResourceRequestLifecycle[]> {
    const ids = [...new Set(requestIds)].slice(0, MAX_PRODUCTION_LIST_LIMIT);
    const lifecycles: ResourceRequestLifecycle[] = [];
    for (const resourceRequestId of ids) {
      const authorized = await this.resourceRequest(userId, resourceRequestId) ??
        await this.providerResourceRequest(userId, resourceRequestId);
      if (!authorized) continue;
      const [quotes, grant, receipt, receiptSettlement] = await Promise.all([
        this.listResourceQuotes(userId, resourceRequestId, MAX_PRODUCTION_LIST_LIMIT, now),
        this.accessGrant(userId, resourceRequestId, now),
        this.resourceReceipt(userId, resourceRequestId),
        this.receiptSettlement(userId, resourceRequestId),
      ]);
      lifecycles.push({ resourceRequestId, quotes, grant, receipt, receiptSettlement });
    }
    return lifecycles.map(copy);
  }

  async createSettlement(record: SettlementRecord): Promise<void> {
    const created = await this.createSettlementForAcceptedRequest(record);
    if (!created) throw new Error('settlement requires a unique accepted resource request and quote');
  }

  async createSettlementForAcceptedRequest(record: SettlementRecord): Promise<SettlementRecord | null> {
    if (record.state !== 'created' || record.unsignedTransaction !== null || record.transactionSignature !== null || record.lastValidBlockHeight !== null || record.errorCode !== null) return null;
    const request = this.requests.get(record.resourceRequestId);
    const quote = this.quotes.get(record.resourceQuoteId);
    const requester = request ? this.machines.get(request.requesterMachineId) : undefined;
    const provider = quote ? this.machines.get(quote.providerMachineId) : undefined;
    if (!request || request.ownerUserId !== record.ownerUserId || !['accepted', 'granted'].includes(request.state) ||
      !quote || quote.resourceRequestId !== request.id || quote.state !== 'accepted' || quote.asset !== 'SOL' ||
      requester?.machineId !== record.machineId || provider?.walletAddress !== record.recipientWallet ||
      this.walletUsers.get(record.sourceWallet) !== record.ownerUserId ||
      exactLamports(quote.amount, request.quantity) !== record.amountLamports ||
      [...this.settlements.values()].some((settlement) => settlement.resourceRequestId === request.id)) return null;
    this.settlements.set(record.id, copy(record));
    return copy(record);
  }

  async listSettlements(userId: string, limit?: number): Promise<readonly SettlementRecord[]> {
    return [...this.settlements.values()]
      .filter((settlement) => settlement.ownerUserId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, boundedLimit(limit))
      .map(copy);
  }

  async settlementForResourceRequest(userId: string, resourceRequestId: string): Promise<SettlementRecord | null> {
    const settlement = [...this.settlements.values()].find((candidate) =>
      candidate.ownerUserId === userId && candidate.resourceRequestId === resourceRequestId
    );
    return settlement ? copy(settlement) : null;
  }

  async receiptSettlement(userId: string, resourceRequestId: string): Promise<ReceiptSettlementProjection | null> {
    const receipt = [...this.resourceReceipts.values()]
      .filter((candidate) => candidate.resourceRequestId === resourceRequestId &&
        (candidate.providerOwnerUserId === userId || candidate.requesterOwnerUserId === userId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0];
    const settlement = receipt?.settlementId ? this.settlements.get(receipt.settlementId) : undefined;
    if (settlement?.resourceRequestId !== resourceRequestId || settlement.state !== 'confirmed') return null;
    return copy({
      id: settlement.id,
      resourceRequestId: settlement.resourceRequestId,
      state: settlement.state,
      transactionSignature: settlement.transactionSignature,
      updatedAt: settlement.updatedAt,
    });
  }

  async settlement(userId: string, settlementId: string): Promise<SettlementRecord | null> {
    const settlement = this.settlements.get(settlementId);
    return settlement?.ownerUserId === userId ? copy(settlement) : null;
  }

  async transitionSettlement(userId: string, settlementId: string, from: SettlementState, patch: Pick<SettlementRecord, 'state' | 'updatedAt'> & Partial<Pick<SettlementRecord, 'unsignedTransaction' | 'transactionSignature' | 'lastValidBlockHeight' | 'errorCode'>>): Promise<SettlementRecord | null> {
    const settlement = this.settlements.get(settlementId);
    if (!settlement || settlement.ownerUserId !== userId || settlement.state !== from) return null;
    if (patch.transactionSignature !== undefined && patch.transactionSignature !== null &&
      [...this.settlements.values()].some((candidate) =>
        candidate.id !== settlementId && candidate.transactionSignature === patch.transactionSignature
      )) return null;
    const updated = { ...settlement, ...patch };
    this.settlements.set(settlementId, updated);
    return copy(updated);
  }
}
