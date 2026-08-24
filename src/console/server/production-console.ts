import type { IncomingMessage } from 'node:http';
import { esc, stylesheet } from '../ui/index.js';
import { routeFromPath } from './handler.js';
import type { ProductionRuntime } from '../../server/production/runtime.js';
import type { ServerConfig } from '../../server/config.js';
import { HttpError } from '../../server/http.js';
import { decimalAmountLte } from '../../settlement/amounts.js';
import { RESOURCE_TYPES } from '../services/resources.js';
import { MACHINE_CAPABILITIES, MACHINE_ROLES } from '../../machines/identity.js';
import type {
  OwnedMachineRecord,
  PersistentAccessGrant,
  PersistentResourceReceipt,
  PersistentResourceRequest,
  PersistentResourceQuote,
  PersistentWorkOrder,
  ProviderCapabilityRow,
  ReceiptSettlementProjection,
  SettlementRecord,
  TelemetryEventRecord,
} from '../../server/production/types.js';
import {
  classifyTelemetryFreshness,
  latestTelemetryByMachine,
  TELEMETRY_FUTURE_TOLERANCE_MS,
  TELEMETRY_LIVE_WINDOW_MS,
  TELEMETRY_OFFLINE_WINDOW_MS,
} from './production-console-live.js';

const navItems = [
  ['overview', 'Overview'],
  ['machines', 'Machines'],
  ['resources', 'Resources'],
  ['jobs', 'Jobs'],
  ['telemetry', 'Telemetry'],
  ['settlements', 'Settlements'],
  ['receipts', 'Receipts'],
  ['settings', 'Settings'],
] as const;

