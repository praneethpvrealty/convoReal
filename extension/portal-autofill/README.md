# ConvoReal Portal Autofill (Chrome extension)

Fills the **99acres / MagicBricks / Housing.com** post-property forms with listing
data sent from your ConvoReal CRM. It runs on **your own logged-in portal
session** — the extension never sees or stores portal credentials, and the final
Submit click is always yours.

## Install (once, ~1 minute)

1. Open Chrome → `chrome://extensions`
2. Toggle **Developer mode** (top right)
3. Click **Load unpacked** → select this folder (`extension/portal-autofill`)

If your CRM runs on a domain other than `convoreal.com` / `localhost:3000`,
add it to the first `matches` list in `manifest.json` and click ↻ on the
extension card.

## Use

1. In ConvoReal → Inventory → **Post Ad** on a property → **Send to Extension**
   (the dialog shows a green dot when the extension is detected).
2. Open the portal's post-property page (button in the same dialog) — you'll be
   logged in as yourself, OTP and all, like normal.
3. A floating **ConvoReal Autofill** panel appears bottom-right with the
   listing. Click **Autofill this page** on each step of the portal's wizard;
   matched text fields fill and flash green. Anything the portal renders as a
   custom dropdown, use the panel's per-field **Copy** buttons.
4. Review everything, upload photos (the panel's "Open all" opens them for
   quick save-and-upload), and click the portal's own Submit.
5. Back in ConvoReal, hit **Mark as Posted** so the CRM tracks the listing and
   reminds you before it expires.

Sent the wrong property, or want a blank panel? Click **Clear** in the panel to
drop the stored listing and reset it to the empty state.

## How data flows

CRM dialog → `window.postMessage` → `crm-bridge.js` (runs only on ConvoReal
pages) → `chrome.storage.local` → `portal-fill.js` (runs only on the three
portal domains) → form fields. Listing content only; nothing leaves your
browser.
