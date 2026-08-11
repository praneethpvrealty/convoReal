'use client';

/**
 * Contact notes, opened from a buyer journey.
 *
 * The requirement behind a journey lives in the contact's notes —
 * budget, locality, what the client said on the last call. Working a
 * journey means reading them, so they open here instead of forcing a
 * detour to the contact page. Same `contact_notes` rows the inbox
 * sidebar and contact detail view read; add, edit and delete all
 * write straight back.
 */

import { useCallback, useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ContactNote } from '@/types';

export interface ContactNotesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  contactName: string;
  canEdit: boolean;
  /** Keeps the toolbar's note count in step with the dialog. */
  onCountChange?: (count: number) => void;
}

export function ContactNotesDialog({
  open,
  onOpenChange,
  contactId,
  contactName,
  canEdit,
  onCountChange,
}: ContactNotesDialogProps) {
  const supabase = createClient();
  const { user, accountId } = useAuth();

  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [newNote, setNewNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  const loadNotes = useCallback(async () => {
    const { data, error } = await supabase
      .from('contact_notes')
      .select('*')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false });
    if (error) {
      toast.error(`Failed to load notes: ${error.message}`);
      setLoading(false);
      return;
    }
    const rows = (data ?? []) as ContactNote[];
    setNotes(rows);
    onCountChange?.(rows.length);
    setLoading(false);
  }, [contactId, onCountChange, supabase]);

  useEffect(() => {
    if (!open) return;
    Promise.resolve().then(() => loadNotes());
  }, [open, loadNotes]);

  const handleAdd = async () => {
    const text = newNote.trim();
    if (!text || !user || !accountId) return;
    setSaving(true);
    const { data, error } = await supabase
      .from('contact_notes')
      .insert({
        contact_id: contactId,
        user_id: user.id,
        account_id: accountId,
        note_text: text,
        is_completed: false,
      })
      .select()
      .single();
    setSaving(false);
    if (error || !data) {
      toast.error(`Failed to add note: ${error?.message ?? 'unknown error'}`);
      return;
    }
    setNotes((prev) => {
      const next = [data as ContactNote, ...prev];
      onCountChange?.(next.length);
      return next;
    });
    setNewNote('');
  };

  const handleSaveEdit = async (noteId: string) => {
    const text = editingText.trim();
    if (!text) return;
    const { data, error } = await supabase
      .from('contact_notes')
      .update({ note_text: text })
      .eq('id', noteId)
      .select('id');
    if (error || !data?.length) {
      toast.error('Failed to save note');
      await loadNotes();
      return;
    }
    setNotes((prev) =>
      prev.map((n) => (n.id === noteId ? { ...n, note_text: text } : n))
    );
    setEditingId(null);
    setEditingText('');
  };

  const handleDelete = async (note: ContactNote) => {
    const { data, error } = await supabase
      .from('contact_notes')
      .delete()
      .eq('id', note.id)
      .select('id');
    if (error || !data?.length) {
      toast.error('Failed to delete note');
      return;
    }
    setNotes((prev) => {
      const next = prev.filter((n) => n.id !== note.id);
      onCountChange?.(next.length);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-slate-800 bg-slate-950">
        <DialogHeader>
          <DialogTitle className="text-slate-100">
            Notes — {contactName}
          </DialogTitle>
        </DialogHeader>

        <p className="-mt-1 text-xs text-slate-400">
          Requirements, call outcomes and anything worth remembering. Shared
          with the contact record.
        </p>

        {canEdit && (
          <div className="space-y-1.5">
            <Textarea
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Add a note…"
              rows={2}
              className="resize-none border-slate-800 bg-slate-900/60 text-sm"
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                className="h-7 px-2.5 text-xs"
                disabled={saving || !newNote.trim()}
                onClick={handleAdd}
              >
                {saving ? 'Adding…' : 'Add note'}
              </Button>
            </div>
          </div>
        )}

        <div className="max-h-[340px] space-y-1.5 overflow-y-auto pr-1">
          {loading ? (
            <p className="py-8 text-center text-xs text-slate-500">Loading…</p>
          ) : notes.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-500">
              No notes yet for this contact.
            </p>
          ) : (
            notes.map((note) => (
              <div
                key={note.id}
                className="rounded-lg border border-slate-800/80 bg-slate-900/50 px-2.5 py-2"
              >
                {editingId === note.id ? (
                  <div className="space-y-1.5">
                    <Textarea
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      rows={3}
                      className="resize-none border-slate-800 bg-slate-950 text-sm"
                    />
                    <div className="flex justify-end gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2.5 text-xs"
                        onClick={() => {
                          setEditingId(null);
                          setEditingText('');
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 px-2.5 text-xs"
                        disabled={!editingText.trim()}
                        onClick={() => handleSaveEdit(note.id)}
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs break-words whitespace-pre-wrap text-slate-200">
                        {note.note_text}
                      </p>
                      <p className="mt-1 text-[10px] text-slate-600">
                        {formatDistanceToNow(new Date(note.created_at), {
                          addSuffix: true,
                        })}
                      </p>
                    </div>
                    {canEdit && (
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(note.id);
                            setEditingText(note.note_text);
                          }}
                          aria-label="Edit note"
                          title="Edit note"
                          className="flex h-7 w-7 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-slate-800 hover:text-white"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(note)}
                          aria-label="Delete note"
                          title="Delete note"
                          className="flex h-7 w-7 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-red-500/10 hover:text-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