export const productionClientScript = (): string => String.raw`
(() => {
  const qs = (selector) => document.querySelector(selector);
  const qsa = (selector) => Array.from(document.querySelectorAll(selector));
  const status = (message, error) => {
    const target = qs('#mc-production-status');
    if (target) { target.textContent = message; target.dataset.error = error ? 'true' : 'false'; }
  };
  const base58 = (bytes) => {
    const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const digits = [0];
    for (const byte of bytes) {
      let carry = byte;
      for (let i = 0; i < digits.length; i += 1) {
        carry += digits[i] * 256;
        digits[i] = carry % 58;
        carry = Math.floor(carry / 58);
      }
      while (carry > 0) { digits.push(carry % 58); carry = Math.floor(carry / 58); }
    }
    for (let index = 0; index < bytes.length - 1 && bytes[index] === 0; index += 1) digits.push(0);
    return digits.reverse().map((digit) => alphabet[digit]).join('');
  };
  const provider = () => window.phantom?.solana || window.solana || null;
  const rejected = (error) => error && (error.code === 4001 || /reject|declin|cancel/i.test(String(error.message || error)));
  const fromBase64 = (value) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  const toBase64 = (value) => btoa(String.fromCharCode(...value));
  const storedCsrf = () => {
    try { return sessionStorage.getItem('mfi_csrf'); } catch { return null; }
  };
  const rememberCsrf = (value) => {
    try { sessionStorage.setItem('mfi_csrf', value); } catch { /* the SameSite CSRF cookie remains canonical */ }
  };
  const forgetCsrf = () => {
    try { sessionStorage.removeItem('mfi_csrf'); } catch { /* storage may be disabled */ }
  };
  const csrf = () => {
    const prefix = 'mfi_console_csrf=';
    const encoded = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
    if (encoded) {
      try {
        const inCookie = decodeURIComponent(encoded.slice(prefix.length));
        if (inCookie) { rememberCsrf(inCookie); return inCookie; }
      } catch { /* fall back to tab storage */ }
    }
    return storedCsrf();
  };
  const apiRequest = async (path, method, body) => {
    const token = csrf();
    if (method !== 'GET' && !token) throw new Error('This browser has no CSRF token. Reconnect the wallet.');
    const response = await fetch(path, {
      method, credentials: 'same-origin',
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { 'x-csrf-token': token } : {})
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    let result;
    try { result = await response.json(); } catch { throw new Error('The server returned an unreadable response.'); }
    if (!response.ok) {
      const failure = new Error(result.error?.detail || result.error?.message || 'The request failed with status ' + response.status + '.');
      failure.code = result.error?.code || null;
      failure.retryable = result.error?.retryable === true;
      throw failure;
    }
    return result;
  };
  const post = (path, body) => apiRequest(path, 'POST', body);

  // Minimal Wallet Standard app registration. Wallets retain custody and sign
  // the exact serialized transaction returned by the trusted backend.
  const standardWallets = [];
  const register = (...wallets) => {
    for (const wallet of wallets) if (wallet && !standardWallets.includes(wallet)) standardWallets.push(wallet);
    return () => { for (const wallet of wallets) { const index = standardWallets.indexOf(wallet); if (index >= 0) standardWallets.splice(index, 1); } };
  };
  const standardApi = Object.freeze({ register });
  window.addEventListener('wallet-standard:register-wallet', (event) => {
    try { if (typeof event.detail === 'function') event.detail(standardApi); } catch { /* an invalid wallet registration is ignored */ }
  });
  try { window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: standardApi })); } catch { /* legacy wallet only */ }
  try {
    const queued = navigator.wallets;
    if (Array.isArray(queued)) for (const callback of queued) if (typeof callback === 'function') callback(standardApi);
  } catch { /* deprecated discovery is optional */ }

  const signingAccount = async (address, chain) => {
    const supportsV0 = (versions) => {
      try { return Array.from(versions || []).some((version) => version === 0); } catch { return false; }
    };
    const match = () => {
      for (const wallet of standardWallets) {
        const feature = wallet.features?.['solana:signTransaction'];
        if (!feature || typeof feature.signTransaction !== 'function' || !supportsV0(feature.supportedTransactionVersions)) continue;
        const account = wallet.accounts?.find((candidate) =>
          candidate.address === address &&
          candidate.features?.includes('solana:signTransaction') &&
          candidate.publicKey instanceof Uint8Array &&
          base58(candidate.publicKey) === address
        );
        if (!account) continue;
        if (chain && (!wallet.chains?.includes(chain) || !account.chains?.includes(chain))) continue;
        return { wallet, account, feature };
      }
      return null;
    };
    let found = match();
    if (found) return found;
    for (const wallet of standardWallets) {
      const connectFeature = wallet.features?.['standard:connect'];
      if (!wallet.features?.['solana:signTransaction'] || typeof connectFeature?.connect !== 'function') continue;
      try { await connectFeature.connect(); } catch (error) { if (rejected(error)) throw error; }
      found = match();
      if (found) return found;
    }
    throw new Error('No Wallet Standard account matching the authenticated wallet and verified Solana network can sign this transaction.');
  };
  const connect = qs('#mc-production-connect');
  if (connect) connect.addEventListener('click', async () => {
    connect.disabled = true;
    connect.setAttribute('aria-busy', 'true');
    try {
      const wallet = provider();
      if (!wallet || typeof wallet.connect !== 'function' || typeof wallet.signMessage !== 'function') {
        throw new Error('No compatible injected Solana wallet with signMessage is available.');
      }
      status('Waiting for wallet connection…');
      const connected = await wallet.connect();
      const walletAddress = String(connected.publicKey || wallet.publicKey || '');
      const challenged = await fetch('/api/auth/challenge', {
        method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ walletAddress })
      });
      const challenge = await challenged.json();
      if (!challenged.ok) throw new Error(challenge.error?.detail || 'Challenge request failed.');
      if (
        typeof challenge.challengeId !== 'string' || !challenge.challengeId ||
        typeof challenge.message !== 'string' || !challenge.message ||
        typeof challenge.expiresAt !== 'string' || !Number.isFinite(Date.parse(challenge.expiresAt)) ||
        Date.parse(challenge.expiresAt) <= Date.now()
      ) throw new Error('The server returned an invalid or expired wallet challenge.');
      status('Sign the authentication message in your wallet. No transaction is requested.');
      const signed = await wallet.signMessage(new TextEncoder().encode(challenge.message), 'utf8');
      const signatureBytes = signed.signature || signed;
      if (!(signatureBytes instanceof Uint8Array) || signatureBytes.length !== 64) {
        throw new Error('The wallet did not return a valid Ed25519 message signature.');
      }
      const verified = await fetch('/api/auth/verify', {
        method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ challengeId: challenge.challengeId, walletAddress, signature: base58(signatureBytes) })
      });
      const result = await verified.json();
      if (!verified.ok) throw new Error(result.error?.detail || 'Wallet verification failed.');
      if (typeof result.csrfToken !== 'string' || !result.csrfToken) {
        throw new Error('The server established an unusable session. Reload and authenticate again.');
      }
      rememberCsrf(result.csrfToken);
      location.reload();
    } catch (error) {
      connect.disabled = false;
      connect.removeAttribute('aria-busy');
      status(rejected(error) ? 'Wallet authentication was rejected. No session was created.' : error instanceof Error ? error.message : 'Wallet authentication failed.', true);
    }
  });
  const logout = qs('#mc-production-logout');
  if (logout) logout.addEventListener('click', async () => {
    logout.disabled = true;
    logout.setAttribute('aria-busy', 'true');
    try {
      const token = csrf();
      if (!token) throw new Error('This browser has no CSRF token. Reconnect the wallet.');
      status('Logging out…');
      const response = await fetch('/api/auth/logout', { method: 'POST', headers: { 'x-csrf-token': token }, credentials: 'same-origin' });
      let result = null;
      try { result = await response.json(); } catch { /* status remains authoritative */ }
      if (!response.ok) throw new Error(result?.error?.detail || 'Logout failed with status ' + response.status + '.');
      forgetCsrf();
      location.reload();
    } catch (error) {
      logout.disabled = false;
      logout.removeAttribute('aria-busy');
      status(error instanceof Error ? error.message : 'Logout failed.', true);
    }
  });
  const telemetryRoot = qs('[data-production-live]');
  if (telemetryRoot) {
    const scopedMachineId = telemetryRoot.dataset.machineId || '';
    const freshness = (observedAt, receivedAt, health) => {
      const now = Date.now();
      const observed = Date.parse(observedAt || '');
      const received = Date.parse(receivedAt || '');
      const futureTolerance = Number(telemetryRoot.dataset.futureToleranceMs);
      const liveWindow = Number(telemetryRoot.dataset.liveWindowMs);
      const offlineWindow = Number(telemetryRoot.dataset.offlineWindowMs);
      if (!Number.isFinite(observed) || !Number.isFinite(received) || now - observed < -futureTolerance || now - received < -futureTolerance) return 'UNKNOWN';
      if (health === 'offline' || now - observed > offlineWindow || now - received > offlineWindow) return 'OFFLINE';
      if (now - observed <= liveWindow && now - received <= liveWindow && received - observed <= liveWindow) return 'LIVE';
      return 'DELAYED';
    };
    const updateRow = (row) => {
      const state = freshness(row.dataset.observedAt, row.dataset.receivedAt, row.dataset.health);
      const target = row.querySelector('[data-live-state]');
      if (target) { target.textContent = state; target.dataset.freshness = state.toLowerCase(); }
    };
    const rowsFor = (machineId) => Array.from(document.querySelectorAll('[data-machine-telemetry]')).filter((row) => row.dataset.machineTelemetry === machineId);
    const applyTelemetry = (payload) => {
      if (!payload || typeof payload.machineId !== 'string' || !payload.snapshot || typeof payload.receivedAt !== 'string') throw new Error('invalid event');
      if (scopedMachineId && payload.machineId !== scopedMachineId) return false;
      for (const row of rowsFor(payload.machineId)) {
        const incoming = Date.parse(payload.receivedAt);
        const current = Date.parse(row.dataset.receivedAt || '');
        if (Number.isFinite(current) && Number.isFinite(incoming) && incoming < current) continue;
        row.dataset.observedAt = payload.snapshot.observedAt;
        row.dataset.receivedAt = payload.receivedAt;
        row.dataset.health = payload.snapshot.health;
        const health = row.querySelector('[data-live-health]');
        const observed = row.querySelector('[data-live-observed]');
        const received = row.querySelector('[data-live-received]');
        const battery = row.querySelector('[data-live-battery]');
        const signal = row.querySelector('[data-live-signal]');
        const progress = row.querySelector('[data-live-progress]');
        const location = row.querySelector('[data-live-location]');
        const pose = row.querySelector('[data-live-pose]');
        const telemetryRef = row.querySelector('[data-live-telemetry-ref]');
        if (health) health.textContent = payload.snapshot.health;
        if (observed) observed.textContent = payload.snapshot.observedAt;
        if (received) received.textContent = payload.receivedAt;
        if (battery) battery.textContent = payload.snapshot.batteryPct === undefined ? 'not recorded' : payload.snapshot.batteryPct + '%';
        if (signal) signal.textContent = payload.snapshot.signalPct === undefined ? 'not recorded' : payload.snapshot.signalPct + '%';
        if (progress) progress.textContent = payload.snapshot.progressPct === undefined ? 'not recorded' : payload.snapshot.progressPct + '%';
        if (location) location.textContent = payload.snapshot.location
          ? payload.snapshot.location.lat + ', ' + payload.snapshot.location.lon + (payload.snapshot.location.altitudeM === undefined ? '' : ' · ' + payload.snapshot.location.altitudeM + ' m')
          : 'not recorded';
        if (pose) pose.textContent = payload.snapshot.pose
          ? 'x ' + payload.snapshot.pose.x + ' · y ' + payload.snapshot.pose.y + (payload.snapshot.pose.z === undefined ? '' : ' · z ' + payload.snapshot.pose.z) + (payload.snapshot.pose.yawDeg === undefined ? '' : ' · yaw ' + payload.snapshot.pose.yawDeg + '°')
          : 'not recorded';
        if (telemetryRef) telemetryRef.textContent = payload.snapshot.telemetryRef || 'not recorded';
        updateRow(row);
      }
      return true;
    };
    document.querySelectorAll('[data-machine-telemetry]').forEach(updateRow);
    const connection = qs('[data-live-connection]');
    const stream = new EventSource('/api/telemetry/stream', { withCredentials: true });
    stream.onopen = () => {
      if (connection) { connection.textContent = 'Connected'; connection.dataset.connection = 'connected'; }
      status('Live telemetry stream connected.');
    };
    stream.addEventListener('telemetry', (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (applyTelemetry(payload)) status('Live telemetry received for ' + payload.machineId + '.');
      } catch { status('A telemetry event could not be rendered.', true); }
    });
    stream.onerror = () => {
      if (connection) { connection.textContent = stream.readyState === EventSource.CLOSED ? 'Disconnected' : 'Reconnecting'; connection.dataset.connection = 'disconnected'; }
      status('Live telemetry stream disconnected; stored snapshots remain visible while the browser retries.', true);
    };
    const freshnessTimer = setInterval(() => document.querySelectorAll('[data-machine-telemetry]').forEach(updateRow), 30_000);
    const reconcile = async () => {
      try {
        const path = scopedMachineId
          ? '/api/telemetry?machineId=' + encodeURIComponent(scopedMachineId) + '&limit=1'
          : '/api/telemetry?latest=true&limit=100';
        const response = await fetch(path, { credentials: 'same-origin' });
        if (!response.ok) return;
        const result = await response.json();
        if (!Array.isArray(result.events)) return;
        for (const event of result.events) applyTelemetry(event);
      } catch { /* SSE remains primary; the next bounded reconciliation retries. */ }
    };
    const reconciliationTimer = setInterval(reconcile, 30_000);
    window.addEventListener('pagehide', () => { clearInterval(freshnessTimer); clearInterval(reconciliationTimer); stream.close(); }, { once: true });
  }

  const showDialog = (dialog) => {
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
  };
  qsa('[data-dialog-close]').forEach((button) => button.addEventListener('click', () => button.closest('dialog')?.close()));
  qsa('[data-copy-value]').forEach((button) => button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copyValue || '');
      status('Transaction signature copied.');
    } catch { status('The browser denied clipboard access. Select and copy the signature manually.', true); }
  }));

  const machineDialog = qs('#mc-machine-dialog');
  const machineForm = qs('#mc-machine-form');
  qsa('[data-machine-open]').forEach((button) => button.addEventListener('click', () => {
    machineForm?.reset();
    showDialog(machineDialog);
  }));
  if (machineForm) machineForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fields = new FormData(machineForm);
    try {
      status('Registering wallet-owned machine…');
      const result = await post('/api/machines', {
        machineId: String(fields.get('machineId') || ''),
        label: String(fields.get('label') || ''),
        role: String(fields.get('role') || '')
      });
      status('Machine registered. Configure its runtime capabilities next.');
      location.assign('/console/machines/' + encodeURIComponent(result.machine.machineId));
    } catch (error) { status(error instanceof Error ? error.message : 'Machine registration failed.', true); }
  });

  const machineCapabilityForm = qs('[data-machine-capability-form]');
  if (machineCapabilityForm) machineCapabilityForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fields = new FormData(machineCapabilityForm);
    try {
      status('Persisting machine capabilities…');
      await post('/api/machines/' + encodeURIComponent(machineCapabilityForm.dataset.machineId) + '/capabilities', {
        capabilities: fields.getAll('capabilities').map(String)
      });
      status('Machine capabilities persisted.');
      location.reload();
    } catch (error) { status(error instanceof Error ? error.message : 'Capability configuration failed.', true); }
  });

  qsa('[data-machine-credential-revoke]').forEach((button) => button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await post('/api/machine-credentials/' + encodeURIComponent(button.dataset.machineCredentialRevoke) + '/revoke');
      status('Machine credential revoked.');
      location.reload();
    } catch (error) { button.disabled = false; status(error instanceof Error ? error.message : 'Credential revocation failed.', true); }
  }));

  const runtimeSessionForm = qs('[data-runtime-session-form]');
  if (runtimeSessionForm) runtimeSessionForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fields = new FormData(runtimeSessionForm);
    try {
      const result = await post('/api/runtime/sessions', {
        machineId: String(runtimeSessionForm.dataset.machineId || ''),
        policyProfileId: String(fields.get('policyProfileId') || '').trim() || 'standard-machine-policy'
      });
      status('Runtime session ' + result.session.sessionId + ' started.');
      location.reload();
    } catch (error) { status(error instanceof Error ? error.message : 'Runtime session creation failed.', true); }
  });
  qsa('[data-runtime-session-end]').forEach((button) => button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await post('/api/runtime/sessions/' + encodeURIComponent(button.dataset.runtimeSessionEnd) + '/end');
      status('Runtime session ended.');
      location.reload();
    } catch (error) { button.disabled = false; status(error instanceof Error ? error.message : 'Runtime session update failed.', true); }
  }));

  const workOrderDialog = qs('#mc-work-order-dialog');
  const workOrderForm = qs('#mc-work-order-form');
  qsa('[data-work-order-open]').forEach((button) => button.addEventListener('click', () => {
    workOrderForm?.reset();
    showDialog(workOrderDialog);
  }));
  if (workOrderForm) workOrderForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fields = new FormData(workOrderForm);
    try {
      status('Creating persisted runtime work order…');
      const result = await post('/api/work-orders', {
        machineId: String(fields.get('machineId') || ''),
        requiredCapabilities: fields.getAll('requiredCapabilities').map(String),
        telemetryRequired: fields.get('telemetryRequired') === 'on',
        proofRequired: fields.get('proofRequired') === 'on',
        expectedOutputs: String(fields.get('expectedOutputs') || '').split(',').map((value) => value.trim()).filter(Boolean),
        settlementAmount: String(fields.get('settlementAmount') || ''),
        settlementAsset: 'SOL',
        settlementRecipient: String(fields.get('settlementRecipient') || '')
      });
      status('Work order persisted as QUEUED.');
      location.assign('/console/jobs/' + encodeURIComponent(result.workOrder.workOrderId));
    } catch (error) { status(error instanceof Error ? error.message : 'Work-order creation failed.', true); }
  });

  // Capability identifiers and ownership always come from the server. Updates
  // cannot change the provider machine or resource type.
  const capabilityDialog = qs('#mc-capability-dialog');
  const capabilityForm = qs('#mc-capability-form');
  qsa('[data-capability-open]').forEach((button) => button.addEventListener('click', () => {
    if (!capabilityForm) return;
    capabilityForm.reset();
    capabilityForm.dataset.capabilityId = button.dataset.capabilityId || '';
    for (const name of ['providerMachineId', 'resourceType', 'label', 'unit', 'railTags', 'availability', 'priceAmount', 'priceAsset']) {
      const field = capabilityForm.elements.namedItem(name);
      if (field && button.dataset[name] !== undefined) field.value = button.dataset[name];
    }
    const machine = capabilityForm.elements.namedItem('providerMachineId');
    const type = capabilityForm.elements.namedItem('resourceType');
    if (machine) machine.disabled = Boolean(button.dataset.capabilityId);
    if (type) type.disabled = Boolean(button.dataset.capabilityId);
    const title = capabilityDialog?.querySelector('[data-capability-title]');
    if (title) title.textContent = button.dataset.capabilityId ? 'Update provider capability' : 'Register provider capability';
    showDialog(capabilityDialog);
  }));
  if (capabilityForm) capabilityForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fields = new FormData(capabilityForm);
    const capabilityId = capabilityForm.dataset.capabilityId;
    const body = {
      ...(capabilityId ? {} : {
        providerMachineId: String(fields.get('providerMachineId') || ''),
        resourceType: String(fields.get('resourceType') || '')
      }),
      label: String(fields.get('label') || ''),
      unit: String(fields.get('unit') || ''),
      railTags: String(fields.get('railTags') || '').split(',').map((value) => value.trim()).filter(Boolean),
      availability: String(fields.get('availability') || ''),
      priceAmount: String(fields.get('priceAmount') || '').trim() || null,
      priceAsset: String(fields.get('priceAsset') || '').trim() || null
    };
    try {
      status(capabilityId ? 'Updating provider capability…' : 'Registering provider capability…');
      await apiRequest(
        capabilityId ? '/api/marketplace/capabilities/' + encodeURIComponent(capabilityId) : '/api/marketplace/capabilities',
        capabilityId ? 'PATCH' : 'POST',
        body
      );
      status('Provider capability persisted.');
      location.reload();
    } catch (error) { status(error instanceof Error ? error.message : 'Capability update failed.', true); }
  });

  // The request drawer is deliberately staged: it discovers compatible
  // persisted providers before submission and never displays a fake success.
  const requestDialog = qs('#mc-resource-request-dialog');
  const requestForm = qs('#mc-resource-request-form');
  let requestStep = 0;
  let discoveredProviders = [];
  const requestSections = () => requestForm ? Array.from(requestForm.querySelectorAll('[data-request-step]')) : [];
  const requestField = (name) => requestForm?.elements.namedItem(name) || null;
  const selectedProvider = () => {
    const field = requestField('capabilityId');
    const id = field ? String(field.value || '') : '';
    return discoveredProviders.find((candidate) => candidate.id === id) || null;
  };
  const updateRequestReview = () => {
    if (!requestForm) return;
    const provider = selectedProvider();
    const values = {
      machine: String(requestField('requesterMachineId')?.value || ''),
      resource: String(requestField('resourceType')?.value || ''),
      quantity: String(requestField('quantity')?.value || ''),
      limit: String(requestField('maxPrice')?.value || ''),
      provider: provider ? provider.label + ' · ' + provider.providerMachineId : 'No provider selected'
    };
    for (const [key, value] of Object.entries(values)) {
      const target = requestForm.querySelector('[data-request-review-' + key + ']');
      if (target) target.textContent = value;
    }
  };
  const showRequestStep = (next) => {
    const sections = requestSections();
    requestStep = Math.max(0, Math.min(next, sections.length - 1));
    sections.forEach((section, index) => { section.hidden = index !== requestStep; });
    const progress = requestForm?.querySelector('[data-request-progress]');
    if (progress) progress.textContent = 'Step ' + (requestStep + 1) + ' of ' + sections.length;
    const back = requestForm?.querySelector('[data-request-back]');
    const nextButton = requestForm?.querySelector('[data-request-next]');
    if (back) back.disabled = requestStep === 0;
    if (nextButton) nextButton.textContent = requestStep === sections.length - 1 ? 'Submit request' : 'Continue';
    if (requestStep >= sections.length - 2) updateRequestReview();
  };
  const discoverProviders = async () => {
    const resourceType = String(requestField('resourceType')?.value || '');
    const params = new URLSearchParams({ resourceType, maxPrice: String(requestField('maxPrice')?.value || '') });
    for (const rail of String(requestField('preferredRails')?.value || '').split(',').map((value) => value.trim()).filter(Boolean)) params.append('preferredRail', rail);
    const result = await apiRequest('/api/marketplace/providers?' + params.toString(), 'GET');
    discoveredProviders = Array.isArray(result.providers) ? result.providers : Array.isArray(result.capabilities) ? result.capabilities : [];
    const selector = requestField('capabilityId');
    if (!selector) return;
    selector.replaceChildren();
    for (const provider of discoveredProviders) {
      const option = document.createElement('option');
      option.value = provider.id;
      const quote = provider.priceAmount === null ? 'quote required' : provider.priceAmount + ' ' + (provider.priceAsset || '');
      option.textContent = provider.label + ' · ' + provider.providerMachineId + ' · ' + provider.availability + ' · ' + quote;
      selector.append(option);
    }
    const empty = requestForm?.querySelector('[data-provider-empty]');
    if (empty) empty.hidden = discoveredProviders.length > 0;
    if (!discoveredProviders.length) throw new Error('No compatible available providers were found. No request was submitted.');
    const preselected = requestForm?.dataset.preselectCapability;
    if (preselected && discoveredProviders.some((provider) => provider.id === preselected)) selector.value = preselected;
  };
  qsa('[data-request-open]').forEach((button) => button.addEventListener('click', () => {
    if (!requestForm) return;
    requestForm.reset();
    requestForm.dataset.preselectCapability = button.dataset.capabilityId || '';
    const resourceType = requestField('resourceType');
    if (resourceType && button.dataset.resourceType) resourceType.value = button.dataset.resourceType;
    discoveredProviders = [];
    showRequestStep(0);
    showDialog(requestDialog);
  }));
  if (requestForm) {
    requestForm.querySelector('[data-request-back]')?.addEventListener('click', () => showRequestStep(requestStep - 1));
    requestForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const sections = requestSections();
      const current = sections[requestStep];
      const fields = current ? Array.from(current.querySelectorAll('input,select,textarea')) : [];
      if (fields.some((field) => typeof field.reportValidity === 'function' && !field.reportValidity())) return;
      try {
        if (requestStep === 3) {
          status('Discovering compatible persisted providers…');
          await discoverProviders();
        }
        if (requestStep < sections.length - 1) { showRequestStep(requestStep + 1); return; }
        const provider = selectedProvider();
        if (!provider) throw new Error('Select a compatible provider before submitting.');
        const result = await post('/api/marketplace/requests', {
          requesterMachineId: String(requestField('requesterMachineId')?.value || ''),
          resourceType: String(requestField('resourceType')?.value || ''),
          capabilityId: provider.id,
          quantity: String(requestField('quantity')?.value || ''),
          maxPrice: String(requestField('maxPrice')?.value || ''),
          preferredRails: String(requestField('preferredRails')?.value || '').split(',').map((value) => value.trim()).filter(Boolean),
          purpose: String(requestField('purpose')?.value || '')
        });
        status('Request ' + result.request.id + ' persisted as ' + String(result.request.state).toUpperCase() + '. No grant or fulfillment is implied.');
        location.assign('/console/resources/' + encodeURIComponent(result.request.id));
      } catch (error) { status(error instanceof Error ? error.message : 'Resource request failed.', true); }
    });
  }

  const quoteForm = qs('[data-provider-quote-form]');
  if (quoteForm) quoteForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fields = new FormData(quoteForm);
    try {
      await post('/api/marketplace/requests/' + encodeURIComponent(quoteForm.dataset.requestId) + '/quotes', {
        capabilityId: String(fields.get('capabilityId') || ''),
        amount: String(fields.get('amount') || ''),
        asset: String(fields.get('asset') || ''),
        expiresAt: String(fields.get('expiresAt') || '').trim() || null
      });
      status('Quote persisted and offered to the requester.');
      location.reload();
    } catch (error) { status(error instanceof Error ? error.message : 'Quote creation failed.', true); }
  });
  const grantForm = qs('[data-access-grant-form]');
  if (grantForm) grantForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fields = new FormData(grantForm);
    try {
      await post('/api/marketplace/requests/' + encodeURIComponent(grantForm.dataset.requestId) + '/grant', {
        quoteId: String(fields.get('resourceQuoteId') || ''),
        accessReference: String(fields.get('accessReference') || '').trim() || null,
        expiresAt: String(fields.get('expiresAt') || '').trim() || null
      });
      status('Pending access grant persisted. Activate it only after provisioning succeeds.');
      location.reload();
    } catch (error) { status(error instanceof Error ? error.message : 'Grant creation failed.', true); }
  });
  const receiptForm = qs('[data-resource-receipt-form]');
  if (receiptForm) receiptForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fields = new FormData(receiptForm);
    try {
      await post('/api/marketplace/requests/' + encodeURIComponent(receiptForm.dataset.requestId) + '/receipt', {
        accessGrantId: String(fields.get('accessGrantId') || ''),
        settlementId: String(fields.get('settlementId') || '').trim() || null,
        evidenceReference: String(fields.get('evidenceReference') || '').trim() || null,
        resultReference: String(fields.get('resultReference') || '').trim() || null
      });
      status('Resource receipt recorded. It remains unverified until the requester reviews it.');
      location.reload();
    } catch (error) { status(error instanceof Error ? error.message : 'Receipt creation failed.', true); }
  });
  qsa('[data-market-action]').forEach((button) => button.addEventListener('click', async () => {
    const action = button.dataset.marketAction;
    const requestId = encodeURIComponent(button.dataset.requestId || '');
    const recordId = encodeURIComponent(button.dataset.recordId || '');
    const paths = {
      accept_quote: '/api/marketplace/requests/' + requestId + '/quotes/' + recordId + '/accept',
      cancel_request: '/api/marketplace/requests/' + requestId + '/cancel',
      reject_request: '/api/marketplace/requests/' + requestId + '/reject',
      withdraw_quote: '/api/marketplace/quotes/' + recordId + '/withdraw',
      activate_grant: '/api/marketplace/grants/' + recordId + '/activate',
      revoke_grant: '/api/marketplace/grants/' + recordId + '/revoke',
      verify_receipt: '/api/marketplace/receipts/' + recordId + '/verify',
      reject_receipt: '/api/marketplace/receipts/' + recordId + '/reject'
    };
    const path = paths[action];
    if (!path) return;
    button.disabled = true;
    try { await post(path); status('Marketplace state persisted.'); location.reload(); }
    catch (error) { button.disabled = false; status(error instanceof Error ? error.message : 'Marketplace update failed.', true); }
  }));

  const settlementRoot = qs('[data-production-settlements]');
  qsa('[data-reconcile-settlement]').forEach((button) => button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const result = await post('/api/settlements/' + encodeURIComponent(button.dataset.reconcileSettlement) + '/confirm');
      if (result.confirmed) {
        status('Settlement explicitly confirmed on Solana.');
        location.reload();
        return;
      }
      if (result.settlement?.state === 'failed') {
        status(result.lifecycle === 'dropped' ? 'The transaction was not found and its blockhash expired. The settlement is dropped, not confirmed.' : 'The transaction failed on chain and was not confirmed.', true);
        location.reload();
        return;
      }
      if (result.reconciliationRequired || result.lifecycle === 'timed_out') {
        status('Reconciliation timed out. The persisted settlement remains unresolved; no success or drop is inferred.', true);
      } else {
        status(result.settlement?.state === 'submitted' ? 'Transaction is submitted and still awaiting explicit confirmation.' : 'Submission delivery is still unknown; the persisted signature remains under reconciliation.', true);
      }
      button.textContent = 'Reconcile again';
      button.disabled = false;
    } catch (error) {
      button.disabled = false;
      status(error instanceof Error ? error.message : 'Settlement reconciliation failed.', true);
    }
  }));
  const review = qs('#mc-settlement-review');
  let activeSettlement = null;
  document.querySelectorAll('[data-settle-request]').forEach((button) => button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      status('Creating settlement terms from the accepted server record…');
      const created = await post('/api/settlements', { resourceRequestId: button.dataset.settleRequest });
      activeSettlement = {
        settlement: created.settlement,
        unsignedTransaction: created.settlement.state === 'awaiting_signature' ? (created.unsignedTransaction || created.settlement.unsignedTransaction || null) : null,
        button
      };
      qs('[data-review-source]').textContent = created.settlement.sourceWallet;
      qs('[data-review-recipient]').textContent = created.settlement.recipientWallet;
      qs('[data-review-amount]').textContent = created.settlement.amountLamports + ' lamports';
      qs('[data-review-memo]').textContent = 'machinefi:settlement:' + created.settlement.id;
      qs('[data-review-state]').textContent = created.settlement.state === 'awaiting_signature' ? 'AWAITING_SIGNATURE — prepared but not submitted' : String(created.settlement.state).toUpperCase() + ' — not submitted';
      showDialog(review);
      status('Review the server-derived source, recipient, and amount before requesting a wallet signature.');
    } catch (error) { button.disabled = false; status(error instanceof Error ? error.message : 'Settlement creation failed.', true); }
  }));
  const cancelActiveSettlement = async (message) => {
    if (!activeSettlement || ['submitting', 'submitted', 'confirmed'].includes(activeSettlement.settlement.state)) return false;
    if (['failed', 'cancelled'].includes(activeSettlement.settlement.state)) {
      activeSettlement.button.disabled = false;
      status(message + ' No replacement transaction was prepared or submitted.');
      return true;
    }
    const id = activeSettlement.settlement.id;
    try {
      const cancelled = await post('/api/settlements/' + encodeURIComponent(id) + '/cancel');
      activeSettlement.settlement = cancelled.settlement;
      activeSettlement.button.disabled = false;
      qs('[data-review-state]').textContent = 'CANCELLED — never submitted';
      status(message + ' Backend cancellation was persisted; nothing was submitted.');
      return true;
    } catch (error) {
      status(message + ' Nothing was submitted, but backend cancellation could not be confirmed: ' + (error instanceof Error ? error.message : 'request failed') + '.', true);
      return false;
    }
  };
  const cancelReview = qs('[data-review-cancel]');
  if (cancelReview) cancelReview.addEventListener('click', async () => {
    const cancelled = await cancelActiveSettlement('Review cancelled.');
    if (cancelled && review?.open) review.close();
  });
  if (review) review.addEventListener('cancel', async (event) => {
    event.preventDefault();
    const cancelled = await cancelActiveSettlement('Review dismissed.');
    if (cancelled && review.open) review.close();
  });
  const approveReview = qs('[data-review-approve]');
  if (approveReview) approveReview.addEventListener('click', async () => {
    if (!activeSettlement) return;
    approveReview.disabled = true;
    try {
      const chain = settlementRoot?.dataset.solanaChain || '';
      if (!chain) throw new Error('Wallet signing is unavailable for this verified custom cluster because no Wallet Standard chain identifier is configured.');
      if (!activeSettlement.unsignedTransaction) {
        status('Preparing the canonical transaction on the verified Solana RPC…');
        const prepared = await post('/api/settlements/' + encodeURIComponent(activeSettlement.settlement.id) + '/prepare');
        activeSettlement.unsignedTransaction = prepared.unsignedTransaction;
        activeSettlement.settlement = prepared.settlement;
        qs('[data-review-state]').textContent = 'AWAITING_SIGNATURE — not submitted';
      }
      const signer = await signingAccount(activeSettlement.settlement.sourceWallet, chain);
      status('Approve or reject the displayed transaction in ' + signer.wallet.name + '.');
      const [output] = await signer.feature.signTransaction({
        transaction: fromBase64(activeSettlement.unsignedTransaction), account: signer.account, ...(chain ? { chain } : {})
      });
      if (!output?.signedTransaction) throw new Error('The wallet did not return a signed serialized transaction.');
      const submitted = await post('/api/settlements/' + encodeURIComponent(activeSettlement.settlement.id) + '/submit', { signedTransaction: toBase64(output.signedTransaction) });
      activeSettlement.settlement = submitted.settlement;
      if (submitted.reconciliationRequired || submitted.settlement.state === 'submitting') {
        qs('[data-review-state]').textContent = 'SUBMISSION RESULT UNKNOWN — reconciling';
        status('The RPC delivery result is unknown. The signature is persisted and the Console is reconciling without resubmitting.', true);
      } else {
        qs('[data-review-state]').textContent = 'SUBMITTED — awaiting explicit confirmation';
        status('Transaction submitted. Waiting for explicit Solana confirmation…');
      }
      for (let attempt = 0; attempt < 70; attempt += 1) {
        const confirmed = await post('/api/settlements/' + encodeURIComponent(activeSettlement.settlement.id) + '/confirm');
        activeSettlement.settlement = confirmed.settlement;
        if (confirmed.confirmed) {
          qs('[data-review-state]').textContent = 'CONFIRMED';
          activeSettlement.button.textContent = 'Confirmed';
          status('Settlement confirmed on Solana.');
          return;
        }
        if (confirmed.settlement?.state === 'failed') {
          const failure = new Error(confirmed.lifecycle === 'dropped' ? 'The transaction was not found and its blockhash expired. It was marked dropped, not confirmed.' : 'The submitted transaction failed on chain.');
          failure.code = confirmed.settlement.errorCode || (confirmed.lifecycle === 'dropped' ? 'TRANSACTION_DROPPED' : 'ON_CHAIN_FAILURE');
          failure.retryable = confirmed.retryable === true || confirmed.lifecycle === 'dropped';
          throw failure;
        }
        if (confirmed.reconciliationRequired || confirmed.lifecycle === 'timed_out') {
          qs('[data-review-state]').textContent = 'SUBMITTED — timed out; reconciliation required';
          status('Confirmation timed out. The transaction remains submitted and has not been reported as successful or dropped.', true);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
      qs('[data-review-state]').textContent = 'SUBMITTED — confirmation still pending';
      status('The transaction is submitted but not yet confirmed. It has not been reported as successful.', true);
    } catch (error) {
      if (rejected(error)) {
        await cancelActiveSettlement('Wallet signing was rejected. Nothing was submitted; the settlement no longer remains awaiting signature.');
      } else {
        if (activeSettlement) {
          try {
            const latest = await apiRequest('/api/settlements/' + encodeURIComponent(activeSettlement.settlement.id), 'GET');
            if (latest.settlement) activeSettlement.settlement = latest.settlement;
          } catch { /* retain the last known local state and do not claim a transition */ }
        }
        const code = error?.code ? ' [' + error.code + ']' : '';
        status((error instanceof Error ? error.message : 'Settlement signing failed.') + code, true);
        if (activeSettlement && activeSettlement.settlement.state === 'failed') {
          activeSettlement.unsignedTransaction = null;
          qs('[data-review-state]').textContent = 'FAILED — replacement preparation requires another explicit signature';
          approveReview.textContent = 'Prepare replacement and sign';
        }
      }
      approveReview.disabled = false;
    }
  });
})();`;

