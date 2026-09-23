// ============================================================
// Guidance value import — runs in the extension's own tab.
//
// 1. Opens the IGR page in a background tab and reads its rendered
//    HTML (the site refuses cloud servers, so the browser fetches).
// 2. Hands that HTML to ConvoReal, which maps each row to a district
//    and SRO and says which PDFs are already imported.
// 3. For each PDF still missing: download it here, register it with
//    ConvoReal, PUT it to the signed storage URL, then call the parse
//    endpoint until ConvoReal reports it ready.
//
// Requests to ConvoReal carry the browser's own signed-in session, so
// the admin must be signed in to ConvoReal in this Chrome profile.
// Nothing is stored except the settings below.
// ============================================================

const DEFAULTS = {
  engineUrl: 'https://app.convoreal.com',
  igrUrl: 'https://igr.karnataka.gov.in/72/revised-guidelines-value/en',
  concurrency: 2,
  includeCorrigenda: true,
};
const MAX_PDF_BYTES = 14 * 1024 * 1024;
const PAGE_WAIT_MS = 60_000;
const PARSE_RETRIES = 3;

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let stopped = false;
let running = false;
const rowEls = new Map();
const totals = { done: 0, working: 0, failed: 0, rates: 0 };

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function loadSettings() {
  const { gvSettings } = await chrome.storage.local.get('gvSettings');
  return { ...DEFAULTS, ...(gvSettings || {}) };
}

function readForm() {
  return {
    engineUrl: $('engineUrl').value.trim().replace(/\/+$/, ''),
    igrUrl: $('igrUrl').value.trim(),
    concurrency: Math.min(4, Math.max(1, Number($('concurrency').value) || 2)),
    includeCorrigenda: $('includeCorrigenda').checked,
  };
}

function fillForm(settings) {
  $('engineUrl').value = settings.engineUrl;
  $('igrUrl').value = settings.igrUrl;
  $('concurrency').value = String(settings.concurrency);
  $('includeCorrigenda').checked = settings.includeCorrigenda;
}

function status(text, cls = '') {
  $('status').textContent = text;
  $('status').className = cls;
}

function refreshTotals(total) {
  if (typeof total === 'number') $('total').textContent = String(total);
  $('done').textContent = String(totals.done);
  $('working').textContent = String(totals.working);
  $('failed').textContent = String(totals.failed);
  $('rates').textContent = String(totals.rates);
}

function addRow(row) {
  const tr = document.createElement('tr');
  for (const value of [
    row.district || row.registration_district || '—',
    row.sro || row.label,
    row.kind === 'corrigendum' ? 'Corrigendum' : 'Notification',
    '',
    '',
  ]) {
    const td = document.createElement('td');
    td.textContent = value;
    tr.appendChild(td);
  }
  $('rows').appendChild(tr);
  rowEls.set(row.url, tr);
}

function setRow(row, state, detail = '') {
  const tr = rowEls.get(row.url);
  if (!tr) return;
  const cls =
    state === 'done' ? 'done' : state === 'failed' ? 'failed' : state === 'skipped' ? 'muted' : 'working';
  tr.children[3].textContent = state;
  tr.children[3].className = cls;
  tr.children[4].textContent = detail;
}

async function api(settings, path, init = {}) {
  let res;
  try {
    res = await fetch(`${settings.engineUrl}${path}`, {
      credentials: 'include',
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
  } catch {
    throw new ApiError(`Could not reach ConvoReal at ${settings.engineUrl}.`, 0);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(body?.error || `ConvoReal answered ${res.status}`, res.status);
  }
  return body;
}

function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('The IGR page did not finish loading in time.'));
    }, PAGE_WAIT_MS);
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === 'complete') listener(tabId, { status: 'complete' });
    });
  });
}

async function readIgrPage(igrUrl) {
  const tab = await chrome.tabs.create({ url: igrUrl, active: false });
  try {
    await waitForTabLoad(tab.id);
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async () => {
        for (let i = 0; i < 40; i += 1) {
          const rows = [...document.querySelectorAll('tr')].filter((tr) =>
            /view/i.test(tr.textContent || '')
          );
          if (rows.length > 3) break;
          await new Promise((r) => setTimeout(r, 500));
        }
        return { html: document.documentElement.outerHTML, url: location.href };
      },
    });
    return result.result;
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function isPdf(bytes) {
  return (
    bytes.length > 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  );
}

function fileName(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() || 'notification.pdf');
  } catch {
    return 'notification.pdf';
  }
}

