// ============================================================
// CRM-side bridge — runs on ConvoReal pages only. The Portal Post
// dialog talks to it with window.postMessage:
//
//   CONVOREAL_PORTAL_EXT_PING     → replies ..._PONG (detection)
//   CONVOREAL_PORTAL_PAYLOAD      → saves the listing payload to
//                                   chrome.storage.local and replies
//                                   ..._PAYLOAD_SAVED
//   CONVOREAL_HARVEST_PULL        → replies ..._HARVEST_DATA with the
//                                   listings portal-harvest.js collected
//   CONVOREAL_HARVEST_CLEAR       → drops one portal's collected batch
//                                   after a successful import
//
// The payload is listing content only (title, price, description,
// photo URLs) — never credentials. portal-fill.js reads it on the
// portal tab; portal-harvest.js writes dashboard scrapes the sync
// dialog pulls from here.
// ============================================================

(() => {
  const SOURCE = 'convoreal-portal-autofill';
  const HANDLED = new Set([
    'CONVOREAL_PORTAL_EXT_PING',
    'CONVOREAL_HARVEST_PULL',
    'CONVOREAL_HARVEST_CLEAR',
    'CONVOREAL_PORTAL_PAYLOAD',
  ]);

  const reply = (message) => window.postMessage({ ...message, source: SOURCE }, window.location.origin);

  // After the extension is reloaded/updated, content scripts already
  // injected into open tabs are orphaned: chrome.* is torn down and
  // chrome.storage becomes undefined, so touching it throws "Cannot
  // read properties of undefined (reading 'local')". Detect that and
  // tell the page to reload instead of crashing.
  function extensionAlive() {
    try {
      return !!(chrome.runtime && chrome.runtime.id && chrome.storage);
    } catch {
      return false;
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (!HANDLED.has(data.type)) return;

    if (!extensionAlive()) {
      reply({ type: 'CONVOREAL_PORTAL_EXT_STALE' });
      return;
    }

    if (data.type === 'CONVOREAL_PORTAL_EXT_PING') {
      reply({ type: 'CONVOREAL_PORTAL_EXT_PONG', version: '1.5.1' });
      return;
    }

    if (data.type === 'CONVOREAL_HARVEST_PULL') {
      chrome.storage.local.get('convorealHarvest', ({ convorealHarvest }) => {
        const store = convorealHarvest || {};
        const harvests = Object.values(store).map((bucket) => ({
          portal: bucket.portal,
          harvestedAt: bucket.harvestedAt,
          pageUrl: bucket.pageUrl,
          accountStats: bucket.accountStats || null,
          listings: Object.values(bucket.listings || {}),
        }));
        reply({ type: 'CONVOREAL_HARVEST_DATA', harvests });
      });
      return;
    }

    if (data.type === 'CONVOREAL_HARVEST_CLEAR' && typeof data.portal === 'string') {
      chrome.storage.local.get('convorealHarvest', ({ convorealHarvest }) => {
        const store = convorealHarvest || {};
        delete store[data.portal];
        chrome.storage.local.set({ convorealHarvest: store }, () => {
          reply({ type: 'CONVOREAL_HARVEST_CLEARED', portal: data.portal });
        });
      });
      return;
    }

    if (data.type === 'CONVOREAL_PORTAL_PAYLOAD' && data.payload && typeof data.payload === 'object') {
      const payload = {
        ...data.payload,
        savedAt: Date.now(),
      };
      chrome.storage.local.set({ convorealPortalPayload: payload }, () => {
        reply({ type: 'CONVOREAL_PORTAL_PAYLOAD_SAVED', propertyTitle: payload.title || '' });
      });
    }
  });

  // Announce on load so an already-open dialog can flip to "detected".
  if (extensionAlive()) reply({ type: 'CONVOREAL_PORTAL_EXT_PONG', version: '1.5.1' });
})();
