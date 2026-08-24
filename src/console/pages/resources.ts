import {
  Amount,
  Chips,
  CommandButton,
  CountBadge,
  DataCard,
  DataTable,
  Drawer,
  EmptyState,
  ErrorState,
  Field,
  type Html,
  KeyValueList,
  LoadingState,
  MachineBadge,
  OverlayActions,
  Split,
  Stack,
  StageRail,
  StatCard,
  StatGrid,
  StatusBadge,
  Tabs,
  TextInput,
  attrs,
  html,
  join,
} from '../ui/index.js';
import {
  RESOURCE_LAYER_AUDITED_REVISION,
  RESOURCE_TYPES,
  consoleResourceMarketplaceService,
  type ResourceMarketplaceService,
  type ResourceOffer,
  type ResourceRequestRecord,
} from '../services/resources.js';

/**
 * Resource marketplace pages.
 *
 * These pages consume only the normalized application service. They never
 * import the optional upstream package and never infer successful marketplace
 * operations from demo console records.
 */

/**
 * Honest default for this repository: one real current-session requester is
 * selectable, while provider/request sources remain unavailable and empty.
 */
export const consoleResourceMarketplace = consoleResourceMarketplaceService;

export interface ResourcesPageOptions {
  service?: ResourceMarketplaceService | undefined;
  activeView?: 'available' | 'requests' | 'providers' | undefined;
}

const dash = (): Html => html`<span class="mc-dim">—</span>`;

const quoteView = (offer: ResourceOffer): Html =>
  offer.quote
    ? html`${Amount({ value: offer.quote.amount, asset: offer.quote.asset })}
        <span class="mc-dim mc-fs-11">/${offer.quote.unit}</span>`
    : html`<span class="mc-dim" title="Quote negotiation is not available">not supplied</span>`;

const railView = (offer: ResourceOffer): Html =>
  offer.runtimeRails.length > 0
    ? Chips({ items: offer.runtimeRails.map((rail) => `${rail.id} · ${rail.network}`) })
    : html`<span class="mc-dim">not supplied</span>`;

const providerStatus = (offer: ResourceOffer): Html =>
  StatusBadge({
    label: offer.providerStatus,
    tone:
      offer.providerStatus === 'online'
        ? 'online'
        : offer.providerStatus === 'offline'
          ? 'offline'
          : offer.providerStatus === 'degraded'
            ? 'degraded'
            : 'neutral',
    dot: offer.providerStatus === 'offline' || offer.providerStatus === 'unknown' ? 'ring' : 'solid',
    size: 'sm',
  });

function availableResourcesView(service: ResourceMarketplaceService): Html {
  const snapshot = service.snapshot();
  if (snapshot.state === 'loading') {
    return DataCard({ flush: true, children: LoadingState({ label: 'Loading provider capabilities' }) });
  }
  if (snapshot.state === 'error') {
    return DataCard({
      flush: true,
      children: ErrorState({
        title: 'Provider discovery failed',
        description: snapshot.sourceMessage,
        ...(snapshot.errorDetail ? { detail: snapshot.errorDetail } : {}),
        actions: CommandButton({ label: 'Retry', size: 'sm', icon: 'refresh', action: 'reload' }),
      }),
    });
  }

  const columns = [
    {
      key: 'type',
      header: 'Resource type',
      mono: true,
      cell: (offer: ResourceOffer) =>
        html`<a class="mc-machine-link" href="/console/resources/${encodeURIComponent(offer.resourceId)}"
          >${offer.capability.resourceType}</a
        >`,
    },
    {
      key: 'provider',
      header: 'Provider',
      cell: (offer: ResourceOffer) =>
        MachineBadge({ name: offer.providerName, machineId: offer.capability.providerId, icon: 'resource' }),
    },
    {
      key: 'machine',
      header: 'Provider machine',
      mono: true,
      cell: (offer: ResourceOffer) => offer.providerMachineId ?? dash(),
    },
    { key: 'capability', header: 'Capability', cell: (offer: ResourceOffer) => offer.capability.label },
    {
      key: 'availability',
      header: 'Availability',
      cell: (offer: ResourceOffer) => StatusBadge({ label: offer.availability, size: 'sm' }),
    },
    { key: 'quote', header: 'Price / quote', align: 'num' as const, cell: quoteView },
    { key: 'rail', header: 'Runtime rail / network', cell: railView },
    { key: 'status', header: 'Provider status', cell: providerStatus },
    {
      key: 'action',
      header: 'Action',
      tight: true,
      cell: (offer: ResourceOffer) =>
        join(
          [
            CommandButton({
              label: 'Detail',
              size: 'sm',
              variant: 'quiet',
              href: `/console/resources/${encodeURIComponent(offer.resourceId)}`,
              iconAfter: 'chevron-right',
            }),
            CommandButton({
              label: 'Request',
              size: 'sm',
              variant: 'primary',
              action: 'open-resource-request',
              target: offer.resourceId,
              disabled: offer.availability === 'unavailable' || offer.providerStatus === 'offline',
            }),
          ],
          ' '
        ),
    },
  ];

  return DataTable({
    columns,
    rows: [...snapshot.availableResources],
    rowKey: (offer) => offer.resourceId,
    caption:
      'Available resources with provider, capability, availability, quote, runtime rail, provider status, and action',
    compact: true,
    totalCount: snapshot.availableResources.length,
    empty: EmptyState({
      title: snapshot.state === 'unavailable' ? 'Provider discovery unavailable' : 'No resources available',
      description:
        snapshot.state === 'unavailable'
          ? snapshot.sourceMessage
          : 'The connected marketplace source returned no provider capabilities.',
      icon: 'resource',
      actions: CommandButton({
        label: 'Open request draft',
        variant: 'primary',
        size: 'sm',
        action: 'open-resource-request',
      }),
    }),
  });
}

