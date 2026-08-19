// ============================================================
// Turn src/lib/whatsapp/template-copy.ts into something a native
// speaker can actually review.
//
// The copy lives in TypeScript because the send path needs it there.
// The people who can tell us whether the Kannada reads like a person
// wrote it do not open GitHub. This writes one Markdown sheet per
// language — English source beside the current translation, with a
// blank column for corrections — so the review is a document you can
// send someone rather than a repository you have to explain.
//
//   npx tsx src/scripts/export-translation-review.ts
//
// Regenerate after any change to template-copy.ts; the sheets are
// committed so a correction can come back as an ordinary PR.
// ============================================================

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  TEMPLATE_COPY_TABLE,
  TEMPLATE_BUTTON_LABELS,
  templateBody,
  templateFooter,
  type EngineTemplateKey,
  type TemplateButtonAction,
} from '../lib/whatsapp/template-copy';
import {
  LANGUAGE_CODES,
  SUPPORTED_LANGUAGES,
  type LanguageCode,
} from '../lib/languages';

const OUT_DIR = join(process.cwd(), 'docs', 'translation-review');

/** Meta's caps, restated here so the sheet can show them per row. */
const MAX_BUTTON_CHARS = 25;

/**
 * Human names for the templates. Deliberately not imported from
 * engine-templates.ts: that module pulls in every builder and their
 * storage/Supabase dependencies, which a plain node script should not
 * have to load to print some strings.
 */
const TEMPLATE_LABELS: Record<EngineTemplateKey, string> = {
  requirement_review:
    'Requirement review — verify the property search recorded for an enquiry',
  property_alert: 'Property details — sent when a buyer asks about a listing',
  property_enquiry_photos: 'Property photos — the same, led by a photo',
  location_reveal: 'Location reveal — approved request for an exact address',
  location_consent_request:
    'Location consent request — a co-broker decides whether a protected request can advance',
  location_owner_decision:
    'Location owner decision — the listing side approves or rejects protected access',
  inventory_update: 'Inventory update — a refreshed catalogue snapshot',
  enquiry_followup: 'Enquiry status — the listing they asked about is gone',
  enquiry_notice: 'Enquiry notice — the same, naming the listing',
  journey_checkin: 'Enquiry check-in — is this still under consideration?',
  journey_timeline: 'Enquiry timeline — when should we check back with you?',
  journey_followup_reminder:
    'Enquiry follow-up reminder — confirm or move the scheduled follow-up date',
  purchase_progress:
    'Purchase progress — where does the paperwork stand on a deal already at legal?',
  audio_announcement:
    'Audio announcement — a voice-note update, delivered as a playable video',
  post_call_options:
    'Post-call options — after a qualification call, offer the matching listings',
};

/** What each numbered placeholder gets filled with at send time. */
const PLACEHOLDER_MEANINGS: Record<EngineTemplateKey, string[]> = {
  requirement_review: ['buyer first name', 'brokerage name'],
  property_alert: [
    'buyer first name',
    'brokerage name',
    'listing title',
    'price / size',
    'locality',
  ],
  property_enquiry_photos: [
    'buyer first name',
    'brokerage name',
    'listing title',
    'price / size',
    'locality',
  ],
  location_reveal: ['requester first name', 'listing title'],
  location_consent_request: [
    'co-broker first name',
    'listing title',
    'masked requester identity',
  ],
  location_owner_decision: [
    'request type',
    'listing title and code',
    'requester identity or masked identity',
    'access being requested',
  ],
  inventory_update: [
    'contact first name',
    'residential summary',
    'commercial summary',
    'farm & land summary',
  ],
  enquiry_followup: ['lead first name', 'brokerage name'],
  enquiry_notice: ['lead first name', 'brokerage name', 'listing title'],
  journey_checkin: ['lead first name', 'brokerage name', 'listing title'],
  journey_timeline: ['lead first name', 'brokerage name', 'listing title'],
  journey_followup_reminder: [
    'lead first name',
    'brokerage name',
    'listing title',
    'scheduled follow-up date',
  ],
  purchase_progress: [
    'buyer first name',
    'brokerage name',
    'property being bought',
    'stage the purchase is recorded at',
  ],
  audio_announcement: ['contact first name', 'brokerage name'],
  post_call_options: [
    'lead first name',
    'brokerage name',
    'stated requirement (budget / areas)',
  ],
};

