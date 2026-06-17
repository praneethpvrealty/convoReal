"use client";

import { useState, useEffect, useCallback, createElement } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { Contact, Deal, ContactNote, Tag } from "@/types";
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
} from "lucide-react";
import { getCurrencyIcon } from "@/lib/currency-utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ContactSidebarProps {
  contact: Contact | null;
}

export function ContactSidebar({ contact }: ContactSidebarProps) {
  const { user, accountId } = useAuth();
  const [copied, setCopied] = useState(false);
  const [currency, setCurrency] = useState("INR");
  const [deals, setDeals] = useState<Deal[]>([]);

  const fetchCurrency = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from("showcase_settings")
        .select("currency")
        .single();
      if (data?.currency) {
        setCurrency(data.currency);
      }
    } catch (err) {
      console.error("Failed to load showcase settings currency:", err);
    }
  }, []);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  // Track which note is being edited: null = none
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();

    // Fetch deals, notes, and tags in parallel
    const [dealsRes, notesRes, tagsRes] = await Promise.all([
      supabase
        .from("deals")
        .select("*, stage:pipeline_stages(*)")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_notes")
        .select("*")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_tags")
        .select("id, tag_id, tags(*)")
        .eq("contact_id", contact.id),
    ]);

    if (dealsRes.data) setDeals(dealsRes.data);
    if (notesRes.data) setNotes(notesRes.data);
    if (tagsRes.data) {
      const mapped = tagsRes.data
        .filter((ct: Record<string, unknown>) => ct.tags)
        .map((ct: Record<string, unknown>) => ({
          ...(ct.tags as Tag),
          contact_tag_id: ct.id as string,
        }));
      setTags(mapped);
    }
  }, [contact]);

  // Load on contact change. setContactData/setTags run inside async
  // Supabase callbacks, not synchronously in the effect body.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchCurrency();
    fetchContactData();
  }, [fetchCurrency, fetchContactData]);

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
      .from("contact_notes")
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
      setNewNote("");
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
    const { error } = await supabase
      .from("contact_notes")
      .update({ is_completed: newVal })
      .eq("id", note.id);
    if (error) {
      // Revert on failure
      setNotes((prev) =>
        prev.map((n) => (n.id === note.id ? { ...n, is_completed: !newVal } : n))
      );
      toast.error("Failed to update note");
    }
  }, []);

  const handleStartEdit = useCallback((note: ContactNote) => {
    setEditingNoteId(note.id);
    setEditingText(note.note_text);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingNoteId(null);
    setEditingText("");
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
      setEditingText("");

      const supabase = createClient();
      const { error } = await supabase
        .from("contact_notes")
        .update({ note_text: trimmed })
        .eq("id", noteId);
      if (error) {
        toast.error("Failed to save note");
        // Refetch to restore true state
        fetchContactData();
      }
    },
    [editingText, fetchContactData]
  );

  const handleDeleteNote = useCallback(
    async (note: ContactNote) => {
      // Optimistic removal
      setNotes((prev) => prev.filter((n) => n.id !== note.id));
      toast("Note deleted", {
        action: {
          label: "Undo",
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
          await supabase.from("contact_notes").delete().eq("id", note.id);
        },
        onAutoClose: async () => {
          const supabase = createClient();
          await supabase.from("contact_notes").delete().eq("id", note.id);
        },
      });
    },
    []
  );

  if (!contact) {
    return (
      <div className="flex h-full w-70 items-center justify-center border-l border-slate-800 bg-slate-900">
        <p className="text-sm text-slate-500">Select a conversation</p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex h-full w-70 flex-col border-l border-slate-800 bg-slate-900">
      <ScrollArea className="flex-1">
        <div className="p-4">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-700 text-lg font-semibold text-white">
              {contact.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={contact.avatar_url}
                  alt={displayName}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <h3 className="mt-3 text-sm font-semibold text-white">
              {displayName}
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
                <Check className="h-3 w-3 text-primary" />
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
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-slate-500">
              <TagIcon className="h-3 w-3" />
              Tags
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.length === 0 ? (
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
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-slate-500">
              {createElement(getCurrencyIcon(currency), { className: "h-3 w-3" })}
              Active Deals
            </div>
            <div className="mt-2 space-y-2">
              {deals.length === 0 ? (
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
                        {(() => {
                          const activeCurrency = deal.currency || currency;
                          if (activeCurrency === "INR") {
                            const val = Number(deal.value || 0);
                            if (val >= 10000000) {
                              return `₹${(val / 10000000).toFixed(2).replace(/\.00$/, '')} Cr`;
                            } else if (val >= 100000) {
                              return `₹${(val / 100000).toFixed(2).replace(/\.00$/, '')} Lakhs`;
                            }
                            return new Intl.NumberFormat("en-IN", {
                              style: "currency",
                              currency: "INR",
                              maximumFractionDigits: 0,
                            }).format(val);
                          }
                          return new Intl.NumberFormat("en-US", {
                            style: "currency",
                            currency: activeCurrency,
                            maximumFractionDigits: 0,
                          }).format(Number(deal.value || 0));
                        })()}
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
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-slate-500">
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
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      handleAddNote();
                    }
                  }}
                  placeholder="Add a note... (⌘+Enter to save)"
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-primary/50"
                />
                <Button
                  size="sm"
                  className="h-auto bg-primary px-2 hover:bg-primary/90"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              {/* Notes list */}
              <div className="mt-2 space-y-2">
                {notes.length === 0 && (
                  <p className="px-1 text-xs text-slate-600">No notes yet</p>
                )}
                {notes.map((note) => (
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
              if (e.key === "Escape") onCancelEdit();
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSaveEdit(note.id);
            }}
            rows={3}
            className="w-full resize-none rounded-md border border-slate-600 bg-slate-700 px-2 py-1.5 text-xs text-white outline-none focus:border-primary/50"
          />
          <div className="flex gap-1.5">
            <button
              onClick={() => onSaveEdit(note.id)}
              disabled={!editingText.trim()}
              className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[10px] font-medium text-white hover:bg-primary/90 disabled:opacity-50"
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
            className="mt-0.5 shrink-0 text-slate-500 hover:text-primary transition-colors"
            title={note.is_completed ? "Mark as incomplete" : "Mark as done"}
          >
            {note.is_completed ? (
              <CheckSquare className="h-3.5 w-3.5 text-primary" />
            ) : (
              <Square className="h-3.5 w-3.5" />
            )}
          </button>

          {/* Note text + timestamp */}
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "whitespace-pre-wrap text-xs leading-relaxed",
                note.is_completed
                  ? "text-slate-500 line-through"
                  : "text-slate-300"
              )}
            >
              {note.note_text}
            </p>
            <p className="mt-1 text-[10px] text-slate-600">
              {format(new Date(note.created_at), "MMM d, yyyy HH:mm")}
            </p>
          </div>

          {/* Action buttons — visible on hover */}
          <div className={cn(
            "flex shrink-0 items-center gap-0.5 transition-opacity",
            "opacity-0 group-hover:opacity-100"
          )}>
            <button
              onClick={() => onStartEdit(note)}
              className="flex h-5 w-5 items-center justify-center rounded text-slate-500 hover:bg-slate-700 hover:text-white transition-colors"
              title="Edit note"
            >
              <Pencil className="h-2.5 w-2.5" />
            </button>
            <button
              onClick={() => onDelete(note)}
              className="flex h-5 w-5 items-center justify-center rounded text-slate-500 hover:bg-red-900/40 hover:text-red-400 transition-colors"
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
