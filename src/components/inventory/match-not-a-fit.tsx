'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { EyeOff, Loader2, RotateCcw, Sparkles, X } from 'lucide-react';
import type { Contact } from '@/types';
import {
  MATCH_REJECT_REASONS,
  STAFF_PROPERTY_TYPE_OPTIONS,
  matchRejectReasonLabel,
  propertyTypeOption,
  type MatchFeedbackMark,
  type MatchRejectReason,
} from '@/lib/match-feedback';
import {
  markMatchNotAFit,
  restoreMatch,
  saveMatchPropertyType,
} from '@/lib/inventory/match-feedback-request';

const chip =
  'cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const chipIdle =
  'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500 hover:text-white';
const chipOn = 'border-primary/50 bg-primary/15 text-primary';

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

interface NotAFitPanelProps {
  propertyId: string;
  contactId: string;
  contactName: string;
  onClose: () => void;
  onSaved: (contactsChanged: boolean) => void | Promise<void>;
}

/**
 * The reasons a matched contact is not a fit for this listing. "Wrong
 * property type" opens the type list, so the mark also says what the
 * contact does want and every later listing matches on it.
 */
export function NotAFitPanel({
  propertyId,
  contactId,
  contactName,
  onClose,
  onSaved,
}: NotAFitPanelProps) {
  const [reason, setReason] = useState<MatchRejectReason | null>(null);
  const [types, setTypes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  async function save(chosen: MatchRejectReason, typeIds: string[]) {
    setSaving(true);
    try {
      const { typeSaved } = await markMatchNotAFit(
        propertyId,
        contactId,
        chosen,
        typeIds
      );
      toast.success(
        typeSaved
          ? `${contactName} hidden here, and their property type is saved for future matches`
          : `${contactName} hidden from this listing's matches`
      );
      await onSaved(typeSaved);
      onClose();
    } catch (err) {
      toast.error(errorText(err, 'Could not save the mark'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      onClick={(event) => event.stopPropagation()}
      className="space-y-2.5 border-t border-slate-800 bg-slate-950/40 px-3.5 py-3"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-300">
          {reason === 'type'
            ? `What is ${contactName} looking for?`
            : `Why is this not a fit for ${contactName}?`}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cancel not a fit"
          className="text-slate-500 hover:text-white"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {reason !== 'type' ? (
        <div className="flex flex-wrap gap-1.5">
          {MATCH_REJECT_REASONS.map((r) => (
            <button
              key={r.reason}
              type="button"
              disabled={saving}
              onClick={() =>
                r.reason === 'type' ? setReason('type') : save(r.reason, [])
              }
              className={`${chip} ${chipIdle}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {STAFF_PROPERTY_TYPE_OPTIONS.map((o) => {
              const on = types.includes(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  disabled={saving}
                  aria-pressed={on}
                  title={o.description}
                  onClick={() =>
                    setTypes((prev) =>
                      on ? prev.filter((id) => id !== o.id) : [...prev, o.id]
                    )
                  }
                  className={`${chip} ${on ? chipOn : chipIdle}`}
                >
                  {o.title}
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => save('type', [])}
              className="rounded-full px-3 py-1.5 text-xs font-semibold text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-50"
            >
              Skip, just hide
            </button>
            <button
              type="button"
              disabled={saving || types.length === 0}
              onClick={() => save('type', types)}
              className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold disabled:opacity-50"
            >
              {saving && <Loader2 className="size-3 animate-spin" />}
              Save type and hide
            </button>
          </div>
        </>
      )}
    </div>
  );
}

interface TypeSuggestionProps {
  propertyId: string;
  contactId: string;
  optionId: string;
  canEdit: boolean;
  onSaved: (contactsChanged: boolean) => void | Promise<void>;
}

/** A type the engine read off this contact's marks and enquiries, for
 *  the agent to confirm in one tap. Nothing is written until they do. */
export function TypeSuggestion({
  propertyId,
  contactId,
  optionId,
  canEdit,
  onSaved,
}: TypeSuggestionProps) {
  const [saving, setSaving] = useState(false);
  const option = propertyTypeOption(optionId);
  if (!option) return null;

  async function confirm() {
    setSaving(true);
    try {
      await saveMatchPropertyType(propertyId, contactId, [optionId]);
      toast.success(`Property type saved: ${option!.title}`);
      await onSaved(true);
    } catch (err) {
      toast.error(errorText(err, 'Could not save the property type'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      onClick={(event) => event.stopPropagation()}
      className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5 text-[11px] text-amber-300"
    >
      <Sparkles className="size-3 shrink-0" />
      <span className="min-w-0 flex-1">
        Likely looking for <strong>{option.title}</strong>, from earlier
        &ldquo;Not a fit&rdquo; marks and enquiries
      </span>
      {canEdit && (
        <button
          type="button"
          disabled={saving}
          onClick={confirm}
          className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 px-2 py-0.5 font-bold hover:bg-amber-500/10 disabled:opacity-50"
        >
          {saving && <Loader2 className="size-3 animate-spin" />}
          Confirm
        </button>
      )}
    </div>
  );
}

interface HiddenMatchesProps {
  propertyId: string;
  hidden: { contact: Contact; feedback: MatchFeedbackMark }[];
  canEdit: boolean;
  onRestored: () => void | Promise<void>;
}

/** Contacts ruled out for this listing, behind a toggle, each with who
 *  said no and why, and a way back into the list. */
export function HiddenMatches({
  propertyId,
  hidden,
  canEdit,
  onRestored,
}: HiddenMatchesProps) {
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  if (hidden.length === 0) return null;

  async function restore(contactId: string, name: string) {
    setBusyId(contactId);
    try {
      await restoreMatch(propertyId, contactId);
      toast.success(`${name} is back in this listing's matches`);
      await onRestored();
    } catch (err) {
      toast.error(errorText(err, 'Could not restore the contact'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="rounded-xl border border-dashed border-slate-800">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-xs font-semibold text-slate-400 hover:text-white"
      >
        <EyeOff className="size-3.5" />
        {open ? 'Hide' : 'Show'} hidden ({hidden.length})
      </button>
      {open && (
        <div className="divide-y divide-slate-800 border-t border-slate-800">
          {hidden.map(({ contact: c, feedback }) => {
            const name = c.name || c.phone || 'Unnamed contact';
            return (
              <div
                key={c.id}
                className="flex items-center justify-between gap-2 px-3.5 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-slate-300">
                    {name}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {matchRejectReasonLabel(feedback.reason)} ·{' '}
                    {feedback.source === 'agent'
                      ? 'marked by agent'
                      : 'said by the buyer'}
                  </p>
                </div>
                {canEdit && feedback.source === 'agent' && (
                  <button
                    type="button"
                    disabled={busyId === c.id}
                    onClick={() => restore(c.id, name)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-50"
                  >
                    {busyId === c.id ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <RotateCcw className="size-3" />
                    )}
                    Restore
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
