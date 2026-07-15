// ============================================================
// Portal harvester — the reverse of portal-fill.js. Runs on the
// portal domains and scrapes the agent's OWN "My Listings" /
// dashboard pages (their logged-in session, their data) into a
// payload the CRM imports via the sync dialog.
//
// Deliberately dumb scraping: find listing cards heuristically
// (a link to a property-detail page, or a block with a ₹ price
// plus posted/expiry/views text), capture each card's RAW TEXT
// and any detail URL, and derive a stable listing id. All real
// parsing happens server-side, so portal redesigns degrade to
// "raw text still captured" instead of "sync broken".
//
// Collected cards accumulate in chrome.storage.local keyed by
// listing id — scanning the same page twice, or overlapping
// pagination, can never produce duplicates. The agent pages
// through the dashboard clicking "Scan" on each page, then pulls
// the batch from the CRM's Portal Sync dialog.
// ============================================================

(() => {
  const PANEL_ID = 'convoreal-harvest-panel';
  const LAUNCHER_ID = 'convoreal-harvest-launcher';
  if (document.getElementById(LAUNCHER_ID)) return;

  const HOST = window.location.hostname;
  const PORTAL = HOST.includes('99acres') ? '99acres' : HOST.includes('magicbricks') ? 'magicbricks' : 'housing';
  const STORE_KEY = 'convorealHarvest';

  const DETAIL_URL_PATTERNS = [
    /propertydetail/i, /property-detail/i, /propdetail/i, /\bpdpid\b/i,
    /-spid-/i, /property_id=/i, /\/buy\/.*\d{6,}/i, /\bid=\d{6,}/i,
  ];

  function normText(t) {
    return (t || '').replace(/\s+/g, ' ').trim();
  }

  function hashText(t) {
    let h = 5381;
    const s = normText(t).toLowerCase();
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return `h${h.toString(36)}`;
  }

  function idFromUrl(url) {
    if (!url) return null;
    const patterns = [/-spid-([A-Za-z0-9]+)/i, /pdpid[=/]([A-Za-z0-9]+)/i, /property_id=(\d+)/i, /[-/](\d{6,})(?:[/?#.]|$)/];
    for (const p of patterns) {
      const m = url.match(p);
      if (m) return m[1];
    }
    return null;
  }

  function isDetailLink(a) {
    const href = a.getAttribute('href') || '';
    return DETAIL_URL_PATTERNS.some((p) => p.test(href));
  }

  /** A card is worth harvesting when its text mentions money AND at
   *  least one dashboard-ish signal (posted/expiry/views/responses/
   *  status). Pure public search results usually lack the second. */
  function looksLikeOwnListingCard(text) {
    if (!/₹|\brs\.?\s*\d/i.test(text)) return false;
    return /\b(posted|expir|views?|responses?|active|under\s*screening|deactivat|refresh|edit)\b/i.test(text);
  }

  function cardContainer(el) {
    let node = el;
    for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
      const text = normText(node.innerText || '');
      if (text.length > 4000) break;
      if (text.length > 80 && looksLikeOwnListingCard(text)) {
        let candidate = node;
        for (let up = 0; up < 3; up++) {
          const parent = candidate.parentElement;
          if (!parent) break;
          const ptext = normText(parent.innerText || '');
          if (ptext.length > text.length * 1.6 || ptext.length > 4000) break;
          candidate = parent;
        }
        return candidate;
      }
    }
    return null;
  }

  function collectCards() {
    const cards = new Map();

    const anchors = [...document.querySelectorAll('a[href]')].filter(isDetailLink);
    for (const a of anchors) {
      const card = cardContainer(a);
      if (!card || card.closest(`#${PANEL_ID}`)) continue;
      const text = normText(card.innerText || '');
      const url = new URL(a.getAttribute('href'), window.location.origin).toString();
      const id = idFromUrl(url) || hashText(text);
      if (!cards.has(id)) cards.set(id, { listingId: id, listingUrl: url, rawText: (card.innerText || '').trim().slice(0, 6000) });
    }

    if (cards.size === 0) {
      const blocks = [...document.querySelectorAll('div, li, section, article')].filter((el) => {
        if (el.closest(`#${PANEL_ID}`)) return false;
        const text = normText(el.innerText || '');
        if (text.length < 100 || text.length > 2500) return false;
        if (!looksLikeOwnListingCard(text)) return false;
        return ![...el.children].some((child) => looksLikeOwnListingCard(normText(child.innerText || '')));
      });
      for (const el of blocks) {
        const text = (el.innerText || '').trim();
        const id = hashText(text);
        if (!cards.has(id)) cards.set(id, { listingId: id, listingUrl: null, rawText: text.slice(0, 6000) });
      }
    }

    return [...cards.values()];
  }

  /** Best-effort account stats off the dashboard chrome ("12 listings
   *  remaining", "Credits left: 4", plan names). Absent → null fields. */
  function collectAccountStats() {
    const text = normText(document.body.innerText || '').slice(0, 20000);
    const stats = {};
    const remaining = text.match(/(\d+)\s*(?:listings?|properties|posts?|credits?)\s*(?:left|remaining|available)/i)
      || text.match(/(?:listings?|credits?)\s*(?:left|remaining|available)[:\s]*(\d+)/i);
    if (remaining) stats.remainingListings = parseInt(remaining[1], 10);
    const refreshes = text.match(/(\d+)\s*refresh(?:es)?\s*(?:left|remaining|available)/i);
    if (refreshes) stats.remainingRefreshes = parseInt(refreshes[1], 10);
    const plan = text.match(/\b(silver|gold|platinum|titanium|premium|owner\s*pack|broker\s*pack)\b[^.\n]{0,20}(?:plan|pack|package)?/i);
    if (plan) stats.planName = normText(plan[0]);
    return Object.keys(stats).length > 0 ? stats : null;
  }

  function readStore(cb) {
    chrome.storage.local.get(STORE_KEY, (data) => cb((data && data[STORE_KEY]) || {}));
  }

  function scanPage(done) {
    const found = collectCards();
    readStore((store) => {
      const bucket = store[PORTAL] || { portal: PORTAL, listings: {}, accountStats: null, harvestedAt: 0 };
      let fresh = 0;
      for (const card of found) {
        if (!bucket.listings[card.listingId]) fresh++;
        bucket.listings[card.listingId] = card;
      }
      bucket.accountStats = collectAccountStats() || bucket.accountStats;
      bucket.harvestedAt = Date.now();
      bucket.pageUrl = window.location.href;
      store[PORTAL] = bucket;
      chrome.storage.local.set({ [STORE_KEY]: store }, () => done(found.length, fresh, Object.keys(bucket.listings).length));
    });
  }

  function clearPortal(done) {
    readStore((store) => {
      delete store[PORTAL];
      chrome.storage.local.set({ [STORE_KEY]: store }, done);
    });
  }

  // ── UI ────────────────────────────────────────────────────────

  function el(tag, style, text) {
    const node = document.createElement(tag);
    if (style) node.style.cssText = style;
    if (text) node.textContent = text;
    return node;
  }

  let expanded = false;

  function renderPanel() {
    document.getElementById(PANEL_ID)?.remove();
    const panel = el('div');
    panel.id = PANEL_ID;
    panel.style.cssText = [
      'position:fixed', 'right:16px', 'bottom:76px', 'z-index:2147483646', 'width:280px',
      'background:#022c22', 'border:1px solid #065f46', 'border-radius:12px',
      'box-shadow:0 8px 32px rgba(0,0,0,.5)', 'font-family:system-ui,sans-serif',
      'color:#d1fae5', 'font-size:12px', 'overflow:hidden', 'display:none', 'flex-direction:column',
    ].join(';');

    const header = el('div', 'display:flex;align-items:center;gap:8px;padding:10px 12px;background:#064e3b;cursor:pointer');
    const title = el('div', 'flex:1');
    title.appendChild(el('div', 'font-weight:800;color:#6ee7b7', 'ConvoReal Sync'));
    title.appendChild(el('div', 'color:#a7f3d0;font-size:10px', 'Collect your listings into the CRM'));
    header.appendChild(title);
    header.appendChild(el('span', 'color:#a7f3d0;font-size:14px', '−'));
    header.addEventListener('click', () => setExpanded(false));
    panel.appendChild(header);

    const body = el('div', 'display:flex;flex-direction:column;gap:8px;padding:10px 12px');
    const status = el('div', 'color:#a7f3d0;min-height:16px', 'Open your "My Listings" page, then scan.');
    const counter = el('div', 'color:#6ee7b7;font-weight:700');

    const scanBtn = el('button',
      'background:#10b981;border:none;border-radius:8px;color:#022c22;font-weight:800;padding:8px;cursor:pointer;font-size:12px',
      'Scan this page');
    scanBtn.addEventListener('click', () => {
      scanBtn.disabled = true;
      status.textContent = 'Scanning…';
      scanPage((onPage, fresh, total) => {
        scanBtn.disabled = false;
        status.textContent = onPage === 0
          ? 'No listing cards found here — open the page that lists your posted properties.'
          : `Found ${onPage} on this page (${fresh} new).`;
        counter.textContent = total > 0 ? `${total} listings collected for ${PORTAL}` : '';
        if (onPage > 0) status.textContent += ' Go to the next page and scan again, then open ConvoReal → Inventory → Portal Sync.';
      });
    });

    const clearBtn = el('button',
      'background:transparent;border:1px solid #065f46;border-radius:8px;color:#a7f3d0;padding:6px;cursor:pointer;font-size:11px',
      'Clear collected listings');
    clearBtn.addEventListener('click', () => clearPortal(() => {
      counter.textContent = '';
      status.textContent = 'Cleared. Scan again when ready.';
    }));

    body.appendChild(scanBtn);
    body.appendChild(status);
    body.appendChild(counter);
    body.appendChild(clearBtn);
    body.appendChild(el('div', 'color:#34d399;font-size:10px;border-top:1px solid #064e3b;padding-top:6px',
      'Only reads this page in your own logged-in session. Import happens in ConvoReal with your review — nothing is created automatically.'));
    panel.appendChild(body);
    document.body.appendChild(panel);

    readStore((store) => {
      const total = Object.keys(store[PORTAL]?.listings || {}).length;
      if (total > 0) counter.textContent = `${total} listings collected for ${PORTAL}`;
    });

    return panel;
  }

  function ensureLauncher() {
    let launcher = document.getElementById(LAUNCHER_ID);
    if (launcher) return launcher;
    launcher = el('button', [
      'position:fixed', 'right:70px', 'bottom:16px', 'z-index:2147483646',
      'height:48px', 'padding:0 14px', 'border-radius:9999px', 'border:1px solid #065f46',
      'background:linear-gradient(135deg,#059669,#047857)', 'color:#fff',
      'font-weight:800', 'font-size:12px', 'font-family:system-ui,sans-serif',
      'cursor:pointer', 'box-shadow:0 6px 24px rgba(5,150,105,.45)',
    ].join(';'), 'Sync to CRM');
    launcher.id = LAUNCHER_ID;
    launcher.title = 'Collect your posted listings for ConvoReal';
    launcher.addEventListener('click', () => setExpanded(true));
    document.body.appendChild(launcher);
    return launcher;
  }

  function setExpanded(next) {
    expanded = next;
    const panel = document.getElementById(PANEL_ID) || renderPanel();
    panel.style.display = expanded ? 'flex' : 'none';
    ensureLauncher().style.display = expanded ? 'none' : 'block';
  }

  ensureLauncher();
})();
