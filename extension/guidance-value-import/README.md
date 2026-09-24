# ConvoReal Guidance Value Import (Chrome extension)

Imports every Karnataka guidance value notification from the IGR
**Revised Guidelines Value** page into ConvoReal in one click. The IGR site
refuses connections from cloud servers, so this extension fetches the page and
the PDFs in your own browser and hands them to ConvoReal, which reads the rates
(district, SRO, village / area / road, rate per sq.m or per acre) into the
guidance value table.

## Install (once)

1. Open Chrome → `chrome://extensions`
2. Toggle **Developer mode** (top right)
3. Click **Load unpacked** → select this folder (`extension/guidance-value-import`)

To hand it to someone not working from the repo, run
`npm run ext:guidance:zip` from the project root and share
`extension/guidance-value-import.zip` (unzip, then Load unpacked as above).

## Use

1. In the same Chrome profile, sign in to ConvoReal as a **platform admin**
   (the account that sees Admin in the sidebar).
2. Click the extension's icon. A tab opens and starts on its own:
   - opens the IGR page in a background tab and reads its table,
   - asks ConvoReal to map each row to a district and sub-registrar office
     (Bengaluru registration districts are filed under Bengaluru Urban),
   - for every notification not yet imported: downloads the PDF, uploads it,
     and waits while ConvoReal reads its rates, two pages at a time.
3. Keep that tab open until the status says **Finished**. Progress, rates found
   and failures are listed per SRO.

Running it again is safe: imported notifications are skipped, unfinished ones
resume where they stopped, and failed ones are retried. **Stop** halts after
the pages in flight.

Settings at the top of the tab (saved for next time):

- **ConvoReal address** — `https://app.convoreal.com` by default. Add other
  domains to `host_permissions` in `manifest.json` if you run ConvoReal
  elsewhere.
- **IGR page** — the revised guidelines value page.
- **In parallel** — how many PDFs are read at once (1–4, default 2).
- **BDA corrigenda** — also import the BDA corrigendum gazettes.

## Cost

Every page of every PDF is read by Gemini, two pages per call, and each call sends only those pages plus the one before them — never the whole PDF. A full state run is hundreds of
PDFs; start with the default settings and watch the first few finish before
leaving it to run. Add the keys in ConvoReal under Admin → AI keys — a key
marked "Guidance value import only" is used for imports alone, so a long run
cannot exhaust the key the chatbot uses, and several keys take over from one
another when one runs out. PDFs are read on Gemini's lite model; set
`GEMINI_IMPORT_TIER=standard` to switch back to full Flash.

If Gemini runs out of credits or rejects the key, the run pauses by itself
and says so; top up or change the key and click Start to resume. A Gemini
rate limit makes the row wait a minute and retry.

## Troubleshooting

- **"Sign in to ConvoReal as a platform admin…"** — the extension uses your
  browser's ConvoReal session. Sign in on the ConvoReal address above in this
  Chrome profile and click Start.
- **"No guidance value PDFs were found"** — the IGR page layout changed. Save
  the page (Ctrl+S) and send the HTML to your ConvoReal developer.
- **A row fails with "PDF is over 14 MB"** — that notification is too large to
  read in one piece; split it and use Admin → Guidance values → Upload many
  PDFs.