/** The buttons each template actually carries, so a bubble shows the
 *  real row rather than a generic one. Mirrors the builders. */
const REPLY_BUTTONS: Record<EngineTemplateKey, TemplateButtonAction[]> = {
  requirement_review: ['update_preferences'],
  property_alert: ['send_more_details', 'view_full_details'],
  property_enquiry_photos: ['send_more_details', 'view_full_details'],
  location_reveal: ['view_location'],
  location_consent_request: ['approve_request', 'decline_request'],
  location_owner_decision: ['approve_access', 'reject_access'],
  inventory_update: ['inventory_full_list', 'site_visit', 'browse_showcase'],
  enquiry_followup: ['update_preferences', 'close_enquiry'],
  enquiry_notice: ['update_preferences', 'close_enquiry'],
  journey_checkin: ['still_considering', 'close_enquiry', 'view_full_details'],
  journey_timeline: ['timeline_today', 'timeline_2_days', 'timeline_unsure'],
  journey_followup_reminder: [
    'timeline_today',
    'timeline_2_days',
    'timeline_unsure',
  ],
  purchase_progress: ['paperwork_on_track', 'paperwork_pending'],
  audio_announcement: [],
  post_call_options: ['send_options'],
};

const BUTTON_ORDER = Object.keys(
  TEMPLATE_BUTTON_LABELS
) as TemplateButtonAction[];
const TEMPLATE_ORDER = Object.keys(TEMPLATE_COPY_TABLE) as EngineTemplateKey[];

function quote(text: string): string {
  return text
    .split('\n')
    .map((l) => (l.trim() === '' ? '>' : `> ${l}`))
    .join('\n');
}

