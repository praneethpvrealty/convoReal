"use client";

/**
 * Journey — page container and router.
 *
 * Two faces:
 *   - OVERVIEW (/journey, default): every journey in one place — a
 *     dropdown at the top flips between buyer journeys (one section
 *     per contact) and property journeys (one per property); each
 *     section expands inline and can be hidden/shown from the list.
 *   - FOCUSED (?contact= / ?property=): one journey, full height —
 *     the deep-link target from the contact panel, inbox thread, and
 *     inventory rows.
 *
 * The page owns what's shared: the account's stage list (seeded on
 * first visit), the stage editor, currency, and routing. Everything
 * per-journey lives in JourneySection.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  ChevronDown,
  SlidersHorizontal,
  UserRound,
  Waypoints,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { Button } from "@/components/ui/button";
import { ConvoRealLoader } from "@/components/ui/convoreal-loader";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FavoriteButton } from "@/components/layout/favorite-button";
import type { JourneyStage } from "@/types";
import { ensureJourneyStages } from "@/lib/journey/capture";
import { JourneySection } from "@/components/journey/journey-section";
import { JourneyOverview } from "@/components/journey/journey-overview";
import { StageEditorDialog } from "@/components/journey/stage-editor-dialog";
import { type JourneyMode } from "@/components/journey/shared";

export default function JourneyPage() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { accountId } = useAuth();
  const canEdit = useCan("send-messages");

  // Focused subject (deep link) — absent on the overview.
  const contactParam = searchParams.get("contact");
  const propertyParam = searchParams.get("property");
  const subjectId = propertyParam ?? contactParam;
  const focusedMode: JourneyMode = propertyParam ? "property" : "buyer";

  // Overview tab — ?view=properties flips to property journeys.
  const overviewMode: JourneyMode =
    searchParams.get("view") === "properties" ? "property" : "buyer";

  const [stages, setStages] = useState<JourneyStage[]>([]);
  const [stagesLoading, setStagesLoading] = useState(true);
  const [currency, setCurrency] = useState("INR");
  const [stageEditorOpen, setStageEditorOpen] = useState(false);

  const seedAttempted = useRef(false);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("showcase_settings")
        .select("currency")
        .eq("account_id", accountId)
        .maybeSingle();
      if (!cancelled && data?.currency) setCurrency(data.currency);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, supabase]);

  const loadStages = useCallback(async () => {
    const { data, error } = await supabase
      .from("journey_stages")
      .select("*")
      .order("position");
    if (error) {
      console.error("Failed to load journey stages:", error.message);
      return [];
    }
    return (data ?? []) as JourneyStage[];
  }, [supabase]);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      setStagesLoading(true);
      let list: JourneyStage[];
      if (!seedAttempted.current) {
        seedAttempted.current = true;
        list = await ensureJourneyStages(accountId);
      } else {
        list = await loadStages();
      }
      if (!cancelled) {
        setStages(list);
        setStagesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, loadStages]);

  const refreshStages = useCallback(async () => {
    setStages(await loadStages());
  }, [loadStages]);

  if (stagesLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <ConvoRealLoader />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2.5 text-3xl font-extrabold tracking-tight">
            <Waypoints className="h-7 w-7 text-primary" />
            <span className="bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
              Journey
            </span>
            <FavoriteButton label="Journey" href="/journey" icon="Waypoints" />
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {subjectId
              ? "One relationship's full funnel — where it stands, and where the rest fell off."
              : overviewMode === "buyer"
                ? "Every buyer's funnel in one place — expand a journey to work it inline."
                : "Every property's funnel in one place — who's still in the race for each listing."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {subjectId ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                router.push(
                  focusedMode === "property"
                    ? "/journey?view=properties"
                    : "/journey",
                  { scroll: false },
                )
              }
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              All journeys
            </Button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-100 transition-colors hover:bg-slate-800">
                {overviewMode === "buyer" ? (
                  <UserRound className="h-3.5 w-3.5 text-primary" />
                ) : (
                  <Building2 className="h-3.5 w-3.5 text-primary" />
                )}
                {overviewMode === "buyer" ? "Buyer journeys" : "Property journeys"}
                <ChevronDown className="h-3 w-3 text-slate-400" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="border-slate-700 bg-slate-900">
                <DropdownMenuItem
                  onClick={() => router.push("/journey", { scroll: false })}
                >
                  <UserRound className="h-3.5 w-3.5" />
                  Buyer journeys
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    router.push("/journey?view=properties", { scroll: false })
                  }
                >
                  <Building2 className="h-3.5 w-3.5" />
                  Property journeys
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {canEdit && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setStageEditorOpen(true)}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Customize stages
            </Button>
          )}
        </div>
      </div>

      {subjectId ? (
        <JourneySection
          key={`${focusedMode}:${subjectId}`}
          mode={focusedMode}
          subjectId={subjectId}
          stages={stages}
          currency={currency}
          canEdit={canEdit}
          variant="full"
        />
      ) : (
        <JourneyOverview
          key={overviewMode}
          mode={overviewMode}
          stages={stages}
          currency={currency}
          canEdit={canEdit}
        />
      )}

      <StageEditorDialog
        open={stageEditorOpen}
        onOpenChange={setStageEditorOpen}
        accountId={accountId}
        stages={stages}
        onChanged={refreshStages}
      />
    </div>
  );
}