const navIcon = (id: (typeof navItems)[number][0]): string => {
  const paths: Record<(typeof navItems)[number][0], string> = {
    overview: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    machines: '<rect x="4" y="6" width="16" height="12" rx="3"/><path d="M9 18v2m6-2v2M9 10h.01M15 10h.01M8 14h8M12 3v3"/>',
    resources: '<path d="M12 2v6m0 8v6M4.2 6.5l5.2 3m5.2 3 5.2 3M4.2 17.5l5.2-3m5.2-3 5.2-3"/><circle cx="12" cy="12" r="3"/>',
    jobs: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M9 5V3h6v2M8 10h8m-8 4h5"/>',
    telemetry: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
    settlements: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5c-.7-.7-1.8-1-3-1-1.7 0-3 .8-3 2s1.1 1.8 3 2 3 1 3 2.3-1.3 2.2-3 2.2c-1.3 0-2.5-.4-3.2-1.2M12 5.5v13"/>',
    receipts: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6m-6 4h6m-6 4h3"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
  };
  return `<span class="mc-nav__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[id]}</svg></span>`;
};

const compactWallet = (wallet: string): string => wallet.length > 13
  ? `${wallet.slice(0, 5)}…${wallet.slice(-5)}`
  : wallet;

/** Keeps Solana's canonical config identifier out of operator-facing labels. */
export const solanaClusterDisplayLabel = (cluster: ServerConfig['solanaCluster'] | string | undefined): string =>
  cluster === 'mainnet-beta' ? 'mainnet' : cluster ?? 'custom';

const layout = (active: string, wallet: string, cluster: string, body: string): string => `
<div class="mc-shell mc-shell--production">
  <div class="mc-shell__brand">
    <a class="mc-brand" href="/console/overview" aria-label="Machine Console overview">
      <span class="mc-brand__mark" aria-hidden="true"><span>M</span></span>
      <span class="mc-brand__meta"><span class="mc-brand__name">Machine Console</span><span class="mc-brand__sub">Runtime control plane</span></span>
    </a>
  </div>
  <div class="mc-shell__topbar">
    <header class="mc-topbar">
      <div class="mc-topbar__slot"><span class="mc-environment"><span class="mc-dot mc-dot--pulse"></span>${esc(solanaClusterDisplayLabel(cluster))}</span><span class="mc-topbar__context">Production workspace</span></div>
      <div class="mc-topbar__slot mc-topbar__slot--end">
        <span class="mc-wallet-chip" title="${esc(wallet)}"><span class="mc-wallet-chip__avatar" aria-hidden="true"></span><span class="mc-mono">${esc(compactWallet(wallet))}</span></span>
        <button id="mc-production-logout" class="mc-btn mc-btn--quiet" type="button">Log out</button>
      </div>
    </header>
  </div>
  <div class="mc-shell__sidebar">
    <aside class="mc-sidebar" aria-label="Machine Console navigation">
      <nav class="mc-nav">${navItems.map(([id, label]) => `<a class="mc-nav__link" href="/console/${id}"${active === id ? ' aria-current="page"' : ''}>${navIcon(id)}<span class="mc-nav__text">${label}</span></a>`).join('')}</nav>
      <div class="mc-sidebar__footer">
        <div class="mc-sidebar-status"><span class="mc-sidebar-status__dot"></span><span><strong>Systems operational</strong><small>RPC identity verified</small></span></div>
        <span class="mc-sidebar-version">Machina</span>
      </div>
    </aside>
  </div>
  <main id="mc-main" class="mc-shell__main" tabindex="-1">
    <div class="mc-shell__inner"><div class="mc-page">${body}</div><p id="mc-production-status" class="mc-toast-status" role="status" aria-live="polite"></p></div>
  </main>
</div>`;

const table = (headers: readonly string[], rows: readonly (readonly string[])[], label: string): string => `
<div class="mc-table-wrap"><div class="mc-table-scroll" role="region" aria-label="${esc(label)}" tabindex="0"><table class="mc-table"><thead><tr>${headers.map((header) => `<th>${esc(header)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}"><div class="mc-table-empty"><span class="mc-table-empty__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 7h14M7 4h10l2 3v12H5V7l2-3Z"/><path d="M9 12h6"/></svg></span><strong>No records yet</strong><span>${esc(label)} will appear here when activity is persisted.</span></div></td></tr>`}</tbody></table></div></div>`;

export const solanaExplorerTransactionUrl = (
  signature: string,
  cluster: ServerConfig['solanaCluster']
): string | null => {
  const clusterQuery = cluster === 'devnet' || cluster === 'testnet' ? `?cluster=${cluster}` : '';
  return cluster === 'mainnet-beta' || cluster === 'devnet' || cluster === 'testnet'
    ? `https://explorer.solana.com/tx/${encodeURIComponent(signature)}${clusterQuery}`
    : null;
};

const transactionSignatureCell = (signature: string | null, cluster: ServerConfig['solanaCluster']): string => {
  if (!signature) return 'none';
  const explorerUrl = solanaExplorerTransactionUrl(signature, cluster);
  const explorer = explorerUrl
    ? `<a href="${esc(explorerUrl)}" target="_blank" rel="noopener noreferrer">Explorer</a>`
    : '<span class="mc-dim">custom cluster · no public explorer link</span>';
  return `<span class="mc-mono">${esc(signature)}</span><br>${explorer} <button class="mc-btn mc-btn--secondary" type="button" data-copy-value="${esc(signature)}">Copy signature</button>`;
};

interface RequestLifecycleView {
  request: PersistentResourceRequest;
  quotes: readonly PersistentResourceQuote[];
  grant: PersistentAccessGrant | null;
  receipt: PersistentResourceReceipt | null;
  receiptSettlement: ReceiptSettlementProjection | null;
  providerView: boolean;
}

const machineOptions = (machines: readonly OwnedMachineRecord[]): string => machines
  .map((machine) => `<option value="${esc(machine.machineId)}">${esc(machine.label)} · ${esc(machine.machineId)}</option>`)
  .join('');

const machineRegistrationDialog = (): string => `
<dialog id="mc-machine-dialog" class="mc-card mc-settlement-dialog" aria-labelledby="mc-machine-title">
  <h2 id="mc-machine-title">Register machine</h2>
  <p class="mc-dim">Ownership and wallet address come from the authenticated session. The server assigns no client-provided owner.</p>
  <form id="mc-machine-form" class="mc-form-stack">
    <label>Machine ID<input name="machineId" required minlength="3" maxlength="64" pattern="[a-z0-9][a-z0-9._:-]{2,63}" placeholder="warehouse-rover-01"></label>
    <label>Display label<input name="label" required maxlength="128" placeholder="Warehouse Rover 01"></label>
    <label>Machine role<select name="role" required>${MACHINE_ROLES.map((role) => `<option value="${esc(role)}">${esc(role)}</option>`).join('')}</select></label>
    <div class="mc-dialog-actions"><button class="mc-btn mc-btn--secondary" type="button" data-dialog-close>Cancel</button><button class="mc-btn mc-btn--primary" type="submit">Register machine</button></div>
  </form>
</dialog>`;

const capabilityCheckboxes = (
  selected: ReadonlySet<string> = new Set(),
  fieldName = 'capabilities'
): string => MACHINE_CAPABILITIES
  .map((capability) => `<label class="mc-check"><input type="checkbox" name="${esc(fieldName)}" value="${esc(capability)}"${selected.has(capability) ? ' checked' : ''}><span>${esc(capability)}</span></label>`)
  .join('');

const workOrderDialog = (
  machines: readonly OwnedMachineRecord[],
  wallet: string
): string => `
<dialog id="mc-work-order-dialog" class="mc-card mc-settlement-dialog" aria-labelledby="mc-work-order-title">
  <h2 id="mc-work-order-title">Create work order</h2>
  <p class="mc-dim">The selected machine must already advertise every required capability. This creates a queued runtime-8 work-order record; it does not execute hardware or submit a settlement.</p>
  <form id="mc-work-order-form" class="mc-form-stack">
    <label>Assigned machine<select name="machineId" required>${machineOptions(machines)}</select></label>
    <fieldset class="mc-choice-grid"><legend>Required capabilities</legend>${capabilityCheckboxes(new Set(), 'requiredCapabilities')}</fieldset>
    <label>Expected outputs<input name="expectedOutputs" maxlength="512" placeholder="inspection-report, images"></label>
    <div class="mc-choice-row"><label class="mc-check"><input type="checkbox" name="telemetryRequired"><span>Require telemetry reference</span></label><label class="mc-check"><input type="checkbox" name="proofRequired"><span>Require proof reference</span></label></div>
    <label>Declared settlement amount (SOL)<input name="settlementAmount" inputmode="decimal" required value="0.000001"></label>
    <label>Settlement recipient<input name="settlementRecipient" required maxlength="44" value="${esc(wallet)}"></label>
    <div class="mc-dialog-actions"><button class="mc-btn mc-btn--secondary" type="button" data-dialog-close>Cancel</button><button class="mc-btn mc-btn--primary" type="submit">Create queued work order</button></div>
  </form>
</dialog>`;

const resourceTypeOptions = (): string => RESOURCE_TYPES
  .map((resourceType) => `<option value="${esc(resourceType)}">${esc(resourceType)}</option>`)
  .join('');

const capabilityEditButton = (capability: ProviderCapabilityRow): string =>
  `<button class="mc-btn mc-btn--secondary" type="button" data-capability-open data-capability-id="${esc(capability.id)}" data-provider-machine-id="${esc(capability.providerMachineId)}" data-resource-type="${esc(capability.resourceType)}" data-label="${esc(capability.label)}" data-unit="${esc(capability.unit)}" data-rail-tags="${esc(capability.railTags.join(', '))}" data-availability="${esc(capability.availability)}" data-price-amount="${esc(capability.priceAmount ?? '')}" data-price-asset="${esc(capability.priceAsset ?? '')}">Edit</button>`;

const marketplaceDialogs = (machines: readonly OwnedMachineRecord[]): string => `
<dialog id="mc-capability-dialog" class="mc-card mc-settlement-dialog" aria-labelledby="mc-capability-title">
  <h2 id="mc-capability-title" data-capability-title>Register provider capability</h2>
  <p class="mc-dim">The server assigns the capability ID and derives ownership from this wallet session.</p>
  <form id="mc-capability-form" class="mc-form-stack">
    <label>Provider machine<select name="providerMachineId" required>${machineOptions(machines)}</select></label>
    <label>Resource type<select name="resourceType" required>${resourceTypeOptions()}</select></label>
    <label>Capability label<input name="label" maxlength="120" required></label>
    <label>Unit<input name="unit" maxlength="64" required placeholder="request, minute, GB"></label>
    <label>Runtime rails/networks<input name="railTags" maxlength="256" placeholder="Optional, e.g. solana:devnet"></label>
    <label>Availability<select name="availability"><option value="available">available</option><option value="limited">limited</option><option value="unavailable">unavailable</option></select></label>
    <label>Indicative price<input name="priceAmount" inputmode="decimal" placeholder="Optional"></label>
    <label>Price asset<input name="priceAsset" maxlength="16" placeholder="SOL"></label>
    <div class="mc-dialog-actions"><button class="mc-btn mc-btn--secondary" type="button" data-dialog-close>Cancel</button><button class="mc-btn mc-btn--primary" type="submit">Persist capability</button></div>
  </form>
</dialog>
<dialog id="mc-resource-request-dialog" class="mc-card mc-settlement-dialog" aria-labelledby="mc-request-title">
  <h2 id="mc-request-title">Request resource</h2>
  <form id="mc-resource-request-form" class="mc-form-stack">
    <p class="mc-kicker" data-request-progress>Step 1 of 7</p>
    <section data-request-step><h3>Select requester machine</h3><label>Owned machine<select name="requesterMachineId" required>${machineOptions(machines)}</select></label></section>
    <section data-request-step hidden><h3>Select resource/capability</h3><label>Resource type<select name="resourceType" required>${resourceTypeOptions()}</select></label><p class="mc-dim">A specific persisted provider capability is selected after discovery.</p></section>
    <section data-request-step hidden><h3>Define requirements</h3><label>Quantity<input name="quantity" inputmode="decimal" required value="1"></label><label>Maximum unit price<input name="maxPrice" inputmode="decimal" required></label><label>Preferred runtime rails<input name="preferredRails" maxlength="256" placeholder="Optional, e.g. solana:devnet"></label><label>Purpose<textarea name="purpose" maxlength="256" required></textarea></label></section>
    <section data-request-step hidden><h3>Discover compatible providers</h3><p>Continue to query the authenticated marketplace API for available persisted capabilities matching the selected type and rails.</p></section>
    <section data-request-step hidden><h3>Compare available providers/quotes</h3><label>Provider capability<select name="capabilityId" required></select></label><p data-provider-empty hidden class="mc-dim">No matching providers. No request will be submitted.</p><p class="mc-dim">Displayed prices are provider advertisements, not accepted quotes. The provider must offer a durable quote after submission.</p></section>
    <section data-request-step hidden><h3>Select provider</h3><p>Confirm the provider selection above. The backend revalidates availability, resource type, runtime rail, ownership, and price limit.</p><dl class="mc-kv"><div><dt>Provider</dt><dd data-request-review-provider></dd></div></dl></section>
    <section data-request-step hidden><h3>Review request</h3><dl class="mc-kv"><div><dt>Requester</dt><dd data-request-review-machine></dd></div><div><dt>Resource</dt><dd data-request-review-resource></dd></div><div><dt>Quantity</dt><dd data-request-review-quantity></dd></div><div><dt>Max unit price</dt><dd data-request-review-limit></dd></div><div><dt>Provider</dt><dd data-request-review-provider></dd></div></dl><p class="mc-dim">Submission persists a pending request. It does not imply a quote, access grant, fulfillment, receipt, or settlement.</p></section>
    <div class="mc-dialog-actions"><button class="mc-btn mc-btn--secondary" type="button" data-dialog-close>Close</button><button class="mc-btn mc-btn--secondary" type="button" data-request-back disabled>Back</button><button class="mc-btn mc-btn--primary" type="submit" data-request-next>Continue</button></div>
  </form>
</dialog>`;

