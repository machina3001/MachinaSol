/**
 * Console page behaviour.
 *
 * Layered on top of the design system's `behaviorScript()`, which already
 * handles copy, tabs, overlays, and focus management. This module only wires the
 * console's own concerns: submitting the two forms to the existing `/api`
 * endpoints and populating the machine drawer.
 *
 * Served inline under the same nonce as the design system script.
 */
export const consoleClientScript = (machinesJson: string): string => String.raw`
'use strict';
(function () {
  var MACHINES = ${machinesJson};

  function el(id) { return document.getElementById(id); }
  function val(id) { var node = el(id); return node && node.value.trim() !== '' ? node.value.trim() : undefined; }

  function setStatus(id, text, tone) {
    var pill = el(id);
    if (!pill) return;
    pill.textContent = text;
    pill.className = 'mc-badge mc-badge--sm mc-badge--' + tone;
  }

  /* Renders a JSON payload plus a short verdict line. */
  function renderResult(containerId, statusId, httpStatus, payload) {
    var container = el(containerId);
    if (!container) return;

    var verdict = 'Response';
    var tone = 'neutral';
    var note = '';

    if (payload && payload.ok === false && payload.error) {
      verdict = 'Rejected';
      tone = 'faulted';
      note = String(payload.error.detail || '');
    } else if (payload && payload.value && typeof payload.value.verified === 'boolean') {
      var v = payload.value;
      if (v.verified) {
        verdict = 'Verified';
        tone = 'online';
        note = 'status ' + v.status + ' · finality ' + (v.finality || 'unknown') + ' · evidence complete';
      } else {
        verdict = v.found ? 'Not verified' : 'Not found';
        tone = 'degraded';
        note = (v.mismatchReasons || []).join('; ') || 'receipt not present in this source';
      }
    } else if (payload && payload.intentId) {
      verdict = 'Intent built';
      tone = 'online';
      note = payload.amount + ' ' + payload.asset + ' · ' + payload.signingMode + ' · broadcast ' + payload.broadcast;
    } else if (payload && payload.sessionId) {
      /* Pair response. Named "derived" because nothing is persisted. */
      verdict = 'Session derived';
      tone = 'online';
      note = payload.machineId + ' · ' + payload.mode + ' · not persisted';
    } else if (payload && payload.ok === true) {
      verdict = 'OK';
      tone = 'online';
      note = payload.mode ? String(payload.mode) : '';
    }

    setStatus(statusId, 'http ' + httpStatus, httpStatus < 300 ? 'online' : httpStatus < 500 ? 'degraded' : 'faulted');

    var head = document.createElement('div');
    head.className = 'mc-row mc-row--wrap mc-mb-12';
    var badge = document.createElement('span');
    badge.className = 'mc-badge mc-badge--' + tone;
    badge.textContent = verdict;
    head.appendChild(badge);
    if (note) {
      var noteEl = document.createElement('span');
      noteEl.className = 'mc-dim mc-fs-11';
      noteEl.textContent = note;
      head.appendChild(noteEl);
    }

    var pre = document.createElement('pre');
    pre.className = 'mc-code';
    pre.setAttribute('tabindex', '0');
    pre.textContent = JSON.stringify(payload, null, 2);

    container.textContent = '';
    container.appendChild(head);
    container.appendChild(pre);
  }

  function post(route, body, containerId, statusId) {
    setStatus(statusId, 'running', 'active');
    var payload = {};
    for (var key in body) {
      if (Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined) payload[key] = body[key];
    }
    return fetch(route, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        return res.json()
          .catch(function () { return { ok: false, error: { detail: 'response was not JSON' } }; })
          .then(function (json) {
            renderResult(containerId, statusId, res.status, json);
            return { httpStatus: res.status, payload: json, networkError: false };
          });
      })
      .catch(function (error) {
        setStatus(statusId, 'no response', 'faulted');
        var container = el(containerId);
        if (container) container.textContent = 'Request failed: ' + (error && error.message ? error.message : 'unknown');
        return { httpStatus: 0, payload: null, networkError: true };
      });
  }

  /* ------------------------------------------------------------- intent */

  var intentForm = el('mc-intent-form');
  if (intentForm) {
    intentForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var fixtureToggle = el('mc-intent-fixture');
      post('/api/intent/build', {
        chain: 'solana',
        fixture: fixtureToggle ? fixtureToggle.checked : true,
        source: val('mc-intent-source'),
        recipient: val('mc-intent-recipient'),
        amount: val('mc-intent-amount'),
        memo: val('mc-intent-memo'),
        machineId: val('mc-intent-machine'),
        sessionId: val('mc-intent-session')
      }, 'mc-intent-out', 'mc-intent-status');
    });
  }

  /* ----------------------------------------------------------- register */

  /* Registration maps onto pairing: it derives a session, it does not persist. */
  var registerForm = el('mc-register-form');
  if (registerForm) {
    registerForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var fixtureToggle = el('mc-reg-fixture');
      var status = el('mc-register-status');
      if (status) status.textContent = 'Deriving session...';
      post('/api/pair', {
        chain: 'solana',
        fixture: fixtureToggle ? fixtureToggle.checked : true,
        machineId: val('mc-reg-machine'),
        operator: val('mc-reg-operator'),
        wallet: val('mc-reg-wallet'),
        machineLabel: val('mc-reg-label'),
        role: val('mc-reg-role')
      }, 'mc-register-out', 'mc-register-status');
    });
  }

  /* ------------------------------------------------------------- verify */

  var verifyForm = el('mc-verify-form');
  if (verifyForm) {
    verifyForm.addEventListener('submit', function (event) {
      event.preventDefault();
      post('/api/verify', {
        chain: 'solana',
        fixture: true,
        signature: val('mc-verify-sig'),
        amount: val('mc-verify-amount'),
        memo: val('mc-verify-memo'),
        machineId: val('mc-verify-machine'),
        sessionId: val('mc-verify-session')
      }, 'mc-verify-out', 'mc-verify-status');
    });
  }

  /* ----------------------------------------------- resource request flow */

  var resourceFlow = el('mc-resource-request-form');
  var resourceFlowBusy = false;
  var resourceDiscoveryToken = 0;
  var resourceDiscoveryFingerprint = '';
  var resourceDiscoveredIds = null;
  var resourceDiscoveryStatus = '';

  function resourceField(id) {
    var node = el(id);
    return node && typeof node.value === 'string' ? node.value.trim() : '';
  }

  function resourceTemplate(name) {
    var target = el('mc-resource-request-result');
    var template = el('mc-resource-state-' + name);
    if (!target || !template || !template.content) return;
    target.textContent = '';
    target.appendChild(template.content.cloneNode(true));
  }

  function setResourceBusy(busy, message) {
    resourceFlowBusy = busy;
    var status = el('mc-resource-request-status');
    if (status && message) status.textContent = message;
    var buttons = document.querySelectorAll(
      '[data-mc="resource-flow-prev"],[data-mc="resource-flow-next"],[data-mc="resource-flow-submit"]'
    );
    for (var i = 0; i < buttons.length; i += 1) {
      if (busy) buttons[i].setAttribute('disabled', '');
      else buttons[i].removeAttribute('disabled');
    }
    if (resourceFlow) {
      var inputs = resourceFlow.querySelectorAll('input,select,textarea');
      for (var j = 0; j < inputs.length; j += 1) {
        if (busy && !inputs[j].disabled) {
          inputs[j].disabled = true;
          inputs[j].setAttribute('data-resource-disabled-for-request', '');
        } else if (!busy && inputs[j].hasAttribute('data-resource-disabled-for-request')) {
          inputs[j].disabled = false;
          inputs[j].removeAttribute('data-resource-disabled-for-request');
        }
      }
    }
  }

  function resourceDraft() {
    return {
      id: resourceField('mc-resource-draft-id'),
      requesterId: resourceField('mc-resource-requester'),
      resourceType: resourceField('mc-resource-type'),
      quantity: resourceField('mc-resource-quantity'),
      maxPrice: resourceField('mc-resource-max-price'),
      preferredRail: resourceField('mc-resource-preferred-rail'),
      purpose: resourceField('mc-resource-purpose'),
      metadata: {
        selectedCapabilityId: resourceField('mc-resource-capability'),
        selectedProviderId: resourceField('mc-resource-provider')
      }
    };
  }

  function selectedResourceId(select) {
    if (!select || !select.selectedOptions || !select.selectedOptions[0]) return '';
    return select.selectedOptions[0].getAttribute('data-resource-id') || '';
  }

  function syncResourceChoices() {
    var type = resourceField('mc-resource-type');
    var capability = el('mc-resource-capability');
    var provider = el('mc-resource-provider');
    var selects = [capability, provider];
    for (var s = 0; s < selects.length; s += 1) {
      var select = selects[s];
      if (!select) continue;
      var options = select.querySelectorAll('option[data-resource-id]');
      var allowed = [];
      for (var i = 0; i < options.length; i += 1) {
        var matchesType = options[i].getAttribute('data-resource-type') === type;
        var resourceId = options[i].getAttribute('data-resource-id') || '';
        var discovered = s === 0
          ? !Array.isArray(resourceDiscoveredIds) || resourceDiscoveredIds.indexOf(resourceId) !== -1
          : Array.isArray(resourceDiscoveredIds) && resourceDiscoveredIds.indexOf(resourceId) !== -1;
        var enabled = matchesType && discovered;
        options[i].hidden = !enabled;
        options[i].disabled = !enabled;
        if (!enabled) options[i].selected = false;
        else allowed.push(options[i]);
      }
      if (allowed.length && (!select.selectedOptions || !select.selectedOptions[0])) allowed[0].selected = true;
      select.disabled = allowed.length === 0;
    }

    var rows = document.querySelectorAll('#mc-resource-request-step-5 tr[data-mc-row]');
    for (var r = 0; r < rows.length; r += 1) {
      var rowId = rows[r].getAttribute('data-mc-row') || '';
      rows[r].hidden = !Array.isArray(resourceDiscoveredIds) || resourceDiscoveredIds.indexOf(rowId) === -1;
    }
    updateResourceReview();
  }

  function invalidateResourceDiscovery() {
    resourceDiscoveryToken += 1;
    resourceDiscoveryFingerprint = '';
    resourceDiscoveredIds = null;
    resourceDiscoveryStatus = '';
    syncResourceChoices();
  }

  function alignResourcePair(changedId) {
    if (!Array.isArray(resourceDiscoveredIds)) return;
    var source = el(changedId);
    var target = el(changedId === 'mc-resource-provider' ? 'mc-resource-capability' : 'mc-resource-provider');
    var resourceId = selectedResourceId(source);
    if (!resourceId || !target) return;
    var options = target.querySelectorAll('option[data-resource-id]');
    for (var i = 0; i < options.length; i += 1) {
      if (!options[i].disabled && options[i].getAttribute('data-resource-id') === resourceId) {
        options[i].selected = true;
        break;
      }
    }
  }

  function updateResourceReview() {
    var requester = el('mc-resource-review-requester');
    var type = el('mc-resource-review-type');
    var capability = el('mc-resource-review-capability');
    var provider = el('mc-resource-review-provider');
    var quote = el('mc-resource-review-quote');
    var capabilityInput = el('mc-resource-capability');
    var providerInput = el('mc-resource-provider');
    if (requester) requester.textContent = resourceField('mc-resource-requester') || 'unavailable';
    if (type) type.textContent = resourceField('mc-resource-type') || 'unavailable';
    if (capability) {
      capability.textContent = capabilityInput && capabilityInput.selectedOptions && capabilityInput.selectedOptions[0]
        ? capabilityInput.selectedOptions[0].textContent
        : 'unavailable';
    }
    if (provider) {
      provider.textContent = providerInput && providerInput.selectedOptions && providerInput.selectedOptions[0]
        ? providerInput.selectedOptions[0].textContent
        : 'unavailable';
    }
    if (quote) {
      var selectedProvider = providerInput && providerInput.selectedOptions && providerInput.selectedOptions[0];
      quote.textContent = selectedProvider
        ? selectedProvider.getAttribute('data-resource-quote') || 'not supplied'
        : 'not supplied';
    }
  }

  function preselectResource(resourceId) {
    if (!resourceId) return;
    var capability = el('mc-resource-capability');
    if (!capability) return;
    var options = capability.querySelectorAll('option[data-resource-id]');
    var match = null;
    for (var i = 0; i < options.length; i += 1) {
      if (options[i].getAttribute('data-resource-id') === resourceId) {
        match = options[i];
        break;
      }
    }
    if (!match) return;
    var typeInput = el('mc-resource-type');
    var type = match.getAttribute('data-resource-type');
    if (type && typeInput) typeInput.value = type;
    syncResourceChoices();
    match.selected = true;
    updateResourceReview();
  }

  function showResourceStep(step) {
    if (!resourceFlow) return;
    var total = Number(resourceFlow.getAttribute('data-resource-total-steps')) || 8;
    var nextStep = Math.max(1, Math.min(total, Number(step) || 1));
    resourceFlow.setAttribute('data-resource-current-step', String(nextStep));

    var panels = resourceFlow.querySelectorAll('[data-resource-request-step]');
    var label = '';
    for (var i = 0; i < panels.length; i += 1) {
      var panelStep = Number(panels[i].getAttribute('data-resource-request-step'));
      var selected = panelStep === nextStep;
      panels[i].hidden = !selected;
      panels[i].setAttribute('aria-hidden', selected ? 'false' : 'true');
      if (selected) label = panels[i].getAttribute('data-resource-step-label') || '';
    }

    var rail = el('mc-resource-request-progress');
    var steps = rail ? rail.querySelectorAll('.mc-stages__step') : [];
    for (var j = 0; j < steps.length; j += 1) {
      steps[j].className = 'mc-stages__step' +
        (j + 1 < nextStep ? ' mc-stages__step--done' : j + 1 === nextStep ? ' mc-stages__step--current' : '');
    }
    var railGraphic = rail ? rail.querySelector('.mc-stages') : null;
    if (railGraphic) railGraphic.setAttribute('aria-label', 'Step ' + nextStep + ' of ' + total + ': ' + label);

    var prev = document.querySelector('[data-mc="resource-flow-prev"]');
    if (prev) {
      if (nextStep === 1) prev.setAttribute('disabled', '');
      else prev.removeAttribute('disabled');
    }
    var nextWrap = el('mc-resource-flow-next-wrap');
    var submitWrap = el('mc-resource-flow-submit-wrap');
    if (nextWrap) nextWrap.hidden = nextStep === total;
    if (submitWrap) submitWrap.hidden = nextStep !== total;
    var status = el('mc-resource-request-status');
    if (status) {
      status.textContent =
        nextStep >= 5 && resourceDiscoveryStatus && resourceDiscoveryStatus !== 'matched'
          ? 'Step ' + nextStep + ' of ' + total + ' · ' + resourceDiscoveryStatus.replace(/-/g, ' ') + ' · inspection only; submission unavailable'
          : 'Step ' + nextStep + ' of ' + total + ' · local draft · no submission backend';
    }
    if (nextStep === 7) updateResourceReview();
  }

  function resourceRequirementsValid() {
    var draft = resourceDraft();
    var quantity = Number(draft.quantity);
    var maxPrice = Number(draft.maxPrice);
    var valid = Boolean(draft.id && draft.requesterId && draft.resourceType) &&
      Number.isFinite(quantity) && quantity > 0 && Number.isFinite(maxPrice) && maxPrice > 0;
    if (!valid) {
      var result = el('mc-resource-request-result');
      if (result) result.textContent = 'Complete the requester, resource type, request id, quantity, and maximum price with valid positive values.';
      var status = el('mc-resource-request-status');
      if (status) status.textContent = 'Draft validation failed';
    }
    return valid;
  }

  function resourceSelectionValid() {
    if (resourceDiscoveryStatus !== 'matched') return true;
    var capability = el('mc-resource-capability');
    var provider = el('mc-resource-provider');
    var capabilityResourceId = selectedResourceId(capability);
    var providerResourceId = selectedResourceId(provider);
    var valid = Boolean(
      capabilityResourceId &&
      providerResourceId &&
      capabilityResourceId === providerResourceId &&
      Array.isArray(resourceDiscoveredIds) &&
      resourceDiscoveredIds.indexOf(capabilityResourceId) !== -1
    );
    if (!valid) {
      var result = el('mc-resource-request-result');
      if (result) result.textContent = 'Choose a capability and provider returned by the latest discovery result.';
      var status = el('mc-resource-request-status');
      if (status) status.textContent = 'Provider selection does not match discovery';
    }
    return valid;
  }

  function resourceDiscoveryIsCurrent(token, fingerprint) {
    if (token !== resourceDiscoveryToken) return false;
    var drawer = el('mc-resource-request-drawer');
    if (!drawer || drawer.hasAttribute('hidden')) return false;
    return fingerprint === JSON.stringify(resourceDraft());
  }

  function discoverResourceProviders(done) {
    var token = resourceDiscoveryToken + 1;
    resourceDiscoveryToken = token;
    resourceDiscoveryFingerprint = JSON.stringify(resourceDraft());
    var fingerprint = resourceDiscoveryFingerprint;
    resourceDiscoveredIds = null;
    resourceDiscoveryStatus = '';
    syncResourceChoices();
    setResourceBusy(true, 'Validating request and discovering compatible providers...');
    resourceTemplate('loading');
    fetch('/api/resources/discover', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(resourceDraft())
    }).then(function (res) {
      return res.json().then(function (payload) {
        var status = payload && payload.result ? payload.result.status : '';
        if (!resourceDiscoveryIsCurrent(token, fingerprint)) {
          if (token === resourceDiscoveryToken) {
            resourceDiscoveryToken += 1;
            resourceDiscoveryFingerprint = '';
            resourceDiscoveredIds = null;
            resourceDiscoveryStatus = '';
            setResourceBusy(false, 'Discovery result discarded because the draft changed or the drawer closed');
            syncResourceChoices();
          }
          return;
        }
        resourceDiscoveryStatus = status;
        if (status === 'matched') {
          var providers = Array.isArray(payload.result.providers) ? payload.result.providers : [];
          resourceDiscoveredIds = providers.map(function (provider) { return String(provider.resourceId || ''); })
            .filter(function (resourceId) { return resourceId !== ''; });
          syncResourceChoices();
          alignResourcePair('mc-resource-capability');
          updateResourceReview();
          resourceDiscoveryFingerprint = JSON.stringify(resourceDraft());
          var output = el('mc-resource-request-result');
          if (output) output.textContent = String(resourceDiscoveredIds.length) + ' compatible provider capability record(s) found.';
        } else {
          resourceDiscoveredIds = [];
          syncResourceChoices();
          if (status === 'unsupported-capability') resourceTemplate('unsupported');
          else if (status === 'marketplace-unavailable') resourceTemplate('marketplace-unavailable');
          else if (status === 'unavailable-provider') resourceTemplate('provider-unavailable');
          else if (status === 'no-matching-providers') resourceTemplate('no-matches');
          else resourceTemplate('error');
        }
        setResourceBusy(false, status ? status.replace(/-/g, ' ') : 'Discovery completed');
        done();
      });
    }).catch(function () {
      if (!resourceDiscoveryIsCurrent(token, fingerprint)) {
        if (token === resourceDiscoveryToken) setResourceBusy(false, 'Discovery result discarded');
        return;
      }
      resourceDiscoveryStatus = 'error';
      resourceDiscoveredIds = [];
      syncResourceChoices();
      resourceTemplate('error');
      setResourceBusy(false, 'Provider discovery failed');
      done();
    });
  }

  function submitResourceDraft() {
    if (resourceFlowBusy || !resourceRequirementsValid() || !resourceSelectionValid()) return;
    setResourceBusy(true, 'Submitting request...');
    post('/api/resources/request', resourceDraft(), 'mc-resource-request-result', 'mc-resource-request-status')
      .then(function (result) {
        setResourceBusy(
          false,
          result && result.networkError
            ? 'No response from resource request endpoint'
            : result && result.httpStatus === 501
              ? 'Submission rejected · no marketplace backend'
              : 'Request rejected'
        );
      });
  }

  if (resourceFlow) {
    syncResourceChoices();
    showResourceStep(1);
    resourceFlow.addEventListener('change', function (event) {
      var target = event.target;
      var id = target && target.id ? target.id : '';
      if (id === 'mc-resource-capability' || id === 'mc-resource-provider') {
        alignResourcePair(id);
        updateResourceReview();
        return;
      }
      if (
        id === 'mc-resource-requester' ||
        id === 'mc-resource-type' ||
        id === 'mc-resource-draft-id' ||
        id === 'mc-resource-quantity' ||
        id === 'mc-resource-max-price' ||
        id === 'mc-resource-preferred-rail' ||
        id === 'mc-resource-purpose'
      ) {
        invalidateResourceDiscovery();
      } else {
        updateResourceReview();
      }
    });
  }

  /* ------------------------------------------------ telemetry filtering */

  function filterTelemetryRows() {
    var wrapper = el('mc-telemetry-machine-table');
    if (!wrapper) return;
    var machineQuery = resourceField('mc-telemetry-filter-machine').toLowerCase();
    var connectionQuery = resourceField('mc-telemetry-filter-connection').toLowerCase();
    var runtimeQuery = resourceField('mc-telemetry-filter-runtime').toLowerCase();
    var rows = wrapper.querySelectorAll('tbody tr[data-mc-row]');
    var visible = 0;
    for (var i = 0; i < rows.length; i += 1) {
      var cells = rows[i].querySelectorAll('td');
      var machineText = cells[0] ? cells[0].textContent.toLowerCase() : '';
      var runtimeText = cells[1] ? cells[1].textContent.trim().toLowerCase() : '';
      var connectionText = cells[3] ? cells[3].textContent.trim().toLowerCase() : '';
      var matches = (!machineQuery || machineText.indexOf(machineQuery) !== -1) &&
        (!connectionQuery || connectionText === connectionQuery) &&
        (!runtimeQuery || runtimeText === runtimeQuery);
      rows[i].hidden = !matches;
      if (matches) visible += 1;
    }
    var status = el('mc-telemetry-filter-status');
    if (status) status.textContent = visible + ' of ' + rows.length + ' machines shown';
    var count = wrapper.querySelector('.mc-table__count');
    if (count) count.textContent = visible + ' of ' + rows.length;
  }

  ['mc-telemetry-filter-machine', 'mc-telemetry-filter-connection', 'mc-telemetry-filter-runtime'].forEach(
    function (id) {
      var input = el(id);
      if (!input) return;
      input.addEventListener(id === 'mc-telemetry-filter-machine' ? 'input' : 'change', filterTelemetryRows);
    }
  );

  /* ------------------------------------------------- machine drawer fill */

  function row(key, value, mono) {
    return '<div class="mc-kv__row"><dt class="mc-kv__key">' + key +
      '</dt><dd class="mc-kv__val' + (mono ? ' mc-kv__val--mono' : '') + '">' + value + '</dd></div>';
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function fillDrawer(machineId) {
    var machine = MACHINES[machineId];
    var body = el('mc-machine-drawer-body');
    var titleEl = el('mc-machine-drawer-title');
    var descEl = el('mc-machine-drawer-desc');
    if (!body) return;

    if (!machine) {
      body.innerHTML = '<p class="mc-muted mc-flush">No record for ' + escapeHtml(machineId) + '.</p>';
      return;
    }
    if (titleEl) titleEl.textContent = machine.label;
    if (descEl) descEl.textContent = machine.machineId + ' · ' + machine.status;

    var caps = machine.capabilities.map(function (capability) {
      return '<span class="mc-chip">' + escapeHtml(capability) + '</span>';
    }).join('');

    body.innerHTML =
      '<dl class="mc-kv">' +
      row('Machine id', escapeHtml(machine.machineId), true) +
      row('Role', escapeHtml(machine.role), true) +
      row('Status', '<span class="mc-badge mc-badge--' + escapeHtml(machine.tone) + '">' + escapeHtml(machine.status) + '</span>') +
      row('Operator', escapeHtml(machine.operatorId), true) +
      row('Wallet', escapeHtml(machine.walletAddress), true) +
      row('Telemetry health', escapeHtml(machine.health || 'unknown')) +
      row('Battery', machine.battery === null ? '—' : escapeHtml(machine.battery) + '%') +
      row('Diagnostics', escapeHtml(machine.diagnostics)) +
      row('Telemetry ref', escapeHtml(machine.telemetryRef), true) +
      row('Capabilities', '<span class="mc-chips">' + caps + '</span>') +
      row('Last seen', escapeHtml(machine.lastSeen)) +
      '</dl>' +
      '<div class="mc-mt-14"><pre class="mc-code" tabindex="0">' +
      escapeHtml(JSON.stringify(machine.raw, null, 2)) + '</pre></div>';
  }

  /* The design system re-dispatches unknown actions as mc:action. */
  document.addEventListener('mc:action', function (event) {
    var detail = event.detail || {};
    if (detail.action === 'open-resource-request') {
      resourceDiscoveryToken += 1;
      resourceDiscoveryFingerprint = '';
      resourceDiscoveredIds = null;
      resourceDiscoveryStatus = '';
      setResourceBusy(false, 'Local draft · no submission backend');
      if (resourceFlow) resourceFlow.reset();
      var resourceResult = el('mc-resource-request-result');
      if (resourceResult) resourceResult.textContent = '';
      syncResourceChoices();
      showResourceStep(1);
      preselectResource(detail.target);
      if (window.MachineConsole) window.MachineConsole.openOverlay('mc-resource-request-drawer');
      return;
    }
    if (detail.action === 'resource-flow-prev') {
      if (!resourceFlow || resourceFlowBusy) return;
      showResourceStep(Number(resourceFlow.getAttribute('data-resource-current-step')) - 1);
      return;
    }
    if (detail.action === 'resource-flow-next') {
      if (!resourceFlow || resourceFlowBusy || !resourceRequirementsValid()) return;
      var currentStep = Number(resourceFlow.getAttribute('data-resource-current-step')) || 1;
      if (currentStep >= 4 && !resourceSelectionValid()) return;
      if (currentStep === 3) {
        discoverResourceProviders(function () { showResourceStep(4); });
      } else {
        showResourceStep(currentStep + 1);
      }
      return;
    }
    if (detail.action === 'resource-flow-submit') {
      submitResourceDraft();
      return;
    }
    if (detail.action === 'open-machine') {
      fillDrawer(detail.target);
      if (window.MachineConsole) window.MachineConsole.openOverlay('mc-machine-drawer');
      return;
    }
    if (detail.action === 'reload') { window.location.reload(); return; }
    if (detail.action === 'goto-machine') {
      window.location.href = '/console/machines/' + encodeURIComponent(detail.target);
      return;
    }
    if (detail.action === 'copy-session') {
      if (detail.target && window.MachineConsole) window.MachineConsole.copy(detail.target);
      return;
    }
    if (detail.action === 'health') {
      fetch('/api/health').then(function (res) {
        return res.json().then(function (json) { renderResult('mc-verify-out', 'mc-verify-status', res.status, json); });
      });
    }
  });

  document.addEventListener('mc:wallet', function () {
    if (window.MachineConsole) window.MachineConsole.openOverlay('mc-machine-drawer');
    fillDrawer('drone-9');
  });
})();
`;