async function uploadRow(settings, row) {
  setRow(row, 'downloading');
  const res = await fetch(row.url, { credentials: 'include' });
  if (!res.ok) throw new Error(`IGR answered ${res.status} for the PDF`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!isPdf(bytes)) throw new Error('IGR did not return a PDF for this row');
  if (bytes.length > MAX_PDF_BYTES) throw new Error('PDF is over 14 MB');

  setRow(row, 'uploading');
  const { data } = await api(settings, '/api/admin/guidance-values/sources', {
    method: 'POST',
    body: JSON.stringify({
      district: row.district || row.registration_district || 'Karnataka',
      taluk: row.registration_district || undefined,
      sro: row.sro || undefined,
      title: row.label,
      source_url: row.url,
      filename: fileName(row.url),
      mime_type: 'application/pdf',
      size: bytes.length,
    }),
  });
  const put = await fetch(data.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf' },
    body: bytes,
  });
  if (!put.ok) {
    await api(settings, `/api/admin/guidance-values/sources/${data.source.id}`, {
      method: 'DELETE',
    }).catch(() => {});
    throw new Error(`Storage upload failed (${put.status})`);
  }
  return data.source.id;
}

async function parseRow(settings, row, sourceId) {
  let failures = 0;
  for (;;) {
    if (stopped) return 'stopped';
    try {
      const { data } = await api(
        settings,
        `/api/admin/guidance-values/sources/${sourceId}/parse`,
        { method: 'POST' }
      );
      failures = 0;
      setRow(
        row,
        'reading',
        `${data.pages_parsed}/${data.page_count ?? '?'} pages · ${data.row_count} rates`
      );
      if (data.status === 'ready') return data;
    } catch (err) {
      if (err.status === 401 || err.status === 403) throw err;
      failures += 1;
      if (failures >= PARSE_RETRIES) throw err;
      setRow(row, 'retrying', err.message);
      await sleep(5000 * failures);
    }
  }
}

async function processRow(settings, row) {
  totals.working += 1;
  refreshTotals();
  try {
    const sourceId = row.source_id || (await uploadRow(settings, row));
    const result = await parseRow(settings, row, sourceId);
    if (result === 'stopped') {
      setRow(row, 'stopped', 'Resumes on the next run');
      return;
    }
    totals.done += 1;
    totals.rates += result.row_count || 0;
    setRow(row, 'done', `${result.row_count} rates from ${result.page_count} pages`);
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      stopped = true;
      status(
        'ConvoReal refused the request. Sign in to ConvoReal as a platform admin in this Chrome profile, then click the extension again.',
        'failed'
      );
    }
    totals.failed += 1;
    setRow(row, 'failed', err.message || String(err));
  } finally {
    totals.working -= 1;
    refreshTotals();
  }
}

async function run() {
  if (running) return;
  running = true;
  stopped = false;
  totals.done = totals.working = totals.failed = totals.rates = 0;
  rowEls.clear();
  $('rows').textContent = '';
  $('start').disabled = true;
  $('stop').disabled = false;

  const settings = readForm();
  await chrome.storage.local.set({ gvSettings: settings });

  try {
    status('Checking your ConvoReal sign-in…');
    await api(settings, '/api/admin/guidance-values/sources');

    status('Reading the IGR page…');
    const page = await readIgrPage(settings.igrUrl);

    status('Matching the IGR table with ConvoReal…');
    const { data: found } = await api(settings, '/api/admin/guidance-values/import', {
      method: 'POST',
      body: JSON.stringify({ action: 'discover', url: page.url, html: page.html }),
    });

    const rows = found.filter(
      (row) => settings.includeCorrigenda || row.kind !== 'corrigendum'
    );
    if (!rows.length) {
      status(
        'No guidance value PDFs were found on the IGR page. It may have changed layout; send its saved HTML to your ConvoReal developer.',
        'failed'
      );
      return;
    }

    rows.forEach(addRow);
    const queue = [];
    for (const row of rows) {
      if (row.status === 'ready') {
        totals.done += 1;
        totals.rates += row.row_count || 0;
        setRow(row, 'done', 'Already imported');
      } else {
        setRow(row, 'queued', row.source_id ? 'Resumes where it stopped' : '');
        queue.push(row);
      }
    }
    refreshTotals(rows.length);
    status(`Importing ${queue.length} of ${rows.length} notifications…`);

    const workers = Array.from({ length: settings.concurrency }, async () => {
      while (!stopped && queue.length) {
        await processRow(settings, queue.shift());
      }
    });
    await Promise.all(workers);

    if (stopped) {
      if (!$('status').classList.contains('failed')) {
        status('Stopped. Click Start (or the extension icon) to resume.');
      }
    } else {
      status(
        `Finished: ${totals.done} of ${rows.length} imported, ${totals.failed} failed, ${totals.rates} rates in total.${totals.failed ? ' Click Start to retry the failed ones.' : ''}`,
        totals.failed ? 'failed' : 'done'
      );
    }
  } catch (err) {
    status(
      err.status === 401 || err.status === 403
        ? 'Sign in to ConvoReal as a platform admin in this Chrome profile, then click Start.'
        : err.message || String(err),
      'failed'
    );
  } finally {
    running = false;
    $('start').disabled = false;
    $('stop').disabled = true;
  }
}

$('start').addEventListener('click', () => run());
$('stop').addEventListener('click', () => {
  stopped = true;
  status('Stopping after the current pages…');
});

loadSettings().then((settings) => {
  fillForm(settings);
  run();
});
