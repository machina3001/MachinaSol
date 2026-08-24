import { fleetSnapshot } from '../data/fleet-snapshot.js';

/**
 * Application boundary for the MachineFi resource economy.
 *
 * `@machinefi/resource-layer` is not installed in this repository. The public
 * package source was audited at revision 1e456ab. It currently supplies record
 * factories, validation, resource-type matching, an in-memory provider
 * registry, and runtime-rail selection primitives. It does not supply remote
 * discovery, quotes, durable requests, access grants, or receipts.
 *
 * This module deliberately mirrors only the audited record vocabulary. Data is
 * injected by an application/backend; the default service is empty and every
 * submit attempt is rejected rather than simulated.
 */

export const RESOURCE_LAYER_AUDITED_REVISION = '1e456ab339976a630785679e2ed1f1f630ad1c75';

/** Exact resource vocabulary returned by resource-layer's listResourceTypes(). */
export const RESOURCE_TYPES = [
  'weather-data',
  'soil-sensor-data',
  'route-map',
  'charging-slot',
  'compute-burst',
  'bandwidth-grant',
  'telemetry-feed',
] as const;

export type ResourceType = (typeof RESOURCE_TYPES)[number];

export function isResourceType(value: unknown): value is ResourceType {
  return typeof value === 'string' && (RESOURCE_TYPES as readonly string[]).includes(value);
}

/** Capability fields implemented by createProviderCapability(). */
export interface ProviderCapabilityRecord {
  id: string;
  providerId: string;
  resourceType: ResourceType;
  label: string;
  unit: string;
  railTags: readonly string[];
  metadata: Readonly<Record<string, unknown>>;
}

/** Runtime-rail fields implemented by createRuntimeRail(). */
export interface RuntimeRailRecord {
  id: string;
  label: string;
  network: string;
  asset: string;
  maxSettlementAmount: number;
}

/**
 * Application-owned quote view. Quote negotiation is not an upstream feature;
 * this can only be populated by an injected backend/provider response.
 */
export interface ResourceQuoteRecord {
  amount: string;
  asset: string;
  unit: string;
  state: 'indicative' | 'quoted';
  source: 'injected-provider';
  expiresAt: string | null;
}

export type ResourceAvailability = 'available' | 'limited' | 'unavailable' | 'unknown';
export type ResourceProviderStatus = 'online' | 'degraded' | 'offline' | 'unknown';

/** Normalized provider/capability view consumed by console pages. */
export interface ResourceOffer {
  /** Stable detail-route id. This is normally the capability id. */
  resourceId: string;
  providerName: string;
  /** Machine identity is application data, not a resource-layer field. */
  providerMachineId: string | null;
  capability: ProviderCapabilityRecord;
  availability: ResourceAvailability;
  providerStatus: ResourceProviderStatus;
  runtimeRails: readonly RuntimeRailRecord[];
  quote: ResourceQuoteRecord | null;
}

export interface ResourceRequestRecord {
  requestId: string;
  requesterMachineId: string;
  resourceId: string | null;
  resourceType: ResourceType;
  providerId: string | null;
  status: 'draft' | 'pending' | 'rejected' | 'fulfilled' | 'unknown';
  quote: ResourceQuoteRecord | null;
  createdAt: string;
  accessGrantState: 'unavailable' | 'none' | 'pending' | 'granted' | 'revoked' | 'unknown';
  receiptState: 'unavailable' | 'none' | 'pending' | 'recorded' | 'unknown';
}

export interface RequesterMachineOption {
  machineId: string;
  label: string;
  runtimeRail: string | null;
}

export interface ResourceMarketplaceCapabilities {
  /** The npm dependency can be imported and called in this application. */
  upstreamPackageInstalled: boolean;
  /** The audited upstream resource-type vocabulary is represented locally. */
  resourceTypeVocabulary: boolean;
  /** Drafts can be validated with the audited request constraints. */
  localDraftValidation: boolean;
  /** Injected capabilities can be matched using upstream's type equality rule. */
  injectedProviderDiscovery: boolean;
  remoteProviderDiscovery: boolean;
  quoteNegotiation: boolean;
  requestSubmission: boolean;
  persistence: boolean;
  ownershipLookup: boolean;
  accessGrants: boolean;
  resourceReceipts: boolean;
}

