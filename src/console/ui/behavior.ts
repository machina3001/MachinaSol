/**
 * Client-side behaviour for the console component library.
 *
 * Delivered as one string so the server can inline it inside a single nonce'd
 * `<script>`, matching the existing CSP. Everything is wired by event
 * delegation on `document`, so markup rendered later (or swapped in) works
 * without re-binding.
 *
 * Contract with the components: a control declares intent through
 * `data-mc-action`, with an optional `data-mc-target` payload. No component
 * contains behaviour, and this module contains no markup.
 *
 * Recognised actions:
 *   copy           — writes `data-mc-copy` to the clipboard
 *   tab            — activates the tab whose id matches `data-mc-target`
 *   open-overlay   — reveals the overlay element with that id
 *   close-overlay  — hides the overlay element with that id
 *   sort           — re-dispatches as an `mc:sort` CustomEvent
 *   wallet         — re-dispatches as an `mc:wallet` CustomEvent
 *
 * Anything unrecognised is re-dispatched as `mc:action`, so feature code can
 * listen without this module knowing about domain concerns.
 */
export const behaviorScript = (): string => String.raw`
'use strict';
(function () {
  var COPY_FEEDBACK_MS = 1100;

  function closest(target, selector) {
    return target && target.closest ? target.closest(selector) : null;
  }

  /* ---------------------------------------------------------------- copy */

  function flashCopied(button) {
    button.setAttribute('data-copied', 'true');
    window.setTimeout(function () { button.removeAttribute('data-copied'); }, COPY_FEEDBACK_MS);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    /* Fallback for non-secure contexts, where the async clipboard is absent. */
    return new Promise(function (resolve, reject) {
      try {
        var scratch = document.createElement('textarea');
        scratch.value = text;
        scratch.setAttribute('readonly', '');
        scratch.className = 'mc-copy-scratch';
        document.body.appendChild(scratch);
        scratch.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(scratch);
        ok ? resolve() : reject(new Error('copy rejected'));
      } catch (error) { reject(error); }
    });
  }

  /* ---------------------------------------------------------------- tabs */

  function activateTab(root, id) {
    if (!root) return;
    var tabs = root.querySelectorAll('[role="tab"]');
    for (var i = 0; i < tabs.length; i += 1) {
      var tab = tabs[i];
      var selected = tab.getAttribute('data-mc-target') === id;
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      tab.setAttribute('tabindex', selected ? '0' : '-1');
    }
    var panels = root.querySelectorAll('[role="tabpanel"]');
    for (var j = 0; j < panels.length; j += 1) {
      var panel = panels[j];
      if (panel.id === id + '-panel') panel.removeAttribute('hidden');
      else panel.setAttribute('hidden', '');
    }
  }

  /* Arrow-key navigation, per the tabs pattern. */
  document.addEventListener('keydown', function (event) {
    var tab = closest(event.target, '[role="tab"]');
    if (!tab) return;
    var map = { ArrowRight: 1, ArrowLeft: -1, Home: 'first', End: 'last' };
    if (!(event.key in map)) return;
    var root = closest(tab, '[data-mc-tabs]');
    if (!root) return;
    var tabs = Array.prototype.filter.call(
      root.querySelectorAll('[role="tab"]'),
      function (candidate) { return !candidate.disabled; }
    );
    var index = tabs.indexOf(tab);
    if (index < 0) return;
    event.preventDefault();
    var step = map[event.key];
    var next =
      step === 'first' ? tabs[0]
      : step === 'last' ? tabs[tabs.length - 1]
      : tabs[(index + step + tabs.length) % tabs.length];
    if (!next) return;
    activateTab(root, next.getAttribute('data-mc-target'));
    next.focus();
  });

  /* ------------------------------------------------------------ overlays */

  var lastFocused = null;

  function focusables(container) {
    return Array.prototype.filter.call(
      container.querySelectorAll(
        'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])'
      ),
      function (element) { return element.offsetParent !== null || element === document.activeElement; }
    );
  }

  function openOverlay(id) {
    var overlay = document.getElementById(id);
    if (!overlay) return;
    lastFocused = document.activeElement;
    overlay.removeAttribute('hidden');
    var candidates = focusables(overlay);
    if (candidates.length) candidates[0].focus();
  }

  function closeOverlay(overlay) {
    if (!overlay || overlay.hasAttribute('hidden')) return;
    overlay.setAttribute('hidden', '');
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    lastFocused = null;
  }

  function openOverlays() {
    return Array.prototype.filter.call(
      document.querySelectorAll('[data-mc-overlay]'),
      function (overlay) { return !overlay.hasAttribute('hidden'); }
    );
  }

  /* Escape closes the topmost overlay. */
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    var open = openOverlays();
    if (!open.length) return;
    event.preventDefault();
    closeOverlay(open[open.length - 1]);
  });

  /* Clicking the scrim, but not the panel, dismisses. */
  document.addEventListener('mousedown', function (event) {
    var overlay = event.target && event.target.hasAttribute && event.target.hasAttribute('data-mc-overlay')
      ? event.target
      : null;
    if (overlay) closeOverlay(overlay);
  });

  /* Keep focus inside an open dialog. */
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Tab') return;
    var open = openOverlays();
    if (!open.length) return;
    var panel = open[open.length - 1].querySelector('[role="dialog"]');
    if (!panel) return;
    var candidates = focusables(panel);
    if (!candidates.length) return;
    var first = candidates[0];
    var last = candidates[candidates.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  /* ---------------------------------------------------------------- menus */

  function menuPanels() {
    return Array.prototype.slice.call(document.querySelectorAll('.mc-menu__panel'));
  }

  function closeMenus(except) {
    menuPanels().forEach(function (panel) {
      if (panel === except) return;
      if (panel.hasAttribute('hidden')) return;
      panel.setAttribute('hidden', '');
      var root = panel.closest('[data-mc-menu-root]');
      var trigger = root && root.querySelector('[data-mc-action="menu"]');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    });
  }

  function toggleMenu(trigger, targetId) {
    var panel = document.getElementById(targetId);
    if (!panel) return;
    var willOpen = panel.hasAttribute('hidden');
    closeMenus(panel);
    if (willOpen) {
      panel.removeAttribute('hidden');
      trigger.setAttribute('aria-expanded', 'true');
      var first = panel.querySelector('[role="menuitem"]:not([aria-disabled="true"])');
      if (first) first.focus();
    } else {
      panel.setAttribute('hidden', '');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.focus();
    }
  }

  function closeOwningMenu(item) {
    var panel = closest(item, '.mc-menu__panel');
    if (!panel) return;
    var root = panel.closest('[data-mc-menu-root]');
    var trigger = root && root.querySelector('[data-mc-action="menu"]');
    closeMenus(null);
    if (trigger) trigger.focus();
  }

  /* Outside click dismisses any open menu. */
  document.addEventListener('click', function (event) {
    if (closest(event.target, '.mc-menu')) return;
    closeMenus(null);
  });

  /* Escape closes menus before it reaches the overlay handler. */
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    var open = menuPanels().filter(function (panel) { return !panel.hasAttribute('hidden'); });
    if (!open.length) return;
    event.stopPropagation();
    var last = open[open.length - 1];
    var root = last && last.closest('[data-mc-menu-root]');
    var trigger = root && root.querySelector('[data-mc-action="menu"]');
    closeMenus(null);
    if (trigger) trigger.focus();
  }, true);

  /* Arrow-key movement between menu items. */
  document.addEventListener('keydown', function (event) {
    var item = closest(event.target, '[role="menuitem"]');
    if (!item) return;
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    var panel = closest(item, '.mc-menu__panel');
    if (!panel) return;
    var items = Array.prototype.filter.call(
      panel.querySelectorAll('[role="menuitem"]'),
      function (candidate) { return candidate.getAttribute('aria-disabled') !== 'true'; }
    );
    var index = items.indexOf(item);
    if (index < 0) return;
    event.preventDefault();
    var step = event.key === 'ArrowDown' ? 1 : -1;
    var next = items[(index + step + items.length) % items.length];
    if (next) next.focus();
  });

  /* ------------------------------------------------------ action dispatch */

  function emit(name, detail, source) {
    document.dispatchEvent(new CustomEvent(name, { detail: detail, bubbles: true }));
    if (source) source.dispatchEvent(new CustomEvent('mc:local', { detail: detail, bubbles: true }));
  }

  function handle(trigger, event) {
    var action = trigger.getAttribute('data-mc-action');
    var target = trigger.getAttribute('data-mc-target');

    if (action !== 'menu') closeOwningMenu(trigger);

    if (action === 'copy') {
      event.preventDefault();
      var value = trigger.getAttribute('data-mc-copy') || '';
      copyText(value).then(function () { flashCopied(trigger); }).catch(function () {
        trigger.setAttribute('aria-label', 'Copy failed');
      });
      return;
    }

    if (action === 'tab') {
      event.preventDefault();
      activateTab(closest(trigger, '[data-mc-tabs]'), target);
      return;
    }

    if (action === 'menu') {
      event.preventDefault();
      event.stopPropagation();
      toggleMenu(trigger, target);
      return;
    }

    if (action === 'open-overlay') {
      event.preventDefault();
      closeMenus(null);
      openOverlay(target);
      return;
    }

    if (action === 'close-overlay') {
      event.preventDefault();
      closeOverlay(document.getElementById(target));
      return;
    }

    if (action === 'sort') {
      event.preventDefault();
      emit('mc:sort', { key: target }, trigger);
      return;
    }

    if (action === 'wallet') {
      event.preventDefault();
      emit('mc:wallet', {}, trigger);
      return;
    }

    /* Unknown actions become a generic event for feature code to consume. */
    emit('mc:action', { action: action, target: target }, trigger);
  }

  document.addEventListener('click', function (event) {
    var trigger = closest(event.target, '[data-mc-action]');
    if (trigger) handle(trigger, event);
  });

  /* Expose the imperative bits for feature code that needs them directly. */
  window.MachineConsole = {
    openOverlay: openOverlay,
    closeOverlay: function (id) { closeOverlay(document.getElementById(id)); },
    activateTab: function (rootId, tabId) { activateTab(document.getElementById(rootId), tabId); },
    copy: copyText
  };
})();
`;
