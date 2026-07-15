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

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    if (data.type === 'CONVOREAL_PORTAL_EXT_PING') {
      window.postMessage({ type: 'CONVOREAL_PORTAL_EXT_PONG', source: SOURCE, version: '1.0.0' }, window.location.origin);
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
        window.postMessage({ type: 'CONVOREAL_HARVEST_DATA', source: SOURCE, harvests }, window.location.origin);
      });
      return;
    }

    if (data.type === 'CONVOREAL_HARVEST_CLEAR' && typeof data.portal === 'string') {
      chrome.storage.local.get('convorealHarvest', ({ convorealHarvest }) => {
        const store = convorealHarvest || {};
        delete store[data.portal];
        chrome.storage.local.set({ convorealHarvest: store }, () => {
          window.postMessage({ type: 'CONVOREAL_HARVEST_CLEARED', source: SOURCE, portal: data.portal }, window.location.origin);
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
        window.postMessage(
          { type: 'CONVOREAL_PORTAL_PAYLOAD_SAVED', source: SOURCE, propertyTitle: payload.title || '' },
          window.location.origin
        );
      });
    }
  });

  // Announce on load so an already-open dialog can flip to "detected".
  window.postMessage({ type: 'CONVOREAL_PORTAL_EXT_PONG', source: SOURCE, version: '1.0.0' }, window.location.origin);
})();