export const RESOURCE_MARKETPLACE_CAPABILITIES: Readonly<ResourceMarketplaceCapabilities> = Object.freeze({
  upstreamPackageInstalled: false,
  resourceTypeVocabulary: true,
  localDraftValidation: true,
  injectedProviderDiscovery: true,
  remoteProviderDiscovery: false,
  quoteNegotiation: false,
  requestSubmission: false,
  persistence: false,
  ownershipLookup: false,
  accessGrants: false,
  resourceReceipts: false,
});

export type MarketplaceLoadState = 'ready' | 'loading' | 'error' | 'unavailable';

export interface ResourceMarketplaceSnapshot {
  state: MarketplaceLoadState;
  /** Human-readable source state, safe to show in the console. */
  sourceMessage: string;
  errorDetail: string | null;
  availableResources: readonly ResourceOffer[];
  myRequests: readonly ResourceRequestRecord[];
  myProviders: readonly ResourceOffer[];
  requesterMachines: readonly RequesterMachineOption[];
  capabilities: Readonly<ResourceMarketplaceCapabilities>;
}

export interface ResourceMarketplaceData {
  state?: MarketplaceLoadState;
  sourceMessage?: string;
  errorDetail?: string | null;
  availableResources?: readonly ResourceOffer[];
  myRequests?: readonly ResourceRequestRecord[];
  myProviders?: readonly ResourceOffer[];
  requesterMachines?: readonly RequesterMachineOption[];
}

/** Input shape used before an upstream ResourceRequest could be constructed. */
export interface ResourceRequestDraftInput {
  id?: unknown;
  requesterId?: unknown;
  resourceType?: unknown;
  quantity?: unknown;
  maxPrice?: unknown;
  preferredRails?: unknown;
  purpose?: unknown;
  metadata?: unknown;
}

export interface ValidResourceRequestDraft {
  id: string;
  requesterId: string;
  resourceType: ResourceType;
  quantity: number;
  maxPrice: number;
  preferredRails: readonly string[];
  purpose: string;
  metadata: Readonly<Record<string, unknown>>;
}

export type DraftValidationIssueCode =
  | 'REQUIRED'
  | 'REQUESTER_NOT_MANAGED'
  | 'NOT_POSITIVE_NUMBER'
  | 'UNSUPPORTED_RESOURCE_TYPE'
  | 'INVALID_RAILS'
  | 'INVALID_METADATA'
  | 'SELECTION_MISMATCH';

export interface DraftValidationIssue {
  field: keyof ResourceRequestDraftInput;
  code: DraftValidationIssueCode;
  message: string;
}

export type DraftValidationResult =
  | { ok: true; value: ValidResourceRequestDraft; issues: readonly [] }
  | { ok: false; issues: readonly DraftValidationIssue[] };

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const nonBlank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/**
 * Locally validates the exact fields and positive-number constraints used by
 * the audited ResourceRequest factory/validator. No request is persisted.
 */
export function validateResourceRequestDraft(input: ResourceRequestDraftInput): DraftValidationResult {
  const issues: DraftValidationIssue[] = [];

  if (!nonBlank(input.id)) {
    issues.push({ field: 'id', code: 'REQUIRED', message: 'Draft request id is required.' });
  }
  if (!nonBlank(input.requesterId)) {
    issues.push({ field: 'requesterId', code: 'REQUIRED', message: 'Requester machine is required.' });
  }
  if (!nonBlank(input.resourceType)) {
    issues.push({ field: 'resourceType', code: 'REQUIRED', message: 'Resource type is required.' });
  } else if (!isResourceType(input.resourceType)) {
    issues.push({
      field: 'resourceType',
      code: 'UNSUPPORTED_RESOURCE_TYPE',
      message: `Unsupported resource type: ${input.resourceType}.`,
    });
  }
  if (typeof input.quantity !== 'number' || !Number.isFinite(input.quantity) || input.quantity <= 0) {
    issues.push({ field: 'quantity', code: 'NOT_POSITIVE_NUMBER', message: 'Quantity must be a positive number.' });
  }
  if (typeof input.maxPrice !== 'number' || !Number.isFinite(input.maxPrice) || input.maxPrice <= 0) {
    issues.push({ field: 'maxPrice', code: 'NOT_POSITIVE_NUMBER', message: 'Maximum price must be a positive number.' });
  }

  const preferredRails = input.preferredRails ?? [];
  if (!Array.isArray(preferredRails) || preferredRails.some((rail) => !nonBlank(rail))) {
    issues.push({ field: 'preferredRails', code: 'INVALID_RAILS', message: 'Preferred rails must be non-empty strings.' });
  }

  const metadata = input.metadata ?? {};
  if (!isRecord(metadata)) {
    issues.push({ field: 'metadata', code: 'INVALID_METADATA', message: 'Metadata must be an object.' });
  }

  if (issues.length > 0) return { ok: false, issues };

  // Each field was narrowed above; these assertions only bridge independent
  // control-flow checks after the aggregated error collection.
  return {
    ok: true,
    issues: [],
    value: {
      id: (input.id as string).trim(),
      requesterId: (input.requesterId as string).trim(),
      resourceType: input.resourceType as ResourceType,
      quantity: input.quantity as number,
      maxPrice: input.maxPrice as number,
      preferredRails: (preferredRails as unknown[]).map((rail) => (rail as string).trim()),
      purpose: nonBlank(input.purpose) ? input.purpose.trim() : 'resource-access',
      metadata: metadata as Readonly<Record<string, unknown>>,
    },
  };
}

