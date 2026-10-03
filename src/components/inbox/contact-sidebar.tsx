'use client';

import { useState, useEffect, useCallback, createElement } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import type { Contact, Deal, ContactNote, Tag } from '@/types';
import {
  Phone,
  Mail,
  Copy,
  Check,
  Tag as TagIcon,
  StickyNote,
  Plus,
  Pencil,
  Trash2,
  X,
  CheckSquare,
  Square,
} from 'lucide-react';
import { getCurrencyIcon } from '@/lib/currency-utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { storagePublicUrl } from '@/lib/storage/url';
import { contactHandle } from '@/lib/contacts/reachability';
import { formatCurrency } from '@/lib/format/currency';

interface ContactSidebarProps {
  contact: Contact | null;
}

export function ContactSidebar({ contact }: ContactSidebarProps) {
  const { user, accountId } = useAuth();
  const [copied, setCopied] = useState(false);
  const [currency, setCurrency] = useState('INR');
  const [deals, setDeals] = useState<Deal[]>([]);

  const fetchCurrency = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from('showcase_settings')
        .select('currency')
        .single();
      if (data?.currency) {
        setCurrency(data.currency);
      }
    } catch (err) {
      console.error('Failed to load showcase settings currency:', err);
    }
  }, []);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [newNote, setNewNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  // Track which note is being edited: null = none
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  const [loadedContactId, setLoadedContactId] = useState<string | null>(null);

  const loadContactData = useCallback(
    async (contactId: string, isCurrent: () => boolean) => {
      const supabase = createClient();

      const [dealsRes, notesRes, tagsRes] = await Promise.all([
        supabase
          .from('deals')
          .select('*, stage:pipeline_stages(*)')
          .eq('contact_id', contactId)
          .order('created_at', { ascending: false }),
        supabase
          .from('contact_notes')
          .select('*')
          .eq('contact_id', contactId)
          .order('created_at', { ascending: false }),
        supabase
          .from('contact_tags')
          .select('id, tag_id, tags(*)')
          .eq('contact_id', contactId),
      ]);

      if (!isCurrent()) return;

      setDeals(dealsRes.data ?? []);
      setNotes(notesRes.data ?? []);
      setTags(
        (tagsRes.data ?? [])
          .filter((ct: Record<string, unknown>) => ct.tags)
          .map((ct: Record<string, unknown>) => ({
            ...(ct.tags as Tag),
            contact_tag_id: ct.id as string,
          }))
      );
      setLoadedContactId(contactId);
    },
    []
  );

  // Load on contact change. A switch mid-flight is cancelled so a slow
  // response for the previous contact can never land under the new
  // contact's name; until the new contact's rows arrive the sections
  // below render placeholders instead of the previous contact's data.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchCurrency();
    if (!contact) return;
    let cancelled = false;
    void loadContactData(contact.id, () => !cancelled);
    return () => {
      cancelled = true;
    };
  }, [contact, fetchCurrency, loadContactData]);

  const ready = contact !== null && loadedContactId === contact.id;

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // Dep is the whole `contact` object (not `contact?.phone`) so the
    // React Compiler's inference agrees with the manual dep list —
    // fixes the `preserve-manual-memoization` lint error.
  }, [contact]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    setAddingNote(true);

    const supabase = createClient();

    if (!user || !accountId) {
      setAddingNote(false);
      return;
    }

    const { data, error } = await supabase
      .from('contact_notes')
      .insert({
        contact_id: contact.id,
        user_id: user.id,
        account_id: accountId,
        note_text: newNote.trim(),
        is_completed: false,
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote('');
    }
    setAddingNote(false);
  }, [contact, newNote, user, accountId]);

  const handleToggleComplete = useCallback(async (note: ContactNote) => {
    const newVal = !note.is_completed;
    // Optimistic update
    setNotes((prev) =>
      prev.map((n) => (n.id === note.id ? { ...n, is_completed: newVal } : n))
    );
    const supabase = createClient();
    const { data, error } = await supabase
      .from('contact_notes')
      .update({ is_completed: newVal })
      .eq('id', note.id)
      .select('id');
    if (error || !data?.length) {
      // Revert on failure
      setNotes((prev) =>
        prev.map((n) =>
          n.id === note.id ? { ...n, is_completed: !newVal } : n
        )
      );
      toast.error('Failed to update note');
    }
  }, []);

  const handleStartEdit = useCallback((note: ContactNote) => {
    setEditingNoteId(note.id);
    setEditingText(note.note_text);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingNoteId(null);
    setEditingText('');
  }, []);

  const handleSaveEdit = useCallback(
    async (noteId: string) => {
      const trimmed = editingText.trim();
      if (!trimmed) return;
      // Optimistic update
      setNotes((prev) =>
        prev.map((n) => (n.id === noteId ? { ...n, note_text: trimmed } : n))
      );
      setEditingNoteId(null);
      setEditingText('');

      const supabase = createClient();
      const { data, error } = await supabase
        .from('contact_notes')
        .update({ note_text: trimmed })
        .eq('id', noteId)
        .select('id');
      if (error || !data?.length) {
        toast.error('Failed to save note');
        // Refetch to restore true state
        if (contact) void loadContactData(contact.id, () => true);
      }
    },
    [editingText, contact, loadContactData]
  );

  const handleDeleteNote = useCallback(async (note: ContactNote) => {
    // Optimistic removal
    setNotes((prev) => prev.filter((n) => n.id !== note.id));
    toast('Note deleted', {
      action: {
        label: 'Undo',
        onClick: () => {
          // Restore the note in local state; the DB row is still there
          setNotes((prev) => {
            // Insert back in roughly the right position (newest first)
            const idx = prev.findIndex(
              (n) => new Date(n.created_at) < new Date(note.created_at)
            );
            const copy = [...prev];
            copy.splice(idx === -1 ? copy.length : idx, 0, note);
            return copy;
          });
        },
      },
      // After toast dismisses / times out actually delete from DB
      duration: 4000,
      onDismiss: async () => {
        const supabase = createClient();
        // The row is already gone from the list; if the delete does not
        // land, say so rather than leaving the note to reappear on the
        // next load with no explanation.
        const { data, error } = await supabase
          .from('contact_notes')
          .delete()
          .eq('id', note.id)
          .select('id');
        if (error || !data?.length) {
          toast.error('Could not delete that note — it will reappear.');
        }
      },
      onAutoClose: async () => {
        const supabase = createClient();
        // The row is already gone from the list; if the delete does not
        // land, say so rather than leaving the note to reappear on the
        // next load with no explanation.
        const { data, error } = await supabase
          .from('contact_notes')
          .delete()
          .eq('id', note.id)
          .select('id');
        if (error || !data?.length) {
          toast.error('Could not delete that note — it will reappear.');
        }
      },
    });
  }, []);

  if (!contact) {
    return (
      <div className="flex h-full w-70 items-center justify-center border-l border-slate-900/60 bg-slate-950/45 backdrop-blur-xl">
        <p className="text-sm text-slate-500">Select a conversation</p>
      </div>
    );
  }

  const displayName = contact.name || contactHandle(contact);
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex h-full w-70 flex-col border-l border-slate-900/60 bg-slate-950/45 backdrop-blur-xl">
      <ScrollArea className="flex-1">
        <div className="p-4 pb-28">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-700 text-lg font-semibold text-white">
              {contact.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={storagePublicUrl(contact.avatar_url)}
                  alt={displayName}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <h3 className="mt-3 text-sm font-semibold text-white">
              {displayName}
              {contact.name_tag && (
                <span
                  className="ml-1.5 inline-flex items-center rounded border border-slate-600/50 bg-slate-700/40 px-1.5 py-0.5 align-middle text-[10px] font-medium text-slate-300 select-none"
                  title="Name Tag — internal label, not sent in messages"
                >
                  {contact.name_tag}
                </span>
              )}
            </h3>
            {contact.company && (
              <p className="text-xs text-slate-400">{contact.company}</p>
            )}
          </div>

          {/* Phone */}
          <div className="mt-4 space-y-2">
            <button
              onClick={handleCopyPhone}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800"
            >
              <Phone className="h-4 w-4 text-slate-500" />
              <span className="flex-1 text-left">{contact.phone}</span>
              {copied ? (
                <Check className="text-primary h-3 w-3" />
              ) : (
                <Copy className="h-3 w-3 text-slate-600" />
              )}
            </button>

            {contact.email && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-300">
                <Mail className="h-4 w-4 text-slate-500" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-slate-800" />

          {/* Tags */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium tracking-wider text-slate-500 uppercase">
              <TagIcon className="h-3 w-3" />
              Tags
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {!ready ? (
                <SectionPlaceholder className="h-4 w-24 rounded-full" />
              ) : tags.length === 0 ? (
                <p className="px-1 text-xs text-slate-600">No tags</p>
              ) : (
                tags.map((tag) => (
                  <span
                    key={tag.contact_tag_id}
                    className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                    }}
                  >
                    {tag.name}
                  </span>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-slate-800" />

          {/* Active Deals */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium tracking-wider text-slate-500 uppercase">
              {createElement(getCurrencyIcon(currency), {
                className: 'h-3 w-3',
              })}
              Active Deals
            </div>
            <div className="mt-2 space-y-2">
              {!ready ? (
                <SectionPlaceholder className="h-12 w-full rounded-lg" />
              ) : deals.length === 0 ? (
                <p className="px-1 text-xs text-slate-600">No deals</p>
              ) : (
                deals.map((deal) => (
                  <div
                    key={deal.id}
                    className="rounded-lg bg-slate-800 px-3 py-2"
                  >
                    <p className="text-sm font-medium text-white">
                      {deal.title}
                    </p>
                    <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
                      <span>
                        {formatCurrency(
                          Number(deal.value || 0),
                          deal.currency || currency
                        )}
                      </span>
                      {deal.stage && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[10px]"
                          style={{
                            backgroundColor: `${deal.stage.color}20`,
                            color: deal.stage.color,
                          }}
                        >
                          {deal.stage.name}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-slate-800" />

          {/* Notes */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium tracking-wider text-slate-500 uppercase">
              <StickyNote className="h-3 w-3" />
              Notes
            </div>
            <div className="mt-2">
              {/* Add note input */}
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      handleAddNote();
                    }
                  }}
                  placeholder="Add a note... (⌘+Enter to save)"
                  rows={2}
                  className="focus:border-primary/50 flex-1 resize-none rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white placeholder-slate-500 outline-none"
                />
                <Button
                  size="sm"
                  className="bg-primary hover:bg-primary/90 h-auto px-2"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              {/* Notes list */}
              <div className="mt-2 space-y-2">
                {!ready && (
                  <SectionPlaceholder className="h-16 w-full rounded-lg" />
                )}
                {ready && notes.length === 0 && (
                  <p className="px-1 text-xs text-slate-600">No notes yet</p>
                )}
                {ready &&
                  notes.map((note) => (
                    <NoteCard
                      key={note.id}
                      note={note}
                      isEditing={editingNoteId === note.id}
                      editingText={editingText}
                      onEditingTextChange={setEditingText}
                      onStartEdit={handleStartEdit}
                      onCancelEdit={handleCancelEdit}
                      onSaveEdit={handleSaveEdit}
                      onToggleComplete={handleToggleComplete}
                      onDelete={handleDeleteNote}
                    />
                  ))}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

function SectionPlaceholder({ className }: { className: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse bg-slate-800/70', className)}
    />
  );
}

interface NoteCardProps {
  note: ContactNote;
  isEditing: boolean;
  editingText: string;
  onEditingTextChange: (val: string) => void;
  onStartEdit: (note: ContactNote) => void;
  onCancelEdit: () => void;
  onSaveEdit: (noteId: string) => void;
  onToggleComplete: (note: ContactNote) => void;
  onDelete: (note: ContactNote) => void;
}

function NoteCard({
  note,
  isEditing,
  editingText,
  onEditingTextChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onToggleComplete,
  onDelete,
}: NoteCardProps) {
  return (
    <div className="group relative rounded-lg bg-slate-800 px-3 py-2">
      {isEditing ? (
        /* ── Edit mode ── */
        <div className="space-y-2">
          <textarea
            autoFocus
            value={editingText}
            onChange={(e) => onEditingTextChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onCancelEdit();
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey))
                onSaveEdit(note.id);
            }}
            rows={3}
            className="focus:border-primary/50 w-full resize-none rounded-md border border-slate-600 bg-slate-700 px-2 py-1.5 text-xs text-white outline-none"
          />
          <div className="flex gap-1.5">
            <button
              onClick={() => onSaveEdit(note.id)}
              disabled={!editingText.trim()}
              className="bg-primary hover:bg-primary/90 flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-white disabled:opacity-50"
            >
              <Check className="h-2.5 w-2.5" />
              Save
            </button>
            <button
              onClick={onCancelEdit}
              className="flex items-center gap-1 rounded-md bg-slate-700 px-2 py-1 text-[10px] font-medium text-slate-300 hover:bg-slate-600"
            >
              <X className="h-2.5 w-2.5" />
              Cancel
            </button>
          </div>
        </div>
      ) : (
        /* ── View mode ── */
        <div className="flex items-start gap-2">
          {/* Checkbox / todo toggle */}
          <button
            onClick={() => onToggleComplete(note)}
            className="hover:text-primary mt-0.5 shrink-0 text-slate-500 transition-colors"
            title={note.is_completed ? 'Mark as incomplete' : 'Mark as done'}
          >
            {note.is_completed ? (
              <CheckSquare className="text-primary h-3.5 w-3.5" />
            ) : (
              <Square className="h-3.5 w-3.5" />
            )}
          </button>

          {/* Note text + timestamp */}
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                'text-xs leading-relaxed whitespace-pre-wrap',
                note.is_completed
                  ? 'text-slate-500 line-through'
                  : 'text-slate-300'
              )}
            >
              {note.note_text}
            </p>
            <p className="mt-1 text-[10px] text-slate-600">
              {format(new Date(note.created_at), 'MMM d, yyyy HH:mm')}
            </p>
          </div>

          {/* Action buttons — visible on hover */}
          <div
            className={cn(
              'flex shrink-0 items-center gap-0.5 transition-opacity',
              'opacity-0 group-hover:opacity-100'
            )}
          >
            <button
              onClick={() => onStartEdit(note)}
              className="flex h-5 w-5 items-center justify-center rounded text-slate-500 transition-colors hover:bg-slate-700 hover:text-white"
              title="Edit note"
            >
              <Pencil className="h-2.5 w-2.5" />
            </button>
            <button
              onClick={() => onDelete(note)}
              className="flex h-5 w-5 items-center justify-center rounded text-slate-500 transition-colors hover:bg-red-900/40 hover:text-red-400"
              title="Delete note"
            >
              <Trash2 className="h-2.5 w-2.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
