# Owners Den — Manual Test Guide

End-to-end manual test plan for the Owners Den feature set on branch
`claude/owners-den-design-vxai2w`: owner portal (Deal Mode), cross-tenant
matching + paid unlock, free bids, deal rooms + Token Safe, and the
mandatory verified-WhatsApp rule for staff.

Run the scenarios **in order** — later ones build on earlier ones.
Anything marked `SQL` runs in the Supabase SQL editor. Anything marked
`curl` runs in a terminal against your dev server.

---

## 0. Prerequisites

1. **Migrations applied** (SQL editor, in order): main's
   `131_journey_mindmap.sql`, then the Den set `132_den_identity.sql` →
   `137_staff_phone_verification.sql`. Verify:

   ```sql
   SELECT table_name FROM information_schema.tables
   WHERE table_name IN ('den_users','den_contact_links','den_match_unlocks',
                        'property_bids','property_bid_events','deal_rooms','token_escrows');
   -- expect 7 rows

   SELECT column_name FROM information_schema.columns
   WHERE table_name = 'properties' AND column_name IN ('deal_mode','min_bid');
   -- expect 2 rows

   SELECT tgname FROM pg_trigger
   WHERE tgname IN ('on_auth_user_phone_verified','profiles_phone_guard');
   -- expect 2 rows
   ```

2. **Supabase dashboard**: Authentication → Sign In / Up → **Phone provider
   enabled**, and the **Send SMS hook** pointing at
   `<app-url>/api/auth/sms-hook` is enabled (this is what delivers OTP codes
   on WhatsApp). `SUPABASE_SMS_HOOK_SECRET` must be set in the app env.

3. **App env**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, and `AUTOMATION_CRON_SECRET` (or
   `CRON_SECRET`) for the cron curls below.

4. `npm install && npm run dev`. A WhatsApp sender must be configured
   (sandbox or Official API) for OTPs and notifications to actually arrive.

5. **You need two real WhatsApp numbers** you can receive messages on:
   - `PHONE_OWNER` — plays the property owner
   - `PHONE_BUYER` — plays the buyer contact
   (One physical phone with two numbers/WhatsApp Business also works.)

---

## 1. Test data setup

You need **two tenant accounts** so cross-tenant matching has two sides:

| Role | Account | How |
|---|---|---|
| Agency A (owner side) | your main login | existing account |
| Agency B (buyer side) | second staff signup | fresh email signup (this also exercises Scenario A) |

Then, via the CRM UI (more realistic than SQL):

1. **Agency A** → Contacts → add contact: name "Test Owner", phone
   `PHONE_OWNER`, classification **Owner**.
