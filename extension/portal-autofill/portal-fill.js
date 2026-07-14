// ============================================================
// Portal-side filler — runs on 99acres / MagicBricks / Housing.
// Shows a floating "ConvoReal" panel with the listing sent from
// the CRM: one-click best-effort autofill of visible text fields,
// plus per-field copy buttons for everything the SPA forms won't
// let us reach (custom dropdowns, multi-step wizards, OTP gates).
//
// Filling strategy: score every visible <input>/<textarea> against
// hint keywords drawn from its label/placeholder/name/aria text,
// then set values through the native setter + input/change events
// so React-based portal forms register the change. The user always
// reviews and clicks the portal's own Submit.
// ============================================================

(() => {
  const PANEL_ID = 'convoreal-portal-panel';
  if (document.getElementById(PANEL_ID)) return;

  const HOST = window.location.hostname;
  const PORTAL = HOST.includes('99acres') ? '99acres' : HOST.includes('magicbricks') ? 'magicbricks' : 'housing';

  // Maps our field labels → keywords likely to appear around the
  // portal's matching form control.
  const FIELD_HINTS = {
    Title: ['ad title', 'property title', 'title', 'heading'],
    Description: ['description', 'describe', 'about the property', 'unique about'],
    'Expected Price': ['expected price', 'price', 'total price', 'cost'],
    'Monthly Rent': ['monthly rent', 'rent', 'expected rent'],
    Maintenance: ['maintenance'],
    'Security Deposit / Advance': ['security deposit', 'deposit', 'advance'],
    'Built-up Area': ['built-up area', 'built up', 'super area', 'carpet area', 'area'],
    'Plot Area': ['plot area', 'land area', 'area'],
    Locality: ['locality', 'society', 'project', 'landmark', 'location', 'search locality'],
    City: ['city'],
    Bedrooms: ['bedroom', 'bhk'],
    Bathrooms: ['bathroom', 'bath'],
    'Project / Society': ['society', 'project name', 'building name'],
  };

  const NUMERIC_FIELDS = new Set([
    'Expected Price', 'Monthly Rent', 'Maintenance', 'Security Deposit / Advance',
    'Built-up Area', 'Plot Area', 'Bedrooms', 'Bathrooms',
  ]);

  /** "₹45 Cr" → "45000000 0" is wrong — portals want raw numbers.
   *  Convert Indian-formatted amounts back to plain digits. */
  function numericValue(label, value) {
    const crMatch = value.match(/^₹?\s*([\d.]+)\s*Cr/i);
    if (crMatch) return String(Math.round(parseFloat(crMatch[1]) * 10000000));
    const lakhMatch = value.match(/^₹?\s*([\d.]+)\s*Lakh/i);
    if (lakhMatch) return String(Math.round(parseFloat(lakhMatch[1]) * 100000));
    const digits = value.replace(/[^\d.]/g, '');
    return digits || value;
  }

  function contextText(el) {
    const bits = [
      el.placeholder, el.name, el.id, el.getAttribute('aria-label'), el.getAttribute('data-label'),
    ];
    if (el.labels) for (const l of el.labels) bits.push(l.textContent);
    const container = el.closest('div, li, section');
    if (container) {
      const label = container.querySelector('label, span, p');
      if (label) bits.push(label.textContent);
    }
    return bits.filter(Boolean).join(' ').toLowerCase();
  }

  function nativeSet(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function isFillable(el) {
    if (el.disabled || el.readOnly) return false;
    if (el.tagName === 'INPUT' && !['text', 'search', 'tel', 'number', 'email', ''].includes(el.type)) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 40 && rect.height > 10;
  }

  function flashOutline(el) {
    el.style.outline = '2px solid #10b981';
    setTimeout(() => { el.style.outline = ''; }, 3000);
  }

  // City / locality / society inputs on the portals are typeaheads:
  // typing alone doesn't count — a suggestion must be clicked to
  // commit the value (and often to reveal the next input).
  const TYPEAHEAD_FIELDS = new Set(['City', 'Locality', 'Project / Society']);

  /** After typing into a typeahead, click the suggestion that best
   *  matches our value: exact text first (plain "Bangalore" beats
   *  "Bangalore East"), then prefix. Only considers options rendered
   *  directly below the input so wizard sidebars etc. can't match. */
  function commitTypeahead(input, value) {
    const want = normalizedText(value);
    const ir = input.getBoundingClientRect();
    const options = [...document.querySelectorAll('[role="option"], li, [class*="suggest" i] *, [class*="autocomplete" i] *, [class*="dropdown" i] li')]
      .filter((el) => {
        if (el.closest(`#${PANEL_ID}`)) return false;
        if (el.childElementCount > 3) return false;
        const r = el.getBoundingClientRect();
        if (r.width < 60 || r.height < 14 || r.height > 80) return false;
        // Must sit in the dropdown zone under the input.
        return r.top >= ir.bottom - 4 && r.top <= ir.bottom + 420 && r.left < ir.right && r.right > ir.left - 60;
      });

    let best = options.find((el) => normalizedText(el.textContent) === want);
    if (!best) best = options.find((el) => normalizedText(el.textContent).startsWith(want));
    if (best) {
      best.click();
      flashOutline(input);
      return true;
    }
    return false;
  }

  async function fillTextFields(fields) {
    const candidates = [...document.querySelectorAll('input, textarea')].filter(isFillable);
    const used = new Set();
    let filled = 0;

    for (const field of fields) {
      const hints = FIELD_HINTS[field.label];
      if (!hints) continue;
      const value = NUMERIC_FIELDS.has(field.label) ? numericValue(field.label, field.value) : field.value;
      let best = null;
      let bestScore = 0;
      for (const el of candidates) {
        if (used.has(el) || el.value === value) continue;
        const ctx = contextText(el);
        if (!ctx) continue;
        let score = 0;
        hints.forEach((hint, idx) => {
          if (ctx.includes(hint)) score = Math.max(score, hints.length - idx + (hint.length > 6 ? 1 : 0));
        });
        if (field.label === 'Description' && el.tagName === 'TEXTAREA') score += 2;
        if (score > bestScore) {
          best = el;
          bestScore = score;
        }
      }
      if (best && bestScore > 0) {
        try {
          nativeSet(best, value);
          used.add(best);
          flashOutline(best);
          filled++;
          if (TYPEAHEAD_FIELDS.has(field.label)) {
            // Give the SPA a beat to render suggestions, pick ours,
            // then another beat for the next input to appear.
            await sleep(700);
            commitTypeahead(best, field.value);
            await sleep(400);
          }
        } catch {
          // Portal blocked the write — the copy button still covers it.
        }
      }
    }
    return filled;
  }

  // ── Choice chips / radios ─────────────────────────────────────
  // Portal wizards front-load selections (Sell vs Rent, Residential
  // vs Commercial, "Plot / Land" chips). Map our field values to the
  // chip texts the portals use and click exact matches — never inside
  // links/nav (a nav "Sell" would navigate away), never our own panel.

  function normalizedText(t) {
    return (t || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function choiceTargets(fields) {
    const get = (label) => fields.find((f) => f.label === label)?.value || '';
    const targets = [];

    const listingFor = get('Listing For');
    if (listingFor) {
      targets.push({
        synonyms: listingFor.startsWith('Rent') ? ['rent / lease', 'rent/lease', 'rent'] : ['sell', 'sale', 'resale'],
      });
    }

    const type = normalizedText(get('Property Type'));
    if (type) {
      const commercial = /commercial|office|shop|showroom|industrial|warehouse|godown/.test(type);
      targets.push({ synonyms: [commercial ? 'commercial' : 'residential'] });

      const sub = [];
      if (/plot|land/.test(type)) sub.push('plot / land', 'plot/land', 'plot', 'land');
      if (/apartment|flat/.test(type) && !/studio|1 rk/.test(type)) sub.push('flat/apartment', 'flat / apartment', 'apartment', 'flat');
      if (/villa|independent house/.test(type)) sub.push('independent house / villa', 'villa', 'independent house');
      if (/builder floor/.test(type)) sub.push('independent / builder floor', 'builder floor');
      if (/studio|1 rk/.test(type)) sub.push('1 rk/ studio apartment', 'studio apartment');
      if (/office/.test(type)) sub.push('office', 'office space');
      if (/shop|showroom|retail/.test(type)) sub.push('shop', 'showroom', 'retail');
      if (/warehouse|godown/.test(type)) sub.push('warehouse / godown', 'warehouse');
      if (/farm/.test(type)) sub.push('farmhouse', 'farm house');
      if (/pg|hostel/.test(type)) sub.push('pg');
      if (sub.length > 0) targets.push({ synonyms: sub });
    }

    const beds = get('Bedrooms');
    if (beds) targets.push({ synonyms: [`${beds} bhk`, `${beds}bhk`, beds], scope: /bedroom|bhk/ });
    const baths = get('Bathrooms');
    if (baths) targets.push({ synonyms: [baths], scope: /bathroom|bath/ });
    const facing = normalizedText(get('Facing'));
    if (facing) targets.push({ synonyms: [facing], scope: /facing/ });

    return targets;
  }

  function clickChoice(target) {
    const clickables = [...document.querySelectorAll('button, label, li, span, div, [role="radio"], [role="button"], [role="tab"]')]
      .filter((el) => {
        if (el.closest(`#${PANEL_ID}, a[href], nav, header, footer`)) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 20 && rect.height > 14 && rect.width < 420 && rect.height < 90;
      });

    for (const syn of target.synonyms) {
      const matches = clickables
        .filter((el) => normalizedText(el.textContent) === syn && el.childElementCount <= 2)
        .filter((el) => {
          if (!target.scope) return true;
          // Numeric/direction chips are ambiguous ("3", "east") — only
          // click them inside a section that mentions the field.
          let node = el.parentElement;
          for (let depth = 0; node && depth < 5; depth++, node = node.parentElement) {
            if (target.scope.test(normalizedText(node.textContent).slice(0, 300))) return true;
          }
          return false;
        })
        .sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width);

      if (matches.length > 0) {
        const el = matches[0];
        try {
          el.click();
          flashOutline(el);
          return true;
        } catch {
          // Ignore and try the next synonym.
        }
      }
    }
    return false;
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function autofill(fields) {
    let done = await fillTextFields(fields);
    // Chips first-to-last: each click can reveal the next section, so
    // pause briefly and re-scan between clicks, then run a second text
    // pass over whatever the selections revealed.
    for (const target of choiceTargets(fields)) {
      if (clickChoice(target)) {
        done++;
        await sleep(450);
      }
    }
    done += await fillTextFields(fields);
    return done;
  }

  function copyText(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
      const prev = btn.textContent;
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = prev; }, 1200);
    });
  }

  function el(tag, style, text) {
    const node = document.createElement(tag);
    if (style) node.style.cssText = style;
    if (text) node.textContent = text;
    return node;
  }

  function renderPanel(payload) {
    document.getElementById(PANEL_ID)?.remove();

    const fields = (payload.portals && payload.portals[PORTAL]) || [];
    const panel = el('div');
    panel.id = PANEL_ID;
    panel.style.cssText = [
      'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483647', 'width:300px',
      'max-height:70vh', 'display:flex', 'flex-direction:column', 'background:#0f172a',
      'border:1px solid #334155', 'border-radius:12px', 'box-shadow:0 8px 32px rgba(0,0,0,.5)',
      'font-family:system-ui,sans-serif', 'color:#e2e8f0', 'font-size:12px', 'overflow:hidden',
    ].join(';');

    const header = el('div', 'display:flex;align-items:center;gap:8px;padding:10px 12px;background:#1e1b4b;cursor:pointer');
    const title = el('div', 'flex:1;min-width:0');
    title.appendChild(el('div', 'font-weight:800;color:#c4b5fd', 'ConvoReal Autofill'));
    title.appendChild(el('div', 'color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis', payload.title || 'No listing sent yet'));
    header.appendChild(title);
    const collapseBtn = el('button', 'background:none;border:none;color:#94a3b8;font-size:14px;cursor:pointer', '−');
    header.appendChild(collapseBtn);
    panel.appendChild(header);

    const body = el('div', 'display:flex;flex-direction:column;overflow:hidden');
    panel.appendChild(body);

    if (fields.length === 0) {
      body.appendChild(el('div', 'padding:12px;color:#94a3b8',
        'Open a property in ConvoReal → Post Ad → "Send to Extension", then come back here.'));
    } else {
      const actions = el('div', 'display:flex;gap:6px;padding:10px 12px;border-bottom:1px solid #1e293b');
      const fillBtn = el('button',
        'flex:1;background:#7c3aed;border:none;border-radius:8px;color:#fff;font-weight:700;padding:8px;cursor:pointer;font-size:12px',
        'Autofill this page');
      const status = el('span', 'align-self:center;color:#94a3b8;white-space:nowrap');
      fillBtn.addEventListener('click', async () => {
        fillBtn.disabled = true;
        status.textContent = 'Filling…';
        try {
          const n = await autofill(fields);
          status.textContent = n > 0 ? `${n} filled ✓` : 'No matches on this step';
        } finally {
          fillBtn.disabled = false;
        }
      });
      actions.appendChild(fillBtn);
      actions.appendChild(status);
      body.appendChild(actions);

      const list = el('div', 'overflow-y:auto;padding:6px 8px;display:flex;flex-direction:column;gap:4px');
      for (const field of fields) {
        const row = el('div', 'display:flex;align-items:center;gap:6px;background:#020617;border:1px solid #1e293b;border-radius:8px;padding:6px 8px');
        const meta = el('div', 'flex:1;min-width:0');
        meta.appendChild(el('div', 'font-size:9px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:#64748b', field.label));
        meta.appendChild(el('div', 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#e2e8f0', field.value));
        row.appendChild(meta);
        const copyBtn = el('button', 'background:#1e293b;border:none;border-radius:6px;color:#cbd5e1;padding:4px 8px;cursor:pointer', 'Copy');
        copyBtn.addEventListener('click', () => copyText(field.value, copyBtn));
        row.appendChild(copyBtn);
        list.appendChild(row);
      }

      if (Array.isArray(payload.photos) && payload.photos.length > 0) {
        const photoRow = el('div', 'display:flex;align-items:center;gap:6px;background:#020617;border:1px solid #1e293b;border-radius:8px;padding:6px 8px');
        photoRow.appendChild(el('div', 'flex:1;color:#94a3b8', `${payload.photos.length} photos`));
        const openBtn = el('button', 'background:#1e293b;border:none;border-radius:6px;color:#cbd5e1;padding:4px 8px;cursor:pointer', 'Open all');
        openBtn.addEventListener('click', () => payload.photos.forEach((u) => window.open(u, '_blank', 'noopener')));
        photoRow.appendChild(openBtn);
        list.appendChild(photoRow);
      }
      body.appendChild(list);

      body.appendChild(el('div', 'padding:8px 12px;color:#64748b;border-top:1px solid #1e293b',
        'Autofill fills text fields, selects matching chips (Sell, property type, BHK), and picks city/locality suggestions. Re-run it on each wizard step, fix anything it missed, review, then submit.'));
    }

    // The − minimizes the whole panel back to the floating launcher.
    header.addEventListener('click', () => setExpanded(false));

    document.body.appendChild(panel);
    syncVisibility();
  }

  // ── Floating launcher ─────────────────────────────────────────
  // The panel stays out of the way by default: a small floating
  // button bottom-right expands it on click. Sending a listing from
  // the CRM auto-expands so the handoff is obvious.

  const LAUNCHER_ID = 'convoreal-portal-launcher';
  let panelExpanded = false;
  let hasPayload = false;

  function ensureLauncher() {
    let launcher = document.getElementById(LAUNCHER_ID);
    if (launcher) return launcher;
    launcher = el('button');
    launcher.id = LAUNCHER_ID;
    launcher.title = 'ConvoReal Autofill';
    launcher.style.cssText = [
      'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483647',
      'width:48px', 'height:48px', 'border-radius:9999px', 'border:1px solid #4c1d95',
      'background:linear-gradient(135deg,#7c3aed,#4338ca)', 'color:#fff',
      'font-weight:900', 'font-size:15px', 'font-family:system-ui,sans-serif',
      'cursor:pointer', 'box-shadow:0 6px 24px rgba(124,58,237,.45)',
      'display:flex', 'align-items:center', 'justify-content:center',
    ].join(';');
    launcher.textContent = 'CR';
    const dot = el('span', [
      'position:absolute', 'top:2px', 'right:2px', 'width:11px', 'height:11px',
      'border-radius:9999px', 'background:#34d399', 'border:2px solid #0f172a', 'display:none',
    ].join(';'));
    dot.id = `${LAUNCHER_ID}-dot`;
    launcher.style.position = 'fixed';
    launcher.appendChild(dot);
    launcher.addEventListener('click', () => setExpanded(true));
    document.body.appendChild(launcher);
    return launcher;
  }

  function syncVisibility() {
    const panel = document.getElementById(PANEL_ID);
    const launcher = ensureLauncher();
    if (panel) panel.style.display = panelExpanded ? 'flex' : 'none';
    launcher.style.display = panelExpanded ? 'none' : 'flex';
    const dot = document.getElementById(`${LAUNCHER_ID}-dot`);
    if (dot) dot.style.display = hasPayload && !panelExpanded ? 'block' : 'none';
  }

  function setExpanded(next) {
    panelExpanded = next;
    syncVisibility();
  }

  chrome.storage.local.get('convorealPortalPayload', ({ convorealPortalPayload }) => {
    const payload = convorealPortalPayload || {};
    hasPayload = !!(payload.portals && payload.portals[PORTAL] && payload.portals[PORTAL].length > 0);
    renderPanel(payload);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.convorealPortalPayload) {
      const payload = changes.convorealPortalPayload.newValue || {};
      hasPayload = !!(payload.portals && payload.portals[PORTAL] && payload.portals[PORTAL].length > 0);
      // A fresh send from the CRM pops the panel open so the handoff
      // is visible without hunting for the button.
      panelExpanded = true;
      renderPanel(payload);
    }
  });
})();