function requestsView(service: ResourceMarketplaceService): Html {
  const snapshot = service.snapshot();
  if (snapshot.state === 'loading') {
    return DataCard({ flush: true, children: LoadingState({ label: 'Loading resource request history' }) });
  }
  if (snapshot.state === 'error') {
    return DataCard({
      flush: true,
      children: ErrorState({
        title: 'Resource request history failed',
        description: snapshot.sourceMessage,
        ...(snapshot.errorDetail ? { detail: snapshot.errorDetail } : {}),
        actions: CommandButton({ label: 'Retry', size: 'sm', icon: 'refresh', action: 'reload' }),
      }),
    });
  }
  const columns = [
    { key: 'id', header: 'Request ID', mono: true, cell: (request: ResourceRequestRecord) => request.requestId },
    {
      key: 'requester',
      header: 'Requesting machine',
      mono: true,
      cell: (request: ResourceRequestRecord) => request.requesterMachineId,
    },
    { key: 'type', header: 'Resource type', mono: true, cell: (request: ResourceRequestRecord) => request.resourceType },
    {
      key: 'provider',
      header: 'Provider',
      mono: true,
      cell: (request: ResourceRequestRecord) => request.providerId ?? dash(),
    },
    { key: 'status', header: 'Status', cell: (request: ResourceRequestRecord) => StatusBadge({ label: request.status }) },
    {
      key: 'quote',
      header: 'Quote',
      align: 'num' as const,
      cell: (request: ResourceRequestRecord) =>
        request.quote ? Amount({ value: request.quote.amount, asset: request.quote.asset }) : dash(),
    },
    { key: 'created', header: 'Created', mono: true, cell: (request: ResourceRequestRecord) => request.createdAt },
    {
      key: 'grant',
      header: 'Access grant',
      cell: (request: ResourceRequestRecord) => StatusBadge({ label: request.accessGrantState, size: 'sm' }),
    },
    {
      key: 'receipt',
      header: 'Receipt',
      cell: (request: ResourceRequestRecord) => StatusBadge({ label: request.receiptState, size: 'sm' }),
    },
  ];

  return DataTable({
    columns,
    rows: [...snapshot.myRequests],
    rowKey: (request) => request.requestId,
    caption: 'Resource requests for managed machines with grant and receipt states',
    compact: true,
    totalCount: snapshot.myRequests.length,
    empty: EmptyState({
      title: 'No resource requests',
      description: service.capabilities.persistence
        ? 'No requests have been created by the current managed machines.'
        : 'Request history is empty because no authenticated ownership or persistence backend is configured.',
      icon: 'inbox',
      actions: CommandButton({
        label: 'Create request draft',
        variant: 'primary',
        size: 'sm',
        action: 'open-resource-request',
      }),
    }),
  });
}