2. **Agency A** → Inventory → add a property (e.g. "3BHK test flat,
   Indiranagar", price ₹1.25 Cr, 3 bedrooms, city Bangalore), set its
   **owner contact** to "Test Owner", and **publish** it.
3. **Agency B** → Contacts → add contact: name "Test Buyer", phone
   `PHONE_BUYER`, classification **Buyer**, budget range covering the
   property price (e.g. ₹1 Cr – ₹1.5 Cr), area of interest matching the
   property locality (e.g. "Indiranagar"), property interest matching the
   type (apartment). The matching engine gates on type → location → budget,
   so make these line up.

Grab the two account ids for later:

```sql
SELECT id, name FROM accounts ORDER BY created_at DESC LIMIT 5;
-- note: AGENCY_A_ID, AGENCY_B_ID
```

---

## 2. Scenario A — staff mandatory WhatsApp verification

Covers `/verify-phone`, the dashboard gate, and the DB hard-wiring.

1. Sign up a fresh staff account (email/password) → confirm email → log in.
   **Expect:** after profile-setup (name/email), you are redirected to
   `/verify-phone` — "ConvoReal runs on WhatsApp…".
2. Enter a real WhatsApp number → **Expect:** 6-digit code arrives on
   WhatsApp. Verify it. **Expect:** redirect to `/dashboard`.
3. `SQL` — the trigger mirrored the verified phone:
   ```sql
   SELECT p.phone FROM profiles p JOIN auth.users u ON u.id = p.user_id
   WHERE u.email = '<the new signup email>';
   -- expect '+<digits>' matching the number you verified
   ```
4. Log out, log back in (same account, any method incl. Google if linked).
   **Expect:** NO re-verification — straight to the dashboard.
5. Settings → General: **Expect:** WhatsApp number shown read-only with a
   "Change number" button; changing it requires a fresh OTP.
6. Guard trigger — `SQL`, simulating a client-role write (run the whole
   block; the ROLLBACK keeps it side-effect free):
   ```sql
   BEGIN;
   SET LOCAL request.jwt.claims = '{"role":"authenticated"}';
   UPDATE profiles SET phone = '+911234567890'
   WHERE user_id = (SELECT user_id FROM profiles LIMIT 1);
   -- expect: ERROR "phone can only be changed through WhatsApp OTP verification"
   ROLLBACK;
   ```

---

## 3. Scenario B — Den login & auto-linking

1. Visit `/login` (staff). **Expect:** amber card "Own a property? List &
   manage it yourself in the Owners Den →". Same on `/signup`.
2. In an incognito window open `/den/login`. Enter `PHONE_OWNER` →
   **Expect:** OTP on WhatsApp → verify → you land on `/den`.
3. **Expect:** the dashboard greets you and shows the Agency A property
   (auto-linked by phone → "managed by <Agency A>"). Activity counters
   render (zeros are fine).
4. `SQL` — isolation proof:
   ```sql
   SELECT du.id, du.phone, (SELECT count(*) FROM profiles pr WHERE pr.user_id = du.auth_user_id) AS profile_rows
   FROM den_users du ORDER BY created_at DESC LIMIT 1;
   -- expect profile_rows = 0 (den user has NO staff profile)
   SELECT count(*) FROM den_contact_links WHERE status = 'active';
   -- expect ≥ 1
   ```
5. (Optional) Google path: sign out of the Den, `/den/login` → Continue with
   Google → **Expect:** forced to `/den/verify-phone` before entering.

---

## 4. Scenario C — owner listing management

1. In the Den: My Properties → Add property. Fill a Rent listing (rent,
   maintenance, advance) with 2–3 photos → submit.
   **Expect:** "Pending review by your agency" badge; photos visible.
2. As Agency A staff: Inventory → **Expect:** the new listing with status
   Pending Review, `listing_source = owner`, owner contact attached.
3. In the Den, open the first (published) property → edit price and
   description, set **Minimum offer** (e.g. ₹1.2 Cr) → Save.
   **Expect:** success toast; values persist on reload.

---

## 5. Scenario D — Deal Mode & cross-tenant matching

1. Den → published property → Deal Mode → **Soft** → confirm dialog.
   **Expect:** chip turns "Soft".
2. Run the sweep:
   ```bash
   curl -H "x-cron-secret: $AUTOMATION_CRON_SECRET" http://localhost:3000/api/cron/deal-mode-matching
   # expect JSON like {"poolSize":1,"eventsCreated":1,...}
   ```
3. As **Agency B** staff → `/radar`. **Expect:** an amber **"Direct Owner"**
   card: property type + locality + **price band** (not exact), score ring,
   your matching buyer ("Test Buyer"), and a blurred/locked owner block.
   **Confirm it does NOT show:** exact address, title, photos, owner name.
4. Back in the Den: flip Deal Mode to **Aggressive**. **Expect:** confirm
   dialog mentions immediate alerts; within ~a minute `PHONE_BUYER` gets a
   WhatsApp "Direct owner property alert" **only if** the buyer has an open
   24h session or Agency B has an approved `den_match_alert` template —
   otherwise it's silently skipped (radar card still shows; this is by design).

---

## 6. Scenario E — paid unlock

All as **Agency B** staff on the radar card.

1. Click **Unlock owner details** with a fresh (zero-credit) account.
   **Expect:** error toast "Not enough credits — you need N more…". This
   attempt also auto-creates the wallet row.
2. `SQL` — grant test credits (total_credits is maintained manually, bump both):
   ```sql
   UPDATE credit_wallets
   SET purchased_credits = purchased_credits + 500, total_credits = total_credits + 500
   WHERE account_id = '<AGENCY_B_ID>';
   ```
3. Unlock again. **Expect:** success toast with credits used (50, or 75 when
   the match score ≥ 80%); the card reveals full address, photos, owner name
   + WhatsApp deep link, "Listed via <Agency A>".
4. `SQL` — exactly one unlock row and one matching burn:
   ```sql
   SELECT credits_burned, score FROM den_match_unlocks WHERE account_id = '<AGENCY_B_ID>';
   SELECT type, ai_feature, amount FROM credit_transactions
   WHERE account_id = '<AGENCY_B_ID>' ORDER BY created_at DESC LIMIT 3;
   ```
5. Reload the radar page. **Expect:** the card is already unlocked, no
   second charge (unique per account+property).
6. Withdrawn-property refusal: turn Deal Mode **Off** in the Den, then (in a
   fresh tenant or after deleting the unlock row) attempt an unlock —
   **Expect:** "The owner is no longer accepting interest…" and **no burn**.
   Turn Deal Mode back on for the next scenario.

---

## 7. Scenario F — bids

1. Agency B, unlocked card → **Place an offer**: below the min_bid first.
   **Expect:** "The owner only considers offers of ₹… or more."
2. Offer a valid amount + message. **Expect:** "Offer sent to the owner!";
   `PHONE_OWNER` gets a WhatsApp ping (session/template rules as above).
3. Try placing a second offer on the same property. **Expect:** blocked —
   one live offer per property (withdraw first).
4. In the Den → **Offers**: the bid shows amount, message, and the bidder as
   a masked professional card (agency name only — no personal contact).
5. **Counter** it (higher amount + note). As Agency B: radar card shows the
   counter with **Accept counter** / **Walk away**.
6. Accept the counter. **Expect:** bid `accepted` at the counter amount; Den
   Offers now shows the buyer contact card (mutual reveal), and an
   **"Open deal room"** link appears.
7. Expiry cron sanity:
   ```bash
   curl -H "x-cron-secret: $AUTOMATION_CRON_SECRET" http://localhost:3000/api/cron/den-bids-expiry
   # expect {"expired":0,"expiredDealModeOff":0} when nothing is stale
   ```

---

## 8. Scenario G — deal room & Token Safe

1. Den → Offers → accepted bid → **Open deal room**. **Expect:** agreed
   amount, bidder agency, buyer contact, meeting date picker (set one —
   persists on reload), and the **Token Safe** panel (Optional badge).
2. Owner proposes Token Safe: amount (e.g. ₹2,00,000), refund conditions,
   "Via escrow" → **Expect:** "Waiting for the other party to accept…".
3. Agency B: the radar card's accepted state shows the same panel →
   **Accept terms** → **Expect:** owner side flips to "waiting for the buyer
   to pay the token"; buyer side shows the reference input.
4. Buyer: **Mark paid** with a reference (e.g. `UTR123456`). **Expect:**
   status `funded`, both confirmation dots grey.
5. Both sides click **Confirm agreement signed** (owner in the Den, buyer on
   the card). **Expect:** after the second confirmation → "✅ Token released
   — the property is blocked for this buyer", and:
   ```sql
   SELECT status FROM deal_rooms ORDER BY created_at DESC LIMIT 1;  -- 'token_secured'
   SELECT status, provider_ref FROM token_escrows ORDER BY created_at DESC LIMIT 1;  -- 'released', 'UTR123456'
   ```

---

## 9. Scenario H — isolation spot-checks

1. `SQL` — a Den user can see nothing of the CRM (RLS denies by
   construction; sanity-check the premise):
   ```sql
   SELECT count(*) FROM profiles p JOIN den_users d ON d.auth_user_id = p.user_id;
   -- expect 0 — no den user has a staff profile, so is_account_member() always fails for them
   ```
2. UI: as the Den owner, try opening `/dashboard` — **Expect:** bounced to
   profile-setup/login flows, never into a CRM workspace with data.
3. As Agency A staff, open `/radar` — **Expect:** your own Deal Mode property
   NEVER appears as a Direct Owner card (own-account excluded from the sweep).
4. If you have a second owner contact in Agency A: log into the Den as
   owner #2 — **Expect:** they see only their own properties, not owner #1's.

---

## 10. Cleanup

```sql
-- Order matters (FKs). Replace the account ids.
DELETE FROM token_escrows WHERE deal_room_id IN
  (SELECT id FROM deal_rooms WHERE owner_account_id = '<AGENCY_A_ID>');
DELETE FROM deal_rooms WHERE owner_account_id = '<AGENCY_A_ID>';
DELETE FROM property_bids WHERE owner_account_id = '<AGENCY_A_ID>';
DELETE FROM den_match_unlocks WHERE account_id = '<AGENCY_B_ID>';
DELETE FROM match_events WHERE source = 'deal_mode' AND account_id = '<AGENCY_B_ID>';
DELETE FROM den_contact_links WHERE account_id = '<AGENCY_A_ID>';
-- Den identities (removes the owner login; auth.users row remains):
DELETE FROM den_users WHERE phone_normalized = right('<PHONE_OWNER digits>', 10);
UPDATE properties SET deal_mode = 'off', min_bid = NULL WHERE account_id = '<AGENCY_A_ID>';
```

## Known-by-design behaviors (don't file as bugs)

- WhatsApp pushes (match alerts, bid pings) silently skip when the contact
  has no open 24h session AND the account lacks the approved template
  (`den_match_alert`, `den_bid_received`, `den_bid_update`) — the in-app
  surfaces still show everything.
- A Google-FIRST Den signup leaves a dormant empty staff account (Supabase
  OAuth can't carry the trigger-guard metadata). Harmless cruft.
- Deal Mode on an **unpublished** property stores the flag but only goes
  live once the agency publishes (the sweep filters `is_published = true`).
- Unlocks are per buyer **account**, not per user — teammates share them.
