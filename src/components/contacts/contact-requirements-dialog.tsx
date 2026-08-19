'use client';

import { useState } from 'react';
import {
  ArrowLeft,
  ClipboardCheck,
  FilePlus2,
  Loader2,
  MessageSquareText,
  Radar,
  Save,
  Send,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { Contact, ContactRequirementProfile } from '@/types';

interface ContactRequirementsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: Contact;
  onChanged: () => void;
}

interface RequirementResult {
  data: {
    profile: ContactRequirementProfile | null;
    duplicate?: boolean;
    match_count: number;
    alerts_active: boolean;
  };
}

type View = 'overview' | 'add' | 'ask';

function inr(value: number): string {
  if (value >= 10_000_000) {
    return `₹${(value / 10_000_000).toFixed(2).replace(/\.00$/, '')} Cr`;
  }
  if (value >= 100_000) {
    return `₹${(value / 100_000).toFixed(2).replace(/\.00$/, '')} L`;
  }
  return `₹${value.toLocaleString('en-IN')}`;
}

function primarySummary(contact: Contact): string {
  const types = contact.pref_property_types?.length
    ? contact.pref_property_types
    : contact.property_interests || [];
  const areas = [
    ...new Set([
      ...(contact.areas_of_interest || []),
      ...(contact.pref_areas || []),
    ]),
  ];
  const min = contact.pref_budget_min ?? contact.min_budget ?? null;
  const max = contact.pref_budget_max ?? contact.max_budget ?? null;
  const budget = contact.no_budget
    ? 'No fixed budget'
    : min && max
      ? `${inr(min)}–${inr(max)}`
      : max
        ? `Up to ${inr(max)}`
        : min
          ? `Above ${inr(min)}`
          : null;
  return [types.slice(0, 2).join(' / '), areas.slice(0, 3).join(', '), budget]
    .filter(Boolean)
    .join(' · ');
}

