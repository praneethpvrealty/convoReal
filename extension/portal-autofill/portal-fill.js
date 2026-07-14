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

  function autofill(fields) {
    const candidates = [...document.querySelectorAll('input, textarea')].filter(isFillable);
    const used = new Set();
    let filled = 0;

    for (const field of fields) {
      const hints = FIELD_HINTS[field.label];
      if (!hints) continue;
      let best = null;
      let bestScore = 0;
      for (const el of candidates) {
        if (used.has(el)) continue;
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
        const value = NUMERIC_FIELDS.has(field.label) ? numericValue(field.label, field.value) : field.value;
        try {
          nativeSet(best, value);
          used.add(best);
          best.style.outline = '2px solid #10b981';
          setTimeout(() => { best.style.outline = ''; }, 3000);
          filled++;
        } catch {
          // Portal blocked the write — the copy button still covers it.
        }
      }
    }
    return filled;
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
      fillBtn.addEventListener('click', () => {
        const n = autofill(fields);
        status.textContent = n > 0 ? `${n} filled ✓` : 'No matches on this step';
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
        'Autofill covers text fields; pick dropdowns manually, then review before submitting.'));
    }

    let collapsed = false;
    header.addEventListener('click', () => {
      collapsed = !collapsed;
      body.style.display = collapsed ? 'none' : 'flex';
      collapseBtn.textContent = collapsed ? '+' : '−';
    });

    document.body.appendChild(panel);
  }

  chrome.storage.local.get('convorealPortalPayload', ({ convorealPortalPayload }) => {
    renderPanel(convorealPortalPayload || {});
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.convorealPortalPayload) {
      renderPanel(changes.convorealPortalPayload.newValue || {});
    }
  });
})();
