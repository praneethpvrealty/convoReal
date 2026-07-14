// ============================================================
// CRM-side bridge — runs on ConvoReal pages only. The Portal Post
// dialog talks to it with window.postMessage:
//
//   CONVOREAL_PORTAL_EXT_PING     → replies ..._PONG (detection)
//   CONVOREAL_PORTAL_PAYLOAD      → saves the listing payload to
//                                   chrome.storage.local and replies
//                                   ..._PAYLOAD_SAVED
//
// The payload is listing content only (title, price, description,
// photo URLs) — never credentials. portal-fill.js reads it on the
// portal tab.
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