function providersView(service: ResourceMarketplaceService): Html {
  const snapshot = service.snapshot();
  if (snapshot.state === 'loading') {
    return DataCard({ flush: true, children: LoadingState({ label: 'Loading managed provider capabilities' }) });
  }
  if (snapshot.state === 'error') {
    return DataCard({
      flush: true,
      children: ErrorState({
        title: 'Managed provider source failed',
        description: snapshot.sourceMessage,
        ...(snapshot.errorDetail ? { detail: snapshot.errorDetail } : {}),
        actions: CommandButton({ label: 'Retry', size: 'sm', icon: 'refresh', action: 'reload' }),
      }),
    });
  }
  const columns = [
    {
      key: 'provider',
      header: 'Provider',
      cell: (offer: ResourceOffer) =>
        MachineBadge({ name: offer.providerName, machineId: offer.capability.providerId, icon: 'resource' }),
    },
    {
      key: 'machine',
      header: 'Machine',
      mono: true,
      cell: (offer: ResourceOffer) => offer.providerMachineId ?? dash(),
    },
    {
      key: 'capabilities',
      header: 'Capabilities',
      cell: (offer: ResourceOffer) => Chips({ items: [offer.capability.resourceType, offer.capability.label] }),
    },
    { key: 'rail', header: 'Runtime rail', cell: railView },
    {
      key: 'availability',
      header: 'Availability',
      cell: (offer: ResourceOffer) => StatusBadge({ label: offer.availability, size: 'sm' }),
    },
    { key: 'pricing', header: 'Pricing', align: 'num' as const, cell: quoteView },
    { key: 'status', header: 'Status', cell: providerStatus },
  ];

  return DataTable({
    columns,
    rows: [...snapshot.myProviders],
    rowKey: (offer) => offer.resourceId,
    caption: 'Provider capabilities managed by the current identity',
    compact: true,
    totalCount: snapshot.myProviders.length,
    empty: EmptyState({
      title: 'No managed providers',
      description: service.capabilities.ownershipLookup
        ? 'The current identity does not advertise resource capabilities.'
        : 'Provider ownership cannot be established without authentication and an ownership data source.',
      icon: 'resource',
    }),
  });
}

const flowSteps = [
  'Requester',
  'Resource',
  'Requirements',
  'Discovery',
  'Compare',
  'Provider',
  'Review',
  'Submit',
] as const;

function selectControl(
  id: string,
  name: string,
  options: readonly {
    value: string;
    label: string;
    resourceId?: string | undefined;
    resourceType?: string | undefined;
    quoteLabel?: string | undefined;
  }[],
  selected?: string
): Html {
  return html`<select${attrs({
    class: 'mc-input mc-input--mono',
    id,
    name,
    'data-resource-flow-input': name,
    disabled: options.length === 0 ? true : undefined,
  })}>
    ${options.length === 0
      ? html`<option value="">Unavailable</option>`
      : join(
          options.map(
            (option) => html`<option${attrs({
              value: option.value,
              selected: option.value === selected ? true : undefined,
              'data-resource-id': option.resourceId,
              'data-resource-type': option.resourceType,
              'data-resource-quote': option.quoteLabel,
            })}
              >${option.label}</option
            >`
          )
        )}
  </select>`;
}

function flowPanel(step: number, title: string, description: string, children: Html): Html {
  return html`<section${attrs({
    id: `mc-resource-request-step-${step}`,
    'data-resource-request-step': step,
    'data-resource-step-label': title,
    hidden: step === 1 ? undefined : true,
  })}>
    <div class="mc-col mc-gap-11">
      <div>
        <p class="mc-label mc-flush">Step ${step} of 8</p>
        <h3 class="mc-card__title mc-mt-4">${title}</h3>
        <p class="mc-muted mc-fs-12 mc-flush mc-mt-4">${description}</p>
      </div>
      ${children}
    </div>
  </section>`;
}