export type ProviderDiscoveryResult =
  | { status: 'matched'; draft: ValidResourceRequestDraft; providers: readonly ResourceOffer[] }
  | { status: 'invalid-request'; issues: readonly DraftValidationIssue[]; providers: readonly [] }
  | { status: 'unsupported-capability'; resourceType: string; providers: readonly [] }
  | { status: 'marketplace-unavailable'; message: string; providers: readonly [] }
  | { status: 'no-matching-providers'; resourceType: ResourceType; providers: readonly [] }
  | { status: 'unavailable-provider'; resourceType: ResourceType; providers: readonly ResourceOffer[] };

export interface RejectedResourceSubmitResult {
  ok: false;
  status: 'rejected';
  code: 'REQUEST_SUBMISSION_UNAVAILABLE';
  message: string;
  validation: DraftValidationResult;
}

export interface ResourceMarketplaceService {
  readonly capabilities: Readonly<ResourceMarketplaceCapabilities>;
  snapshot(): ResourceMarketplaceSnapshot;
  resource(resourceId: string): ResourceOffer | undefined;
  validateDraft(input: ResourceRequestDraftInput): DraftValidationResult;
  discoverProviders(input: ResourceRequestDraftInput): ProviderDiscoveryResult;
  submitRequest(input: ResourceRequestDraftInput): RejectedResourceSubmitResult;
}

const copyOffer = (offer: ResourceOffer): ResourceOffer => ({
  ...offer,
  capability: {
    ...offer.capability,
    railTags: [...offer.capability.railTags],
    metadata: { ...offer.capability.metadata },
  },
  runtimeRails: offer.runtimeRails.map((rail) => ({ ...rail })),
  quote: offer.quote ? { ...offer.quote } : null,
});

