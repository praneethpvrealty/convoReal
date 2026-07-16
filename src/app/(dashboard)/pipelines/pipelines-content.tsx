"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { Pipeline, PipelineStage, Deal, DealStatus } from "@/types";
import { PipelineBoard } from "@/components/pipelines/pipeline-board";
import { PipelineSettings } from "@/components/pipelines/pipeline-settings";
import { DealForm } from "@/components/pipelines/deal-form";
import { PipelineAnalytics } from "@/components/pipelines/pipeline-analytics";
import { Button } from "@/components/ui/button";
import { PipelineStageLoader } from "@/components/ui/pipeline-stage-loader";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GitBranch, Plus, ChevronDown, Settings } from "lucide-react";
import { toast } from "sonner";
import { useCan } from "@/hooks/use-can";
import { GatedButton } from "@/components/ui/gated-button";
import { InfoHint } from "@/components/ui/info-hint";

// Pipeline creation is admin-class (settings-tier write under
// the new RLS); deal creation is operational and only requires
// agent+. The two CTAs gate on different `useCan` capabilities,
// not on different copy.

// Seed stages for Real Estate Pipeline
const SPEC_DEFAULT_STAGES = [
  { name: "New Inquiry", color: "#3b82f6", position: 0 },            // blue
  { name: "Profiling/Qualified", color: "#eab308", position: 1 },       // yellow
  { name: "Site Visit Scheduled", color: "#f97316", position: 2 },     // orange
  { name: "Negotiation/Token", color: "#8b5cf6", position: 3 },        // purple
  { name: "Due Diligence/Contract", color: "#06b6d4", position: 4 },   // cyan
  { name: "Closed Won", color: "#22c55e", position: 5 },              // green
  { name: "Closed Lost", color: "#ef4444", position: 6 },             // red
];