/** Eight-stage request drawer. Client behavior targets its stable ids/data attributes. */
export function resourceRequestDrawer(
  preselectedResourceId?: string,
  service: ResourceMarketplaceService = consoleResourceMarketplace
): Html {
  const snapshot = service.snapshot();
  const selectedOffer = preselectedResourceId ? service.resource(preselectedResourceId) : undefined;
  const selectedType = selectedOffer?.capability.resourceType ?? RESOURCE_TYPES[0];
  const requester = snapshot.requesterMachines[0];
  const railOptions = Array.from(
    new Set(snapshot.availableResources.flatMap((offer) => offer.runtimeRails.map((rail) => rail.id)))
  ).map((rail) => ({ value: rail, label: rail }));
  const providerOptions = snapshot.availableResources
    .filter((offer) => offer.availability !== 'unavailable' && offer.providerStatus !== 'offline')
    .map((offer) => ({
      value: offer.capability.providerId,
      label: `${offer.providerName} · ${offer.capability.label}`,
      resourceId: offer.resourceId,
      resourceType: offer.capability.resourceType,
      quoteLabel: offer.quote ? `${offer.quote.amount} ${offer.quote.asset} / ${offer.quote.unit}` : 'not supplied',
    }));
  const rejection = service.submitRequest({});

  const panels = join([
    flowPanel(
      1,
      'Select requester machine',
      'Only machines in the current session snapshot can be selected. This local session is not authenticated.',
      Field({
        inputId: 'mc-resource-requester',
        label: 'Requester machine',
        hint: requester ? `Runtime rail: ${requester.runtimeRail ?? 'not supplied'}` : 'No requester identity is available.',
        children: selectControl(
          'mc-resource-requester',
          'requesterId',
          snapshot.requesterMachines.map((machine) => ({ value: machine.machineId, label: `${machine.label} · ${machine.machineId}` })),
          requester?.machineId
        ),
      })
    ),
    flowPanel(
      2,
      'Select resource and capability',
      'Resource types are restricted to the vocabulary implemented by the audited resource-layer source.',
      html`<div class="mc-split">
        ${Field({
          inputId: 'mc-resource-type',
          label: 'Resource type',
          children: selectControl(
            'mc-resource-type',
            'resourceType',
            RESOURCE_TYPES.map((resourceType) => ({ value: resourceType, label: resourceType })),
            selectedType
          ),
        })}
        ${Field({
          inputId: 'mc-resource-capability',
          label: 'Capability',
          hint: selectedOffer ? `Unit: ${selectedOffer.capability.unit}` : 'Capabilities require an injected provider source.',
          children: selectControl(
            'mc-resource-capability',
            'capabilityId',
            snapshot.availableResources.map((offer) => ({
              value: offer.capability.id,
              label: offer.capability.label,
              resourceId: offer.resourceId,
              resourceType: offer.capability.resourceType,
            })),
            selectedOffer?.capability.id
          ),
        })}
      </div>`
    ),
    flowPanel(
      3,
      'Define requirements',
      'These fields map to the audited ResourceRequest record. They remain a local draft.',
      html`<div class="mc-col mc-gap-11">
        ${Field({
          inputId: 'mc-resource-draft-id',
          label: 'Draft request id',
          hint: 'Local identifier only; it is not a persisted request.',
          children: TextInput({ inputId: 'mc-resource-draft-id', name: 'id', value: 'draft-resource-request' }),
        })}
        <div class="mc-split">
          ${Field({
            inputId: 'mc-resource-quantity',
            label: 'Quantity',
            hint: 'Must be a positive number.',
            children: TextInput({ inputId: 'mc-resource-quantity', name: 'quantity', value: '1', inputmode: 'decimal' }),
          })}
          ${Field({
            inputId: 'mc-resource-max-price',
            label: 'Maximum price',
            hint: 'Positive numeric ceiling; asset comes from a selected rail/quote.',
            children: TextInput({ inputId: 'mc-resource-max-price', name: 'maxPrice', value: '1', inputmode: 'decimal' }),
          })}
        </div>
        <div class="mc-split">
          ${Field({
            inputId: 'mc-resource-purpose',
            label: 'Purpose',
            children: TextInput({ inputId: 'mc-resource-purpose', name: 'purpose', value: 'resource-access' }),
          })}
          ${Field({
            inputId: 'mc-resource-preferred-rail',
            label: 'Preferred runtime rail',
            hint: railOptions.length ? 'Applied after resource-type matching.' : 'No runtime rails were supplied.',
            children: selectControl('mc-resource-preferred-rail', 'preferredRail', railOptions),
          })}
        </div>
      </div>`
    ),
    flowPanel(
      4,
      'Discover compatible providers',
      'Discovery matches the request resource type, then applies application-level rail compatibility.',
      snapshot.state === 'loading'
        ? LoadingState({ label: 'Loading provider capabilities' })
        : snapshot.state === 'error'
          ? ErrorState({
              title: 'Provider discovery failed',
              description: snapshot.sourceMessage,
              ...(snapshot.errorDetail ? { detail: snapshot.errorDetail } : {}),
              inline: true,
            })
        : snapshot.availableResources.length === 0
        ? EmptyState({
            title: snapshot.state === 'unavailable' ? 'Provider discovery unavailable' : 'No matching providers',
            description: snapshot.sourceMessage,
            icon: 'resource',
            inline: true,
          })
        : DataCard({
            title: 'Injected provider registry',
            icon: 'resource',
            children: KeyValueList({
              rows: [
                { key: 'Capabilities', value: String(snapshot.availableResources.length), mono: true },
                { key: 'Match rule', value: 'resourceType equality', mono: true },
                { key: 'Remote discovery', value: 'unavailable', mono: true },
              ],
            }),
          })
    ),
    flowPanel(
      5,
      'Compare providers and quotes',
      'Only quotes returned by an injected provider/backend are shown.',
      snapshot.state === 'loading'
        ? LoadingState({ label: 'Loading provider quotes' })
        : snapshot.state === 'error'
          ? ErrorState({
              title: 'Provider quote source failed',
              description: snapshot.sourceMessage,
              ...(snapshot.errorDetail ? { detail: snapshot.errorDetail } : {}),
              inline: true,
            })
        : snapshot.availableResources.length === 0
        ? EmptyState({
            title: 'No provider quotes',
            description: 'Quote negotiation is not implemented by the audited package and no provider source is connected.',
            icon: 'settlement',
            inline: true,
          })
        : availableResourcesView(service)
    ),
    flowPanel(
      6,
      'Select provider',
      'Unavailable and offline providers cannot be selected for submission.',
      snapshot.state === 'loading'
        ? LoadingState({ label: 'Loading selectable providers' })
        : snapshot.state === 'error'
          ? ErrorState({
              title: 'Provider selection unavailable',
              description: snapshot.sourceMessage,
              ...(snapshot.errorDetail ? { detail: snapshot.errorDetail } : {}),
              inline: true,
            })
        : Field({
        inputId: 'mc-resource-provider',
        label: 'Provider capability',
        hint: providerOptions.length ? 'Selection remains part of this local draft.' : 'No compatible provider is available.',
        children: selectControl(
          'mc-resource-provider',
          'providerId',
          providerOptions,
          selectedOffer?.capability.providerId
        ),
          })
    ),
    flowPanel(
      7,
      'Review request',
      'Review the normalized draft. No transaction, grant, or receipt is created at this stage.',
      DataCard({
        title: 'Local request draft',
        icon: 'audit',
        children: KeyValueList({
          rows: [
            { key: 'Requester', value: html`<span id="mc-resource-review-requester">${requester?.machineId ?? 'unavailable'}</span>`, mono: true },
            { key: 'Resource type', value: html`<span id="mc-resource-review-type">${selectedType}</span>`, mono: true },
            { key: 'Capability', value: html`<span id="mc-resource-review-capability">${selectedOffer?.capability.label ?? 'unavailable'}</span>` },
            { key: 'Provider', value: html`<span id="mc-resource-review-provider">${selectedOffer?.providerName ?? 'unavailable'}</span>` },
            { key: 'Quote', value: html`<span id="mc-resource-review-quote">${selectedOffer ? quoteView(selectedOffer) : 'not supplied'}</span>` },
            { key: 'Persistence', value: StatusBadge({ label: 'unavailable', tone: 'offline', dot: 'ring', size: 'sm' }) },
          ],
        }),
      })
    ),
    flowPanel(
      8,
      'Submit request',
      'Submission is fail-closed until a genuine request backend is connected.',
      ErrorState({
        title: 'Submission unavailable',
        description: rejection.message,
        detail: rejection.code,
        inline: true,
      })
    ),
  ]);

  return Drawer({
    id: 'mc-resource-request-drawer',
    title: 'Request resource',
    description: 'Build and validate a resource request without simulating execution.',
    wide: true,
    children: html`<form
        id="mc-resource-request-form"
        class="mc-col mc-gap-14"
        data-resource-request-flow="true"
        data-resource-current-step="1"
        data-resource-total-steps="8"
        novalidate
      >
        <div id="mc-resource-request-progress" data-resource-flow-progress="true">
          ${StageRail({
            stages: flowSteps,
            currentIndex: 0,
            label: 'Step 1 of 8: Select requester machine',
          })}
        </div>
        <div id="mc-resource-request-status" class="mc-dim mc-fs-11" role="status" aria-live="polite">
          Local draft · no submission backend
        </div>
        <div id="mc-resource-request-panels">${panels}</div>
        <div id="mc-resource-request-result" aria-live="polite"></div>
      </form>
      <div id="mc-resource-state-templates" hidden aria-hidden="true">
        <template id="mc-resource-state-loading">${LoadingState({ label: 'Discovering compatible providers', inline: true })}</template>
        <template id="mc-resource-state-error">${ErrorState({
          title: 'Provider discovery failed',
          description: 'The provider source returned an error.',
          detail: 'PROVIDER_DISCOVERY_FAILED',
          inline: true,
        })}</template>
        <template id="mc-resource-state-marketplace-unavailable">${ErrorState({
          title: 'Provider discovery unavailable',
          description: snapshot.sourceMessage,
          detail: 'MARKETPLACE_BACKEND_UNAVAILABLE',
          inline: true,
        })}</template>
        <template id="mc-resource-state-provider-unavailable">${ErrorState({
          title: 'Provider unavailable',
          description: 'Matching capabilities exist, but every provider is unavailable or offline.',
          detail: 'UNAVAILABLE_PROVIDER',
          inline: true,
        })}</template>
        <template id="mc-resource-state-unsupported">${ErrorState({
          title: 'Unsupported capability',
          description: 'The requested resource type is outside the audited resource-layer vocabulary.',
          detail: 'UNSUPPORTED_RESOURCE_TYPE',
          inline: true,
        })}</template>
        <template id="mc-resource-state-no-matches">${EmptyState({
          title: 'No matching providers',
          description: 'No injected capability matches the requested resource type and runtime rail.',
          icon: 'resource',
          inline: true,
        })}</template>
        <template id="mc-resource-state-rejected">${ErrorState({
          title: 'Request rejected',
          description: rejection.message,
          detail: rejection.code,
          inline: true,
        })}</template>
      </div>`,
    footer: html`<span class="mc-dim mc-fs-11">No wallet signature or transaction is requested</span>
      ${OverlayActions({
        children: join(
          [
            CommandButton({
              label: 'Back',
              size: 'sm',
              variant: 'quiet',
              action: 'resource-flow-prev',
              target: 'mc-resource-request-form',
              disabled: true,
              testId: 'resource-flow-prev',
            }),
            html`<span id="mc-resource-flow-next-wrap">${CommandButton({
              label: 'Continue',
              size: 'sm',
              variant: 'primary',
              iconAfter: 'chevron-right',
              action: 'resource-flow-next',
              target: 'mc-resource-request-form',
              testId: 'resource-flow-next',
            })}</span>`,
            html`<span id="mc-resource-flow-submit-wrap" hidden>${CommandButton({
              label: 'Submit request',
              size: 'sm',
              variant: 'primary',
              icon: 'play',
              action: 'resource-flow-submit',
              target: 'mc-resource-request-form',
              testId: 'resource-flow-submit',
            })}</span>`,
          ],
          ' '
        ),
      })}`,
  });
}