function sheet(code: LanguageCode): string {
  const { label, native } = SUPPORTED_LANGUAGES[code];
  const out: string[] = [];

  out.push(`# ${native} (${label}) — WhatsApp message review`);
  out.push('');
  out.push(
    `These are every word ConvoReal sends to a client in ${label}. They were drafted by a machine and have **not** been checked by anyone who speaks ${label}. Please read them as a customer would.`
  );
  out.push('');
  out.push('## What to look for');
  out.push('');
  out.push(`1. **Does it read naturally**, or like translated English?`);
  out.push(
    '2. **Keep it flat and factual.** These are deliberately dry — labelled fields, no emoji, no "don\'t miss out". That dryness is what lets WhatsApp classify them as *Utility* messages, which reach people who have hit their marketing limit. Adding warmth or urgency can get the message re-classified, and that cannot be undone. Please do not make it more persuasive.'
  );
  out.push(
    '3. **Leave every `{{1}}`, `{{2}}` … exactly as they are.** They are filled in with real names and prices when the message is sent. You may move one within the sentence, but do not delete one, add one, or let two sit next to each other with only a comma between.'
  );
  out.push(
    `4. **Buttons must stay under ${MAX_BUTTON_CHARS} characters** — WhatsApp refuses longer ones.`
  );
  out.push('');
  out.push(
    'Write your correction in the last column / block. Leave it blank if the current wording is fine.'
  );
  out.push('');
  out.push('---');
  out.push('');

  // ---- Buttons ----
  out.push(`## Buttons (${BUTTON_ORDER.length})`);
  out.push('');
  out.push('The tappable options underneath a message.');
  out.push('');
  out.push(`| # | English | ${native} (current) | Length | Your correction |`);
  out.push('|---|---------|---------------------|--------|-----------------|');
  BUTTON_ORDER.forEach((action, i) => {
    const en = TEMPLATE_BUTTON_LABELS[action].en;
    const tr = TEMPLATE_BUTTON_LABELS[action][code];
    out.push(
      `| ${i + 1} | ${en} | ${tr} | ${tr.length}/${MAX_BUTTON_CHARS} | |`
    );
  });
  out.push('');
  out.push('---');
  out.push('');

  // ---- Bodies ----
  out.push(`## Messages (${TEMPLATE_ORDER.length})`);
  out.push('');
  TEMPLATE_ORDER.forEach((key, i) => {
    const meanings = PLACEHOLDER_MEANINGS[key];
    out.push(`### ${i + 1}. ${TEMPLATE_LABELS[key]}`);
    out.push('');
    if (meanings.length > 0) {
      out.push(
        `*Placeholders:* ${meanings.map((m, n) => `\`{{${n + 1}}}\` = ${m}`).join(' · ')}`
      );
      out.push('');
    }
    out.push('**English**');
    out.push('');
    out.push(quote(templateBody(key, 'en')));
    const enFooter = templateFooter(key, 'en');
    if (enFooter) {
      out.push('');
      out.push(`*Footer:* ${enFooter}`);
    }
    out.push('');
    out.push(`**${native} — current**`);
    out.push('');
    out.push(quote(templateBody(key, code)));
    const trFooter = templateFooter(key, code);
    if (trFooter) {
      out.push('');
      out.push(`*Footer:* ${trFooter}`);
    }
    out.push('');
    out.push('**Your correction** *(leave blank if the above is fine)*');
    out.push('');
    out.push('>');
    out.push('');
    out.push('---');
    out.push('');
  });

  out.push('## When you are done');
  out.push('');
  out.push(
    `Send this back with your corrections. They get applied to \`src/lib/whatsapp/template-copy.ts\` (the \`${code}:\` entries), which fixes the wording for every account at once — not just one.`
  );
  out.push('');

  return out.join('\n');
}

// ------------------------------------------------------------
// The page shell. Kept as one string so the script stays a single
// file; the only substitution is __DATA__.
// ------------------------------------------------------------
const PAGE_TEMPLATE = String.raw`<title>WhatsApp message review — ConvoReal</title>
<style>
/* Violet-cool neutrals, taken from ConvoReal's own dark-slate + violet
   system rather than invented, so this reads as part of the product.
   Every colour is a token: the page renders in the viewer's theme, and
   "system" stamps nothing on the root, so anything defined only inside
   a media query would never apply in the default state. */
:root {
  --paper:#FBFAFC; --surface:#FFFFFF; --surface-2:#F4F3F8;
  --ink:#17161D; --ink-2:#56545F; --ink-3:#8B8895;
  --line:#E5E3EC; --line-2:#D6D3E0;
  --accent:#5B4BD6; --accent-ink:#4436B8; --accent-soft:#EFECFC;
  --warn:#8A5A00; --warn-soft:#FDF4E3; --warn-line:#EAD5A8;
  --bubble-src:#F1F0F6; --bubble-tr:#EBE7FB;
  --ok:#2F7D5A;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --paper:#0F0F17; --surface:#16161F; --surface-2:#1D1D28;
    --ink:#EAE9F0; --ink-2:#A7A4B5; --ink-3:#75717F;
    --line:#292836; --line-2:#363546;
    --accent:#A79AFF; --accent-ink:#C4BBFF; --accent-soft:#231E42;
    --warn:#E6BA6A; --warn-soft:#2A2113; --warn-line:#4B3B1C;
    --bubble-src:#1D1D28; --bubble-tr:#221E40;
    --ok:#6FC49B;
  }
}
:root[data-theme="dark"] {
  --paper:#0F0F17; --surface:#16161F; --surface-2:#1D1D28;
  --ink:#EAE9F0; --ink-2:#A7A4B5; --ink-3:#75717F;
  --line:#292836; --line-2:#363546;
  --accent:#A79AFF; --accent-ink:#C4BBFF; --accent-soft:#231E42;
  --warn:#E6BA6A; --warn-soft:#2A2113; --warn-line:#4B3B1C;
  --bubble-src:#1D1D28; --bubble-tr:#221E40;
  --ok:#6FC49B;
}

/* No webfont: six Indic scripts cannot be inlined, and a linked CDN
   font is blocked outright — a silent fallback is the real risk here.
   So the stacks name the faces these devices actually ship. */
:root {
  --serif: "Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,ui-serif,serif;
  --sans: system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
  --mono: ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
  --indic: "Noto Sans Devanagari","Noto Sans Kannada","Noto Sans Tamil","Noto Sans Telugu","Noto Sans Malayalam","Nirmala UI","Kohinoor Devanagari","Tiro Devanagari Hindi",system-ui,sans-serif;
}

* { box-sizing:border-box; }
/* The language bar is sticky, so anything scrolled to must clear it. */
html { scroll-padding-top:4.5rem; }
body {
  margin:0; background:var(--paper); color:var(--ink);
  font-family:var(--sans); font-size:16px; line-height:1.6;
  -webkit-text-size-adjust:100%;
}
.wrap { max-width:54rem; margin:0 auto; padding:0 1.25rem 5rem; }

header { padding:3rem 0 1.5rem; }
.eyebrow {
  font-size:.7rem; font-weight:700; letter-spacing:.14em; text-transform:uppercase;
  color:var(--accent); margin:0 0 .75rem;
}
h1 {
  font-family:var(--serif); font-weight:600; font-size:clamp(1.9rem,5vw,2.7rem);
  line-height:1.15; margin:0 0 .75rem; text-wrap:balance; letter-spacing:-.01em;
}
.lede { color:var(--ink-2); margin:0; max-width:40rem; }

/* Sticky because the reviewer scrolls a long way and must always be
   able to tell which language they are looking at. */
.langbar {
  position:sticky; top:0; z-index:10; margin:1.75rem 0 0;
  background:color-mix(in srgb, var(--paper) 88%, transparent);
  backdrop-filter:blur(10px);
  border-block:1px solid var(--line); padding:.6rem 0;
}
.langbar-inner { display:flex; gap:.4rem; overflow-x:auto; scrollbar-width:thin; }
.chip {
  flex:0 0 auto; font-family:var(--indic); font-size:.95rem; font-weight:600;
  padding:.4rem .8rem; border-radius:999px; cursor:pointer;
  border:1px solid var(--line-2); background:var(--surface); color:var(--ink-2);
  transition:background .15s,color .15s,border-color .15s;
}
.chip:hover { border-color:var(--accent); color:var(--ink); }
.chip[aria-pressed="true"] {
  background:var(--accent); border-color:var(--accent); color:#fff;
}
.chip:focus-visible, button:focus-visible, textarea:focus-visible {
  outline:2px solid var(--accent); outline-offset:2px;
}

.guide { margin:2rem 0 0; padding:1.1rem 1.25rem; background:var(--surface);
  border:1px solid var(--line); border-radius:14px; }
.guide h2 { font-family:var(--serif); font-size:1.05rem; margin:0 0 .6rem; font-weight:600; }
.guide ol { margin:0; padding-left:1.1rem; color:var(--ink-2); font-size:.93rem; }
.guide li { margin:.45rem 0; }
.guide strong { color:var(--ink); }

/* The one thing a reviewer can get expensively wrong. */
.warn {
  margin:.9rem 0 0; padding:.85rem 1rem; border-radius:12px; font-size:.9rem;
  background:var(--warn-soft); border:1px solid var(--warn-line); color:var(--warn);
}
.warn b { color:var(--warn); }

h2.sec {
  font-family:var(--serif); font-weight:600; font-size:1.35rem;
  margin:3rem 0 .3rem; letter-spacing:-.01em;
}
.sec-note { color:var(--ink-3); font-size:.88rem; margin:0 0 1.25rem; }

.card {
  background:var(--surface); border:1px solid var(--line);
  border-radius:16px; padding:1.15rem 1.25rem; margin:0 0 1rem;
}
.card-head { display:flex; gap:.6rem; align-items:baseline; margin:0 0 .5rem; }
.num {
  font-family:var(--mono); font-size:.75rem; color:var(--accent);
  background:var(--accent-soft); padding:.12rem .45rem; border-radius:6px; flex:0 0 auto;
}
.card-title { font-weight:600; font-size:.98rem; margin:0; }
.slots { font-size:.8rem; color:var(--ink-3); margin:.1rem 0 1rem; }
.slots code { font-family:var(--mono); font-size:.78rem; color:var(--ink-2); }

.pair { display:grid; gap:.7rem; }
@media (min-width:46rem) { .pair.two { grid-template-columns:1fr 1fr; } }

.role {
  font-size:.68rem; font-weight:700; letter-spacing:.1em; text-transform:uppercase;
  color:var(--ink-3); margin:0 0 .35rem;
}

/* Rendered as the message will actually arrive. A reviewer judging
   copy in a table judges a table; judging it in the bubble, with the
   reply buttons under it, is judging the thing customers get. */
.bubble {
  border-radius:14px; padding:.75rem .9rem; font-size:.94rem; line-height:1.55;
  white-space:pre-wrap; overflow-wrap:anywhere;
}
.bubble.src { background:var(--bubble-src); }
.bubble.tr  { background:var(--bubble-tr); font-family:var(--indic); }
.bubble .ph {
  font-family:var(--mono); font-size:.82em; padding:0 .18em; border-radius:4px;
  background:color-mix(in srgb, var(--accent) 16%, transparent); color:var(--accent-ink);
}
.foot { font-size:.78rem; color:var(--ink-3); margin:.45rem 0 0; font-style:italic; }
.replies { display:flex; flex-wrap:wrap; gap:.35rem; margin:.5rem 0 0; }
.reply {
  font-size:.8rem; padding:.3rem .7rem; border-radius:999px;
  border:1px solid var(--line-2); color:var(--accent); background:transparent;
}
.replies.tr .reply { font-family:var(--indic); }

.btnrow { display:grid; gap:.55rem; align-items:center; padding:.7rem 0;
  border-bottom:1px solid var(--line); grid-template-columns:1fr; }
@media (min-width:40rem) { .btnrow { grid-template-columns:1fr 1fr auto; } }
.btnrow:last-of-type { border-bottom:0; }
.btn-en { color:var(--ink-2); font-size:.92rem; }
.btn-tr { font-family:var(--indic); font-weight:600; font-size:.98rem; }
.len {
  font-family:var(--mono); font-size:.74rem; color:var(--ink-3);
  font-variant-numeric:tabular-nums; white-space:nowrap;
}
.len.tight { color:var(--warn); }

label.note { display:block; margin:.9rem 0 0; }
label.note span {
  display:block; font-size:.72rem; font-weight:700; letter-spacing:.08em;
  text-transform:uppercase; color:var(--ink-3); margin:0 0 .3rem;
}
textarea {
  width:100%; min-height:2.6rem; resize:vertical; font:inherit;
  font-family:var(--indic); padding:.55rem .7rem; border-radius:10px;
  border:1px dashed var(--line-2); background:var(--surface-2); color:var(--ink);
}
textarea::placeholder { color:var(--ink-3); font-family:var(--sans); font-style:italic; }
textarea:not(:placeholder-shown) { border-style:solid; border-color:var(--accent); }

.actions {
  position:sticky; bottom:0; margin-top:2.5rem; padding:1rem 0;
  background:linear-gradient(to top, var(--paper) 65%, transparent);
  display:flex; gap:.7rem; align-items:center; flex-wrap:wrap;
}
.primary {
  font:inherit; font-weight:600; font-size:.92rem; cursor:pointer;
  padding:.6rem 1.1rem; border-radius:10px; border:0;
  background:var(--accent); color:#fff;
}
.primary:hover { background:var(--accent-ink); }
.count { font-size:.85rem; color:var(--ink-3); font-variant-numeric:tabular-nums; }
.count.saved { color:var(--ok); }

footer { margin-top:3rem; padding-top:1.5rem; border-top:1px solid var(--line);
  color:var(--ink-3); font-size:.83rem; }
@media (prefers-reduced-motion: reduce) { * { transition:none !important; } }
</style>

<div class="wrap">
  <header>
    <p class="eyebrow">ConvoReal · translation review</p>
    <h1>Do these messages sound right?</h1>
    <p class="lede">
      Every WhatsApp message ConvoReal sends to a client, in your language.
      They were drafted by a machine and nobody who speaks the language has
      read them yet. Nothing goes out until someone does.
    </p>
  </header>

  <nav class="langbar" aria-label="Choose language">
    <div class="langbar-inner" id="chips"></div>
  </nav>

  <section class="guide" aria-labelledby="g">
    <h2 id="g">What to look for</h2>
    <ol>
      <li><strong>Does it read naturally?</strong> Or does it read like English put through a machine?</li>
      <li><strong>Leave every <code>{{1}}</code>, <code>{{2}}</code> exactly as it is.</strong> Real names and prices drop into those slots when the message is sent. Move one within a sentence if the grammar needs it, but never delete one, add one, or let two sit side by side with only a comma between.</li>
      <li><strong>Keep the length close.</strong> Buttons are capped at 25 characters and the counter turns amber when you are near.</li>
    </ol>
    <p class="warn">
      <b>Please do not make it friendlier.</b> These read flat on purpose — plain
      labels, no emoji, no urgency. That flatness is what lets WhatsApp treat them
      as service messages, which still reach people who have hit their limit on
      promotional ones. Warmer wording can get a message reclassified as marketing,
      and that cannot be reversed afterwards.
    </p>
  </section>

  <h2 class="sec">Buttons</h2>
  <p class="sec-note">The tappable options underneath a message.</p>
  <div class="card" id="buttons"></div>

  <h2 class="sec">Messages</h2>
  <p class="sec-note">Shown the way they arrive on a phone.</p>
  <div id="messages"></div>

  <div class="actions">
    <button class="primary" id="copy" type="button">Copy my corrections</button>
    <span class="count" id="count">No corrections yet</span>
  </div>

  <footer>
    Corrections go into <code>src/lib/whatsapp/template-copy.ts</code>, which fixes
    the wording for every ConvoReal account at once. Your notes stay in this
    browser until you copy them &mdash; nothing is sent anywhere.
  </footer>
</div>

<script>
var DATA = __DATA__;
var current = DATA.languages[0];
var notes = {};

function esc(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
/* Make the slots visually obvious so nobody edits one by accident. */
function withSlots(s) {
  return esc(s).replace(/\{\{(\d+)\}\}/g, '<span class="ph">{{$1}}</span>');
}
function key(kind, id) { return current.code + ":" + kind + ":" + id; }

function renderChips() {
  document.getElementById("chips").innerHTML = DATA.languages.map(function (l) {
    return '<button class="chip" type="button" data-code="' + l.code + '" ' +
      'aria-pressed="' + (l.code === current.code) + '" ' +
      'title="' + esc(l.label) + '">' + esc(l.native) + "</button>";
  }).join("");
}

function renderButtons() {
  document.getElementById("buttons").innerHTML = current.buttons.map(function (b, i) {
    var tight = b.tr.length > b.max - 4;
    return '<div class="btnrow">' +
      '<div class="btn-en">' + esc(b.en) + "</div>" +
      '<div class="btn-tr">' + esc(b.tr) + "</div>" +
      '<div class="len' + (tight ? " tight" : "") + '">' + b.tr.length + "/" + b.max + "</div>" +
      '<label class="note" style="grid-column:1/-1"><span>Better wording?</span>' +
      '<textarea data-k="' + key("button", b.id) + '" rows="1" placeholder="Leave blank if this is fine"></textarea>' +
      "</label></div>";
  }).join("");
}

function bubble(role, text, footer, replies, isTr) {
  return '<div><p class="role">' + role + "</p>" +
    '<div class="bubble ' + (isTr ? "tr" : "src") + '">' + withSlots(text) + "</div>" +
    (footer ? '<p class="foot">' + esc(footer) + "</p>" : "") +
    (replies.length
      ? '<div class="replies' + (isTr ? " tr" : "") + '">' +
        replies.map(function (r) { return '<span class="reply">' + esc(isTr ? r.tr : r.en) + "</span>"; }).join("") +
        "</div>"
      : "") +
    "</div>";
}

function renderMessages() {
  document.getElementById("messages").innerHTML = current.messages.map(function (m, i) {
    var slots = m.slots.length
      ? '<p class="slots">' + m.slots.map(function (s, n) {
          return "<code>{{" + (n + 1) + "}}</code> " + esc(s);
        }).join(" &middot; ") + "</p>"
      : "";
    return '<div class="card">' +
      '<div class="card-head"><span class="num">' + (i + 1) + "</span>" +
      '<h3 class="card-title">' + esc(m.label) + "</h3></div>" + slots +
      '<div class="pair two">' +
        bubble("English", m.en, m.enFooter, m.replies, false) +
        bubble(esc(current.native) + " &mdash; now", m.tr, m.trFooter, m.replies, true) +
      "</div>" +
      '<label class="note"><span>Better wording?</span>' +
      '<textarea data-k="' + key("message", m.id) + '" rows="3" placeholder="Leave blank if this is fine"></textarea>' +
      "</label></div>";
  }).join("");
}

function restore() {
  document.querySelectorAll("textarea").forEach(function (t) {
    var k = t.getAttribute("data-k");
    if (notes[k]) t.value = notes[k];
    t.addEventListener("input", function () {
      if (t.value.trim()) notes[k] = t.value; else delete notes[k];
      updateCount();
    });
  });
}

function updateCount() {
  var n = Object.keys(notes).length;
  var el = document.getElementById("count");
  el.textContent = n === 0 ? "No corrections yet"
    : n + (n === 1 ? " correction" : " corrections") + " noted";
  el.className = "count" + (n ? " saved" : "");
}

function render() {
  renderChips(); renderButtons(); renderMessages(); restore(); updateCount();
}

document.getElementById("chips").addEventListener("click", function (e) {
  var b = e.target.closest(".chip"); if (!b) return;
  var code = b.getAttribute("data-code");
  current = DATA.languages.filter(function (l) { return l.code === code; })[0];
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

/* One pasteable block, so a reviewer never has to touch the repo. */
document.getElementById("copy").addEventListener("click", function () {
  var lines = [];
  DATA.languages.forEach(function (l) {
    var mine = Object.keys(notes).filter(function (k) { return k.indexOf(l.code + ":") === 0; });
    if (!mine.length) return;
    lines.push("## " + l.native + " (" + l.label + ")  [" + l.code + "]");
    lines.push("");
    l.buttons.forEach(function (b) {
      var k = l.code + ":button:" + b.id;
      if (!notes[k]) return;
      lines.push("BUTTON " + b.id);
      lines.push("  english: " + b.en);
      lines.push("  was:     " + b.tr);
      lines.push("  change:  " + notes[k].replace(/\n/g, " "));
      lines.push("");
    });
    l.messages.forEach(function (m) {
      var k = l.code + ":message:" + m.id;
      if (!notes[k]) return;
      lines.push("MESSAGE " + m.id + "  (" + m.label + ")");
      lines.push("  was:");
      m.tr.split("\n").forEach(function (x) { lines.push("    " + x); });
      lines.push("  change:");
      notes[k].split("\n").forEach(function (x) { lines.push("    " + x); });
      lines.push("");
    });
  });
  var out = lines.length
    ? "ConvoReal translation corrections\n\n" + lines.join("\n")
    : "No corrections noted.";
  var btn = document.getElementById("copy");
  navigator.clipboard.writeText(out).then(function () {
    btn.textContent = "Copied — paste it back";
    setTimeout(function () { btn.textContent = "Copy my corrections"; }, 2600);
  }, function () {
    btn.textContent = "Press ⌘/Ctrl+C";
    window.prompt("Copy your corrections:", out);
    setTimeout(function () { btn.textContent = "Copy my corrections"; }, 2600);
  });
});

render();
</script>`;

/**
 * The same content as a single self-contained page.
 *
 * The Markdown sheets are for anyone comfortable with a repository.
 * Most people who can judge whether the Kannada reads well are not,
 * and they are on a phone. This emits one HTML file that can be
 * published and sent as a link: pick your language, read the messages
 * laid out the way WhatsApp will actually show them, type corrections
 * inline, and copy the lot back as plain text.
 *
 * Data is injected from the same source as everything else, so the
 * page cannot drift from template-copy.ts.
 */
function reviewPage(): string {
  const payload = {
    languages: LANGUAGE_CODES.filter((c) => c !== 'en').map((code) => ({
      code,
      label: SUPPORTED_LANGUAGES[code].label,
      native: SUPPORTED_LANGUAGES[code].native,
      buttons: BUTTON_ORDER.map((action) => ({
        id: action,
        en: TEMPLATE_BUTTON_LABELS[action].en,
        tr: TEMPLATE_BUTTON_LABELS[action][code],
        max: MAX_BUTTON_CHARS,
      })),
      messages: TEMPLATE_ORDER.map((key) => ({
        id: key,
        label: TEMPLATE_LABELS[key],
        slots: PLACEHOLDER_MEANINGS[key],
        en: templateBody(key, 'en'),
        enFooter: templateFooter(key, 'en') ?? null,
        tr: templateBody(key, code),
        trFooter: templateFooter(key, code) ?? null,
        replies: REPLY_BUTTONS[key].map((action) => ({
          en: TEMPLATE_BUTTON_LABELS[action].en,
          tr: TEMPLATE_BUTTON_LABELS[action][code],
        })),
      })),
    })),
  };

  // `</script` inside a script block would close it early.
  const json = JSON.stringify(payload).replace(/<\//g, '<\\/');
  return PAGE_TEMPLATE.replace('__DATA__', json);
}

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });

  const written: string[] = [];
  for (const code of LANGUAGE_CODES) {
    // English is the source these are translated FROM; there is
    // nothing for a reviewer to compare it against.
    if (code === 'en') continue;
    const file = join(OUT_DIR, `${code}.md`);
    writeFileSync(file, sheet(code), 'utf-8');
    written.push(file);
  }

  const html = join(OUT_DIR, 'review.html');
  writeFileSync(html, reviewPage(), 'utf-8');
  written.push(html);

  console.log(`Wrote ${written.length} files:`);
  for (const f of written) console.log(`  ${f}`);
}

main();