const isExpiredAt = (expiresAt: string | null, renderTime: Date): boolean =>
  expiresAt !== null && Number.isFinite(Date.parse(expiresAt)) && Date.parse(expiresAt) <= renderTime.getTime();

export const effectiveQuoteState = (quote: PersistentResourceQuote, renderTime: Date): string =>
  quote.state === 'offered' && isExpiredAt(quote.expiresAt, renderTime)
    ? 'expired'
    : quote.state;

export const effectiveGrantState = (grant: PersistentAccessGrant | null, renderTime: Date): string =>
  grant && (grant.state === 'pending' || grant.state === 'active') && isExpiredAt(grant.expiresAt, renderTime)
    ? 'expired'
    : grant?.state ?? 'none';

export const canCreateAccessGrant = (
  grant: PersistentAccessGrant | null,
  renderTime: Date
): boolean => grant === null || ['revoked', 'expired'].includes(effectiveGrantState(grant, renderTime));

export const canReplaceResourceReceipt = (receipt: PersistentResourceReceipt | null): boolean =>
  receipt === null || receipt.state === 'rejected';

const lifecycleState = (view: RequestLifecycleView | undefined, renderTime = new Date()): { grant: string; receipt: string } => ({
  grant: effectiveGrantState(view?.grant ?? null, renderTime),
  receipt: view?.receipt?.state ?? 'none',
});

const workOrdersTable = (orders: readonly PersistentWorkOrder[]): string => table(
  ['Work order', 'Machine', 'Stage', 'Capabilities', 'Settlement', 'Updated'],
  orders.map((order) => [
    `<span class="mc-mono">${esc(order.workOrderId)}</span>`,
    order.machineId ? `<a href="/console/machines/${encodeURIComponent(order.machineId)}/jobs">${esc(order.machineId)}</a>` : 'unassigned',
    esc(order.stage),
    order.requiredCapabilities.length ? order.requiredCapabilities.map(esc).join(', ') : 'none',
    `${esc(order.settlementAmount)} ${esc(order.settlementAsset)} · ${esc(order.settlementChain)}`,
    esc(order.updatedAt),
  ]),
  'Persisted work orders'
);

export function renderTelemetryTable(
  machines: readonly OwnedMachineRecord[],
  events: readonly TelemetryEventRecord[],
  renderTime: Date
): string {
  const latest = latestTelemetryByMachine(events);
  const rows = machines.map((machine) => {
    const event = latest.get(machine.machineId);
    const observedAt = event?.snapshot.observedAt ?? '';
    const receivedAt = event?.receivedAt ?? '';
    const health = event?.snapshot.health ?? '';
    const freshness = classifyTelemetryFreshness(event, renderTime);
    return `<tr data-machine-telemetry="${esc(machine.machineId)}" data-observed-at="${esc(observedAt)}" data-received-at="${esc(receivedAt)}" data-health="${esc(health)}"><td><a href="/console/machines/${encodeURIComponent(machine.machineId)}">${esc(machine.label)}</a><br><span class="mc-mono">${esc(machine.machineId)}</span></td><td><span data-live-observed>${observedAt ? esc(observedAt) : 'Never'}</span></td><td><span data-live-received>${receivedAt ? esc(receivedAt) : 'Never'}</span></td><td><span data-live-health>${health ? esc(health) : 'unknown'}</span></td><td><strong data-live-state data-freshness="${freshness.toLowerCase()}">${freshness}</strong></td><td data-live-battery>${event?.snapshot.batteryPct === undefined ? 'not recorded' : `${esc(event.snapshot.batteryPct)}%`}</td><td data-live-signal>${event?.snapshot.signalPct === undefined ? 'not recorded' : `${esc(event.snapshot.signalPct)}%`}</td><td data-live-progress>${event?.snapshot.progressPct === undefined ? 'not recorded' : `${esc(event.snapshot.progressPct)}%`}</td><td data-live-location>${event ? esc(telemetryLocation(event.snapshot)) : 'not recorded'}</td><td data-live-pose>${event ? esc(telemetryPose(event.snapshot)) : 'not recorded'}</td><td data-live-telemetry-ref class="mc-mono">${esc(event?.snapshot.telemetryRef ?? 'not recorded')}</td></tr>`;
  });
  return `<div class="mc-table-scroll" role="region" aria-label="Live machine telemetry" tabindex="0"><table class="mc-table"><thead><tr><th>Machine</th><th>Observed</th><th>Received</th><th>Health</th><th>Freshness</th><th>Battery</th><th>Signal</th><th>Progress</th><th>Location</th><th>Pose</th><th>Telemetry ref</th></tr></thead><tbody>${rows.length ? rows.join('') : '<tr><td colspan="11" class="mc-dim">No owned machines. No fixture telemetry is substituted.</td></tr>'}</tbody></table></div>`;
}

const telemetryLocation = (snapshot: TelemetryEventRecord['snapshot']): string => snapshot.location
  ? `${snapshot.location.lat}, ${snapshot.location.lon}${snapshot.location.altitudeM === undefined ? '' : ` · ${snapshot.location.altitudeM} m`}`
  : 'not recorded';

const telemetryPose = (snapshot: TelemetryEventRecord['snapshot']): string => snapshot.pose
  ? `x ${snapshot.pose.x} · y ${snapshot.pose.y}${snapshot.pose.z === undefined ? '' : ` · z ${snapshot.pose.z}`}${snapshot.pose.yawDeg === undefined ? '' : ` · yaw ${snapshot.pose.yawDeg}°`}`
  : 'not recorded';

export interface ProductionConsoleResult { status: number; html: string; }

export const isSettlementEligibleRequest = (request: PersistentResourceRequest): boolean =>
  (request.state === 'accepted' || request.state === 'granted') &&
  request.providerMachineId !== null &&
  request.quoteAmount !== null &&
  request.quoteAsset === 'SOL';

export const isProviderCapabilityCompatibleWithRequest = (
  capability: ProviderCapabilityRow,
  request: PersistentResourceRequest
): boolean => capability.availability !== 'unavailable' &&
  capability.resourceType === request.resourceType &&
  (request.capabilityId === null || request.capabilityId === capability.id) &&
  (request.providerMachineId === null || request.providerMachineId === capability.providerMachineId) &&
  (request.preferredRails.length === 0 || request.preferredRails.some((rail) => capability.railTags.includes(rail))) &&
  (capability.priceAmount === null || decimalAmountLte(capability.priceAmount, request.maxPrice));

export const canProviderRejectRequest = (
  request: PersistentResourceRequest,
  ownedMachines: readonly OwnedMachineRecord[]
): boolean => ['pending', 'quoted'].includes(request.state) &&
  request.providerMachineId !== null &&
  ownedMachines.some((machine) => machine.machineId === request.providerMachineId);

