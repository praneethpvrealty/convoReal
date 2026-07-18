"use client";

/**
 * Drop-in journey for other pages (agent directory tab, future
 * embeds): loads the account's stage list + currency itself, then
 * renders the standard embedded JourneySection with an "Open full
 * view" link to the /journey page.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Expand } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { ConvoRealLoader } from "@/components/ui/convoreal-loader";
import type { JourneyStage } from "@/types";
import { ensureJourneyStages } from "@/lib/journey/capture";
import { JourneySection } from "./journey-section";
import type { JourneyMode } from "./shared";

export function JourneyEmbed({
  mode,
  subjectId,
}: {
  mode: JourneyMode;
  subjectId: string;
}) {
  const supabase = createClient();
  const { accountId } = useAuth();
  const canEdit = useCan("send-messages");

  const [stages, setStages] = useState<JourneyStage[]>([]);
  const [currency, setCurrency] = useState("INR");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      const [stageList, cur] = await Promise.all([
        ensureJourneyStages(accountId),
        supabase
          .from("showcase_settings")
          .select("currency")
          .eq("account_id", accountId)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      setStages(stageList);
      if (cur.data?.currency) setCurrency(cur.data.currency);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, supabase]);

  if (!ready) {
    return (
      <div className="flex h-[240px] items-center justify-center rounded-xl border border-slate-800 bg-slate-950">
        <ConvoRealLoader size={20} label="Loading journey" />
      </div>
    );
  }

  const fullHref =
    mode === "buyer"
      ? `/journey?contact=${subjectId}`
      : `/journey?property=${subjectId}`;

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Link
          href={fullHref}
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-400 transition-colors hover:text-white"
        >
          <Expand className="h-3 w-3" />
          Open full view
        </Link>
      </div>
      <JourneySection
        key={`${mode}:${subjectId}`}
        mode={mode}
        subjectId={subjectId}
        stages={stages}
        currency={currency}
        canEdit={canEdit}
        variant="embedded"
      />
    </div>
  );
}