export default function PipelinesPage() {
  const supabase = createClient();
  const { user, accountId } = useAuth();
  const canEditSettings = useCan("edit-settings");
  const canCreateDeals = useCan("send-messages");

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("");
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState("INR");

  const fetchCurrency = useCallback(async () => {
    if (!accountId) return;
    try {
      const { data } = await supabase
        .from('showcase_settings')
        .select('currency')
        .eq('account_id', accountId)
        .maybeSingle();
      if (data?.currency) {
        setCurrency(data.currency);
      }
    } catch (err) {
      console.error('Failed to load showcase settings currency:', err);
    }
  }, [accountId, supabase]);

  useEffect(() => {
    Promise.resolve().then(() => fetchCurrency());
  }, [fetchCurrency]);

  // Dialog / sheet state
  const [newPipelineOpen, setNewPipelineOpen] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState("");
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [dealFormOpen, setDealFormOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [defaultStageId, setDefaultStageId] = useState<string>("");

  const searchParams = useSearchParams();
  useEffect(() => {
    if (searchParams.get("new") === "true") {
      const timer = setTimeout(() => {
        setDealFormOpen(true);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [searchParams]);

  // Automatically open deal form if dealId is specified in query parameters
  const [hasAutoOpenedDeal, setHasAutoOpenedDeal] = useState(false);
  useEffect(() => {
    const did = searchParams?.get("dealId");
    if (did && !hasAutoOpenedDeal) {
      (async () => {
        const { data: deal } = await supabase
          .from("deals")
          .select("*, contact:contacts(*), assignee:profiles!deals_assigned_to_fkey(*), property:properties(*)")
          .eq("id", did)
          .maybeSingle();
        if (deal) {
          setSelectedPipelineId(deal.pipeline_id);
          setEditingDeal(deal as Deal);
          setDealFormOpen(true);
          setHasAutoOpenedDeal(true);
        }
      })();
    }
  }, [searchParams, hasAutoOpenedDeal, supabase]);

  // Brokerage prompt on drag/move state
  const [brokeragePromptDeal, setBrokeragePromptDeal] = useState<Deal | null>(null);
  const [pendingStageId, setPendingStageId] = useState<string>("");
  const [modalBrokerageType, setModalBrokerageType] = useState<"percentage" | "fixed">("percentage");
  const [modalBrokerageValue, setModalBrokerageValue] = useState("");

  // Guard against double-seeding (React StrictMode double-effect in dev).
  const seedAttempted = useRef(false);

  const loadPipelines = useCallback(async () => {
    const { data, error } = await supabase
      .from("pipelines")
      .select("*")
      .order("created_at");
    if (error) {
      console.error("Failed to load pipelines:", error.message);
      return [];
    }
    return data ?? [];
  }, [supabase]);

  const loadStages = useCallback(
    async (pipelineId: string) => {
      const { data } = await supabase
        .from("pipeline_stages")
        .select("*")
        .eq("pipeline_id", pipelineId)
        .order("position");
      
      const loaded = data ?? [];
      const hasLost = loaded.some((s) => s.name.toLowerCase().includes("lost"));
      if (!hasLost && loaded.length > 0) {
        const maxPosition = loaded.reduce((max, s) => Math.max(max, s.position), 0);
        const { data: newStage, error } = await supabase
          .from("pipeline_stages")
          .insert({
            pipeline_id: pipelineId,
            name: "Closed Lost",
            color: "#ef4444",
            position: maxPosition + 1,
          })
          .select()
          .single();
        if (!error && newStage) {
          loaded.push(newStage);
        }
      }
      return loaded;
    },
    [supabase],
  );

  const loadDeals = useCallback(
    async (pipelineId: string) => {
      const { data } = await supabase
        .from("deals")
        .select("*, contact:contacts(*), assignee:profiles!deals_assigned_to_fkey(*), property:properties(*)")
        .eq("pipeline_id", pipelineId)
        .order("created_at", { ascending: false });
      return (data ?? []) as Deal[];
    },
    [supabase],
  );

  const seedDefaultPipeline = useCallback(async (): Promise<Pipeline | null> => {
    if (!user || !accountId) return null;

    const { data: pipeline, error } = await supabase
      .from("pipelines")
      .insert({ user_id: user.id, account_id: accountId, name: "Real Estate Pipeline" })
      .select()
      .single();

    if (error || !pipeline) {
      console.error("Failed to seed pipeline:", error?.message);
      return null;
    }

    const stagesPayload = SPEC_DEFAULT_STAGES.map((s) => ({
      pipeline_id: pipeline.id,
      name: s.name,
      color: s.color,
      position: s.position,
    }));
    await supabase.from("pipeline_stages").insert(stagesPayload);

    return pipeline as Pipeline;
  }, [supabase, user, accountId]);

  // Initial load + seed-if-empty
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      let list = await loadPipelines();

      if (list.length === 0 && !seedAttempted.current) {
        seedAttempted.current = true;
        const seeded = await seedDefaultPipeline();
        if (seeded) list = await loadPipelines();
      }

      if (cancelled) return;
      setPipelines(list);
      if (list.length > 0) {
        setSelectedPipelineId((prev) =>
          prev && list.some((p) => p.id === prev) ? prev : list[0].id,
        );
      } else {
        setSelectedPipelineId("");
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPipelines, seedDefaultPipeline]);

  // Load stages + deals whenever selected pipeline changes.
  // Clearing on no-selection is a legitimate sync with URL/prop
  // state; the load completion uses async setters inside promise
  // callbacks (not synchronous in the effect body).
  useEffect(() => {
    if (!selectedPipelineId) {
      Promise.resolve().then(() => {
        setStages([]);
        setDeals([]);
      });
      return;
    }
    let cancelled = false;
    (async () => {
      const [s, d] = await Promise.all([
        loadStages(selectedPipelineId),
        loadDeals(selectedPipelineId),
      ]);
      if (cancelled) return;
      setStages(s);
      setDeals(d);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPipelineId, loadStages, loadDeals]);

  const refreshPipelines = useCallback(async () => {
    const list = await loadPipelines();
    setPipelines(list);
    if (list.length === 0) setSelectedPipelineId("");
    else if (!list.some((p) => p.id === selectedPipelineId))
      setSelectedPipelineId(list[0].id);
  }, [loadPipelines, selectedPipelineId]);

  const refreshStages = useCallback(async () => {
    if (!selectedPipelineId) return;
    setStages(await loadStages(selectedPipelineId));
  }, [loadStages, selectedPipelineId]);

  const refreshDeals = useCallback(async () => {
    if (!selectedPipelineId) return;
    setDeals(await loadDeals(selectedPipelineId));
  }, [loadDeals, selectedPipelineId]);

  const handleDealMoved = useCallback(
    async (dealId: string, newStageId: string) => {
      const deal = deals.find((d) => d.id === dealId);
      const targetStage = stages.find((s) => s.id === newStageId);
      const isNegotiationOrLater = targetStage && ["Negotiation/Token", "Due Diligence/Contract", "Closed Won"].includes(targetStage.name);

      if (isNegotiationOrLater && deal && deal.brokerage_amount === null) {
        // Pause and trigger modal
        setBrokeragePromptDeal(deal);
        setPendingStageId(newStageId);
        setModalBrokerageType("percentage");
        setModalBrokerageValue("");
        return;
      }

      let dealStatus: DealStatus = "open";
      if (targetStage) {
        if (targetStage.name.toLowerCase().includes("lost")) {
          dealStatus = "lost";
        } else if (targetStage.name.toLowerCase().includes("won")) {
          dealStatus = "won";
        }
      }

      // Optimistic update — board already animated; just persist.
      setDeals((prev) =>
        prev.map((d) => (d.id === dealId ? { ...d, stage_id: newStageId, status: dealStatus } : d)),
      );
      
      const { error } = await supabase
        .from("deals")
        .update({ stage_id: newStageId, status: dealStatus })
        .eq("id", dealId);

      if (error) {
        toast.error("Failed to move deal");
        refreshDeals();
        return;
      }

      // Automated Status Transition for Real Estate Properties
      try {
        if (deal && deal.property_id) {
          if (targetStage) {
            let nextStatus = "Available";
            if (targetStage.name === "Negotiation/Token") {
              nextStatus = "Under Contract";
            } else if (targetStage.name === "Closed Won" || targetStage.name.toLowerCase().includes("won")) {
              nextStatus = "Sold";
            } else if (targetStage.name.toLowerCase().includes("lost")) {
              nextStatus = "Available";
            }

            const { error: propErr } = await supabase
              .from("properties")
              .update({ status: nextStatus })
              .eq("id", deal.property_id);
            
            if (propErr) {
              console.error("Failed to sync property status:", propErr.message);
            }
          }
        }
      } catch (err) {
        console.error("Unexpected error in property status transition:", err);
      }
    },
    [supabase, refreshDeals, deals, stages],
  );

  async function handleModalBrokerageSave() {
    if (!brokeragePromptDeal || !pendingStageId) return;

    const dealId = brokeragePromptDeal.id;
    const dealValue = brokeragePromptDeal.value || 0;
    const brokVal = parseFloat(modalBrokerageValue) || 0;
    const brokerageAmt = modalBrokerageType === "percentage"
      ? (dealValue * brokVal) / 100
      : brokVal;

    const targetStage = stages.find((s) => s.id === pendingStageId);
    let dealStatus: DealStatus = "open";
    if (targetStage) {
      if (targetStage.name.toLowerCase().includes("lost")) {
        dealStatus = "lost";
      } else if (targetStage.name.toLowerCase().includes("won")) {
        dealStatus = "won";
      }
    }

    // Optimistically update
    setDeals((prev) =>
      prev.map((d) =>
        d.id === dealId
          ? {
              ...d,
              stage_id: pendingStageId,
              brokerage_type: modalBrokerageType,
              brokerage_value: brokVal,
              brokerage_amount: brokerageAmt,
              status: dealStatus,
            }
          : d
      )
    );

    const { error } = await supabase
      .from("deals")
      .update({
        stage_id: pendingStageId,
        brokerage_type: modalBrokerageType,
        brokerage_value: brokVal,
        brokerage_amount: brokerageAmt,
        status: dealStatus,
      })
      .eq("id", dealId);

    if (error) {
      toast.error("Failed to move deal");
      refreshDeals();
      setBrokeragePromptDeal(null);
      setPendingStageId("");
      return;
    }

    // Sync property status based on new stage
    try {
      if (brokeragePromptDeal.property_id) {
        if (targetStage) {
          let nextStatus = "Available";
          if (targetStage.name === "Negotiation/Token") {
            nextStatus = "Under Contract";
          } else if (targetStage.name === "Closed Won" || targetStage.name.toLowerCase().includes("won")) {
            nextStatus = "Sold";
          } else if (targetStage.name.toLowerCase().includes("lost")) {
            nextStatus = "Available";
          }

          const { error: propErr } = await supabase
            .from("properties")
            .update({ status: nextStatus })
            .eq("id", brokeragePromptDeal.property_id);
          
          if (propErr) {
            console.error("Failed to sync property status:", propErr.message);
          }
        }
      }
    } catch (err) {
      console.error("Unexpected error in property status transition:", err);
    }

    toast.success("Deal moved and brokerage updated");
    setBrokeragePromptDeal(null);
    setPendingStageId("");
    refreshDeals();
  }

  function handleModalBrokerageCancel() {
    setBrokeragePromptDeal(null);
    setPendingStageId("");
    refreshDeals(); // Forces board to snap back
  }

  function formatCalculatedModalBrokerage() {
    if (!brokeragePromptDeal) return "";
    const val = brokeragePromptDeal.value || 0;
    const brokVal = parseFloat(modalBrokerageValue) || 0;
    const amt = modalBrokerageType === "percentage" ? (val * brokVal) / 100 : brokVal;
    
    if (currency === "INR") {
      if (amt >= 10000000) {
        const cr = amt / 10000000;
        return `₹${cr.toFixed(2).replace(/\.00$/, '')} Crore`;
      }
      if (amt >= 100000) {
        const lakhs = amt / 100000;
        return `₹${lakhs.toFixed(2).replace(/\.00$/, '')} Lakhs`;
      }
      return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
      }).format(amt);
    }
    const symbols: Record<string, string> = {
      USD: '$',
      EUR: '€',
      GBP: '£',
      AED: 'د.إ',
    };
    const sym = symbols[currency] || '';
    return `${sym}${amt.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  }

  function formatModalDealValue(val: number) {
    if (currency === "INR") {
      if (val >= 10000000) {
        const cr = val / 10000000;
        return `₹${cr.toFixed(2).replace(/\.00$/, '')} Cr`;
      }
      if (val >= 100000) {
        const lakhs = val / 100000;
        return `₹${lakhs.toFixed(2).replace(/\.00$/, '')} Lakhs`;
      }
      return `₹${val.toLocaleString('en-IN')}`;
    }
    const symbols: Record<string, string> = {
      USD: '$',
      EUR: '€',
      GBP: '£',
      AED: 'د.إ',
    };
    const sym = symbols[currency] || '';
    return `${sym}${val.toLocaleString()}`;
  }

  const handleAddDeal = useCallback(
    (stageId?: string) => {
      setEditingDeal(null);
      setDefaultStageId(stageId ?? stages[0]?.id ?? "");
      setDealFormOpen(true);
    },
    [stages],
  );

  const handleEditDeal = useCallback((deal: Deal) => {
    setEditingDeal(deal);
    setDefaultStageId(deal.stage_id);
    setDealFormOpen(true);
  }, []);

  async function handleCreatePipeline() {
    const name = newPipelineName.trim();
    if (!name) return;
    setCreating(true);

    if (!user || !accountId) {
      setCreating(false);
      return;
    }

    const { data: pipeline, error } = await supabase
      .from("pipelines")
      .insert({ user_id: user.id, account_id: accountId, name })
      .select()
      .single();

    if (error || !pipeline) {
      toast.error("Failed to create pipeline");
      setCreating(false);
      return;
    }

    const stagesPayload = SPEC_DEFAULT_STAGES.map((s) => ({
      pipeline_id: pipeline.id,
      name: s.name,
      color: s.color,
      position: s.position,
    }));
    await supabase.from("pipeline_stages").insert(stagesPayload);

    setNewPipelineName("");
    setNewPipelineOpen(false);
    setSelectedPipelineId(pipeline.id);
    await refreshPipelines();
    setCreating(false);
    toast.success("Pipeline created");
  }

  const selectedPipeline = pipelines.find((p) => p.id === selectedPipelineId);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-400">
        <PipelineStageLoader size={104} label="Loading pipeline" className="mb-4" />
        <p className="text-sm">Loading pipeline...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {/* Pipeline selector dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white hover:bg-slate-800 transition-colors data-[popup-open]:bg-slate-800"
            >
              <GitBranch className="h-4 w-4 text-primary" />
              <span className="font-semibold">
                {selectedPipeline?.name ?? "Select Pipeline"}
              </span>
              <ChevronDown className="h-4 w-4 text-slate-400" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-64 border-slate-700 bg-slate-900 text-slate-200"
            >
              {pipelines.length === 0 && (
                <DropdownMenuItem disabled className="text-slate-500">
                  No pipelines yet
                </DropdownMenuItem>
              )}
              {pipelines.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  onClick={() => setSelectedPipelineId(p.id)}
                  className={
                    p.id === selectedPipelineId
                      ? "text-primary"
                      : "text-slate-300"
                  }
                >
                  <GitBranch className="mr-2 h-3.5 w-3.5" />
                  {p.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator className="bg-slate-700" />
              {selectedPipeline && (
                <DropdownMenuItem
                  onClick={() => setSettingsOpen(true)}
                  className="text-slate-300"
                >
                  <Settings className="mr-2 h-3.5 w-3.5" />
                  Manage Pipelines
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <InfoHint text="A kanban board representing your sales pipelines, showing deal cards moving through custom defined stages." />
        </div>

        <div className="flex items-center gap-2">
          <GatedButton
            variant="outline"
            canAct={canEditSettings}
            gateReason="create pipelines"
            onClick={() => setNewPipelineOpen(true)}
            className="border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
          >
            <Plus className="mr-1 h-4 w-4" />
            Add Pipeline
          </GatedButton>
          <GatedButton
            canAct={canCreateDeals}
            gateReason="create deals"
            disabled={!selectedPipelineId || stages.length === 0}
            onClick={() => handleAddDeal()}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-4 w-4" />
            Add Deal
          </GatedButton>
        </div>
      </div>

      {/* Board */}
      {pipelines.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-700 py-20">
          <GitBranch className="h-12 w-12 text-slate-600" />
          <h3 className="mt-4 text-lg font-medium text-white">
            No pipelines yet
          </h3>
          <p className="mt-2 text-sm text-slate-400">
            Create a pipeline to start tracking deals
          </p>
          <GatedButton
            canAct={canEditSettings}
            gateReason="create pipelines"
            onClick={() => setNewPipelineOpen(true)}
            className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-4 w-4" />
            Create Pipeline
          </GatedButton>
        </div>
      ) : (
        <>
          <PipelineAnalytics stages={stages} deals={deals} currency={currency} />
          <PipelineBoard
            stages={stages}
            deals={deals}
            onDealMoved={handleDealMoved}
            onAddDeal={handleAddDeal}
            onEditDeal={handleEditDeal}
            currency={currency}
          />
        </>
      )}

      {/* New Pipeline Dialog */}
      <Dialog open={newPipelineOpen} onOpenChange={setNewPipelineOpen}>
        <DialogContent className="sm:max-w-sm bg-slate-900 border-slate-700">
          <DialogHeader>
            <DialogTitle className="text-white">New Pipeline</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label className="text-slate-300">Pipeline Name</Label>
            <Input
              value={newPipelineName}
              onChange={(e) => setNewPipelineName(e.target.value)}
              placeholder="e.g., Enterprise Sales"
              className="mt-2 bg-slate-800 border-slate-700 text-white"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreatePipeline();
              }}
            />
            <p className="mt-2 text-xs text-slate-400">
              Default stages (New Lead → Won) will be created automatically.
            </p>
          </div>
          <DialogFooter className="bg-slate-900/50 border-slate-700">
            <Button
              variant="outline"
              onClick={() => setNewPipelineOpen(false)}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreatePipeline}
              disabled={creating || !newPipelineName.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {creating ? "Creating..." : "Create Pipeline"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pipeline Settings */}
      {selectedPipeline && (
        <PipelineSettings
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          pipeline={selectedPipeline}
          stages={stages}
          onPipelinesChanged={refreshPipelines}
          onStagesChanged={refreshStages}
          onCreateNewPipeline={() => {
            setSettingsOpen(false);
            setNewPipelineOpen(true);
          }}
        />
      )}

      {/* Brokerage Prompt Dialog */}
      <Dialog open={!!brokeragePromptDeal} onOpenChange={(open) => !open && handleModalBrokerageCancel()}>
        <DialogContent className="sm:max-w-md bg-slate-900 border-slate-700 text-slate-200">
          <DialogHeader>
            <DialogTitle className="text-white">Enter Brokerage Details</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-3">
            <p className="text-xs text-slate-400">
              This deal is entering <span className="font-semibold text-primary">Negotiation/Token</span> or a later transaction-closing stage. Please specify the brokerage rate or amount.
            </p>
            {brokeragePromptDeal && (
              <div className="text-xs bg-slate-950/40 border border-slate-800 rounded-lg p-3 space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-450">Deal:</span>
                  <span className="font-semibold text-slate-300">{brokeragePromptDeal.title}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-450">Value:</span>
                  <span className="font-bold text-primary">{formatModalDealValue(brokeragePromptDeal.value)}</span>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label className="text-slate-300">Brokerage Type</Label>
                <select
                  value={modalBrokerageType}
                  onChange={(e) => setModalBrokerageType(e.target.value as "percentage" | "fixed")}
                  className="h-9 w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-sm text-white outline-none focus:border-primary font-medium"
                >
                  <option value="percentage">Percentage (%)</option>
                  <option value="fixed">Fixed Value</option>
                </select>
              </div>
              <div className="grid gap-2">
                <Label className="text-slate-300">
                  {modalBrokerageType === "percentage" ? "Brokerage (%)" : "Brokerage Amount"}
                </Label>
                <Input
                  type="number"
                  value={modalBrokerageValue}
                  onChange={(e) => setModalBrokerageValue(e.target.value)}
                  placeholder={modalBrokerageType === "percentage" ? "2" : "0"}
                  className="border-slate-700 bg-slate-800 text-white"
                />
              </div>
            </div>
            {modalBrokerageValue && !isNaN(Number(modalBrokerageValue)) && Number(modalBrokerageValue) > 0 && (
              <p className="text-[11px] text-primary font-semibold mt-1">
                Calculated Brokerage: {formatCalculatedModalBrokerage()}
              </p>
            )}
          </div>
          <DialogFooter className="bg-slate-900/50 border-slate-700">
            <Button
              variant="outline"
              onClick={handleModalBrokerageCancel}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={handleModalBrokerageSave}
              disabled={!modalBrokerageValue || isNaN(Number(modalBrokerageValue)) || Number(modalBrokerageValue) <= 0}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Save & Move Deal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deal Form (Sheet) */}
      <DealForm
        open={dealFormOpen}
        onOpenChange={setDealFormOpen}
        deal={editingDeal}
        pipelineId={selectedPipelineId}
        stages={stages}
        defaultStageId={defaultStageId}
        onSaved={refreshDeals}
      />
    </div>
  );
}
