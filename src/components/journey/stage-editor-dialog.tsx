"use client";

/**
 * Stage editor — the "customisable" half of the journey spec.
 *
 * Account-level: rename, recolor, reorder (up/down), add, delete.
 * Deleting is blocked while any journey item sits on the stage (the
 * DB FK is RESTRICT for the same reason) — the user is told to move
 * those items first rather than us guessing where they should go.
 * Writes go straight to Supabase; the parent refreshes on close.
 */

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { JourneyStage } from "@/types";
import { STAGE_COLOR_CHOICES } from "./shared";

export interface StageEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string | null;
  stages: JourneyStage[];
  /** Called after any successful write so the page refetches. */
  onChanged: () => void;
}

export function StageEditorDialog({
  open,
  onOpenChange,
  accountId,
  stages,
  onChanged,
}: StageEditorDialogProps) {
  const supabase = createClient();
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<string | null>) => {
    if (busy) return;
    setBusy(true);
    try {
      const err = await fn();
      if (err) toast.error(err);
      else onChanged();
    } finally {
      setBusy(false);
    }
  };

  const rename = (stage: JourneyStage, name: string) =>
    run(async () => {
      const trimmed = name.trim();
      if (!trimmed || trimmed === stage.name) return null;
      const { error } = await supabase
        .from("journey_stages")
        .update({ name: trimmed })
        .eq("id", stage.id);
      return error ? `Rename failed: ${error.message}` : null;
    });

  const recolor = (stage: JourneyStage, color: string) =>
    run(async () => {
      const { error } = await supabase
        .from("journey_stages")
        .update({ color })
        .eq("id", stage.id);
      return error ? `Color change failed: ${error.message}` : null;
    });

  const move = (idx: number, dir: -1 | 1) =>
    run(async () => {
      const a = stages[idx];
      const b = stages[idx + dir];
      if (!a || !b) return null;
      // Swap positions — two updates; not atomic but self-healing on
      // refetch (order-by position is stable either way).
      const r1 = await supabase
        .from("journey_stages")
        .update({ position: b.position })
        .eq("id", a.id);
      const r2 = await supabase
        .from("journey_stages")
        .update({ position: a.position })
        .eq("id", b.id);
      const error = r1.error ?? r2.error;
      return error ? `Reorder failed: ${error.message}` : null;
    });

  const remove = (stage: JourneyStage) =>
    run(async () => {
      const { count, error: countError } = await supabase
        .from("journey_items")
        .select("id", { count: "exact", head: true })
        .eq("stage_id", stage.id);
      if (countError) return `Check failed: ${countError.message}`;
      if ((count ?? 0) > 0) {
        return `“${stage.name}” has ${count} item${count === 1 ? "" : "s"} on it — move them to another stage first.`;
      }
      const { error } = await supabase
        .from("journey_stages")
        .delete()
        .eq("id", stage.id);
      return error ? `Delete failed: ${error.message}` : null;
    });

  const add = () =>
    run(async () => {
      const trimmed = newName.trim();
      if (!trimmed || !accountId) return null;
      const nextPos =
        stages.reduce((max, s) => Math.max(max, s.position), -1) + 1;
      const color =
        STAGE_COLOR_CHOICES[stages.length % STAGE_COLOR_CHOICES.length];
      const { error } = await supabase.from("journey_stages").insert({
        account_id: accountId,
        name: trimmed,
        color,
        position: nextPos,
      });
      if (!error) setNewName("");
      return error ? `Add failed: ${error.message}` : null;
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-slate-800 bg-slate-950">
        <DialogHeader>
          <DialogTitle className="text-slate-100">Customize journey stages</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          {stages.map((s, idx) => (
            <div
              key={s.id}
              className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-2"
            >
              <div className="flex flex-col">
                <button
                  type="button"
                  disabled={idx === 0 || busy}
                  onClick={() => move(idx, -1)}
                  className="text-slate-500 transition-colors hover:text-slate-200 disabled:opacity-30"
                  aria-label={`Move ${s.name} up`}
                >
                  <ArrowUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  disabled={idx === stages.length - 1 || busy}
                  onClick={() => move(idx, 1)}
                  className="text-slate-500 transition-colors hover:text-slate-200 disabled:opacity-30"
                  aria-label={`Move ${s.name} down`}
                >
                  <ArrowDown className="h-3 w-3" />
                </button>
              </div>

              <Input
                defaultValue={s.name}
                // Commit on blur / Enter — per-keystroke writes would
                // spam the DB and refetch mid-typing.
                onBlur={(e) => rename(s, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                className="h-8 flex-1 border-slate-800 bg-slate-950 text-xs"
              />

              <div className="flex shrink-0 items-center gap-1">
                {STAGE_COLOR_CHOICES.slice(0, 7).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => recolor(s, c)}
                    aria-label={`Set ${s.name} color`}
                    className={cn(
                      "h-3.5 w-3.5 rounded-full transition-transform hover:scale-125",
                      s.color === c && "ring-2 ring-white/70 ring-offset-1 ring-offset-slate-950",
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={() => remove(s)}
                className="shrink-0 text-slate-600 transition-colors hover:text-red-400"
                aria-label={`Delete ${s.name}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
            placeholder="New stage name…"
            className="h-8 flex-1 border-slate-800 bg-slate-950 text-xs"
          />
          <Button size="sm" disabled={!newName.trim() || busy} onClick={add}>
            <Plus className="h-3.5 w-3.5" />
            Add stage
          </Button>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