/** Creates a read-only service over records supplied by a real application source. */
export function createResourceMarketplaceService(data: ResourceMarketplaceData = {}): ResourceMarketplaceService {
  const availableResources = (data.availableResources ?? []).map(copyOffer);
  const myRequests = (data.myRequests ?? []).map((request) => ({
    ...request,
    quote: request.quote ? { ...request.quote } : null,
  }));
  const myProviders = (data.myProviders ?? []).map(copyOffer);
  const requesterMachines = (data.requesterMachines ?? []).map((machine) => ({ ...machine }));
  const state = data.state ?? 'unavailable';
  const sourceMessage =
    data.sourceMessage ??
    'Provider discovery is unavailable because @machinefi/resource-layer and a marketplace backend are not configured.';
  const errorDetail = data.errorDetail ?? null;

  const snapshot: ResourceMarketplaceSnapshot = Object.freeze({
    state,
    sourceMessage,
    errorDetail,
    availableResources,
    myRequests,
    myProviders,
    requesterMachines,
    capabilities: RESOURCE_MARKETPLACE_CAPABILITIES,
  });

  const validateForService = (input: ResourceRequestDraftInput): DraftValidationResult => {
    const validation = validateResourceRequestDraft(input);
    if (!validation.ok || requesterMachines.length === 0) return validation;
    if (requesterMachines.some((machine) => machine.machineId === validation.value.requesterId)) return validation;
    return {
      ok: false,
      issues: [
        {
          field: 'requesterId',
          code: 'REQUESTER_NOT_MANAGED',
          message: 'Requester machine is not present in the current session scope.',
        },
      ],
    };
  };

  const validateSelectionForSubmission = (input: ResourceRequestDraftInput): DraftValidationResult => {
    const validation = validateForService(input);
    if (!validation.ok || state !== 'ready') return validation;
    const capabilityValue = validation.value.metadata['selectedCapabilityId'];
    const providerValue = validation.value.metadata['selectedProviderId'];
    const capabilityId = nonBlank(capabilityValue) ? capabilityValue.trim() : undefined;
    const providerId = nonBlank(providerValue) ? providerValue.trim() : undefined;
    if (capabilityId === undefined && providerId === undefined) return validation;

    const selectedOffer =
      capabilityId !== undefined && providerId !== undefined
        ? availableResources.find(
            (offer) =>
              offer.capability.id === capabilityId &&
              offer.capability.providerId === providerId &&
              offer.capability.resourceType === validation.value.resourceType &&
              offer.availability !== 'unavailable' &&
              offer.providerStatus !== 'offline'
          )
        : undefined;
    if (selectedOffer) return validation;
    return {
      ok: false,
      issues: [
        {
          field: 'metadata',
          code: 'SELECTION_MISMATCH',
          message: 'Selected capability and provider must identify one available offer for the requested resource type.',
        },
      ],
    };
  };

  return Object.freeze({
    capabilities: RESOURCE_MARKETPLACE_CAPABILITIES,
    snapshot: () => snapshot,
    resource: (resourceId: string) => availableResources.find((offer) => offer.resourceId === resourceId),
    validateDraft: validateForService,
    discoverProviders(input: ResourceRequestDraftInput): ProviderDiscoveryResult {
      const validation = validateForService(input);
      if (!validation.ok) {
        const unsupported = validation.issues.find((issue) => issue.code === 'UNSUPPORTED_RESOURCE_TYPE');
        if (unsupported) {
          return { status: 'unsupported-capability', resourceType: String(input.resourceType ?? ''), providers: [] };
        }
        return { status: 'invalid-request', issues: validation.issues, providers: [] };
      }

      if (state !== 'ready') {
        return { status: 'marketplace-unavailable', message: sourceMessage, providers: [] };
      }

      // This is intentionally the audited upstream matchesCapability semantic:
      // resourceType equality. Rail compatibility is applied afterward by the
      // application because upstream matching does not inspect railTags.
      const typeMatches = availableResources.filter(
        (offer) => offer.capability.resourceType === validation.value.resourceType
      );
      const railMatches =
        validation.value.preferredRails.length === 0
          ? typeMatches
          : typeMatches.filter((offer) =>
              validation.value.preferredRails.some((rail) => offer.capability.railTags.includes(rail))
            );

      if (railMatches.length === 0) {
        return { status: 'no-matching-providers', resourceType: validation.value.resourceType, providers: [] };
      }

      const available = railMatches.filter(
        (offer) => offer.availability !== 'unavailable' && offer.providerStatus !== 'offline'
      );
      if (available.length === 0) {
        return { status: 'unavailable-provider', resourceType: validation.value.resourceType, providers: railMatches };
      }
      return { status: 'matched', draft: validation.value, providers: available };
    },
    submitRequest(input: ResourceRequestDraftInput): RejectedResourceSubmitResult {
      return {
        ok: false,
        status: 'rejected',
        code: 'REQUEST_SUBMISSION_UNAVAILABLE',
        message:
          'Request rejected locally: no resource request submission, persistence, quote, grant, or receipt backend is configured.',
        validation: validateSelectionForSubmission(input),
      };
    },
  });
}

/** Default honest state used until the host application injects a real source. */
export const defaultResourceMarketplaceService = createResourceMarketplaceService();

/** Shared SSR/API composition for the current deterministic console session. */
const consoleSnapshot = fleetSnapshot();
export const consoleResourceMarketplaceService = createResourceMarketplaceService({
  state: 'unavailable',
  sourceMessage:
    'No marketplace backend is configured. Provider discovery, quotes, request history, grants, and receipts are unavailable.',
  requesterMachines: [
    {
      machineId: consoleSnapshot.session.machineId,
      label: consoleSnapshot.session.machineLabel ?? consoleSnapshot.session.machineId,
      runtimeRail: consoleSnapshot.session.chain,
    },
  ],
});
