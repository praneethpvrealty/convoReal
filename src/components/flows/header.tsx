'use client';

/**
 * Editor header — flow name / description, status badge, dirty
 * indicator, and the action buttons (Save, Activate/Pause, Delete,
 * View runs, Back).
 *
 * Lifted out of flow-builder.tsx so the same header renders above
 * both views in FlowEditorShell. Without this, canvas users had no
 * way to save without toggling to list view.
 *
 * Reads everything from the editor context (`useFlowEditor`) so it
 * stays in sync with whichever view is mutating state, and routes
 * router navigation locally (back to /flows, View runs to
 * /flows/[id]/runs) — those don't belong in the hook.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  History,
  Loader2,
  PauseCircle,
  PlayCircle,
  Save,
  Trash2,
  Workflow,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useFlowEditor, type BuilderState } from './flow-editor-state';

export function EditorHeader() {
  const router = useRouter();
  const {
    flow,
    state,
    setState,
    dirty,
    saving,
    activating,
    canActivate,
    save,
    setStatus,
    deleteFlow,
    readOnly,
  } = useFlowEditor();
  const canEdit = !readOnly;
  const [leaveTo, setLeaveTo] = useState<string | null>(null);

  const navigate = (href: string) => {
    if (dirty) setLeaveTo(href);
    else router.push(href);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <button
          type="button"
          onClick={() => navigate('/flows')}
          className="inline-flex items-center gap-1 hover:text-slate-300"
        >
          <ArrowLeft className="h-3 w-3" />
          Flows
        </button>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Workflow className="text-primary h-5 w-5 shrink-0" />
          <Input
            value={state.name}
            onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))}
            readOnly={!canEdit}
            placeholder="Flow name"
            className="max-w-md bg-slate-900 text-lg font-semibold"
          />
          <StatusBadge status={state.status} />
          {!canEdit && (
            <Badge
              variant="outline"
              className="shrink-0 border-slate-700 text-slate-400"
              title="You can view this flow but not change it"
            >
              Read-only
            </Badge>
          )}
          {dirty && (
            <span
              className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium tracking-wide text-amber-300 uppercase"
              title="Unsaved changes — hit Save to persist"
              aria-live="polite"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              Edited
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/flows/${flow.id}/runs`)}
          >
            <History className="h-3.5 w-3.5" />
            Runs
          </Button>
          {canEdit && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void deleteFlow()}
                className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
              {state.status === 'active' ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void setStatus('draft')}
                  disabled={activating}
                >
                  {activating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <PauseCircle className="h-3.5 w-3.5" />
                  )}
                  Pause
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void setStatus('active')}
                  disabled={activating || !canActivate}
                  title={
                    !canActivate
                      ? 'Fix the issues below before activating'
                      : undefined
                  }
                >
                  {activating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <PlayCircle className="h-3.5 w-3.5" />
                  )}
                  Activate
                </Button>
              )}
              <Button onClick={() => void save()} disabled={saving} size="sm">
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                Save
              </Button>
            </>
          )}
        </div>
      </div>
      <Input
        value={state.description}
        onChange={(e) =>
          setState((s) => ({ ...s, description: e.target.value }))
        }
        readOnly={!canEdit}
        placeholder="Optional description (internal — customers don't see this)"
        className="bg-slate-900 text-sm"
      />
      <Dialog
        open={leaveTo !== null}
        onOpenChange={(open) => !open && setLeaveTo(null)}
      >
        <DialogContent className="bg-slate-900 text-slate-100">
          <DialogHeader>
            <DialogTitle>Leave without saving?</DialogTitle>
            <DialogDescription className="text-slate-300">
              You have unsaved changes to this flow. They will be lost if you
              leave now.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="border-slate-800 bg-slate-900">
            <Button variant="ghost" onClick={() => setLeaveTo(null)}>
              Stay
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const href = leaveTo;
                setLeaveTo(null);
                if (href) router.push(href);
              }}
            >
              Leave
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusBadge({ status }: { status: BuilderState['status'] }) {
  const cls = {
    draft: 'border-slate-700 bg-slate-800 text-slate-300',
    active: 'border-emerald-600/40 bg-emerald-500/10 text-emerald-300',
    archived: 'border-slate-700 bg-slate-800/50 text-slate-500',
  }[status];
  return (
    <Badge variant="outline" className={cn('shrink-0', cls)}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}
