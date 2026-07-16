// ============================================================
// Owners Den — Deal Mode matching sweep (server-only).
//
// Matches every published property with deal_mode on against every
// OTHER tenant's active Buyer/Agent contacts, using the same
// deterministic engine as Match Radar (src/lib/matching.ts). Results
// are written as match_events rows in the BUYER's account with
// source='deal_mode' and a MASKED property snapshot — see
// src/lib/den/masking.ts for exactly what crosses the tenant line.
//
// Called from:
//   - /api/cron/deal-mode-matching (scheduled, full pool)
//   - PUT /api/den/properties/[id]/deal-mode (fire-and-forget, single
//     property when an owner flips to aggressive)
//
// Aggressive mode additionally notifies matched buyers on WhatsApp,
// through THEIR agency's sender: free-form when the 24h session is
// open, else the den_match_alert template if the account has it
// approved, else silently skips (the radar card still shows). Only
// NEWLY CREATED events notify — refreshing an existing event on a
// re-sweep never re-pings anyone.
//
// Best-effort semantics throughout, mirroring the radar engine: a
// sweep failure must never break a cron tick or a deal-mode toggle.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Contact, MatchEventTarget, MessageTemplate, Property } from "@/types";
import { getMatchingContacts, type MatchDetails } from "@/lib/matching";
import { sendWhatsAppMessageAndPersist } from "@/lib/whatsapp/meta-api-dispatcher";
import { buildMaskedPropertySnapshot, type MaskedPropertySnapshot } from "./masking";

const MIN_SCORE = 60;
const MAX_TARGETS = 12;
const MAX_POOL = 500;
const MAX_CONTACTS = 20_000;
/** Re-sweep refresh window: within it we update the live event's
 *  snapshot instead of stacking twins; sent/dismissed events stay
 *  quiet until the window lapses. */
const DEDUPE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Meta rate-limit safety cap on aggressive pings per sweep run. */
const MAX_NOTIFICATIONS_PER_RUN = 100;
const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

export const DEN_MATCH_ALERT_TEMPLATE_NAME = "den_match_alert";

function chipsFromDetails(d: MatchDetails): string[] {
  const chips: string[] = [];
  if (d.type === "match") chips.push("Type match");
  else if (d.type === "partial") chips.push("Category match");
  if (d.location === "match") chips.push("In area");
  else if (d.location === "partial") chips.push("Same city");
  if (d.budget === "match") chips.push("Budget fit");
  else if (d.budget === "partial") chips.push("Budget near");
  if (d.bhk === "match") chips.push("BHK fit");
  if (d.roi === "match") chips.push("Yield ✓");
  return chips;
}

export interface SweepSummary {
  poolSize: number;
  eventsCreated: number;
  eventsRefreshed: number;
  notified: number;
}

export async function runDealModeSweep(
  db: SupabaseClient,
  opts: { propertyId?: string } = {},
): Promise<SweepSummary> {
  const summary: SweepSummary = { poolSize: 0, eventsCreated: 0, eventsRefreshed: 0, notified: 0 };

  let poolQuery = db
    .from("properties")
    .select("*")
    .neq("deal_mode", "off")
    .eq("is_published", true)
    .limit(MAX_POOL);
  if (opts.propertyId) poolQuery = poolQuery.eq("id", opts.propertyId);
  const { data: pool, error: poolErr } = await poolQuery;
  if (poolErr) {
    console.error("[deal-mode-sweep] pool query failed:", poolErr.message);
    return summary;
  }
  if (!pool || pool.length === 0) return summary;
  summary.poolSize = pool.length;

  // All active buyer/agent contacts platform-wide, grouped by tenant.
  // Service-role read — every downstream write re-scopes by account.
  const { data: contacts, error: contactsErr } = await db
    .from("contacts")
    .select("*")
    .eq("status", "active")
    .in("classification", ["Buyer", "Agent"])
    .limit(MAX_CONTACTS);
  if (contactsErr) {
    console.error("[deal-mode-sweep] contacts query failed:", contactsErr.message);
    return summary;
  }
  // account_id is a real column on contacts but not part of the TS
  // Contact interface (staff code is always already account-scoped).
  const contactsByAccount = new Map<string, Contact[]>();
  for (const contact of (contacts || []) as Array<Contact & { account_id: string }>) {
    const list = contactsByAccount.get(contact.account_id) || [];
    list.push(contact);
    contactsByAccount.set(contact.account_id, list);
  }
  if (contactsByAccount.size === 0) return summary;

  let notifyBudget = MAX_NOTIFICATIONS_PER_RUN;
  const templateCache = new Map<string, MessageTemplate | null>();

  for (const property of pool as Property[]) {
    const snapshot = buildMaskedPropertySnapshot(property);

    for (const [buyerAccountId, buyerContacts] of contactsByAccount) {
      // Never match a property into its own tenant — the agency
      // already has full access, and an owner-agent must not be able
      // to pay to unlock their own listing.
      if (buyerAccountId === property.account_id) continue;

      let results;
      try {
        results = getMatchingContacts(property, buyerContacts)
          .filter((r) => r.score >= MIN_SCORE)
          .slice(0, MAX_TARGETS);
      } catch (err) {
        console.error("[deal-mode-sweep] matching failed:", err);
        continue;
      }
      if (results.length === 0) continue;

      const targets: MatchEventTarget[] = results.map((r) => ({
        id: r.contact.id,
        name: r.contact.name || r.contact.phone,
        detail: r.contact.phone,
        score: r.score,
        chips: chipsFromDetails(r.details),
      }));

      const outcome = await upsertDealModeEvent(db, buyerAccountId, property.id, targets, snapshot);
      if (outcome === "created") summary.eventsCreated++;
      else if (outcome === "refreshed") summary.eventsRefreshed++;

      // Aggressive + brand-new event → ping the matched buyers now.
      if (outcome === "created" && property.deal_mode === "aggressive" && notifyBudget > 0) {
        for (const result of results) {
          if (notifyBudget <= 0) break;
          const sent = await notifyBuyer(db, buyerAccountId, result.contact, result.score, snapshot, templateCache);
          if (sent) {
            summary.notified++;
            notifyBudget--;
          }
        }
      }
    }
  }

  return summary;
}

