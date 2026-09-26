/**
 * Journey auto-capture — turns "property shared to contact" moments
 * into journey_items rows without the agent lifting a finger.
 *
 * Client-side helper (uses the browser Supabase client) called from
 * the /journey page's "Import from chat" and "Import inquiries" buttons
 * (explicit user action → visible immediately). Shares capture through
 * the server ledger writer instead — see capture-server.ts and
 * src/lib/whatsapp/share-property-send.ts — so every share surface,
 * bot sends included, lands on the journey.
 *
 * Idempotent by construction: the upsert ignores pairs that already
 * exist (the UNIQUE(account_id, contact_id, property_id) constraint),
 * so re-sharing a property never duplicates, resurrects a dropped
 * branch, or un-hides anything the agent tucked away.
 */

import { createClient } from "@/lib/supabase/client";
import type { JourneyItemSource, JourneyStage } from "@/types";

/**
 * The account's journey stages: mirrors of its default pipeline's
 * stages. The sync creates the default board when the account has
 * none and keeps names, colours, order and kinds in step. A viewer
 * cannot run the sync, so the mirrored rows are read back either way.
 */
export async function ensureJourneyStages(
  accountId: string,
): Promise<JourneyStage[]> {
  const supabase = createClient();
  const { data: synced, error: syncError } = await supabase.rpc(
    "sync_journey_stages_from_pipeline",
    { p_account_id: accountId, p_pipeline_id: null },
  );
  if (!syncError && Array.isArray(synced) && synced.length > 0) {
    return synced as JourneyStage[];
  }
  const { data, error } = await supabase
    .from("journey_stages")
    .select("*")
    .eq("account_id", accountId)
    .not("pipeline_stage_id", "is", null)
    .order("position");
  if (error) {
    console.error("Failed to load journey stages:", error.message);
    return [];
  }
  return (data ?? []) as JourneyStage[];
}

export interface CaptureJourneyItemsInput {
  accountId: string;
  /** auth.users.id of the acting agent, for created_by / event audit. */
  userId?: string | null;
  pairs: Array<{ contactId: string; propertyId: string }>;
  source: JourneyItemSource;
  /** true → off-canvas, waits in the Captured tray. */
  hidden: boolean;
}

export interface CaptureResult {
  /** Rows actually created — 0 with a null error means every pair
   *  was already on the journey. */
  created: number;
  /** Database failure, verbatim — callers surface it so a broken
   *  capture never masquerades as "nothing new". */
  error: string | null;
}

/**
 * Upsert contact×property pairs at the first journey stage, logging an
 * 'added' event for each NEW row. Existing pairs are left completely
 * untouched.
 */
export async function captureJourneyItems({
  accountId,
  userId,
  pairs,
  source,
  hidden,
}: CaptureJourneyItemsInput): Promise<CaptureResult> {
  if (pairs.length === 0) return { created: 0, error: null };
  const supabase = createClient();

  const stages = await ensureJourneyStages(accountId);
  const firstStage = stages[0];
  if (!firstStage) {
    return { created: 0, error: "Journey stages could not be loaded" };
  }

  // Dedupe input pairs (a broadcast can list the same contact twice
  // via merged phones) — the DB constraint would reject the batch
  // otherwise, since ignoreDuplicates only skips conflicts with
  // EXISTING rows, not duplicates within the same insert.
  const seen = new Set<string>();
  const payload = pairs
    .filter((p) => {
      const key = `${p.contactId}:${p.propertyId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((p) => ({
      account_id: accountId,
      contact_id: p.contactId,
      property_id: p.propertyId,
      stage_id: firstStage.id,
      source,
      hidden,
      created_by: userId ?? null,
    }));

  const { data, error } = await supabase
    .from("journey_items")
    .upsert(payload, {
      onConflict: "account_id,contact_id,property_id",
      ignoreDuplicates: true,
    })
    .select("id");

  if (error) {
    console.error("Journey capture failed:", error.message);
    return { created: 0, error: error.message };
  }

  const created = data ?? [];
  if (created.length > 0) {
    const { error: evError } = await supabase.from("journey_events").insert(
      created.map((row) => ({
        account_id: accountId,
        item_id: row.id,
        event_type: "added",
        to_stage_id: firstStage.id,
        reason:
          source === "whatsapp_share"
            ? "Captured from WhatsApp share"
            : source === "chat_import"
              ? "Imported from chat history"
              : source === "inquiry_import"
                ? "Imported from property inquiries"
                : null,
        created_by: userId ?? null,
      })),
    );
    if (evError) {
      // Timeline entry is best-effort — the item row is already in;
      // don't fail the capture over its audit line.
      console.error("Journey capture event log failed:", evError.message);
    }
  }
  return { created: created.length, error: null };
}
