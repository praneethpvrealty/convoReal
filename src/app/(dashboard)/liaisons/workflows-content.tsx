'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type { LiaisonWorkflow } from '@/types';
import { totalDurationDays } from '@/lib/liaisons/workflows';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConvoRealLoader } from '@/components/ui/convoreal-loader';
import { WorkflowForm } from '@/components/liaisons/workflow-form';
import { ShareWorkflowDialog } from '@/components/liaisons/share-workflow-dialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Clock,
  Edit,
  Loader2,
  Plus,
  Search,
  Send,
  Trash2,
  Waypoints,
} from 'lucide-react';

export default function WorkflowsContent() {
  const supabase = createClient();

  const [workflows, setWorkflows] = useState<LiaisonWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<LiaisonWorkflow | null>(null);

  const [shareOpen, setShareOpen] = useState(false);
  const [shareTarget, setShareTarget] = useState<LiaisonWorkflow | null>(null);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LiaisonWorkflow | null>(
    null
  );
  const [deleting, setDeleting] = useState(false);

  const fetchWorkflows = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('liaison_workflows')
        .select('*')
        .order('service_name');

      if (error) throw error;
      setWorkflows(data || []);
    } catch (err) {
      console.error('Error fetching workflows:', err);
      toast.error('Failed to load workflows');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchWorkflows();
  }, [fetchWorkflows]);

  const filteredWorkflows = useMemo(() => {
    if (!searchQuery.trim()) return workflows;
    const q = searchQuery.toLowerCase();
    return workflows.filter(
      (w) =>
        w.service_name.toLowerCase().includes(q) ||
        (w.description && w.description.toLowerCase().includes(q)) ||
        (w.stages ?? []).some(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            (s.authority && s.authority.toLowerCase().includes(q))
        )
    );
  }, [workflows, searchQuery]);

  function openAdd() {
    setEditTarget(null);
    setFormOpen(true);
  }

  function openEdit(workflow: LiaisonWorkflow) {
    setEditTarget(workflow);
    setFormOpen(true);
  }

  function openShare(workflow: LiaisonWorkflow) {
    setShareTarget(workflow);
    setShareOpen(true);
  }

  function confirmDelete(workflow: LiaisonWorkflow) {
    setDeleteTarget(workflow);
    setDeleteConfirmOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);

    const { data: deleted, error } = await supabase
      .from('liaison_workflows')
      .delete()
      .eq('id', deleteTarget.id)
      .select('id');

    if (error || !deleted?.length) {
      toast.error('Failed to delete workflow');
    } else {
      toast.success('Workflow deleted');
      fetchWorkflows();
    }

    setDeleting(false);
    setDeleteConfirmOpen(false);
    setDeleteTarget(null);
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative max-w-md flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by process, stage, authority..."
            className="focus-visible:ring-primary border-slate-800 bg-slate-900/60 pl-9 text-sm text-white placeholder:text-slate-500 focus-visible:ring-1 focus-visible:ring-offset-0"
          />
        </div>
        <Button
          onClick={openAdd}
          className="bg-primary hover:bg-primary/90 text-primary-foreground h-9 cursor-pointer gap-1.5 px-4 text-xs font-bold sm:ml-auto"
        >
          <Plus className="size-3.5" />
          New Workflow
        </Button>
      </div>

      {/* Workflows */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <ConvoRealLoader size={24} label="Loading workflows" />
        </div>
      ) : filteredWorkflows.length === 0 ? (
        <div className="mx-auto mt-4 max-w-lg rounded-xl border border-dashed border-slate-800 bg-slate-900/20 py-16 text-center">
          <Waypoints className="mx-auto mb-4 size-12 text-slate-700 opacity-45" />
          <h4 className="mb-1 text-sm font-semibold text-white">
            {workflows.length === 0 ? 'No workflows yet' : 'No matches'}
          </h4>
          <p className="mx-auto mb-4 max-w-xs text-xs text-slate-400">
            {workflows.length === 0
              ? 'Map a process once — stages, approval authorities, timelines — then share it with any client on WhatsApp.'
              : 'Try a different search.'}
          </p>
          {workflows.length === 0 && (
            <Button
              onClick={openAdd}
              className="bg-primary hover:bg-primary/90 text-primary-foreground h-8 cursor-pointer gap-1.5 px-4 text-xs font-bold"
            >
              <Plus className="size-3.5" />
              Create your first workflow
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {filteredWorkflows.map((workflow) => {
            const total = totalDurationDays(workflow.stages ?? []);
            return (
              <div
                key={workflow.id}
                className="flex flex-col overflow-hidden rounded-xl border border-slate-800/80 bg-slate-900/40 transition-all duration-300 hover:border-slate-700/80"
              >
                {/* Header */}
                <div className="p-4 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-sm font-semibold text-white">
                      {workflow.service_name}
                    </h3>
                    {total !== null && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
                        <Clock className="size-3" />~{total} days
                      </span>
                    )}
                  </div>
                  {workflow.description && (
                    <p className="mt-1 text-[11px] text-slate-400">
                      {workflow.description}
                    </p>
                  )}
                </div>

                {/* Stage timeline */}
                <div className="flex-1 px-4">
                  <ol className="space-y-0 border-t border-slate-800/80 pt-3">
                    {(workflow.stages ?? []).map((stage, i) => {
                      const isLast = i === (workflow.stages ?? []).length - 1;
                      return (
                        <li key={i} className="relative flex gap-3 pb-3">
                          {/* Connector */}
                          {!isLast && (
                            <span
                              aria-hidden
                              className="absolute top-6 bottom-0 left-[11px] w-px bg-slate-800"
                            />
                          )}
                          <span className="bg-primary/10 border-primary/25 text-primary z-10 flex size-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold">
                            {i + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span className="text-xs font-semibold text-slate-200">
                                {stage.name}
                              </span>
                              {stage.authority && (
                                <span className="inline-flex items-center rounded-full border border-sky-500/20 bg-sky-500/10 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-sky-400 uppercase">
                                  {stage.authority}
                                </span>
                              )}
                              {stage.duration_days !== null && (
                                <span className="text-[10px] text-slate-500">
                                  ~{stage.duration_days}d
                                </span>
                              )}
                            </div>
                            {stage.description && (
                              <p className="mt-0.5 text-[10px] text-slate-500">
                                {stage.description}
                              </p>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-2 border-t border-slate-800/80 p-3">
                  <Button
                    size="sm"
                    onClick={() => openShare(workflow)}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground mr-auto h-7 cursor-pointer gap-1 px-3 text-[10px] font-bold"
                  >
                    <Send className="size-3" />
                    Share on WhatsApp
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => openEdit(workflow)}
                    className="h-7 cursor-pointer gap-1 px-2 text-[10px] text-slate-400 hover:bg-slate-800 hover:text-white"
                  >
                    <Edit className="size-3" />
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => confirmDelete(workflow)}
                    className="h-7 cursor-pointer gap-1 px-2 text-[10px] text-slate-400 hover:bg-slate-800 hover:text-red-400"
                  >
                    <Trash2 className="size-3" />
                    Delete
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / edit */}
      <WorkflowForm
        open={formOpen}
        onOpenChange={setFormOpen}
        workflow={editTarget}
        onSaved={fetchWorkflows}
      />

      {/* Share on WhatsApp */}
      <ShareWorkflowDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        workflow={shareTarget}
      />

      {/* Delete Confirmation */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="border-slate-700 bg-slate-900 text-slate-200 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white">Delete Workflow</DialogTitle>
            <DialogDescription className="text-slate-400">
              Are you sure you want to delete{' '}
              <span className="font-medium text-slate-200">
                {deleteTarget?.service_name}
              </span>
              ? Messages already sent to clients are not affected. This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="border-slate-700 bg-slate-900">
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmOpen(false)}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