export async function renderProductionConsoleDocument(input: {
  req: IncomingMessage;
  pathname: string;
  nonce: string;
  version: string;
  config: ServerConfig;
  runtime: ProductionRuntime;
}): Promise<ProductionConsoleResult> {
  let auth;
  try {
    auth = await input.runtime.auth.authenticate(input.req);
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 401) throw error;
    const login = `<main id="mc-main" class="mc-auth-page">
      <section class="mc-auth-showcase" aria-label="Machine Console introduction">
        <a class="mc-brand mc-auth-brand" href="/console/overview"><span class="mc-brand__mark" aria-hidden="true"><span>M</span></span><span class="mc-brand__meta"><span class="mc-brand__name">Machine Console</span><span class="mc-brand__sub">Production control plane</span></span></a>
        <div class="mc-auth-showcase__copy"><p class="mc-kicker">Secure machine infrastructure</p><h1>Operate physical networks with verifiable ownership.</h1><p>Monitor machines, coordinate resources, and settle work through one ownership-scoped control plane.</p></div>
        <div class="mc-auth-proof-grid"><div><span class="mc-auth-proof__icon">01</span><strong>Wallet-owned</strong><small>Every operation is authorized server-side.</small></div><div><span class="mc-auth-proof__icon">02</span><strong>${esc(solanaClusterDisplayLabel(input.config.solanaCluster))} verified</strong><small>RPC identity is checked before startup.</small></div><div><span class="mc-auth-proof__icon">03</span><strong>Non-custodial</strong><small>Your private keys never leave your wallet.</small></div></div>
      </section>
      <section class="mc-card mc-auth-card">
        <span class="mc-environment"><span class="mc-dot mc-dot--pulse"></span>${esc(solanaClusterDisplayLabel(input.config.solanaCluster))}</span>
        <div class="mc-auth-card__copy"><p class="mc-kicker">Welcome back</p><h2>Authenticate with your wallet</h2><p>Sign a short-lived authentication message to enter your production workspace.</p></div>
        <button id="mc-production-connect" class="mc-btn mc-btn--primary mc-btn--auth" type="button"><span aria-hidden="true">↗</span> Connect Solana wallet</button>
        <p id="mc-production-status" role="status" aria-live="polite" class="mc-auth-status">No wallet is connected.</p>
        <div class="mc-auth-security"><span aria-hidden="true">✓</span><p><strong>Safe authentication</strong><br>No transaction, payment, private key, or seed phrase is requested.</p></div>
      </section>
    </main>`;
    return { status: 200, html: document('Authenticate', input.nonce, login, input.version) };
  }

  const route = routeFromPath(input.pathname);
  if (route.section === 'not-found') {
    return { status: 404, html: document('Not found', input.nonce, layout('not-found', auth.record.walletAddress, input.config.solanaCluster ?? 'custom', '<h1>Not found</h1><p>This Console route does not exist.</p>'), input.version) };
  }

  const userId = auth.record.userId;
  const renderTime = new Date();
  const machines = await input.runtime.store.listOwnedMachines(userId, 100);
  const machineById = route.section === 'machines' && route.detailId
    ? await input.runtime.store.ownedMachine(userId, route.detailId)
    : null;
  if (route.section === 'machines' && route.detailId && !machineById) {
    return { status: 404, html: document('Machine not found', input.nonce, layout('machines', auth.record.walletAddress, input.config.solanaCluster ?? 'custom', '<h1>Machine not found</h1><p>No owned machine has this identifier.</p>'), input.version) };
  }
  const machineTab = route.section === 'machines' ? route.tab ?? 'overview' : null;
  const needsLifecycle = route.section === 'resources' || route.section === 'receipts' ||
    (route.section === 'machines' && (machineTab === 'resources' || machineTab === 'receipts'));
  const needsRequests = needsLifecycle || route.section === 'overview' || route.section === 'settlements' ||
    (route.section === 'machines' && machineTab === 'settlements');
  const needsWorkOrders = route.section === 'overview' || route.section === 'jobs' ||
    (route.section === 'machines' && (machineTab === 'overview' || machineTab === 'runtime' || machineTab === 'jobs'));
  const needsSettlements = route.section === 'receipts' || route.section === 'settlements' ||
    (route.section === 'machines' && (machineTab === 'settlements' || machineTab === 'receipts'));
  const [capabilities, requests, providerRequests, workOrders, settlements] = await Promise.all([
    route.section === 'resources'
      ? input.runtime.store.listProviderCapabilities(userId, 100)
      : Promise.resolve<readonly ProviderCapabilityRow[]>([]),
    needsRequests
      ? input.runtime.store.listResourceRequests(userId, 100)
      : Promise.resolve<readonly PersistentResourceRequest[]>([]),
    needsLifecycle
      ? input.runtime.store.listProviderResourceRequests(userId, 100)
      : Promise.resolve<readonly PersistentResourceRequest[]>([]),
    needsWorkOrders
      ? input.runtime.store.listWorkOrders(userId, null, 100)
      : Promise.resolve<readonly PersistentWorkOrder[]>([]),
    needsSettlements
      ? input.runtime.store.listSettlements(userId, 100)
      : Promise.resolve<readonly SettlementRecord[]>([]),
  ]);
  // One bounded DISTINCT-per-machine query prevents a noisy machine starving
  // other rows. Machine runtime/telemetry detail asks only for that history.
  const telemetry: TelemetryEventRecord[] = [];
  if (route.section === 'overview' || route.section === 'telemetry') {
    telemetry.push(...await input.runtime.store.latestTelemetry(userId, 100));
  } else if (machineById && (machineTab === 'runtime' || machineTab === 'telemetry')) {
    telemetry.push(...await input.runtime.store.recentTelemetry(userId, machineById.machineId, 100));
  }
  const requestList = requests.slice(0, 100);
  const providerRequestList = providerRequests.slice(0, 100);
  const visibleRequests = [...new Map(
    [...requestList, ...providerRequestList].map((request) => [request.id, request] as const)
  ).values()].slice(0, 200);
  let directlyProviderAuthorized = false;
  if (route.section === 'resources' && route.detailId && !visibleRequests.some((request) => request.id === route.detailId)) {
    const directlyOwned = await input.runtime.store.resourceRequest(userId, route.detailId);
    const directlyProvider = directlyOwned ? null : await input.runtime.store.providerResourceRequest(userId, route.detailId);
    const directlyAuthorized = directlyOwned ?? directlyProvider;
    directlyProviderAuthorized = directlyProvider !== null;
    if (directlyAuthorized) visibleRequests.push(directlyAuthorized);
  }
  const providerRequestIds = new Set(providerRequests.map((request) => request.id));
  if (directlyProviderAuthorized && route.detailId) providerRequestIds.add(route.detailId);
  const detailLifecycleRequest = route.section === 'resources' && route.detailId
    ? visibleRequests.find((request) => request.id === route.detailId) ?? null
    : null;
  const lifecycleRequests = detailLifecycleRequest ? [detailLifecycleRequest] : visibleRequests;
  const lifecycleRecords = needsLifecycle
    ? await input.runtime.store.resourceRequestLifecycles(
      userId,
      lifecycleRequests.map((request) => request.id),
      renderTime.toISOString()
    )
    : [];
  const lifecycleRecordByRequest = new Map(
    lifecycleRecords.map((record) => [record.resourceRequestId, record] as const)
  );
  const lifecycleViews = needsLifecycle ? lifecycleRequests.map((request): RequestLifecycleView => {
    const lifecycle = lifecycleRecordByRequest.get(request.id);
    const grant = lifecycle?.grant ?? null;
    const displayGrant = grant && effectiveGrantState(grant, renderTime) === 'expired'
      ? { ...grant, state: 'expired' as const }
      : grant;
    return {
      request,
      quotes: lifecycle?.quotes ?? [],
      grant: displayGrant,
      receipt: lifecycle?.receipt ?? null,
      receiptSettlement: lifecycle?.receiptSettlement ?? null,
      providerView: providerRequestIds.has(request.id),
    };
  }) : [];
  const lifecycleByRequest = new Map(lifecycleViews.map((view) => [view.request.id, view] as const));
  const detailRequest = route.section === 'resources' && route.detailId
    ? lifecycleByRequest.get(route.detailId) ?? null
    : null;
  const detailCapability = route.section === 'resources' && route.detailId
    ? capabilities.find((capability) => capability.id === route.detailId) ??
      await input.runtime.store.providerCapability(userId, route.detailId)
    : null;
  const detailResourceSettlement = route.section === 'resources' && detailRequest
    ? await input.runtime.store.settlementForResourceRequest(userId, detailRequest.request.id)
    : null;
  const detailReceiptSettlement = detailRequest?.receiptSettlement ?? null;
  const detailTargetCapability = route.section === 'resources' && detailRequest?.request.capabilityId
    ? capabilities.find((capability) => capability.id === detailRequest.request.capabilityId) ??
      await input.runtime.store.providerCapability(userId, detailRequest.request.capabilityId)
    : null;
  const detailWorkOrder = route.section === 'jobs' && route.detailId
    ? workOrders.find((candidate) => candidate.workOrderId === route.detailId) ??
      await input.runtime.store.workOrder(userId, route.detailId)
    : null;
  if (route.section === 'resources' && route.detailId && !detailRequest && !detailCapability) {
    return { status: 404, html: document('Resource not found', input.nonce, layout('resources', auth.record.walletAddress, input.config.solanaCluster ?? 'custom', '<h1>Resource not found</h1><p>No visible capability or authorized request has this identifier.</p>'), input.version) };
  }
  let body = '';

  if (route.section === 'overview') {
    const liveMachines = latestTelemetryByMachine(telemetry).size;
    body = `<section class="mc-overview-hero">
      <div><p class="mc-kicker">Authenticated production data</p><h1>Command center</h1><p>Ownership-scoped activity across your machine network.</p></div>
      <div class="mc-overview-hero__meta"><span class="mc-environment"><span class="mc-dot mc-dot--pulse"></span>${esc(solanaClusterDisplayLabel(input.config.solanaCluster))}</span><span class="mc-verified-label">Genesis verified</span></div>
    </section>
    <div class="mc-stat-grid mc-overview-stats">
      <section class="mc-card mc-stat"><div class="mc-stat__head"><span class="mc-stat__eyebrow">Owned machines</span><span class="mc-stat__glyph" aria-hidden="true">M</span></div><strong class="mc-stat__value">${machines.length}</strong><p class="mc-stat__hint">Authorized for this wallet</p></section>
      <section class="mc-card mc-stat"><div class="mc-stat__head"><span class="mc-stat__eyebrow">Live telemetry</span><span class="mc-stat__glyph mc-stat__glyph--online" aria-hidden="true">↗</span></div><strong class="mc-stat__value">${liveMachines}</strong><p class="mc-stat__hint">Machines reporting now</p></section>
      <section class="mc-card mc-stat"><div class="mc-stat__head"><span class="mc-stat__eyebrow">Resource requests</span><span class="mc-stat__glyph" aria-hidden="true">R</span></div><strong class="mc-stat__value">${requests.length}</strong><p class="mc-stat__hint">Recent marketplace activity</p></section>
      <section class="mc-card mc-stat"><div class="mc-stat__head"><span class="mc-stat__eyebrow">Work orders</span><span class="mc-stat__glyph" aria-hidden="true">J</span></div><strong class="mc-stat__value">${workOrders.length}</strong><p class="mc-stat__hint">Owner-scoped jobs</p></section>
    </div>
    ${machines.length === 0 ? `<section class="mc-card mc-onboarding">
      <div class="mc-onboarding__intro"><span class="mc-onboarding__number">01</span><div><p class="mc-kicker">Start here</p><h2>Bring your first machine online</h2><p>Your wallet is authenticated. Register a machine through the ownership-scoped API to unlock telemetry, jobs, resources, and settlements.</p></div></div>
      <div class="mc-onboarding__steps"><div><span>1</span><strong>Register</strong><small>Create a machine owned by this wallet.</small></div><div><span>2</span><strong>Connect</strong><small>Issue a scoped ingestion credential.</small></div><div><span>3</span><strong>Operate</strong><small>Stream telemetry and assign work.</small></div></div>
      <div class="mc-onboarding__actions"><button class="mc-btn mc-btn--primary" type="button" data-machine-open>Register first machine</button><a class="mc-btn mc-btn--secondary" href="/api">View API routes</a></div>
    </section>` : `<section class="mc-card mc-overview-panel"><div><p class="mc-kicker">Fleet status</p><h2>Machine network</h2><p>${machines.length} machine${machines.length === 1 ? '' : 's'} registered, ${liveMachines} currently reporting telemetry.</p></div><a class="mc-btn mc-btn--secondary" href="/console/machines">Open registry</a></section>`}
    <section class="mc-card mc-network-proof"><div class="mc-network-proof__mark" aria-hidden="true">✓</div><div><p class="mc-kicker">Verified network boundary</p><h2>Solana ${esc(solanaClusterDisplayLabel(input.config.solanaCluster))}</h2><p>RPC genesis identity was cryptographically checked at startup—an environment label alone was not trusted.</p></div><div class="mc-network-proof__hash"><span>Genesis hash</span><code>${esc(input.runtime.network.actualGenesisHash)}</code><small>Verified ${esc(input.runtime.network.verifiedAt)}</small></div></section>${machineRegistrationDialog()}`;
  } else if (route.section === 'machines') {
    if (machineById) {
      const events = telemetry.filter((event) => event.machineId === machineById.machineId);
      const activeTab = route.tab ?? 'overview';
      const [machineCapabilities, sessions, credentials] = await Promise.all([
        activeTab === 'overview' || activeTab === 'resources'
          ? input.runtime.store.listMachineCapabilities(userId, machineById.machineId)
          : Promise.resolve([]),
        activeTab === 'overview' || activeTab === 'runtime'
          ? input.runtime.store.listRuntimeSessions(userId, machineById.machineId, 100)
          : Promise.resolve([]),
        activeTab === 'overview'
          ? input.runtime.store.listMachineCredentials(userId, machineById.machineId, 100)
          : Promise.resolve([]),
      ]);
      const machineOrders = workOrders.filter((order) => order.machineId === machineById.machineId);
      const machineRequestViews = lifecycleViews.filter((view) => view.request.requesterMachineId === machineById.machineId || view.request.providerMachineId === machineById.machineId);
      const detailTabs = ['overview', 'runtime', 'jobs', 'resources', 'telemetry', 'settlements', 'receipts'] as const;
      const tabs = `<nav class="mc-detail-tabs" aria-label="Machine detail">${detailTabs.map((tabName) => `<a href="/console/machines/${encodeURIComponent(machineById.machineId)}/${tabName}"${activeTab === tabName ? ' aria-current="page"' : ''}>${esc(tabName)}</a>`).join('')}</nav>`;
      const header = `<p class="mc-kicker">Owned machine</p><h1>${esc(machineById.label)}</h1><p class="mc-mono">${esc(machineById.machineId)}</p><p class="mc-dim">Verified Solana network: ${esc(solanaClusterDisplayLabel(input.config.solanaCluster))} · genesis <span class="mc-mono">${esc(input.runtime.network.actualGenesisHash)}</span></p>${tabs}`;
      if (activeTab === 'runtime') {
        const latestSession = [...sessions].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
        const activeSession = sessions.find((session) => session.endedAt === null);
        const latestActivity = [latestSession?.updatedAt, events[0]?.receivedAt, machineOrders[0]?.updatedAt].filter((value): value is string => Boolean(value)).sort().at(-1) ?? 'none';
        const timeline = [
          ...sessions.flatMap((session) => [
            { at: session.createdAt, event: 'SESSION CREATED', ref: session.sessionId },
            ...(session.endedAt ? [{ at: session.endedAt, event: 'SESSION ENDED', ref: session.sessionId }] : []),
          ]),
          ...machineOrders.map((order) => ({ at: order.createdAt, event: 'JOB REQUESTED', ref: order.workOrderId })),
          ...events.map((event) => ({ at: event.receivedAt, event: 'TELEMETRY RECEIVED', ref: event.id })),
        ].sort((left, right) => right.at.localeCompare(left.at));
        const proofRows = machineOrders
          .filter((order) => order.proofRequired || order.proofId)
          .map((order) => [
            `<a href="/console/jobs/${encodeURIComponent(order.workOrderId)}">${esc(order.workOrderId)}</a>`,
            order.proofId ? `<span class="mc-mono">${esc(order.proofId)}</span>` : 'required, not recorded',
          ]);
        body = `${header}<section class="mc-card"><h2>Runtime header</h2><dl class="mc-kv"><div><dt>Status</dt><dd>${activeSession ? 'active' : 'idle'}</dd></div><div><dt>Network</dt><dd>${esc(latestSession?.chain ?? 'no persisted session')}</dd></div><div><dt>Last activity</dt><dd>${esc(latestActivity)}</dd></div></dl></section>${activeSession ? '<p class="mc-dim">End the active session before starting a replacement.</p>' : `<section class="mc-card"><h2>Start runtime session</h2><form class="mc-form-inline" data-runtime-session-form data-machine-id="${esc(machineById.machineId)}"><label>Policy profile<input name="policyProfileId" maxlength="128" value="standard-machine-policy"></label><button class="mc-btn mc-btn--primary" type="submit">Start session</button></form></section>`}<h2>Sessions</h2>${table(['Session', 'Status', 'Chain', 'Started', 'Updated', 'Duration', 'Action'], sessions.map((session) => { const ended = session.endedAt ? Date.parse(session.endedAt) : renderTime.getTime(); const duration = Math.max(0, ended - Date.parse(session.createdAt)); return [`<span class="mc-mono">${esc(session.sessionId)}</span>`, session.endedAt ? 'ended' : 'active', esc(session.chain), esc(session.createdAt), esc(session.updatedAt), Number.isFinite(duration) ? `${Math.floor(duration / 1000)}s` : 'unknown', session.endedAt ? '—' : `<button class="mc-btn mc-btn--secondary" type="button" data-runtime-session-end="${esc(session.sessionId)}">End session</button>`]; }), 'Runtime sessions')}<h2>Current jobs</h2>${workOrdersTable(machineOrders.filter((order) => !['settled', 'failed', 'cancelled'].includes(order.stage)))}<h2>Persisted runtime timeline</h2>${table(['Time', 'Event', 'Record'], timeline.map((item) => [esc(item.at), esc(item.event), `<span class="mc-mono">${esc(item.ref)}</span>`]), 'Actual runtime events')}<h2>Policy</h2><section class="mc-card"><p>No persisted machine policy profile is available in the production store. The Console does not synthesize a policy decision or imply that descriptive runtime limits were enforced.</p></section><h2>Proof</h2>${table(['Work order', 'Proof'], proofRows, 'Persisted machine proof references')}<p class="mc-dim">Only proof identifiers already recorded on work orders are shown. This application has no proof payload store or autonomous proof pipeline.</p>`;
      } else if (activeTab === 'jobs') {
        body = `${header}<h2>Persisted work orders</h2>${workOrdersTable(machineOrders)}`;
      } else if (activeTab === 'resources') {
        body = `${header}<h2>Runtime capabilities</h2>${table(['Capability', 'Recorded'], machineCapabilities.map((capability) => [esc(capability.capability), esc(capability.createdAt)]), 'Machine capabilities')}<h2>Resource requests and provisions</h2>${table(['Request', 'Role', 'Type', 'State', 'Grant', 'Receipt'], machineRequestViews.map((view) => { const state = lifecycleState(view); return [`<a href="/console/resources/${encodeURIComponent(view.request.id)}">${esc(view.request.id)}</a>`, view.request.requesterMachineId === machineById.machineId ? 'requester' : 'provider', esc(view.request.resourceType), esc(view.request.state), esc(state.grant), esc(state.receipt)]; }), 'Machine resource records')}`;
      } else if (activeTab === 'telemetry') {
        body = `${header}<section data-production-live data-machine-id="${esc(machineById.machineId)}" data-live-window-ms="${TELEMETRY_LIVE_WINDOW_MS}" data-offline-window-ms="${TELEMETRY_OFFLINE_WINDOW_MS}" data-future-tolerance-ms="${TELEMETRY_FUTURE_TOLERANCE_MS}"><p>Stream: <strong data-live-connection data-connection="connecting">Connecting</strong>. SSE is primary; a machine-scoped 30-second durable reconciliation converges across instances.</p>${renderTelemetryTable([machineById], events, renderTime)}<h2>Persisted telemetry history</h2>${table(['Observed', 'Received', 'Health', 'Freshness', 'Battery', 'Signal', 'Progress', 'Location', 'Pose', 'Telemetry ref'], events.map((event) => [esc(event.snapshot.observedAt), esc(event.receivedAt), esc(event.snapshot.health), classifyTelemetryFreshness(event, renderTime), event.snapshot.batteryPct === undefined ? 'not recorded' : `${esc(event.snapshot.batteryPct)}%`, event.snapshot.signalPct === undefined ? 'not recorded' : `${esc(event.snapshot.signalPct)}%`, event.snapshot.progressPct === undefined ? 'not recorded' : `${esc(event.snapshot.progressPct)}%`, esc(telemetryLocation(event.snapshot)), esc(telemetryPose(event.snapshot)), esc(event.snapshot.telemetryRef ?? 'not recorded')]), 'Machine telemetry history')}</section>`;
      } else if (activeTab === 'receipts') {
        body = `${header}${table(['Request', 'Grant', 'Receipt', 'Evidence', 'Result'], machineRequestViews.map((view) => [`<a href="/console/resources/${encodeURIComponent(view.request.id)}">${esc(view.request.id)}</a>`, esc(view.grant?.state ?? 'none'), esc(view.receipt?.state ?? 'none'), esc(view.receipt?.evidenceReference ?? 'none'), esc(view.receipt?.resultReference ?? 'none')]), 'Machine resource receipts')}`;
      } else if (activeTab === 'settlements') {
        const machineSettlements = settlements.filter((settlement) => settlement.machineId === machineById.machineId);
        body = `${header}<p>Submitted and confirmed are distinct persisted states. Continue in the ownership-scoped settlement view to review or sign eligible records.</p>${table(['Settlement', 'Request', 'State', 'Signature', 'Updated', 'Action'], machineSettlements.map((settlement) => [`<span class="mc-mono">${esc(settlement.id)}</span>`, `<a href="/console/resources/${encodeURIComponent(settlement.resourceRequestId)}">${esc(settlement.resourceRequestId)}</a>`, esc(settlement.state), transactionSignatureCell(settlement.transactionSignature, input.config.solanaCluster), esc(settlement.updatedAt), '<a class="mc-btn mc-btn--primary" href="/console/settlements">Open settlements</a>']), 'Machine settlements')}`;
      } else {
        const selectedCapabilities = new Set(machineCapabilities.map((capability) => capability.capability));
        body = `${header}<dl class="mc-kv"><div><dt>Role</dt><dd>${esc(machineById.role)}</dd></div><div><dt>Wallet</dt><dd class="mc-mono">${esc(machineById.walletAddress)}</dd></div><div><dt>Runtime capabilities</dt><dd>${machineCapabilities.length ? machineCapabilities.map((capability) => esc(capability.capability)).join(', ') : 'none persisted'}</dd></div><div><dt>Sessions</dt><dd>${sessions.length}</dd></div><div><dt>Work orders</dt><dd>${machineOrders.length}</dd></div></dl><section class="mc-card mc-setup-card"><h2>Configure runtime capabilities</h2><p>Jobs assigned to this machine are checked against these persisted capabilities.</p><form class="mc-form-stack" data-machine-capability-form data-machine-id="${esc(machineById.machineId)}"><fieldset class="mc-choice-grid"><legend>Supported capabilities</legend>${capabilityCheckboxes(selectedCapabilities)}</fieldset><div class="mc-dialog-actions"><button class="mc-btn mc-btn--primary" type="submit">Save capabilities</button></div></form></section><section class="mc-card mc-setup-card"><h2>Machine authentication</h2><p>Machine credentials are created through the operator API and delivered directly to the native runtime secret manager. Plaintext credentials are never embedded in this Console. Scope: <code>telemetry:write</code>.</p><p class="mc-dim">Issue through <code>POST /api/machines/${esc(machineById.machineId)}/credentials</code>, then configure the native runtime to call <code>POST /api/machines/${esc(machineById.machineId)}/telemetry</code> without a browser Origin header.</p>${table(['Credential', 'Label', 'Expires', 'State', 'Scope', 'Action'], credentials.map((credential) => [`<span class="mc-mono">${esc(credential.id)}</span>`, esc(credential.label), esc(credential.expiresAt ?? 'never'), credential.revokedAt ? `revoked ${esc(credential.revokedAt)}` : 'active', 'telemetry:write', credential.revokedAt ? '—' : `<button class="mc-btn mc-btn--secondary" type="button" data-machine-credential-revoke="${esc(credential.id)}">Revoke</button>`]), 'Machine credential metadata')}</section>`;
      }
    } else {
      body = `<p class="mc-kicker">Ownership-scoped registry</p><h1>Machines</h1><p class="mc-dim">Register a real machine record, then open it to configure capabilities, runtime sessions, jobs, credentials, and telemetry.</p><div class="mc-dialog-actions"><button class="mc-btn mc-btn--primary" type="button" data-machine-open>Register machine</button></div>${table(['Machine', 'Role', 'Wallet', 'Updated'], machines.map((machine) => [`<a href="/console/machines/${encodeURIComponent(machine.machineId)}">${esc(machine.label)}</a><br><span class="mc-mono">${esc(machine.machineId)}</span>`, esc(machine.role), `<span class="mc-mono">${esc(machine.walletAddress)}</span>`, esc(machine.updatedAt)]), 'Owned machines')}${machineRegistrationDialog()}`;
    }
  } else if (route.section === 'telemetry') {
    body = `<p class="mc-kicker">Credential-authenticated ingestion</p><h1>Live telemetry</h1><section data-production-live data-live-window-ms="${TELEMETRY_LIVE_WINDOW_MS}" data-offline-window-ms="${TELEMETRY_OFFLINE_WINDOW_MS}" data-future-tolerance-ms="${TELEMETRY_FUTURE_TOLERANCE_MS}"><p>Stream: <strong data-live-connection data-connection="connecting">Connecting</strong>. New events arrive over an authenticated server-sent event stream, with a bounded 30-second owner-scoped persistence reconciliation for multi-instance convergence. Rows use persisted observation and server-receipt timestamps; retained records remain visible during reconnects.</p>${renderTelemetryTable(machines, telemetry, renderTime)}</section>`;
  } else if (route.section === 'resources') {
    if (detailCapability) {
      const owned = detailCapability.ownerUserId === userId;
      const history = lifecycleViews.filter((view) => view.request.capabilityId === detailCapability.id);
      body = `<p class="mc-kicker">Provider capability</p><h1>${esc(detailCapability.label)}</h1><dl class="mc-kv"><div><dt>Capability ID</dt><dd class="mc-mono">${esc(detailCapability.id)}</dd></div><div><dt>Resource type</dt><dd>${esc(detailCapability.resourceType)}</dd></div><div><dt>Provider machine</dt><dd class="mc-mono">${esc(detailCapability.providerMachineId)}</dd></div><div><dt>Availability</dt><dd>${esc(detailCapability.availability)}</dd></div><div><dt>Runtime rails/network</dt><dd>${detailCapability.railTags.length ? detailCapability.railTags.map(esc).join(', ') : 'none declared'}</dd></div><div><dt>Pricing</dt><dd>${detailCapability.priceAmount ? `${esc(detailCapability.priceAmount)} ${esc(detailCapability.priceAsset ?? '')} / ${esc(detailCapability.unit)}` : 'quote required'}</dd></div><div><dt>Provider status</dt><dd>UNKNOWN · no cross-owner telemetry is exposed</dd></div></dl><div class="mc-dialog-actions">${owned ? capabilityEditButton(detailCapability) : ''}${machines.length && detailCapability.availability !== 'unavailable' ? `<button class="mc-btn mc-btn--primary" type="button" data-request-open data-capability-id="${esc(detailCapability.id)}" data-resource-type="${esc(detailCapability.resourceType)}">Request resource</button>` : ''}</div><h2>Authorized request history</h2>${table(['Request', 'Requester', 'State', 'Quote', 'Grant', 'Receipt', 'Created'], history.map((view) => { const state = lifecycleState(view); return [`<a href="/console/resources/${encodeURIComponent(view.request.id)}">${esc(view.request.id)}</a>`, esc(view.request.requesterMachineId), esc(view.request.state), view.request.quoteAmount ? `${esc(view.request.quoteAmount)} ${esc(view.request.quoteAsset ?? '')}` : 'none', esc(state.grant), esc(state.receipt), esc(view.request.createdAt)]; }), 'Capability request history')}${marketplaceDialogs(machines)}`;
    } else if (detailRequest) {
      const request = detailRequest.request;
      const requesterView = request.ownerUserId === userId;
      const providerView = detailRequest.providerView;
      const acceptedQuote = detailRequest.quotes.find((quote) => effectiveQuoteState(quote, renderTime) === 'accepted') ?? null;
      const quoteCapabilities = detailTargetCapability && !capabilities.some((capability) => capability.id === detailTargetCapability.id)
        ? [...capabilities, detailTargetCapability]
        : capabilities;
      const ownedMatchingCapabilities = quoteCapabilities.filter((capability) =>
        capability.ownerUserId === userId && isProviderCapabilityCompatibleWithRequest(capability, request)
      );
      const settlement = detailResourceSettlement ?? detailReceiptSettlement;
      const quoteRows = detailRequest.quotes.map((quote) => {
        const quoteState = effectiveQuoteState(quote, renderTime);
        const actions: string[] = [];
        if (requesterView && quoteState === 'offered' && ['pending', 'quoted'].includes(request.state)) {
          actions.push(`<button class="mc-btn mc-btn--primary" type="button" data-market-action="accept_quote" data-request-id="${esc(request.id)}" data-record-id="${esc(quote.id)}">Accept quote</button>`);
        }
        if (quote.providerOwnerUserId === userId && quoteState === 'offered') {
          actions.push(`<button class="mc-btn mc-btn--secondary" type="button" data-market-action="withdraw_quote" data-request-id="${esc(request.id)}" data-record-id="${esc(quote.id)}">Withdraw quote</button>`);
        }
        return [
          `<span class="mc-mono">${esc(quote.id)}</span>`, esc(quote.providerMachineId), `${esc(quote.amount)} ${esc(quote.asset)}`,
          esc(quoteState), esc(quote.expiresAt ?? 'none'), actions.join(' ') || '—',
        ];
      });
      const quoteForm = providerView && ['pending', 'quoted'].includes(request.state) && ownedMatchingCapabilities.length
        ? `<section class="mc-card"><h2>Offer provider quote</h2><form class="mc-form-inline" data-provider-quote-form data-request-id="${esc(request.id)}"><label>Capability<select name="capabilityId" required>${ownedMatchingCapabilities.map((capability) => `<option value="${esc(capability.id)}">${esc(capability.label)} · ${esc(capability.providerMachineId)}</option>`).join('')}</select></label><label>Unit amount<input name="amount" inputmode="decimal" required></label><label>Asset<input name="asset" required maxlength="16" value="SOL"></label><label>Expires at (ISO)<input name="expiresAt" placeholder="Optional ISO timestamp"></label><button class="mc-btn mc-btn--primary" type="submit">Offer quote</button></form></section>`
        : '';
      let grantActions = '';
      const grantState = effectiveGrantState(detailRequest.grant, renderTime);
      const receiptReplaceable = canReplaceResourceReceipt(detailRequest.receipt);
      if (providerView && request.state === 'accepted' && acceptedQuote &&
        receiptReplaceable && canCreateAccessGrant(detailRequest.grant, renderTime)) {
        grantActions = `<section class="mc-card"><h2>Create access grant</h2><form class="mc-form-inline" data-access-grant-form data-request-id="${esc(request.id)}"><input type="hidden" name="resourceQuoteId" value="${esc(acceptedQuote.id)}"><label>Access reference<input name="accessReference" maxlength="256" placeholder="Opaque reference, never a secret"></label><label>Expires at (ISO)<input name="expiresAt" placeholder="Optional ISO timestamp"></label><button class="mc-btn mc-btn--primary" type="submit">Create pending grant</button></form></section>`;
      } else if (providerView && detailRequest.grant && (grantState === 'pending' || grantState === 'active')) {
        grantActions = `<div class="mc-dialog-actions">${grantState === 'pending' ? `<button class="mc-btn mc-btn--primary" type="button" data-market-action="activate_grant" data-request-id="${esc(request.id)}" data-record-id="${esc(detailRequest.grant.id)}">Activate grant</button>` : ''}<button class="mc-btn mc-btn--secondary" type="button" data-market-action="revoke_grant" data-request-id="${esc(request.id)}" data-record-id="${esc(detailRequest.grant.id)}">Revoke grant</button></div>`;
      }
      const receiptForm = providerView && detailRequest.grant && grantState === 'active' && receiptReplaceable
        ? `<section class="mc-card"><h2>Record fulfillment receipt</h2><form class="mc-form-inline" data-resource-receipt-form data-request-id="${esc(request.id)}"><input type="hidden" name="accessGrantId" value="${esc(detailRequest.grant.id)}"><label>Settlement ID<input name="settlementId" value="${esc(settlement?.state === 'confirmed' ? settlement.id : '')}" placeholder="Optional; confirmed settlement only"></label><label>Evidence reference<input name="evidenceReference" maxlength="256" placeholder="Durable evidence reference"></label><label>Result reference<input name="resultReference" maxlength="256" placeholder="Durable result reference"></label><button class="mc-btn mc-btn--primary" type="submit">Record receipt</button></form></section>`
        : '';
      const receiptActions = requesterView && detailRequest.receipt?.state === 'recorded'
        ? `<div class="mc-dialog-actions"><button class="mc-btn mc-btn--secondary" type="button" data-market-action="reject_receipt" data-request-id="${esc(request.id)}" data-record-id="${esc(detailRequest.receipt.id)}">Reject receipt</button><button class="mc-btn mc-btn--primary" type="button" data-market-action="verify_receipt" data-request-id="${esc(request.id)}" data-record-id="${esc(detailRequest.receipt.id)}">Verify receipt</button></div>`
        : '';
      const requestActions = requesterView && ['pending', 'quoted'].includes(request.state)
        ? `<div class="mc-dialog-actions"><button class="mc-btn mc-btn--secondary" type="button" data-market-action="cancel_request" data-request-id="${esc(request.id)}">Cancel request</button></div>`
        : providerView && canProviderRejectRequest(request, machines)
          ? `<div class="mc-dialog-actions"><button class="mc-btn mc-btn--secondary" type="button" data-market-action="reject_request" data-request-id="${esc(request.id)}">Reject request</button></div>`
          : '';
      body = `<p class="mc-kicker">Authorized resource request</p><h1>Request ${esc(request.id)}</h1><dl class="mc-kv"><div><dt>Requester machine</dt><dd class="mc-mono">${esc(request.requesterMachineId)}</dd></div><div><dt>Resource</dt><dd>${esc(request.resourceType)} × ${esc(request.quantity)}</dd></div><div><dt>Provider machine</dt><dd>${esc(request.providerMachineId ?? 'not selected')}</dd></div><div><dt>Purpose</dt><dd>${esc(request.purpose)}</dd></div><div><dt>Preferred rails</dt><dd>${request.preferredRails.length ? request.preferredRails.map(esc).join(', ') : 'none'}</dd></div><div><dt>Maximum price</dt><dd>${esc(request.maxPrice)}</dd></div><div><dt>Request state</dt><dd>${esc(request.state)}</dd></div><div><dt>Settlement</dt><dd>${settlement ? `${esc(settlement.state)} · ${esc(settlement.id)}` : 'none'}</dd></div></dl>${requestActions}<h2>Quotes</h2>${table(['Quote', 'Provider', 'Unit amount', 'State', 'Expires', 'Action'], quoteRows, 'Resource quotes')}${quoteForm}<h2>Access grant</h2>${table(['Grant', 'State', 'Access reference', 'Expires', 'Updated'], detailRequest.grant ? [[`<span class="mc-mono">${esc(detailRequest.grant.id)}</span>`, esc(detailRequest.grant.state), esc(detailRequest.grant.accessReference ?? 'none'), esc(detailRequest.grant.expiresAt ?? 'none'), esc(detailRequest.grant.updatedAt)]] : [], 'Access grant')}${grantActions}<h2>Resource receipt</h2>${table(['Receipt', 'State', 'Settlement', 'Evidence', 'Result', 'Updated'], detailRequest.receipt ? [[`<span class="mc-mono">${esc(detailRequest.receipt.id)}</span>`, esc(detailRequest.receipt.state), esc(detailRequest.receipt.settlementId ?? 'none'), esc(detailRequest.receipt.evidenceReference ?? 'none'), esc(detailRequest.receipt.resultReference ?? 'none'), esc(detailRequest.receipt.updatedAt)]] : [], 'Resource receipt')}${receiptForm}${receiptActions}`;
      if (detailRequest.receipt?.settlementId) {
        body += `<section class="mc-card"><h3>Linked Solana transaction</h3>${transactionSignatureCell(settlement?.transactionSignature ?? null, input.config.solanaCluster)}</section>`;
      }
    } else {
      const available = capabilities.filter((capability) => capability.availability !== 'unavailable');
      const ownedCapabilities = capabilities.filter((capability) => capability.ownerUserId === userId);
      body = `<p class="mc-kicker">Persistent marketplace</p><h1>Resources</h1><div class="mc-dialog-actions">${machines.length ? '<button class="mc-btn mc-btn--secondary" type="button" data-capability-open>Register provider capability</button><button class="mc-btn mc-btn--primary" type="button" data-request-open>Request resource</button>' : '<p class="mc-dim">Register an owned machine before advertising or requesting resources.</p>'}</div><section><h2>Available Resources</h2>${table(['Resource type', 'Provider machine', 'Capability', 'Availability', 'Price/quote', 'Runtime rail/network', 'Provider status', 'Action'], available.map((capability) => [esc(capability.resourceType), esc(capability.providerMachineId), `<a href="/console/resources/${encodeURIComponent(capability.id)}">${esc(capability.label)}</a>`, esc(capability.availability), capability.priceAmount ? `${esc(capability.priceAmount)} ${esc(capability.priceAsset ?? '')} / ${esc(capability.unit)}` : 'quote required', capability.railTags.length ? capability.railTags.map(esc).join(', ') : 'none declared', 'UNKNOWN', machines.length ? `<button class="mc-btn mc-btn--primary" type="button" data-request-open data-capability-id="${esc(capability.id)}" data-resource-type="${esc(capability.resourceType)}">Request</button>` : '—']), 'Available persisted resources')}</section><section><h2>My Requests</h2><p class="mc-dim">Showing up to 100 recent owner-scoped requests.</p>${table(['Request ID', 'Requesting machine', 'Resource', 'Provider', 'Status', 'Quote', 'Created', 'Access grant', 'Receipt'], requestList.map((request) => { const state = lifecycleState(lifecycleByRequest.get(request.id)); return [`<a href="/console/resources/${encodeURIComponent(request.id)}">${esc(request.id)}</a>`, esc(request.requesterMachineId), esc(request.resourceType), esc(request.providerMachineId ?? 'not selected'), esc(request.state), request.quoteAmount ? `${esc(request.quoteAmount)} ${esc(request.quoteAsset ?? '')}` : 'none', esc(request.createdAt), esc(state.grant), esc(state.receipt)]; }), 'Owned resource requests')}</section><section><h2>My Providers</h2>${table(['Provider machine', 'Capability', 'Type', 'Runtime rail', 'Availability', 'Pricing', 'Status', 'Action'], ownedCapabilities.map((capability) => [esc(capability.providerMachineId), `<a href="/console/resources/${encodeURIComponent(capability.id)}">${esc(capability.label)}</a>`, esc(capability.resourceType), capability.railTags.length ? capability.railTags.map(esc).join(', ') : 'none', esc(capability.availability), capability.priceAmount ? `${esc(capability.priceAmount)} ${esc(capability.priceAsset ?? '')}` : 'quote required', 'owned · telemetry status shown only on machine page', capabilityEditButton(capability)]), 'Owned provider capabilities')}</section><section><h2>Provider request inbox</h2><p class="mc-dim">Showing up to 100 recent provider-authorized requests.</p>${table(['Request', 'Requester', 'Resource', 'State', 'Quote', 'Grant', 'Receipt'], providerRequestList.map((request) => { const view = lifecycleByRequest.get(request.id); const state = lifecycleState(view); return [`<a href="/console/resources/${encodeURIComponent(request.id)}">${esc(request.id)}</a>`, esc(request.requesterMachineId), esc(request.resourceType), esc(request.state), request.quoteAmount ? `${esc(request.quoteAmount)} ${esc(request.quoteAsset ?? '')}` : 'offer required', esc(state.grant), esc(state.receipt)]; }), 'Provider requests')}</section>${marketplaceDialogs(machines)}`;
    }
  } else if (route.section === 'settlements') {
    const eligible = requests.filter(isSettlementEligibleRequest);
    const solanaChain = input.config.solanaCluster === 'mainnet-beta' ? 'solana:mainnet' : input.config.solanaCluster === 'devnet' ? 'solana:devnet' : input.config.solanaCluster === 'testnet' ? 'solana:testnet' : '';
    const settlementByRequest = new Map(settlements.map((settlement) => [settlement.resourceRequestId, settlement] as const));
    const eligibleRows = eligible.map((request) => {
      const settlement = settlementByRequest.get(request.id);
      const reconcilable = settlement && ['submitting', 'submitted'].includes(settlement.state);
      const canReview = Boolean(solanaChain) && (!settlement || ['created', 'awaiting_signature', 'cancelled', 'failed'].includes(settlement.state));
      const action = canReview
        ? `<button class="mc-btn mc-btn--primary" type="button" data-settle-request="${esc(request.id)}">${settlement?.state === 'failed' ? 'Retry with replacement' : settlement ? 'Resume settlement' : 'Review settlement'}</button>`
        : reconcilable
          ? `<button class="mc-btn mc-btn--primary" type="button" data-reconcile-settlement="${esc(settlement.id)}">Reconcile / confirm</button>`
          : settlement?.state === 'confirmed' ? 'Confirmed' : solanaChain ? 'Not retryable' : 'Signing unavailable';
      return [
        esc(settlement?.id ?? 'not created'),
        `<a href="/console/resources/${encodeURIComponent(request.id)}">${esc(request.id)}</a>`,
        esc(request.resourceType), esc(request.requesterMachineId), esc(request.providerMachineId ?? 'not selected'),
        `${esc(request.quoteAmount ?? '')} SOL × ${esc(request.quantity)}`,
        esc(settlement?.state ?? 'not created'),
        settlement?.transactionSignature
          ? transactionSignatureCell(settlement.transactionSignature, input.config.solanaCluster)
          : esc(settlement?.errorCode ?? 'none'),
        action,
      ];
    });
    const persistedRows = settlements.map((settlement) => {
      const request = requests.find((candidate) => candidate.id === settlement.resourceRequestId) ?? null;
      return [
        `<span class="mc-mono">${esc(settlement.id)}</span>`,
        `<a href="/console/resources/${encodeURIComponent(settlement.resourceRequestId)}">${esc(settlement.resourceRequestId)}</a>`,
        esc(request?.resourceType ?? 'outside visible request window'),
        esc(settlement.machineId), esc(request?.providerMachineId ?? 'outside visible request window'),
        'SOL', esc(settlement.state), `${esc(settlement.amountLamports)} lamports`,
        transactionSignatureCell(settlement.transactionSignature, input.config.solanaCluster),
        esc(settlement.errorCode ?? 'none'), esc(settlement.updatedAt),
        ['submitting', 'submitted'].includes(settlement.state)
          ? `<button class="mc-btn mc-btn--secondary" type="button" data-reconcile-settlement="${esc(settlement.id)}">Reconcile / confirm</button>`
          : '—',
      ];
    });
    body = `<section data-production-settlements data-solana-chain="${esc(solanaChain)}"><p class="mc-kicker">Non-custodial Solana settlement</p><h1>Settlements</h1><p>The backend derives the exact source, recipient, lamports, and audit memo from an accepted persisted quote. Review those terms before a matching Wallet Standard v0 account signs. The browser never receives a private key and the server broadcasts only validated signed bytes.</p><p class="mc-dim">RPC genesis: <span class="mc-mono">${esc(input.runtime.network.actualGenesisHash)}</span>${solanaChain ? ` · required wallet chain ${esc(solanaChain)}` : ' · custom verified chain: signing fails closed because there is no Wallet Standard chain mapping'}</p>${table(['Settlement', 'Request', 'Resource', 'Machine', 'Provider', 'Quote', 'Persisted state', 'Signature/error', 'Action'], eligibleRows, 'Settlement-ready requests')}<h2>Persisted settlement records</h2>${table(['Settlement', 'Request', 'Resource', 'Machine', 'Provider', 'Token', 'State', 'Amount', 'Signature', 'Error', 'Updated', 'Action'], persistedRows, 'Persisted settlements')}<dialog id="mc-settlement-review" class="mc-card mc-settlement-dialog" aria-labelledby="mc-settlement-title"><h2 id="mc-settlement-title">Review trusted settlement terms</h2><p>Verify these exact values in your wallet. Signing is always an explicit user action. Cancelling persists a cancellation before this dialog closes.</p><dl class="mc-kv"><div><dt>Source</dt><dd class="mc-mono" data-review-source></dd></div><div><dt>Recipient</dt><dd class="mc-mono" data-review-recipient></dd></div><div><dt>Amount</dt><dd class="mc-mono" data-review-amount></dd></div><div><dt>Audit memo</dt><dd class="mc-mono" data-review-memo></dd></div><div><dt>State</dt><dd data-review-state></dd></div></dl><div class="mc-dialog-actions"><button class="mc-btn mc-btn--secondary" type="button" data-review-cancel>Cancel settlement</button><button class="mc-btn mc-btn--primary" type="button" data-review-approve>Prepare and sign in wallet</button></div></dialog></section>`;
  } else if (route.section === 'jobs') {
    if (route.detailId) {
      const order = detailWorkOrder;
      if (!order) return { status: 404, html: document('Work order not found', input.nonce, layout('jobs', auth.record.walletAddress, input.config.solanaCluster ?? 'custom', '<h1>Work order not found</h1><p>No owned work order has this identifier.</p>'), input.version) };
      const jobTabs = [
        ['overview', 'Overview'], ['timeline', 'Timeline'], ['machine', 'Machine'],
        ['resource', 'Resource'], ['provider', 'Provider'], ['telemetry', 'Telemetry'],
        ['settlement', 'Settlement'], ['receipt', 'Receipt'], ['proof', 'Proof'],
      ] as const;
      body = `<p class="mc-kicker">Persisted runtime-8 work order</p><h1>${esc(order.workOrderId)}</h1><nav class="mc-detail-tabs" aria-label="Work order detail">${jobTabs.map(([id, label]) => `<a href="#job-${id}">${label}</a>`).join('')}</nav>
      <section id="job-overview" class="mc-card"><h2>Overview</h2><dl class="mc-kv"><div><dt>Stage</dt><dd>${esc(order.stage)}</dd></div><div><dt>Required capabilities</dt><dd>${order.requiredCapabilities.length ? order.requiredCapabilities.map(esc).join(', ') : 'none'}</dd></div><div><dt>Expected outputs</dt><dd>${order.expectedOutputs.length ? order.expectedOutputs.map(esc).join(', ') : 'none'}</dd></div><div><dt>Result</dt><dd>${esc(order.resultRef ?? 'not recorded')}</dd></div></dl></section>
      <section id="job-timeline"><h2>Timeline</h2>${table(['Time', 'Event', 'State/reference'], [[esc(order.createdAt), 'WORK ORDER CREATED', esc(order.workOrderId)], [esc(order.updatedAt), 'LATEST PERSISTED UPDATE', esc(order.stage)]], 'Persisted work-order timeline')}</section>
      <section id="job-machine" class="mc-card"><h2>Machine</h2><p>${order.machineId ? `<a href="/console/machines/${encodeURIComponent(order.machineId)}/jobs">${esc(order.machineId)}</a>` : 'No machine is assigned in this work-order record.'}</p></section>
      <section id="job-resource" class="mc-card"><h2>Resource</h2><p>Unavailable: the persisted work-order model has no resource-request foreign key. The Console does not infer one from labels or timestamps.</p></section>
      <section id="job-provider" class="mc-card"><h2>Provider</h2><p>Unavailable: no provider relationship is recorded on this work order.</p></section>
      <section id="job-telemetry" class="mc-card"><h2>Telemetry</h2><dl class="mc-kv"><div><dt>Required</dt><dd>${order.telemetryRequired ? 'yes' : 'no'}</dd></div><div><dt>Reference</dt><dd class="mc-mono">${esc(order.telemetryRef ?? (order.telemetryRequired ? 'required, not recorded' : 'not applicable'))}</dd></div></dl></section>
      <section id="job-settlement" class="mc-card"><h2>Settlement</h2><dl class="mc-kv"><div><dt>Declared terms</dt><dd>${esc(order.settlementAmount)} ${esc(order.settlementAsset)} on ${esc(order.settlementChain)}</dd></div><div><dt>Recipient</dt><dd class="mc-mono">${esc(order.settlementRecipient)}</dd></div><div><dt>Intent reference</dt><dd class="mc-mono">${esc(order.settlementIntentId ?? 'not recorded')}</dd></div></dl><p class="mc-dim">These are work-order terms, not proof of a submitted or confirmed on-chain settlement; this model has no settlement-record foreign key.</p></section>
      <section id="job-receipt" class="mc-card"><h2>Receipt</h2><p>Unavailable: resource receipts are linked to marketplace requests, not this work-order identifier.</p></section>
      <section id="job-proof" class="mc-card"><h2>Proof</h2><dl class="mc-kv"><div><dt>Required</dt><dd>${order.proofRequired ? 'yes' : 'no'}</dd></div><div><dt>Reference</dt><dd class="mc-mono">${esc(order.proofId ?? (order.proofRequired ? 'required, not recorded' : 'not applicable'))}</dd></div></dl><p class="mc-dim">Only the persisted reference is available; this application has no proof payload store or autonomous proof pipeline.</p></section>`;
    } else {
      body = `<p class="mc-kicker">Persistent runtime-8 projection</p><h1>Jobs</h1><p>Only authenticated, owner-scoped work orders are shown. Creating a work order persists a queued record; it does not fabricate execution or settlement success.</p><div class="mc-dialog-actions">${machines.length ? '<button class="mc-btn mc-btn--primary" type="button" data-work-order-open>Create work order</button>' : '<a class="mc-btn mc-btn--primary" href="/console/machines">Register a machine first</a>'}</div>${table(['Work order', 'Machine', 'Stage', 'Capabilities', 'Settlement', 'Updated'], workOrders.map((order) => [`<a href="/console/jobs/${encodeURIComponent(order.workOrderId)}">${esc(order.workOrderId)}</a>`, order.machineId ? `<a href="/console/machines/${encodeURIComponent(order.machineId)}/jobs">${esc(order.machineId)}</a>` : 'unassigned', esc(order.stage), order.requiredCapabilities.map(esc).join(', '), `${esc(order.settlementAmount)} ${esc(order.settlementAsset)} · ${esc(order.settlementChain)}`, esc(order.updatedAt)]), 'Persisted work orders')}${machines.length ? workOrderDialog(machines, auth.record.walletAddress) : ''}`;
    }
  } else if (route.section === 'receipts') {
    const withLifecycle = lifecycleViews.filter((view) => view.grant || view.receipt);
    const receiptRows = withLifecycle.map((view) => {
      const linkedSettlement = view.receiptSettlement ?? (view.receipt?.settlementId
        ? settlements.find((settlement) => settlement.id === view.receipt?.settlementId) ?? null
        : null);
      const transaction = linkedSettlement?.transactionSignature
        ? transactionSignatureCell(linkedSettlement.transactionSignature, input.config.solanaCluster)
        : view.receipt?.settlementId
          ? `<a href="/console/resources/${encodeURIComponent(view.request.id)}">Open authorized detail for confirmed transaction</a>`
          : 'none';
      return [
        view.receipt ? `<span class="mc-mono">${esc(view.receipt.id)}</span>` : 'none',
        `<a href="/console/resources/${encodeURIComponent(view.request.id)}">${esc(view.request.id)}</a>`,
        view.request.ownerUserId === userId ? 'requester' : 'provider',
        esc(view.request.requesterMachineId), esc(view.request.providerMachineId ?? 'not selected'),
        esc(view.request.resourceType),
        esc(view.request.state), esc(view.grant?.state ?? 'none'), esc(view.receipt?.state ?? 'none'),
        esc(view.receipt?.settlementId ?? 'none'),
        transaction,
        esc(view.receipt?.evidenceReference ?? 'none'),
        esc(view.receipt?.updatedAt ?? view.grant?.updatedAt ?? view.request.updatedAt),
      ];
    });
    body = `<p class="mc-kicker">Persistent marketplace evidence</p><h1>Receipts</h1><p>Access grants and resource receipts are application-level durable records. A recorded receipt is not verified until the authenticated requester accepts it.</p>${table(['Receipt ID', 'Request', 'Role', 'Requester machine', 'Provider machine', 'Resource', 'Request state', 'Grant', 'Receipt state', 'Settlement', 'Transaction', 'Evidence', 'Updated'], receiptRows, 'Persisted access and receipt records')}`;
  } else if (route.section === 'settings') {
    body = `<p class="mc-kicker">Production configuration</p><h1>Settings</h1><dl class="mc-kv"><div><dt>Data mode</dt><dd>production · PostgreSQL</dd></div><div><dt>Wallet session</dt><dd>verified · HttpOnly · SameSite=Strict</dd></div><div><dt>Solana cluster</dt><dd>${esc(solanaClusterDisplayLabel(input.config.solanaCluster))} · genesis verified</dd></div><div><dt>RPC destination</dt><dd>operator configured · not exposed</dd></div><div><dt>Telemetry retention</dt><dd>${esc(input.config.telemetryRetentionDays ?? 30)} days</dd></div><div><dt>Telemetry row cap</dt><dd>${esc(input.config.telemetryMaxEventsPerMachine ?? 10_000)} events per machine</dd></div><div><dt>Fixture fallback</dt><dd>disabled</dd></div></dl>`;
  } else {
    body = `<p class="mc-kicker">Production boundary</p><h1>${esc(navItems.find(([id]) => id === route.section)?.[1] ?? route.section)}</h1><section class="mc-card"><h2>No persisted records for this view</h2><p>This route is preserved, but no fixture or inferred record is substituted in production mode. Use the authenticated API to create the underlying records.</p></section>`;
  }

  return { status: 200, html: document(route.section, input.nonce, layout(route.section, auth.record.walletAddress, input.config.solanaCluster ?? 'custom', body), input.version) };
}

