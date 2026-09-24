// ============================================================
// Owner Harvester — Runs on portal domains (99acres, MagicBricks, Housing).
// Designed to capture Owner leads from public search/detail pages.
//
// The agent manually reveals the owner's phone number, then clicks
// "Capture Owner Lead" in the injected UI. This script parses the DOM
// for phone numbers, names, and property details, and saves them to
// chrome.storage.local for the CRM to import.
// ============================================================

(() => {
  const PANEL_ID = 'convoreal-owner-panel';
  const LAUNCHER_ID = 'convoreal-owner-launcher';
  if (document.getElementById(LAUNCHER_ID)) return;

  const HOST = window.location.hostname;
  const PORTAL = HOST.includes('99acres') ? '99acres' : HOST.includes('magicbricks') ? 'magicbricks' : 'housing';
  const STORE_KEY = 'convorealOwnerLeads';

  function normText(t) {
    return (t || '').replace(/\s+/g, ' ').trim();
  }

  function hashText(t) {
    let h = 5381;
    const s = normText(t).toLowerCase();
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return `h${h.toString(36)}`;
  }

  // Very aggressive phone number matcher for Indian numbers
  function extractPhones(text) {
    const phones = [];
    const regex = /(?:\+?91[\s-]*)?[6789]\d{2}[\s-]?\d{3}[\s-]?\d{4}/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const clean = match[0].replace(/[^\d+]/g, '');
      if (clean.length >= 10) {
        phones.push(clean.length === 10 ? '+91' + clean : clean);
      }
    }
    return [...new Set(phones)];
  }

  // Attempt to find the name of the owner/agent near the phone number or in typical seller boxes
  function extractName(node) {
    // Traverse up and look for names
    let el = node;
    for (let i = 0; i < 5; i++) {
      if (!el) break;
      const text = normText(el.innerText || '');
      // Look for common patterns: "Posted by: John", "Owner: Jane"
      const match = text.match(/(?:posted by|owner|seller|agent)[\s:]*([A-Za-z\s]{3,25})/i);
      if (match && match[1].trim().toLowerCase() !== 'owner') {
        return match[1].trim();
      }
      el = el.parentElement;
    }
    return 'Unknown Owner';
  }

  function extractPrice(text) {
    const match = text.match(/(?:₹|rs\.?|inr)[\s]*([\d,]+(?:\.\d+)?[\s]*(?:lac|lakh|cr|crore|k)?)/i);
    return match ? match[0] : '';
  }

  function scrapeCurrentPage() {
    const fullText = normText(document.body.innerText || '');
    
    // Attempt 1: Find all phone numbers on the page
    const allPhones = extractPhones(fullText);
    
    if (allPhones.length === 0) {
      return { error: 'No phone numbers found. Make sure you have clicked "View Contact" to reveal the number first.' };
    }

    // Try to isolate the specific block that contains the phone number to get relevant details
    const phoneNodes = [];
    
    // Find text nodes containing the phone number
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    let n;
    while ((n = walk.nextNode())) {
      if (extractPhones(n.nodeValue).length > 0) {
        phoneNodes.push(n.parentElement);
      }
    }

    let ownerName = 'Unknown Owner';
    let price = extractPrice(fullText);
    let title = document.title;
    
    if (phoneNodes.length > 0) {
      // Pick the first one and try to find the container card
      let container = phoneNodes[0];
      ownerName = extractName(container);
      
      // Go up a few levels to get local context for price/title if not on detail page
      for (let i=0; i<6; i++) {
        if(container.parentElement) container = container.parentElement;
      }
      const localText = normText(container.innerText || '');
      const localPrice = extractPrice(localText);
      if (localPrice) price = localPrice;
    }

    return {
      id: hashText(allPhones[0] + title),
      portal: PORTAL,
      url: window.location.href,
      title: title.substring(0, 150),
      price: price,
      name: ownerName,
      phone: allPhones[0],
      rawText: fullText.substring(0, 2000), // store some context
      capturedAt: Date.now()
    };
  }

  function saveLead(lead, cb) {
    chrome.storage.local.get(STORE_KEY, (data) => {
      const store = data[STORE_KEY] || {};
      store[lead.id] = lead;
      chrome.storage.local.set({ [STORE_KEY]: store }, () => {
        cb(Object.keys(store).length);
      });
    });
  }

  function clearLeads(cb) {
    chrome.storage.local.remove(STORE_KEY, cb);
  }

  // ── UI ────────────────────────────────────────────────────────

  function el(tag, style, text) {
    const node = document.createElement(tag);
    if (style) node.style.cssText = style;
    if (text) node.textContent = text;
    return node;
  }

  let expanded = false;
  function setExpanded(val) {
    expanded = val;
    document.getElementById(PANEL_ID).style.display = expanded ? 'flex' : 'none';
    document.getElementById(LAUNCHER_ID).style.display = expanded ? 'none' : 'block';
  }

  function renderPanel() {
    document.getElementById(PANEL_ID)?.remove();
    const panel = el('div');
    panel.id = PANEL_ID;
    panel.style.cssText = [
      'position:fixed', 'left:16px', 'bottom:76px', 'z-index:2147483646', 'width:300px',
      'background:#1e1b4b', 'border:1px solid #4338ca', 'border-radius:12px',
      'box-shadow:0 8px 32px rgba(0,0,0,.5)', 'font-family:system-ui,sans-serif',
      'color:#e0e7ff', 'font-size:12px', 'overflow:hidden', 'display:none', 'flex-direction:column',
    ].join(';');

    const header = el('div', 'display:flex;align-items:center;gap:8px;padding:10px 12px;background:#312e81;cursor:pointer');
    const title = el('div', 'flex:1');
    title.appendChild(el('div', 'font-weight:800;color:#818cf8', 'Owner Lead Capture'));
    title.appendChild(el('div', 'color:#c7d2fe;font-size:10px', 'Save owners to ConvoReal'));
    header.appendChild(title);
    header.appendChild(el('span', 'color:#c7d2fe;font-size:14px', '−'));
    header.addEventListener('click', () => setExpanded(false));
    panel.appendChild(header);

    const body = el('div', 'display:flex;flex-direction:column;gap:8px;padding:10px 12px');
    const status = el('div', 'color:#c7d2fe;min-height:16px', 'Reveal the number first, then capture.');
    const counter = el('div', 'color:#818cf8;font-weight:700');

    const captureBtn = el('button',
      'background:#6366f1;border:none;border-radius:8px;color:#fff;font-weight:800;padding:8px;cursor:pointer;font-size:12px',
      'Capture Owner Lead');
    
    captureBtn.addEventListener('click', () => {
      const data = scrapeCurrentPage();
      if (data.error) {
        status.textContent = data.error;
        status.style.color = '#fca5a5';
      } else {
        saveLead(data, (total) => {
          status.textContent = `Captured: ${data.name} (${data.phone})`;
          status.style.color = '#a7f3d0';
          counter.textContent = `${total} leads waiting for import`;
        });
      }
    });

    const clearBtn = el('button',
      'background:transparent;border:1px solid #4c1d95;border-radius:8px;color:#c7d2fe;padding:6px;cursor:pointer;font-size:11px',
      'Clear unimported leads');
    clearBtn.addEventListener('click', () => clearLeads(() => {
      counter.textContent = '';
      status.textContent = 'Cleared queue.';
      status.style.color = '#c7d2fe';
    }));

    body.appendChild(captureBtn);
    body.appendChild(status);
    body.appendChild(counter);
    body.appendChild(clearBtn);
    panel.appendChild(body);
    document.body.appendChild(panel);

    chrome.storage.local.get(STORE_KEY, (data) => {
      const total = Object.keys(data[STORE_KEY] || {}).length;
      if (total > 0) counter.textContent = `${total} leads waiting for import`;
    });

    return panel;
  }

  function ensureLauncher() {
    let launcher = document.getElementById(LAUNCHER_ID);
    if (launcher) return launcher;
    launcher = el('button', [
      'position:fixed', 'left:16px', 'bottom:16px', 'z-index:2147483646',
      'height:48px', 'padding:0 14px', 'border-radius:9999px', 'border:1px solid #4338ca',
      'background:linear-gradient(135deg,#4f46e5,#3730a3)', 'color:#fff',
      'font-weight:800', 'font-size:12px', 'font-family:system-ui,sans-serif',
      'cursor:pointer', 'box-shadow:0 6px 24px rgba(79,70,229,.45)',
    ].join(';'), 'Capture Owner');
    launcher.id = LAUNCHER_ID;
    launcher.addEventListener('click', () => setExpanded(true));
    document.body.appendChild(launcher);
    return launcher;
  }

  // Init
  renderPanel();
  ensureLauncher();
})();