function profileSummary(profile: ContactRequirementProfile): string {
  const size =
    profile.land_area_min_sqft && profile.land_area_max_sqft
      ? `${Math.round(profile.land_area_min_sqft).toLocaleString('en-IN')}–${Math.round(profile.land_area_max_sqft).toLocaleString('en-IN')} sq.ft.`
      : profile.land_area_min_sqft || profile.land_area_max_sqft
        ? `${Math.round(profile.land_area_min_sqft || profile.land_area_max_sqft || 0).toLocaleString('en-IN')} sq.ft.`
        : null;
  const budget =
    profile.budget_min && profile.budget_max
      ? `${inr(profile.budget_min)}–${inr(profile.budget_max)}`
      : profile.budget_max
        ? `Up to ${inr(profile.budget_max)}`
        : profile.budget_min
          ? `Above ${inr(profile.budget_min)}`
          : null;
  return [
    profile.property_types.slice(0, 2).join(' / '),
    profile.areas.slice(0, 3).join(', '),
    size,
    budget,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function ContactRequirementsDialog({
  open,
  onOpenChange,
  contact,
  onChanged,
}: ContactRequirementsDialogProps) {
  const [view, setView] = useState<View>('overview');
  const profiles = contact.requirement_profiles || [];
  const [primaryText, setPrimaryText] = useState(
    () => contact.requirements?.trim() || primarySummary(contact)
  );
  const [profileDrafts, setProfileDrafts] = useState<Record<string, string>>(
    () =>
      Object.fromEntries(
        profiles.map((profile) => [profile.id, profile.raw_text])
      )
  );
  const [addText, setAddText] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const name = contact.name?.trim() || 'this buyer';

  function close() {
    if (saving || sending) return;
    onOpenChange(false);
  }

  async function readResponse(response: Response): Promise<RequirementResult> {
    const body = (await response.json().catch(() => ({}))) as
      | RequirementResult
      | { error?: string };
    if (!response.ok || !('data' in body)) {
      throw new Error(
        ('error' in body && body.error) || 'Could not save the requirement'
      );
    }
    return body;
  }

  function successMessage(result: RequirementResult['data'], verb: string) {
    const matches = result.match_count
      ? `${result.match_count} current match${result.match_count === 1 ? '' : 'es'} found.`
      : 'No current match; Match Radar will keep watching.';
    const delivery = result.alerts_active
      ? ' Future matches will go from the connected business WhatsApp.'
      : ' Future matches stay in Match Radar until WhatsApp alerts are enabled.';
    toast.success(`${verb}. ${matches}${delivery}`);
  }

  async function saveRequirement(
    target: 'primary' | 'profile',
    text: string,
    profileId?: string
  ) {
    const key = target === 'primary' ? 'primary' : profileId || 'profile';
    if (!text.trim() || saving) return;
    setSaving(key);
    try {
      const result = await readResponse(
        await fetch(`/api/contacts/${contact.id}/requirements`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            target,
            profile_id: profileId,
            text,
          }),
        })
      );
      successMessage(result.data, 'Requirement updated');
      onChanged();
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not save the requirement'
      );
    } finally {
      setSaving(null);
    }
  }

  async function addRequirement() {
    if (!addText.trim() || saving) return;
    setSaving('add');
    try {
      const result = await readResponse(
        await fetch(`/api/contacts/${contact.id}/requirements`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: addText,
            source: 'personal_whatsapp',
          }),
        })
      );
      successMessage(
        result.data,
        result.data.duplicate
          ? 'Requirement was already saved'
          : 'Additional requirement saved'
      );
      onChanged();
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not save the requirement'
      );
    } finally {
      setSaving(null);
    }
  }

  async function askBuyer() {
    if (sending || !contact.phone) return;
    setSending(true);
    try {
      const response = await fetch('/api/whatsapp/flows/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_id: contact.id }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        delivery?: 'flow' | 'template';
      };
      if (!response.ok)
        throw new Error(body.error || 'Could not send the form');
      toast.success(
        body.delivery === 'template'
          ? `Requirement request sent to ${name} by approved WhatsApp template`
          : `Requirement form sent to ${name} from the Engine`
      );
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not send the form'
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
    >
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-6 text-white shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-bold">
            {view !== 'overview' ? (
              <button
                type="button"
                onClick={() => setView('overview')}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                aria-label="Back to requirements"
              >
                <ArrowLeft className="size-4" />
              </button>
            ) : (
              <ClipboardCheck className="text-primary size-5" />
            )}
            {view === 'overview'
              ? 'Requirements'
              : view === 'add'
                ? 'Add another requirement'
                : 'Ask for requirements and budget'}
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-400">
            {view === 'overview'
              ? `Review every active brief for ${name} from one place.`
              : view === 'add'
                ? 'Paste a personal WhatsApp message. It becomes a separate structured brief.'
                : `Send ${name} the pre-filled WhatsApp form from your connected business number.`}
          </DialogDescription>
        </DialogHeader>

        {view === 'overview' ? (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                variant="outline"
                onClick={() => setView('add')}
                className="h-auto justify-start border-sky-500/20 bg-sky-500/5 px-4 py-3 text-sky-300"
              >
                <FilePlus2 className="size-4" />
                Add another requirement
              </Button>
              <Button
                variant="outline"
                onClick={() => setView('ask')}
                disabled={!contact.phone}
                className="h-auto justify-start border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-emerald-300"
              >
                <Send className="size-4" />
                Ask buyer for requirements
              </Button>
            </div>

            <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Primary requirement
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Used by the buyer form and Match Radar. Editing re-reads the
                    text into structured matching fields.
                  </p>
                </div>
                <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-bold text-emerald-400">
                  Active
                </span>
              </div>
              <Textarea
                value={primaryText}
                onChange={(event) => setPrimaryText(event.target.value)}
                placeholder="Property type, location, size, budget and any must-haves"
                className="min-h-28 border-slate-700 bg-slate-900 text-white placeholder:text-slate-600"
                maxLength={4000}
              />
              {primarySummary(contact) ? (
                <p className="text-xs text-slate-500">
                  Structured now: {primarySummary(contact)}
                </p>
              ) : null}
              <Button
                size="sm"
                onClick={() => saveRequirement('primary', primaryText)}
                disabled={!primaryText.trim() || saving !== null}
              >
                {saving === 'primary' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                {saving === 'primary'
                  ? 'Reading and matching…'
                  : 'Save primary requirement'}
              </Button>
            </section>

            <section className="space-y-3">
              <div>
                <h3 className="text-sm font-bold text-white">
                  Additional requirements
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  Each brief is matched independently, so locations, sizes and
                  budgets never get mixed together.
                </p>
              </div>
              {profiles.length ? (
                profiles.map((profile) => (
                  <div
                    key={profile.id}
                    className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-semibold text-slate-100">
                          {profile.title}
                        </h4>
                        {profileSummary(profile) ? (
                          <p className="mt-1 text-xs text-slate-500">
                            {profileSummary(profile)}
                          </p>
                        ) : null}
                      </div>
                      <span className="rounded-full bg-sky-500/10 px-2 py-1 text-[10px] font-bold text-sky-400">
                        Separate brief
                      </span>
                    </div>
                    <Textarea
                      value={profileDrafts[profile.id] ?? profile.raw_text}
                      onChange={(event) =>
                        setProfileDrafts((current) => ({
                          ...current,
                          [profile.id]: event.target.value,
                        }))
                      }
                      className="min-h-24 border-slate-700 bg-slate-900 text-white"
                      maxLength={4000}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        saveRequirement(
                          'profile',
                          profileDrafts[profile.id] ?? profile.raw_text,
                          profile.id
                        )
                      }
                      disabled={
                        !(
                          profileDrafts[profile.id] ?? profile.raw_text
                        ).trim() || saving !== null
                      }
                    >
                      {saving === profile.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Save className="size-4" />
                      )}
                      {saving === profile.id
                        ? 'Reading and matching…'
                        : 'Save changes'}
                    </Button>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-slate-700 p-5 text-center text-sm text-slate-500">
                  No additional requirements yet.
                </div>
              )}
            </section>

            <div className="border-primary/20 bg-primary/5 flex items-start gap-2 rounded-xl border p-3 text-xs text-slate-300">
              <Radar className="text-primary mt-0.5 size-4 shrink-0" />
              <p>
                {contact.buyer_alerts_consent === 'granted'
                  ? 'Match Radar is watching these briefs. New matches can be sent from the connected business WhatsApp.'
                  : 'Match Radar is watching these briefs. WhatsApp delivery starts after buyer alert consent is granted.'}
              </p>
            </div>
          </div>
        ) : view === 'add' ? (
          <div className="space-y-3">
            <Label htmlFor="new-requirement" className="text-xs text-slate-300">
              Requirement message
            </Label>
            <Textarea
              id="new-requirement"
              value={addText}
              onChange={(event) => setAddText(event.target.value)}
              placeholder="For Dabaspete, 2–3 acres, for cold storage / warehouse on or close to STRR"
              className="min-h-36 border-slate-700 bg-slate-950/60 text-white placeholder:text-slate-600"
              maxLength={4000}
              autoFocus
            />
            <div className="border-primary/20 bg-primary/5 flex items-start gap-2 rounded-xl border p-3 text-xs text-slate-300">
              <Radar className="text-primary mt-0.5 size-4 shrink-0" />
              <p>
                AI extracts area, property type, size and budget, checks current
                inventory, and saves this independently.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setView('overview')}>
                Cancel
              </Button>
              <Button
                onClick={addRequirement}
                disabled={!addText.trim() || saving !== null}
              >
                {saving === 'add' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <FilePlus2 className="size-4" />
                )}
                {saving === 'add' ? 'Reading and matching…' : 'Save to Engine'}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-300">
              <div className="flex items-start gap-2">
                <MessageSquareText className="mt-0.5 size-4 shrink-0 text-emerald-400" />
                <p>
                  The pre-filled form is sent from your connected ConvoReal
                  WhatsApp number and recorded in Inbox—not from your personal
                  WhatsApp.
                </p>
              </div>
              <div className="flex items-start gap-2">
                <Radar className="text-primary mt-0.5 size-4 shrink-0" />
                <p>
                  Only {name}&apos;s submitted response updates the primary
                  brief. ConvoReal then re-runs matching and retains it for
                  future Match Radar alerts.
                </p>
              </div>
            </div>
            {!contact.phone ? (
              <p className="text-sm text-amber-400">
                Add a phone number before sending the form.
              </p>
            ) : null}
            <DialogFooter>
              <Button variant="outline" onClick={() => setView('overview')}>
                Cancel
              </Button>
              <Button onClick={askBuyer} disabled={sending || !contact.phone}>
                {sending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                {sending ? 'Sending from Engine…' : 'Send from Engine'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