type UpsertOutcome = "created" | "refreshed" | "skipped";

async function upsertDealModeEvent(
  db: SupabaseClient,
  accountId: string,
  propertyId: string,
  targets: MatchEventTarget[],
  snapshot: MaskedPropertySnapshot,
): Promise<UpsertOutcome> {
  const since = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();
  const { data: existing } = await db
    .from("match_events")
    .select("id, status")
    .eq("account_id", accountId)
    .eq("property_id", propertyId)
    .eq("source", "deal_mode")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1);
  const dup = existing?.[0];

  if (dup && dup.status === "new") {
    await db
      .from("match_events")
      .update({ matches: targets, subject_snapshot: snapshot, updated_at: new Date().toISOString() })
      .eq("id", dup.id);
    return "refreshed";
  }
  if (dup) return "skipped"; // sent/dismissed inside the window — stay quiet

  const { error } = await db.from("match_events").insert({
    account_id: accountId,
    kind: "new_property",
    source: "deal_mode",
    property_id: propertyId,
    matches: targets,
    subject_snapshot: snapshot,
    status: "new",
  });
  if (error) {
    console.error("[deal-mode-sweep] event insert failed:", error.message);
    return "skipped";
  }
  return "created";
}

function buildAlertText(score: number, snapshot: MaskedPropertySnapshot): string {
  const what = snapshot.bedrooms ? `${snapshot.bedrooms} BHK ${snapshot.type}` : snapshot.type;
  const where = snapshot.locality || snapshot.city || "your preferred area";
  const band = snapshot.rent_band
    ? `${snapshot.rent_band} per month`
    : snapshot.price_band || "price on request";
  return (
    `🏠 *Direct owner property alert!*\n\n` +
    `A ${what} in ${where} (${band}) matching *${score}%* of your requirement just became available — directly from the owner, no middlemen.\n\n` +
    `Reply to this message to know more.`
  );
}

async function isSessionOpen(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<boolean> {
  const { data: conv } = await db
    .from("conversations")
    .select("id")
    .eq("account_id", accountId)
    .eq("contact_id", contactId)
    .maybeSingle();
  if (!conv) return false;
  const since = new Date(Date.now() - SESSION_WINDOW_MS).toISOString();
  const { count } = await db
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conv.id)
    .eq("sender_type", "customer")
    .gte("created_at", since);
  return (count ?? 0) > 0;
}

async function approvedTemplate(
  db: SupabaseClient,
  accountId: string,
  cache: Map<string, MessageTemplate | null>,
): Promise<MessageTemplate | null> {
  if (cache.has(accountId)) return cache.get(accountId) ?? null;
  const { data: row } = await db
    .from("message_templates")
    .select("*")
    .eq("account_id", accountId)
    .eq("name", DEN_MATCH_ALERT_TEMPLATE_NAME)
    .order("last_submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const template = row as MessageTemplate | null;
  const approved = template?.status === "APPROVED" ? template : null;
  cache.set(accountId, approved);
  return approved;
}

async function notifyBuyer(
  db: SupabaseClient,
  accountId: string,
  contact: Contact,
  score: number,
  snapshot: MaskedPropertySnapshot,
  templateCache: Map<string, MessageTemplate | null>,
): Promise<boolean> {
  try {
    if (!contact.phone) return false;

    const open = await isSessionOpen(db, accountId, contact.id);
    if (open) {
      const res = await sendWhatsAppMessageAndPersist({
        accountId,
        contactId: contact.id,
        kind: "text",
        senderType: "bot",
        text: buildAlertText(score, snapshot),
      });
      return res.success;
    }

    const template = await approvedTemplate(db, accountId, templateCache);
    if (!template) return false; // radar card still shows — no spam without a template

    const what = snapshot.bedrooms ? `${snapshot.bedrooms} BHK ${snapshot.type}` : snapshot.type;
    const params = [
      contact.name?.trim().split(/\s+/)[0] || "there",
      what,
      snapshot.locality || snapshot.city || "your preferred area",
      `${score}%`,
    ];
    const res = await sendWhatsAppMessageAndPersist({
      accountId,
      contactId: contact.id,
      kind: "template",
      senderType: "bot",
      templateName: template.name,
      templateLanguage: template.language || "en_US",
      templateParams: params,
      messageParams: { body: params },
      templateRow: template,
      text: buildAlertText(score, snapshot),
    });
    return res.success;
  } catch (err) {
    console.error("[deal-mode-sweep] notify failed (non-fatal):", err);
    return false;
  }
}