/** Main /console/resources page body. */
export function resourcesSection(options: ResourcesPageOptions = {}): Html {
  const service = options.service ?? consoleResourceMarketplace;
  const snapshot = service.snapshot();
  const active = options.activeView ?? 'available';
  const availableTypes = new Set(snapshot.availableResources.map((offer) => offer.capability.resourceType)).size;

  return Stack({
    children: join([
      StatGrid({
        children: join([
          StatCard({ label: 'Available resources', value: snapshot.availableResources.length, icon: 'resource' }),
          StatCard({ label: 'Resource types', value: availableTypes, unit: `/ ${RESOURCE_TYPES.length}`, icon: 'overview' }),
          StatCard({ label: 'My requests', value: snapshot.myRequests.length, icon: 'inbox' }),
          StatCard({
            label: 'Marketplace source',
            value: snapshot.state,
            icon: snapshot.state === 'ready' ? 'check' : 'alert',
            tone: snapshot.state === 'ready' ? 'default' : 'alert',
            hint: service.capabilities.requestSubmission ? 'submission enabled' : 'read/draft only',
          }),
        ]),
      }),
      Tabs({
        active: `resource-${active}`,
        ariaLabel: 'Resource marketplace views',
        items: [
          {
            id: 'resource-available',
            label: 'Available Resources',
            icon: 'resource',
            badge: CountBadge({ value: snapshot.availableResources.length }),
            panel: availableResourcesView(service),
          },
          {
            id: 'resource-requests',
            label: 'My Requests',
            icon: 'inbox',
            badge: CountBadge({ value: snapshot.myRequests.length }),
            panel: requestsView(service),
          },
          {
            id: 'resource-providers',
            label: 'My Providers',
            icon: 'machine',
            badge: CountBadge({ value: snapshot.myProviders.length }),
            panel: providersView(service),
          },
        ],
      }),
      DataCard({
        title: 'Resource-layer capability boundary',
        icon: 'shield',
        badge: StatusBadge({ label: 'adapter', tone: 'idle', dot: 'ring', size: 'sm' }),
        children: KeyValueList({
          rows: [
            { key: 'Audited source', value: RESOURCE_LAYER_AUDITED_REVISION, mono: true },
            { key: 'Package installed', value: service.capabilities.upstreamPackageInstalled ? 'yes' : 'no', mono: true },
            { key: 'Local draft validation', value: service.capabilities.localDraftValidation ? 'available' : 'unavailable', mono: true },
            { key: 'Injected provider matching', value: service.capabilities.injectedProviderDiscovery ? 'available' : 'unavailable', mono: true },
            { key: 'Remote discovery', value: service.capabilities.remoteProviderDiscovery ? 'available' : 'unavailable', mono: true },
            { key: 'Quotes / submission', value: service.capabilities.requestSubmission ? 'available' : 'unavailable', mono: true },
            { key: 'Grants / receipts', value: service.capabilities.accessGrants ? 'available' : 'unavailable', mono: true },
          ],
        }),
      }),
      resourceRequestDrawer(undefined, service),
    ]),
  });
}

