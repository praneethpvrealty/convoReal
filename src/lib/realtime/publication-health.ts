import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * The tables that must be members of the `supabase_realtime`
 * publication for the app's live updates to work. Postgres replicates
 * nothing for a table outside it, so a client subscribes successfully,
 * reports connected, and then receives no events at all.
 *
 * Keep this in step with what the clients actually subscribe to:
 *
 *   grep -rn "postgres_changes" src/ mobile/ --include=*.ts --include=*.tsx -A3
 *
 * The test alongside this file asserts the list still matches migration
 * 207's, so adding a table to one and forgetting the other fails CI
 * rather than leaving a silent monitoring blind spot.
 */
export const REALTIME_TABLES = [
  "conversations",
  "credit_wallets",
  "flow_runs",
  "message_reactions",
  "messages",
  "notifications",
] as const;

export interface RealtimePublicationHealth {
  ok: boolean;
  present: string[];
  missing: string[];
}

export async function checkRealtimePublication(): Promise<RealtimePublicationHealth> {
  const { data, error } = await supabaseAdmin().rpc("realtime_publication_tables");
  if (error) {
    throw new Error(`realtime_publication_tables failed: ${error.message}`);
  }
  const present = (data as string[] | null) ?? [];
  const missing = REALTIME_TABLES.filter((t) => !present.includes(t));
  return { ok: missing.length === 0, present, missing };
}