const productionStyles = (): string => `
:root {
  --mc-sidebar-w: 248px;
  --mc-topbar-h: 64px;
}
html, body { min-height: 100%; background: var(--mc-ground); font-size: 14px; }
body { letter-spacing: -0.005em; }
::selection { color: var(--mc-accent-fg); background: var(--mc-accent); }

.mc-shell--production { min-height: 100vh; }
.mc-shell--production .mc-shell__brand,
.mc-shell--production .mc-topbar,
.mc-shell--production .mc-sidebar { background: var(--mc-surface); }
.mc-shell--production .mc-shell__brand { padding: 0 22px; border-color: var(--mc-border); }
.mc-shell--production .mc-brand { width: 100%; text-decoration: none; }
.mc-shell--production .mc-brand__mark {
  width: 34px; height: 34px; border: 1px solid var(--mc-accent);
  border-radius: 0; color: var(--mc-accent-fg); background: var(--mc-accent);
  clip-path: polygon(0 0, 78% 0, 100% 22%, 100% 100%, 22% 100%, 0 78%);
  box-shadow: none; font-family: var(--mc-font-mono); font-size: 10px; font-weight: 800;
}
.mc-shell--production .mc-brand__name { font-size: 14px; letter-spacing: -.02em; }
.mc-shell--production .mc-brand__sub { margin-top: 2px; font-size: 8.5px; color: var(--mc-text-3); }
.mc-shell--production .mc-sidebar { border-color: var(--mc-border); }
.mc-shell--production .mc-nav { gap: 5px; padding: 20px 14px; }
.mc-shell--production .mc-nav__link { gap: 12px; padding: 10px 12px; border-radius: var(--mc-r-md); color: var(--mc-text-2); font-size: 13px; }
.mc-shell--production .mc-nav__link:hover { color: var(--mc-text); background: var(--mc-surface-hover); }
.mc-shell--production .mc-nav__link[aria-current='page'] { color: var(--mc-accent-text); background: var(--mc-accent-muted); border-color: var(--mc-accent-border); }
.mc-shell--production .mc-nav__link[aria-current='page']::after { content: ''; width: 3px; height: 18px; margin-left: auto; border-radius: var(--mc-r-pill); background: var(--mc-accent); box-shadow: none; }
.mc-shell--production .mc-nav__icon { width: 18px; height: 18px; }
.mc-shell--production .mc-nav__icon svg { width: 18px; height: 18px; }
.mc-shell--production .mc-sidebar__footer { gap: 12px; padding: 16px 18px 18px; }
.mc-sidebar-status { display: flex; align-items: center; gap: 10px; min-width: 0; }
.mc-sidebar-status__dot { width: 8px; height: 8px; flex: 0 0 auto; border-radius: 50%; background: var(--mc-st-online); box-shadow: 0 0 0 4px var(--mc-st-online-muted); }
.mc-sidebar-status span { display: flex; flex-direction: column; min-width: 0; }
.mc-sidebar-status strong { color: var(--mc-text-2); font-size: 11px; font-weight: 550; }
.mc-sidebar-status small, .mc-sidebar-version { color: var(--mc-text-3); font-family: var(--mc-font-mono); font-size: 8.5px; letter-spacing: .04em; }
.mc-sidebar-version { padding-left: 18px; text-transform: uppercase; }

.mc-shell--production .mc-topbar { padding: 0 28px; border-color: var(--mc-border); }
.mc-topbar__context { color: var(--mc-text-3); font-size: 12px; }
.mc-environment { display: inline-flex; align-items: center; gap: 7px; width: max-content; padding: 5px 9px; border: 1px solid var(--mc-st-online-border); border-radius: var(--mc-r-pill); color: var(--mc-st-online); background: var(--mc-st-online-muted); font-family: var(--mc-font-mono); font-size: 9px; letter-spacing: .08em; text-transform: uppercase; white-space: nowrap; }
.mc-environment .mc-dot { width: 6px; height: 6px; color: var(--mc-st-online); }
.mc-wallet-chip { display: inline-flex; align-items: center; gap: 8px; padding: 6px 10px 6px 7px; border: 1px solid var(--mc-border); border-radius: var(--mc-r-pill); color: var(--mc-text-2); background: var(--mc-surface-raised); font-size: 10px; }
.mc-wallet-chip__avatar { width: 22px; height: 22px; border-radius: 50%; background: var(--mc-accent); box-shadow: inset 0 0 0 6px var(--mc-accent-muted); }
.mc-shell--production .mc-btn--quiet { color: var(--mc-text-3); }
.mc-shell--production .mc-btn--quiet:hover { color: var(--mc-text); }

.mc-shell--production .mc-shell__main { background: var(--mc-ground); }
.mc-shell--production .mc-shell__inner { width: 100%; max-width: 1480px; padding: 34px 40px 72px; }
.mc-page { display: flow-root; }
.mc-page > .mc-kicker, .mc-page > h1, .mc-page > p { max-width: 850px; }
.mc-kicker { margin: 0 0 7px; color: var(--mc-accent-text); font-family: var(--mc-font-mono); font-size: 9.5px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; }
.mc-page h1 { margin: 0 0 10px; color: var(--mc-text); font-size: clamp(25px, 3vw, 34px); line-height: 1.14; letter-spacing: -.04em; }
.mc-page h2 { margin: 30px 0 12px; color: var(--mc-text); font-size: 17px; line-height: 1.25; letter-spacing: -.025em; }
.mc-page h3 { color: var(--mc-text); }
.mc-page p { color: var(--mc-text-2); }
.mc-page > p { margin: 0 0 26px; }
.mc-page > .mc-card { margin-top: 20px; padding: 22px; }
.mc-page > .mc-table-wrap, .mc-page > section > .mc-table-wrap { margin-top: 18px; }
.mc-card { border-color: var(--mc-border); background: var(--mc-surface); box-shadow: var(--mc-sh-card); }
.mc-btn { min-height: 36px; padding: 8px 13px; border-radius: var(--mc-r-md); }
.mc-btn--primary { color: var(--mc-accent-fg); box-shadow: var(--mc-sh-card); }
.mc-btn--secondary { color: var(--mc-text-2); background: var(--mc-surface-raised); }

.mc-overview-hero { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 24px; }
.mc-overview-hero h1 { margin-bottom: 8px; }
.mc-overview-hero p:last-child { margin: 0; }
.mc-overview-hero__meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: flex-end; padding-bottom: 4px; }
.mc-verified-label { color: var(--mc-text-3); font-family: var(--mc-font-mono); font-size: 9px; letter-spacing: .08em; text-transform: uppercase; }
.mc-overview-stats { grid-template-columns: repeat(4, minmax(150px, 1fr)); gap: 14px; margin: 0 0 20px; }
.mc-overview-stats .mc-stat { min-height: 150px; padding: 18px; justify-content: space-between; border-radius: var(--mc-r-lg); }
.mc-stat__head { justify-content: space-between; }
.mc-stat__eyebrow { color: var(--mc-text-3); font-size: 11px; }
.mc-stat__glyph { display: grid; place-items: center; width: 28px; height: 28px; border: 1px solid var(--mc-border); border-radius: var(--mc-r-md); color: var(--mc-accent-text); background: var(--mc-accent-muted); font-family: var(--mc-font-mono); font-size: 10px; }
.mc-stat__glyph--online { color: var(--mc-st-online); background: var(--mc-st-online-muted); }
.mc-overview-stats .mc-stat__value { margin-top: 16px; color: var(--mc-text); font-size: 34px; font-weight: 580; }
.mc-overview-stats .mc-stat__hint { margin: 0; color: var(--mc-text-3); font-size: 10.5px; }

.mc-onboarding { display: grid; grid-template-columns: minmax(240px, 1.1fr) minmax(360px, 1.5fr); gap: 26px 40px; overflow: hidden; position: relative; padding: 28px !important; }
.mc-onboarding::after { content: ''; position: absolute; width: 160px; height: 160px; right: -65px; top: -75px; border: 1px solid var(--mc-accent-border); border-radius: 50%; box-shadow: 0 0 0 22px color-mix(in srgb, var(--mc-accent) 2.5%, transparent), 0 0 0 48px color-mix(in srgb, var(--mc-accent) 1.8%, transparent); pointer-events: none; }
.mc-onboarding__intro { display: flex; gap: 16px; align-items: flex-start; }
.mc-onboarding__number { display: grid; place-items: center; width: 38px; height: 38px; flex: 0 0 auto; border: 1px solid var(--mc-accent-border); border-radius: var(--mc-r-lg); color: var(--mc-accent-text); background: var(--mc-accent-muted); font-family: var(--mc-font-mono); font-size: 10px; }
.mc-onboarding h2 { margin: 0 0 8px; font-size: 20px; }
.mc-onboarding p { margin: 0; max-width: 52ch; font-size: 12.5px; }
.mc-onboarding__steps { display: grid; grid-template-columns: repeat(3, 1fr); align-self: center; }
.mc-onboarding__steps > div { display: flex; flex-direction: column; gap: 4px; min-height: 88px; padding: 0 18px; border-left: 1px solid var(--mc-border); }
.mc-onboarding__steps span { color: var(--mc-accent-text); font-family: var(--mc-font-mono); font-size: 9px; }
.mc-onboarding__steps strong { color: var(--mc-text); font-size: 12px; }
.mc-onboarding__steps small { color: var(--mc-text-3); font-size: 10.5px; line-height: 1.45; }
.mc-onboarding__actions { grid-column: 1 / -1; display: flex; gap: 9px; padding-top: 22px; border-top: 1px solid var(--mc-border); }
.mc-overview-panel { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
.mc-overview-panel h2 { margin: 0 0 5px; }
.mc-overview-panel p { margin: 0; }
.mc-network-proof { display: grid; grid-template-columns: auto minmax(220px, 1fr) minmax(280px, .8fr); align-items: center; gap: 18px; padding: 20px 22px !important; }
.mc-network-proof__mark { display: grid; place-items: center; width: 42px; height: 42px; border: 1px solid var(--mc-st-online-border); border-radius: var(--mc-r-lg); color: var(--mc-st-online); background: var(--mc-st-online-muted); }
.mc-network-proof h2 { margin: 0 0 5px; font-size: 15px; }
.mc-network-proof p { margin: 0; font-size: 11.5px; }
.mc-network-proof__hash { min-width: 0; display: flex; flex-direction: column; gap: 4px; padding-left: 20px; border-left: 1px solid var(--mc-border); }
.mc-network-proof__hash span, .mc-network-proof__hash small { color: var(--mc-text-3); font-size: 9px; text-transform: uppercase; letter-spacing: .08em; }
.mc-network-proof__hash code { overflow: hidden; color: var(--mc-text-2); font-family: var(--mc-font-mono); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }

.mc-table-wrap { border-color: var(--mc-border); border-radius: var(--mc-r-lg); box-shadow: var(--mc-sh-card); }
.mc-table thead th { height: 42px; padding-inline: 16px; color: var(--mc-text-3); background: var(--mc-surface-raised); font-size: 9px; }
.mc-table td { padding: 13px 16px; color: var(--mc-text-2); }
.mc-table-empty { min-height: 150px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; text-align: center; }
.mc-table-empty__icon { display: grid; place-items: center; width: 38px; height: 38px; margin-bottom: 6px; border: 1px solid var(--mc-border); border-radius: var(--mc-r-lg); color: var(--mc-text-3); background: var(--mc-surface-raised); }
.mc-table-empty__icon svg { width: 18px; height: 18px; }
.mc-table-empty strong { color: var(--mc-text-2); font-size: 12px; }
.mc-table-empty span:last-child { color: var(--mc-text-3); font-size: 10.5px; }

.mc-kv { margin-top: 18px; padding: 8px 20px; border: 1px solid var(--mc-border); border-radius: var(--mc-r-lg); background: var(--mc-surface); box-shadow: var(--mc-sh-card); }
.mc-kv > div { display: grid; grid-template-columns: minmax(140px, 210px) minmax(0, 1fr); gap: 18px; padding: 13px 0; border-bottom: 1px solid var(--mc-border); }
.mc-kv > div:last-child { border-bottom: 0; }
.mc-kv dt { color: var(--mc-text-3); font-family: var(--mc-font-mono); font-size: 9px; letter-spacing: .08em; text-transform: uppercase; }
.mc-kv dd { min-width: 0; margin: 0; color: var(--mc-text-2); overflow-wrap: anywhere; }
.mc-detail-tabs { display: flex; gap: 5px; overflow-x: auto; margin: 22px 0 26px; padding: 5px; border: 1px solid var(--mc-border); border-radius: var(--mc-r-lg); background: var(--mc-surface); }
.mc-detail-tabs a { padding: 7px 11px; border-radius: var(--mc-r-md); color: var(--mc-text-3); text-transform: capitalize; text-decoration: none; white-space: nowrap; }
.mc-detail-tabs a:hover { color: var(--mc-text); background: var(--mc-surface-hover); }
.mc-detail-tabs a[aria-current='page'] { color: var(--mc-accent-text); background: var(--mc-accent-muted); box-shadow: inset 0 0 0 1px var(--mc-accent-border); }

.mc-dialog-actions { display: flex; justify-content: flex-end; align-items: center; gap: 10px; flex-wrap: wrap; margin: 20px 0; }
.mc-form-stack, .mc-form-inline { display: grid; gap: 14px; }
.mc-form-inline { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); align-items: end; }
.mc-form-stack label, .mc-form-inline label { display: grid; gap: 6px; color: var(--mc-text-2); font-size: 11px; }
.mc-form-stack input, .mc-form-stack select, .mc-form-stack textarea, .mc-form-inline input, .mc-form-inline select { width: 100%; padding: 10px 11px; border: 1px solid var(--mc-border); border-radius: var(--mc-r-md); color: var(--mc-text); background: var(--mc-surface-raised); }
.mc-form-stack textarea { min-height: 92px; resize: vertical; }
.mc-setup-card { margin-top: 22px !important; }
.mc-setup-card h2 { margin-top: 0; }
.mc-choice-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 9px; margin: 0; padding: 14px; border: 1px solid var(--mc-border); border-radius: var(--mc-r-lg); }
.mc-choice-grid legend { padding: 0 7px; color: var(--mc-text-3); font-family: var(--mc-font-mono); font-size: 9px; letter-spacing: .08em; text-transform: uppercase; }
.mc-choice-row { display: flex; gap: 18px; flex-wrap: wrap; }
.mc-form-stack .mc-check, .mc-check { display: flex; grid-template-columns: none; align-items: center; gap: 8px; min-height: 36px; padding: 8px 10px; border: 1px solid var(--mc-border); border-radius: var(--mc-r-md); color: var(--mc-text-2); background: var(--mc-surface-raised); cursor: pointer; }
.mc-form-stack .mc-check input, .mc-check input { width: 15px; height: 15px; padding: 0; accent-color: var(--mc-accent); }
.mc-check:has(input:checked) { color: var(--mc-text); border-color: var(--mc-accent-border); background: var(--mc-accent-muted); }
.mc-settlement-dialog { width: min(760px, calc(100% - 32px)); max-height: calc(100vh - 32px); overflow: auto; padding: 24px; color: inherit; background: var(--mc-surface-overlay); border: 1px solid var(--mc-border-strong); }
.mc-settlement-dialog::backdrop { background: rgba(0, 0, 0, .78); }
[data-freshness='live'], [data-connection='connected'] { color: var(--mc-st-online); }
[data-freshness='delayed'] { color: var(--mc-st-degraded); }
[data-freshness='offline'], [data-connection='disconnected'] { color: var(--mc-alert-text); }
[data-freshness='unknown'] { color: var(--mc-text-3); }
.mc-toast-status { position: fixed; z-index: 90; right: 22px; bottom: 22px; max-width: 440px; margin: 0; padding: 11px 14px; border: 1px solid var(--mc-border-strong); border-radius: var(--mc-r-lg); color: var(--mc-text-2); background: var(--mc-surface-overlay); box-shadow: var(--mc-sh-overlay); font-size: 11px; }
.mc-toast-status:empty { display: none; }
.mc-toast-status[data-error='true'] { color: var(--mc-alert-text); border-color: var(--mc-alert-border); }

.mc-auth-page { min-height: 100vh; display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(420px, .85fr); background: var(--mc-ground); }
.mc-auth-showcase { position: relative; overflow: hidden; display: flex; flex-direction: column; justify-content: space-between; min-height: 100vh; padding: 48px clamp(40px, 7vw, 100px); border-right: 1px solid var(--mc-border); background: var(--mc-surface); }
.mc-auth-showcase::before, .mc-auth-showcase::after { content: ''; position: absolute; border: 1px solid var(--mc-accent-border); border-radius: 50%; pointer-events: none; }
.mc-auth-showcase::before { width: 560px; height: 560px; right: -250px; top: 5%; box-shadow: 0 0 0 65px color-mix(in srgb, var(--mc-accent) 1.8%, transparent), 0 0 0 130px color-mix(in srgb, var(--mc-accent) 1.2%, transparent); }
.mc-auth-showcase::after { width: 190px; height: 190px; right: 12%; bottom: 8%; box-shadow: inset 0 0 80px color-mix(in srgb, var(--mc-accent) 4%, transparent); }
.mc-auth-brand { position: relative; z-index: 1; width: max-content; text-decoration: none; }
.mc-auth-showcase__copy { position: relative; z-index: 1; max-width: 680px; padding: 80px 0; }
.mc-auth-showcase__copy h1 { max-width: 680px; margin: 0 0 20px; color: var(--mc-text); font-size: clamp(38px, 5vw, 68px); line-height: 1.02; letter-spacing: -.06em; }
.mc-auth-showcase__copy > p:last-child { max-width: 560px; color: var(--mc-text-2); font-size: 16px; line-height: 1.65; }
.mc-auth-proof-grid { position: relative; z-index: 1; display: grid; grid-template-columns: repeat(3, 1fr); border-top: 1px solid var(--mc-border); }
.mc-auth-proof-grid > div { display: flex; flex-direction: column; gap: 5px; min-height: 100px; padding: 18px 18px 0 0; }
.mc-auth-proof__icon { color: var(--mc-accent-text); font-family: var(--mc-font-mono); font-size: 9px; }
.mc-auth-proof-grid strong { color: var(--mc-text); font-size: 11px; }
.mc-auth-proof-grid small { max-width: 22ch; color: var(--mc-text-3); font-size: 10px; line-height: 1.5; }
.mc-auth-card { place-self: center; width: min(440px, calc(100% - 56px)); padding: 34px; border-radius: var(--mc-r-xl); }
.mc-auth-card__copy { margin: 30px 0 24px; }
.mc-auth-card__copy h2 { margin: 0 0 9px; color: var(--mc-text); font-size: 27px; letter-spacing: -.04em; }
.mc-auth-card__copy p:last-child { margin: 0; color: var(--mc-text-2); line-height: 1.6; }
.mc-btn--auth { width: 100%; min-height: 48px; font-size: 13px; }
.mc-auth-status { min-height: 20px; margin: 14px 0 0; color: var(--mc-text-3); font-size: 10.5px; text-align: center; }
.mc-auth-status[data-error='true'] { color: var(--mc-alert-text); }
.mc-auth-security { display: flex; align-items: flex-start; gap: 10px; margin-top: 22px; padding: 13px; border: 1px solid var(--mc-st-online-border); border-radius: var(--mc-r-lg); color: var(--mc-st-online); background: var(--mc-st-online-muted); }
.mc-auth-security p { margin: 0; color: var(--mc-text-3); font-size: 9.5px; line-height: 1.55; }
.mc-auth-security strong { color: var(--mc-st-online); font-size: 10px; }

@media (max-width: 1100px) {
  .mc-shell--production { grid-template-columns: 76px minmax(0, 1fr); }
  .mc-shell--production .mc-shell__brand { justify-content: center; padding: 0; }
  .mc-shell--production .mc-nav__link { justify-content: center; padding-inline: 0; }
  .mc-shell--production .mc-nav__link[aria-current='page']::after { display: none; }
  .mc-shell--production .mc-sidebar__footer { align-items: center; padding-inline: 8px; }
  .mc-sidebar-status span, .mc-sidebar-version { display: none; }
  .mc-onboarding { grid-template-columns: 1fr; }
  .mc-onboarding__actions { grid-column: auto; }
  .mc-auth-page { grid-template-columns: 1fr 440px; }
  .mc-auth-showcase { padding-inline: 48px; }
  .mc-auth-proof-grid { grid-template-columns: 1fr; }
  .mc-auth-proof-grid > div { min-height: auto; }
  .mc-auth-proof-grid > div:nth-child(n+2) { display: none; }
}
@media (max-width: 800px) {
  .mc-overview-stats { grid-template-columns: repeat(2, 1fr); }
  .mc-network-proof { grid-template-columns: auto 1fr; }
  .mc-network-proof__hash { grid-column: 2; padding: 14px 0 0; border-top: 1px solid var(--mc-border); border-left: 0; }
  .mc-auth-page { grid-template-columns: 1fr; place-items: center; padding: 24px; }
  .mc-auth-showcase { display: none; }
  .mc-auth-card { width: min(440px, 100%); }
}
@media (max-width: 720px) {
  .mc-shell--production { grid-template-columns: minmax(0, 1fr); grid-template-rows: var(--mc-topbar-h) auto minmax(0,1fr); grid-template-areas: 'topbar' 'sidebar' 'main'; }
  .mc-shell--production .mc-shell__brand { display: none; }
  .mc-shell--production .mc-nav { padding: 8px 12px; }
  .mc-shell--production .mc-nav__link { padding: 8px 12px; }
  .mc-shell--production .mc-nav__link[aria-current='page']::after { display: none; }
  .mc-shell--production .mc-shell__inner { padding: 24px 16px 56px; }
  .mc-topbar__context { display: none; }
  .mc-shell--production .mc-topbar { padding: 0 14px; }
  .mc-wallet-chip { max-width: 145px; }
  .mc-overview-hero { align-items: flex-start; flex-direction: column; }
  .mc-overview-hero__meta { justify-content: flex-start; }
  .mc-onboarding__steps { grid-template-columns: 1fr; gap: 14px; }
  .mc-onboarding__steps > div { min-height: auto; padding: 0 0 0 16px; }
  .mc-network-proof { grid-template-columns: 1fr; }
  .mc-network-proof__hash { grid-column: auto; }
  .mc-kv > div { grid-template-columns: 1fr; gap: 5px; }
}
@media (max-width: 480px) {
  .mc-overview-stats { grid-template-columns: 1fr; }
  .mc-overview-stats .mc-stat { min-height: 125px; }
  .mc-onboarding { padding: 21px !important; }
  .mc-onboarding__actions { flex-direction: column; }
  .mc-auth-page { padding: 14px; }
  .mc-auth-card { padding: 26px 22px; }
}
`;

function document(title: string, nonce: string, body: string, version: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${esc(title)} · Machina Console</title><style nonce="${nonce}">${stylesheet()}\n${productionStyles()}</style></head><body><a href="#mc-main" class="mc-sr">Skip to content</a>${body}<footer class="mc-sr">Machina ${esc(version)}</footer><script nonce="${nonce}">${productionClientScript()}</script></body></html>`;
}