/** /console/resources/[resourceId] detail body. */
export function resourceDetailSection(
  resourceId: string,
  service: ResourceMarketplaceService = consoleResourceMarketplace
): Html {
  const snapshot = service.snapshot();
  const offer = service.resource(resourceId);

  if (!offer) {
    const content =
      snapshot.state === 'loading'
        ? LoadingState({ label: 'Loading resource detail' })
        : snapshot.state === 'error'
          ? ErrorState({
              title: 'Resource lookup failed',
              description: snapshot.sourceMessage,
              ...(snapshot.errorDetail ? { detail: snapshot.errorDetail } : {}),
              actions: CommandButton({ label: 'All resources', href: '/console/resources', size: 'sm', icon: 'resource' }),
            })
          : ErrorState({
              title: snapshot.state === 'unavailable' ? 'Resource unavailable' : 'Resource not found',
              description:
                snapshot.state === 'unavailable'
                  ? snapshot.sourceMessage
                  : `No provider capability is registered with resource id ${resourceId}.`,
              detail: snapshot.state === 'unavailable' ? 'PROVIDER_SOURCE_UNAVAILABLE' : 'RESOURCE_NOT_FOUND',
              actions: CommandButton({ label: 'All resources', href: '/console/resources', size: 'sm', icon: 'resource' }),
            });
    return Stack({
      children: join([DataCard({ flush: true, children: content }), resourceRequestDrawer(undefined, service)]),
    });
  }

  const requestHistory = snapshot.myRequests.filter((request) => request.resourceId === offer.resourceId);
  const requestHistoryTable = DataTable({
    columns: [
      { key: 'id', header: 'Request ID', mono: true, cell: (request: ResourceRequestRecord) => request.requestId },
      { key: 'requester', header: 'Requester', mono: true, cell: (request: ResourceRequestRecord) => request.requesterMachineId },
      { key: 'status', header: 'Status', cell: (request: ResourceRequestRecord) => StatusBadge({ label: request.status }) },
      { key: 'created', header: 'Created', mono: true, cell: (request: ResourceRequestRecord) => request.createdAt },
      { key: 'grant', header: 'Access grant', cell: (request: ResourceRequestRecord) => StatusBadge({ label: request.accessGrantState, size: 'sm' }) },
      { key: 'receipt', header: 'Receipt', cell: (request: ResourceRequestRecord) => StatusBadge({ label: request.receiptState, size: 'sm' }) },
    ],
    rows: requestHistory,
    rowKey: (request) => request.requestId,
    caption: `Request history for ${offer.resourceId}`,
    compact: true,
    empty: EmptyState({
      title: 'No request history',
      description: service.capabilities.persistence
        ? 'No requests reference this resource.'
        : 'Request history is unavailable because no persistence backend is configured.',
      icon: 'inbox',
      inline: true,
    }),
  });

  return Stack({
    children: join([
      offer.availability === 'unavailable' || offer.providerStatus === 'offline'
        ? DataCard({
            tone: 'alert',
            children: ErrorState({
              title: 'Provider unavailable',
              description: 'This provider capability cannot currently accept a resource request.',
              detail: 'UNAVAILABLE_PROVIDER',
              inline: true,
            }),
          })
        : html``,
      StatGrid({
        children: join([
          StatCard({ label: 'Resource type', value: offer.capability.resourceType, icon: 'resource' }),
          StatCard({ label: 'Availability', value: offer.availability, icon: 'zap' }),
          StatCard({ label: 'Runtime rails', value: offer.runtimeRails.length, icon: 'link' }),
          StatCard({
            label: 'Current quote',
            value: offer.quote?.amount ?? 'unavailable',
            unit: offer.quote?.asset,
            icon: 'settlement',
            tone: offer.quote ? 'default' : 'alert',
          }),
        ]),
      }),
      Split({
        children: join([
          DataCard({
            title: 'Resource identity',
            icon: 'resource',
            children: KeyValueList({
              rows: [
                { key: 'Resource id', value: offer.resourceId, mono: true },
                { key: 'Capability id', value: offer.capability.id, mono: true },
                { key: 'Resource type', value: offer.capability.resourceType, mono: true },
                { key: 'Capability', value: offer.capability.label },
                { key: 'Unit', value: offer.capability.unit, mono: true },
                { key: 'Availability', value: StatusBadge({ label: offer.availability, size: 'sm' }) },
              ],
            }),
          }),
          DataCard({
            title: 'Provider',
            icon: 'machine',
            badge: providerStatus(offer),
            children: KeyValueList({
              rows: [
                { key: 'Provider', value: offer.providerName },
                { key: 'Provider id', value: offer.capability.providerId, mono: true },
                { key: 'Provider machine', value: offer.providerMachineId ?? 'not supplied', mono: true },
                { key: 'Runtime rails', value: railView(offer) },
                { key: 'Pricing / quote', value: quoteView(offer) },
              ],
            }),
          }),
        ]),
      }),
      DataCard({ title: 'Request history', icon: 'inbox', flush: true, children: requestHistoryTable }),
      Split({
        children: join([
          DataCard({
            title: 'Access grant',
            icon: 'shield',
            badge: StatusBadge({ label: service.capabilities.accessGrants ? 'available' : 'unavailable', tone: 'offline', dot: 'ring', size: 'sm' }),
            children: service.capabilities.accessGrants
              ? EmptyState({ title: 'No access grant', description: 'No access grant references this resource.', icon: 'shield', inline: true })
              : EmptyState({
                  title: 'Access grants unsupported',
                  description: 'The audited upstream package names AccessGrant as a design concept but does not implement it.',
                  icon: 'shield',
                  inline: true,
                }),
          }),
          DataCard({
            title: 'Resource receipts',
            icon: 'audit',
            badge: StatusBadge({ label: service.capabilities.resourceReceipts ? 'available' : 'unavailable', tone: 'offline', dot: 'ring', size: 'sm' }),
            children: service.capabilities.resourceReceipts
              ? EmptyState({ title: 'No receipts', description: 'No receipt references this resource.', icon: 'audit', inline: true })
              : EmptyState({
                  title: 'Resource receipts unsupported',
                  description: 'ResourceReceipt is not implemented by the audited upstream package or this application backend.',
                  icon: 'audit',
                  inline: true,
                }),
          }),
        ]),
      }),
      resourceRequestDrawer(offer.resourceId, service),
    ]),
  });
}

/** Header metadata used by the shared console shell for resource detail routes. */
export function resourceDetailHeader(
  resourceId: string,
  service: ResourceMarketplaceService = consoleResourceMarketplace
): {
  title: string;
  resourceId: string;
  found: boolean;
  resourceType: string;
  provider: string;
  providerStatus: string;
  runtimeRail: string;
} {
  const offer = service.resource(resourceId);
  if (!offer) {
    return {
      title: service.snapshot().state === 'unavailable' ? 'Resource unavailable' : 'Resource not found',
      resourceId,
      found: false,
      resourceType: 'unknown',
      provider: 'unavailable',
      providerStatus: 'unknown',
      runtimeRail: 'unavailable',
    };
  }
  return {
    title: offer.capability.label,
    resourceId: offer.resourceId,
    found: true,
    resourceType: offer.capability.resourceType,
    provider: offer.providerName,
    providerStatus: offer.providerStatus,
    runtimeRail: offer.runtimeRails.map((rail) => rail.id).join(', ') || 'not supplied',
  };
}
