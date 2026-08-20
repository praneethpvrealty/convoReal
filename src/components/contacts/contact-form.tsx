'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import type {
  Contact,
  Tag,
  ContactTag,
  Property,
  AreaOfInterestGeo,
} from '@/types';
import { AreasOfInterestInput } from '@/components/contacts/areas-of-interest-input';
import { PROPERTY_INTEREST_OPTIONS } from '@/lib/property-interests';
import { ProjectsOfInterestInput } from '@/components/contacts/projects-of-interest-input';
import { NameTagBadge } from '@/components/contacts/name-tag-badge';
import { contactFullName } from '@/lib/contacts/full-name';
import { contactHandle } from '@/lib/contacts/reachability';
import { pruneAreasGeo } from '@/lib/contacts/area-geo';
import {
  LANGUAGE_CODES,
  languageDisplay,
  type LanguageCode,
} from '@/lib/languages';
import type { UpdateChannel } from '@/lib/voice/announcements';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PriceHint } from '@/components/ui/price-hint';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Search, Plus, Trash2, ArrowUp } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { normalizePhoneWithCountryCode } from '@/lib/whatsapp/phone-utils';
import { AlertsConsentControl } from '@/components/contacts/alerts-consent-control';
import { resolveRequirementSource } from '@/lib/requirements/profiles';

interface ContactFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact?: Contact | null;
  contactTags?: ContactTag[];
  onSaved: () => void;
}

export function ContactForm({
  open,
  onOpenChange,
  contact,
  contactTags = [],
  onSaved,
}: ContactFormProps) {
  const supabase = createClient();
  const { user, accountId } = useAuth();
  const isEdit = !!contact;

  const [name, setName] = useState('');
  const [salutation, setSalutation] = useState<'Mr.' | 'Mrs.' | ''>('');
  const [secondName, setSecondName] = useState('');
  const [nameTag, setNameTag] = useState('');
  const [phone, setPhone] = useState('');
  const [secondaryPhones, setSecondaryPhones] = useState<string[]>([]);
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [classification, setClassification] = useState<
    | 'Owner'
    | 'Seller'
    | 'Buyer'
    | 'Agent'
    | 'Developer'
    | 'Owner & Buyer'
    | 'Others'
  >('Others');
  const [leadTemp, setLeadTemp] = useState<
    'HOT' | 'COLD' | 'Not Responding' | 'Dead' | ''
  >('');
  const [updateChannel, setUpdateChannel] = useState<UpdateChannel | ''>('');
  const [preferredLanguage, setPreferredLanguage] = useState<LanguageCode | ''>(
    ''
  );
  const [lastInquiredPropertyId, setLastInquiredPropertyId] = useState<
    string | null
  >(null);
  const [referrer, setReferrer] = useState('');
  const [referrerContactId, setReferrerContactId] = useState<string | null>(
    null
  );
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [showReferrerSuggestions, setShowReferrerSuggestions] = useState(false);
  const [source, setSource] = useState('');
  const [saving, setSaving] = useState(false);
  const [dob, setDob] = useState('');
  const [feedbackStatus, setFeedbackStatus] = useState<
    'not_requested' | 'requested' | 'collected'
  >('not_requested');

  // Notes state
  const [notesText, setNotesText] = useState('');
  const [recentNoteId, setRecentNoteId] = useState<string | null>(null);
  const [defaultCountryCode, setDefaultCountryCode] = useState('91');

  // Associated Properties state
  const [propertiesList, setPropertiesList] = useState<Property[]>([]);
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>([]);
  const [loadingProperties, setLoadingProperties] = useState(false);
  const [propertySearch, setPropertySearch] = useState('');

  // Real estate preferences
  const [minBudget, setMinBudget] = useState('');
  const [maxBudget, setMaxBudget] = useState('');
  const [noBudget, setNoBudget] = useState(false);
  const [listingIntent, setListingIntent] = useState('');
  const [strictAreaMatch, setStrictAreaMatch] = useState(false);
  const [areasOfInterest, setAreasOfInterest] = useState<string[]>([]);
  const [areasText, setAreasText] = useState('');
  const [areasGeo, setAreasGeo] = useState<AreaOfInterestGeo[]>([]);
  const [projectsOfInterest, setProjectsOfInterest] = useState<string[]>([]);
  const [projectsText, setProjectsText] = useState('');
  const [strictProjectMatch, setStrictProjectMatch] = useState(false);
  const [propertyInterests, setPropertyInterests] = useState<string[]>([]);
  const [minRoi, setMinRoi] = useState('');

  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);

  const fetchTags = useCallback(async () => {
    setLoadingTags(true);
    const { data } = await supabase.from('tags').select('*').order('name');
    if (data) setTags(data);
    setLoadingTags(false);
  }, [supabase]);

  const fetchContacts = useCallback(async () => {
    const { data } = await supabase.from('contacts').select('*').order('name');
    if (data) setContacts(data);
  }, [supabase]);

  const fetchProperties = useCallback(async () => {
    setLoadingProperties(true);
    const { data } = await supabase
      .from('properties')
      .select('*')
      .order('title');
    if (data) setPropertiesList(data);
    setLoadingProperties(false);
  }, [supabase]);

  const fetchRecentNote = useCallback(
    async (contactId: string) => {
      const { data } = await supabase
        .from('contact_notes')
        .select('*')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) {
        setNotesText(data.note_text ?? '');
        setRecentNoteId(data.id);
      } else {
        setNotesText('');
        setRecentNoteId(null);
      }
    },
    [supabase]
  );

  const fetchAssociatedProperties = useCallback(
    async (contactId: string) => {
      const { data } = await supabase
        .from('properties')
        .select('id')
        .eq('owner_contact_id', contactId);
      if (data) {
        setSelectedPropertyIds(data.map((p) => p.id));
      } else {
        setSelectedPropertyIds([]);
      }
    },
    [supabase]
  );

  useEffect(() => {
    if (open) {
      const sourceContact = contact ? resolveRequirementSource(contact) : null;
      setName(contact?.name ?? '');
      setSalutation(contact?.salutation ?? '');
      setSecondName(contact?.second_name ?? '');
      setNameTag(contact?.name_tag ?? '');
      setPreferredLanguage(contact?.preferred_language ?? '');
      setPhone(contact?.phone ?? '');
      setSecondaryPhones(contact?.secondary_phones ?? []);
      setEmail(contact?.email ?? '');
      setCompany(contact?.company ?? '');
      setClassification((contact as Contact)?.classification ?? 'Others');
      setLeadTemp(contact?.lead_temp ?? '');
      setUpdateChannel(contact?.preferred_update_channel ?? '');
      setLastInquiredPropertyId(contact?.last_inquired_property_id ?? null);
      setReferrer(contact?.referrer ?? '');
      setReferrerContactId(contact?.referrer_contact_id ?? null);
      setMinBudget(
        sourceContact?.pref_budget_min != null
          ? String(sourceContact.pref_budget_min)
          : sourceContact?.min_budget != null
            ? String(sourceContact.min_budget)
            : ''
      );
      setMaxBudget(
        sourceContact?.pref_budget_max != null
          ? String(sourceContact.pref_budget_max)
          : sourceContact?.max_budget != null
            ? String(sourceContact.max_budget)
            : ''
      );
      setNoBudget(Boolean(sourceContact?.no_budget));
      setListingIntent((sourceContact?.pref_listing_types ?? []).join(','));
      setStrictAreaMatch(!!contact?.strict_area_match);
      const initialAreas = Array.from(
        new Set([
          ...(sourceContact?.areas_of_interest ?? []),
          ...(sourceContact?.pref_areas ?? []),
        ])
      );
      setAreasOfInterest(initialAreas);
      setAreasText(
        initialAreas.join(', ') + (initialAreas.length > 0 ? ', ' : '')
      );
      setAreasGeo(contact?.areas_of_interest_geo ?? []);
      const initialProjects = Array.from(
        new Set([
          ...(sourceContact?.projects_of_interest ?? []),
          ...(sourceContact?.pref_projects ?? []),
        ])
      );
      setProjectsOfInterest(initialProjects);
      setProjectsText(
        initialProjects.join(', ') + (initialProjects.length > 0 ? ', ' : '')
      );
      setStrictProjectMatch(!!contact?.strict_project_match);
      const initialPropertyInterests = Array.from(
        new Set([
          ...(sourceContact?.property_interests ?? []),
          ...(sourceContact?.pref_property_types ?? []),
          ...(sourceContact?.pref_property_categories ?? []),
        ])
      );
      setPropertyInterests(initialPropertyInterests);
      setMinRoi(contact?.min_roi ? String(contact.min_roi) : '');
      setSource(contact?.source ?? '');
      setDob(contact?.dob ?? '');
      setFeedbackStatus(contact?.feedback_status ?? 'not_requested');
      setSelectedTagIds(contactTags.map((ct) => ct.tag_id));
      fetchTags();
      fetchContacts();
      fetchProperties();

      if (contact?.id) {
        fetchRecentNote(contact.id);
        fetchAssociatedProperties(contact.id);
      } else {
        setNotesText('');
        setRecentNoteId(null);
        setSelectedPropertyIds([]);
      }
    }
  }, [
    open,
    contact,
    contactTags,
    fetchTags,
    fetchContacts,
    fetchProperties,
    fetchRecentNote,
    fetchAssociatedProperties,
  ]);

  useEffect(() => {
    if (!open) return;
    async function fetchShowcaseSettings() {
      try {
        const { data } = await supabase
          .from('showcase_settings')
          .select('default_country_code')
          .maybeSingle();
        if (data?.default_country_code) {
          setDefaultCountryCode(data.default_country_code);
        }
      } catch (err) {
        console.error('Failed to load default country code setting:', err);
      }
    }
    fetchShowcaseSettings();
  }, [open, supabase]);

  const filteredProperties = useMemo(() => {
    if (!propertySearch.trim()) return propertiesList;
    const q = propertySearch.toLowerCase();
    return propertiesList.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        (p.location && p.location.toLowerCase().includes(q))
    );
  }, [propertiesList, propertySearch]);

  const filteredReferrerContacts = useMemo(() => {
    if (!referrer.trim()) return [];
    return contacts
      .filter(
        (c) =>
          c.id !== contact?.id &&
          (contactFullName(c).toLowerCase().includes(referrer.toLowerCase()) ||
            (c.phone && c.phone.includes(referrer)))
      )
      .slice(0, 5);
  }, [contacts, referrer, contact]);

  const handleSwapSecondaryToPrimary = (idx: number) => {
    const currentPrimary = phone;
    const selectedSecondary = secondaryPhones[idx];

    setPhone(selectedSecondary);
    const updated = [...secondaryPhones];
    updated[idx] = currentPrimary;
    setSecondaryPhones(updated);

    toast.success('Phone numbers swapped!');
  };

  function toggleTag(tagId: string) {
    setSelectedTagIds((prev) =>
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!phone.trim() && !email.trim()) {
      toast.error('Add a phone number or an email');
      return;
    }

    setSaving(true);

    try {
      if (!user || !accountId)
        throw new Error('Not authenticated or account not loaded');

      const isEdit = !!contact?.id;
      const contactId = contact?.id;

      // Email-only contacts (company mailboxes) keep a null phone —
      // a number, once given, still has to be a valid one.
      const normalizedPrimary = phone.trim()
        ? normalizePhoneWithCountryCode(phone.trim(), defaultCountryCode)
        : null;
      if (phone.trim() && !normalizedPrimary) {
        toast.error('Invalid primary phone number format');
        setSaving(false);
        return;
      }

      const normalizedSecondary = secondaryPhones
        .filter((p) => p.trim().length > 0)
        .map((p) => normalizePhoneWithCountryCode(p.trim(), defaultCountryCode))
        .filter(Boolean);

      const payload = {
        name: name.trim() || null,
        salutation: salutation || null,
        second_name: secondName.trim() || null,
        name_tag: nameTag.trim() || null,
        preferred_language: preferredLanguage || null,
        phone: normalizedPrimary,
        secondary_phones: normalizedSecondary,
        email: email.trim() || null,
        company: company.trim() || null,
        classification,
        lead_temp: leadTemp || null,
        preferred_update_channel: updateChannel || null,
        last_inquired_property_id: lastInquiredPropertyId,
        referrer: referrer.trim() || null,
        referrer_contact_id: referrerContactId,
        min_budget: minBudget ? Number(minBudget) : null,
        max_budget: maxBudget ? Number(maxBudget) : null,
        no_budget: noBudget,
        pref_listing_types: listingIntent ? listingIntent.split(',') : [],
        strict_area_match: strictAreaMatch,
        areas_of_interest: areasOfInterest,
        areas_of_interest_geo: pruneAreasGeo(areasGeo, areasOfInterest),
        projects_of_interest: projectsOfInterest,
        strict_project_match:
          projectsOfInterest.length > 0 && strictProjectMatch,
        property_interests: propertyInterests,
        min_roi: minRoi ? Number(minRoi) : null,
        source: source.trim() || null,
        dob: dob || null,
        feedback_status: feedbackStatus,
        // Related entities — server handles these atomically
        tag_ids: selectedTagIds,
        note_text: notesText,
        recent_note_id: recentNoteId || null,
        property_ids: selectedPropertyIds,
      };

      const url = isEdit ? `/api/contacts/${contactId}` : '/api/contacts';
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res
          .json()
          .catch(() => ({ error: 'Failed to save contact' }));
        throw new Error(data.error || 'Failed to save contact');
      }

      toast.success(isEdit ? 'Contact updated' : 'Contact created');
      onOpenChange(false);
      onSaved();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to save contact';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden border-slate-700 bg-slate-900 p-0 text-slate-200 sm:max-w-lg">
        <DialogHeader className="border-b border-slate-800 p-6 pb-4">
          <DialogTitle className="text-white">
            {isEdit ? 'Edit Contact' : 'Add Contact'}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {isEdit
              ? 'Update the contact details below.'
              : 'Fill in the details to create a new contact.'}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <div className="flex-1 space-y-4 overflow-y-auto p-6 pt-4">
            <div className="grid grid-cols-6 gap-3">
              <div className="col-span-6 space-y-2">
                <Label className="text-slate-300">Title</Label>
                <div className="flex gap-2">
                  {(['Mr.', 'Mrs.'] as const).map((option) => (
                    <Button
                      key={option}
                      type="button"
                      variant={salutation === option ? 'default' : 'outline'}
                      size="sm"
                      aria-pressed={salutation === option}
                      onClick={() =>
                        setSalutation(salutation === option ? '' : option)
                      }
                    >
                      {option}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="col-span-2 space-y-2">
                <Label htmlFor="cf-name" className="text-slate-300">
                  Name
                </Label>
                <Input
                  id="cf-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="John"
                  className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                />
              </div>
              <div className="col-span-2 space-y-2">
                <Label htmlFor="cf-second-name" className="text-slate-300">
                  Second Name
                </Label>
                <Input
                  id="cf-second-name"
                  value={secondName}
                  onChange={(e) => setSecondName(e.target.value)}
                  placeholder="Doe"
                  className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                />
              </div>
              <div className="col-span-2 space-y-2">
                <Label htmlFor="cf-name-tag" className="text-slate-300">
                  Name Tag
                </Label>
                <Input
                  id="cf-name-tag"
                  value={nameTag}
                  onChange={(e) => setNameTag(e.target.value)}
                  placeholder="Bank DSA"
                  className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                />
              </div>
              <p className="col-span-6 -mt-1 text-xs text-slate-500">
                Mr./Mrs. is used in client-facing messages. Second Name and
                Name Tag stay inside the Engine. Name + Second Name must be
                unique across your contacts.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cf-phone" className="text-slate-300">
                Phone{' '}
                {email.trim() ? (
                  <span className="text-slate-500">(optional)</span>
                ) : (
                  <span className="text-red-400">*</span>
                )}
              </Label>
              <Input
                id="cf-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98765 43210"
                className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
              />
              <p className="text-xs text-slate-500">
                Include country code, e.g. +91 for India. Leave blank for a
                contact you only have an email for — WhatsApp features stay
                switched off for those.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-slate-300">
                  Secondary Phone Numbers
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSecondaryPhones([...secondaryPhones, ''])}
                  className="text-primary hover:text-primary-hover flex h-6 items-center gap-1 border border-slate-700/50 px-2 text-xs hover:bg-slate-800"
                >
                  <Plus className="h-3 w-3" />
                  Add Number
                </Button>
              </div>

              {secondaryPhones.length > 0 && (
                <div className="mt-1 space-y-2">
                  {secondaryPhones.map((secPhone, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Input
                        value={secPhone}
                        onChange={(e) => {
                          const updated = [...secondaryPhones];
                          updated[idx] = e.target.value;
                          setSecondaryPhones(updated);
                        }}
                        placeholder="+91 98765 43210"
                        className="h-9 flex-1 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                      />
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() =>
                                  handleSwapSecondaryToPrimary(idx)
                                }
                                className="hover:text-primary h-9 w-9 shrink-0 text-slate-400 hover:bg-slate-800"
                              />
                            }
                          >
                            <ArrowUp className="h-4 w-4" />
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            Make primary (swap with current primary)
                          </TooltipContent>
                        </Tooltip>

                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  setSecondaryPhones(
                                    secondaryPhones.filter((_, i) => i !== idx)
                                  );
                                }}
                                className="h-9 w-9 shrink-0 text-slate-400 hover:bg-slate-800 hover:text-red-400"
                              />
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            Delete secondary number
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-slate-500">
                For calling/referral lookup only. WhatsApp messages always route
                to the primary number.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cf-email" className="text-slate-300">
                Email {!phone.trim() && <span className="text-red-400">*</span>}
              </Label>
              <Input
                id="cf-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="john@example.com"
                className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cf-company" className="text-slate-300">
                Company
              </Label>
              <Input
                id="cf-company"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Acme Inc."
                className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
              />
            </div>

            <div className="relative space-y-2">
              <Label htmlFor="cf-referrer" className="text-slate-300">
                Referer
              </Label>
              <div className="relative">
                <Input
                  id="cf-referrer"
                  value={referrer}
                  onChange={(e) => {
                    setReferrer(e.target.value);
                    setReferrerContactId(null);
                    setShowReferrerSuggestions(true);
                  }}
                  onFocus={() => setShowReferrerSuggestions(true)}
                  onBlur={() => {
                    setTimeout(() => setShowReferrerSuggestions(false), 200);
                  }}
                  placeholder="Search existing contact or type a name..."
                  className="animate-none border-slate-700 bg-slate-800 pr-16 text-white placeholder:text-slate-500"
                />
                {referrerContactId && (
                  <span className="bg-primary/20 text-primary border-primary/30 absolute top-1/2 right-3 -translate-y-1/2 rounded border px-1.5 py-0.5 text-[10px] font-medium">
                    Linked
                  </span>
                )}
              </div>

              {showReferrerSuggestions &&
                filteredReferrerContacts.length > 0 && (
                  <div className="absolute z-50 mt-1 max-h-48 w-full space-y-0.5 overflow-y-auto rounded-md border border-slate-700 bg-slate-900 p-1 shadow-lg">
                    <div className="mb-1 border-b border-slate-800 px-2 py-1 text-[10px] font-semibold text-slate-500">
                      Link to existing contact:
                    </div>
                    {filteredReferrerContacts.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onMouseDown={() => {
                          setReferrer(c.name || 'Unnamed');
                          setReferrerContactId(c.id);
                          setShowReferrerSuggestions(false);
                        }}
                        className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-800"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold">
                            {contactFullName(c) || 'Unnamed'}
                          </span>
                          <NameTagBadge tag={c.name_tag} />
                          <span className="ml-1.5 text-[10px] text-slate-400">
                            ({contactHandle(c)})
                          </span>
                        </div>
                        <span className="rounded bg-slate-800 px-1 py-0.5 text-[10px] font-bold text-slate-400">
                          {c.classification}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="cf-classification" className="text-slate-300">
                Classification
              </Label>
              <select
                id="cf-classification"
                value={classification}
                onChange={(e) =>
                  setClassification(
                    e.target.value as
                      | 'Owner'
                      | 'Seller'
                      | 'Buyer'
                      | 'Agent'
                      | 'Developer'
                      | 'Owner & Buyer'
                      | 'Others'
                  )
                }
                className="focus:border-primary w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:outline-none"
              >
                <option value="Others">Others</option>
                <option value="Owner">Owner</option>
                <option value="Seller">Seller</option>
                <option value="Buyer">Buyer</option>
                <option value="Agent">Agent</option>
                <option value="Developer">Developer</option>
                <option value="Owner & Buyer">Owner & Buyer</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cf-source" className="text-slate-300">
                Source
              </Label>
              <select
                id="cf-source"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="focus:border-primary w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:outline-none"
              >
                <option value="">Select Source</option>
                <option value="Magic Bricks">Magic Bricks</option>
                <option value="Housing">Housing</option>
                <option value="99acres">99acres</option>
                <option value="Facebook">Facebook</option>
                <option value="Instagram">Instagram</option>
                <option value="Reference">Reference</option>
                <option value="WhatsApp">WhatsApp</option>
                <option value="Others">Others</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cf-dob" className="text-slate-300">
                Date of Birth
              </Label>
              <Input
                id="cf-dob"
                type="date"
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                className="focus-visible:ring-primary focus-visible:border-primary h-10 w-full border-slate-700 bg-slate-800 text-sm text-white placeholder:text-slate-500 focus-visible:ring-1"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cf-lead-temp" className="text-slate-300">
                Lead Temperature / Status
              </Label>
              <select
                id="cf-lead-temp"
                value={leadTemp}
                onChange={(e) =>
                  setLeadTemp(
                    e.target.value as
                      | 'HOT'
                      | 'COLD'
                      | 'Not Responding'
                      | 'Dead'
                      | ''
                  )
                }
                className="focus:border-primary w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:outline-none"
              >
                <option value="">None</option>
                <option value="HOT">🔥 HOT</option>
                <option value="COLD">❄️ COLD</option>
                <option value="Not Responding">⏳ Not Responding</option>
                <option value="Dead">💀 Dead</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cf-preferred-language" className="text-slate-300">
                Preferred Language
              </Label>
              <select
                id="cf-preferred-language"
                value={preferredLanguage}
                onChange={(e) =>
                  setPreferredLanguage(e.target.value as LanguageCode | '')
                }
                className="focus:border-primary w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:outline-none"
              >
                <option value="">Use account default</option>
                {LANGUAGE_CODES.map((code) => (
                  <option key={code} value={code}>
                    {languageDisplay(code)}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500">
                Picks the language variant of a WhatsApp template when one
                exists. Sends fall back to English if it doesn&apos;t.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cf-update-channel" className="text-slate-300">
                Preferred Update Channel
              </Label>
              <select
                id="cf-update-channel"
                value={updateChannel}
                onChange={(e) =>
                  setUpdateChannel(e.target.value as UpdateChannel | '')
                }
                className="focus:border-primary w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:outline-none"
              >
                <option value="">No preference</option>
                <option value="whatsapp_text">💬 WhatsApp text</option>
                <option value="whatsapp_audio">🎙️ WhatsApp voice note</option>
                <option value="voice_call">📞 Phone call</option>
              </select>
              <p className="text-xs text-slate-500">
                How announcements and reminders reach this contact. No
                preference lets each send pick its own default.
              </p>
              {contact?.id && (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const res = await fetch(
                        `/api/contacts/${contact.id}/ask-update-channel`,
                        { method: 'POST' }
                      );
                      const json = await res.json().catch(() => ({}));
                      if (!res.ok)
                        throw new Error(json.error || 'Failed to send');
                      toast.success(
                        'Asked on WhatsApp — their tap sets the preference automatically.'
                      );
                    } catch (err) {
                      toast.error(
                        err instanceof Error ? err.message : 'Failed to send'
                      );
                    }
                  }}
                  className="text-primary text-xs font-medium hover:underline"
                >
                  Ask them on WhatsApp instead →
                </button>
              )}
            </div>

            {contact?.id && (
              <AlertsConsentControl
                contactId={contact.id}
                consent={contact.buyer_alerts_consent}
                requestedAt={contact.buyer_alerts_consent_requested_at}
              />
            )}

            <div className="space-y-2">
              <Label htmlFor="cf-inquired-property" className="text-slate-300">
                Shown Interest / Inquired Property
              </Label>
              <select
                id="cf-inquired-property"
                value={lastInquiredPropertyId || ''}
                onChange={(e) =>
                  setLastInquiredPropertyId(e.target.value || null)
                }
                className="focus:border-primary w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:outline-none"
              >
                <option value="">None</option>
                {propertiesList.map((prop) => (
                  <option key={prop.id} value={prop.id}>
                    {prop.property_code ? `[${prop.property_code}] ` : ''}
                    {prop.title}
                  </option>
                ))}
              </select>
            </div>

            {/* Real Estate Preferences */}
            {classification === 'Buyer' && (
              <div className="mt-2 space-y-4 border-t border-slate-800 pt-4">
                <h4 className="text-sm font-bold tracking-wide text-white uppercase">
                  Real Estate Preferences
                </h4>

                {/* Buy or rent. Read by the matcher as a hard gate, so
                    an unset value stays unset rather than defaulting to
                    Sale — a guess here silently hides half the
                    inventory from the contact. */}
                <div className="space-y-2">
                  <Label htmlFor="cf-listing-intent" className="text-slate-300">
                    Looking to
                  </Label>
                  <select
                    id="cf-listing-intent"
                    value={listingIntent}
                    onChange={(e) => setListingIntent(e.target.value)}
                    className="focus:border-primary w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:outline-none"
                  >
                    <option value="">Not stated</option>
                    <option value="Sale">Buy</option>
                    <option value="Rent">Rent</option>
                    <option value="Sale,Rent">Either</option>
                  </select>
                </div>

                {/* Budget Fields */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-slate-300">Budget Range (INR)</Label>
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-400 select-none">
                      <input
                        type="checkbox"
                        checked={noBudget}
                        onChange={(e) => {
                          setNoBudget(e.target.checked);
                          if (e.target.checked) {
                            setMinBudget('');
                            setMaxBudget('');
                          }
                        }}
                        className="border-slate-750 text-primary focus:ring-primary/40 h-3.5 w-3.5 rounded bg-slate-800"
                      />
                      No Budget Limit
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Input
                        type="number"
                        disabled={noBudget}
                        value={minBudget}
                        onChange={(e) => setMinBudget(e.target.value)}
                        placeholder="Min Budget"
                        className="h-8 border-slate-700 bg-slate-800 text-xs text-white placeholder:text-slate-500 disabled:opacity-40"
                      />
                      <PriceHint
                        value={minBudget}
                        compact
                        className="block text-[10px]"
                      />
                    </div>
                    <div className="space-y-1">
                      <Input
                        type="number"
                        disabled={noBudget}
                        value={maxBudget}
                        onChange={(e) => setMaxBudget(e.target.value)}
                        placeholder="Max Budget"
                        className="h-8 border-slate-700 bg-slate-800 text-xs text-white placeholder:text-slate-500 disabled:opacity-40"
                      />
                      <PriceHint
                        value={maxBudget}
                        compact
                        className="block text-[10px]"
                      />
                    </div>
                  </div>
                </div>

                {/* ROI Preference Field */}
                <div className="space-y-2">
                  <Label htmlFor="cf-min-roi" className="text-slate-300">
                    Expected Min ROI (%)
                  </Label>
                  <Input
                    id="cf-min-roi"
                    type="number"
                    step="0.01"
                    value={minRoi}
                    onChange={(e) => setMinRoi(e.target.value)}
                    placeholder="e.g. 4.5"
                    className="focus-visible:ring-primary h-8.5 border-slate-700 bg-slate-800 text-xs text-white placeholder:text-slate-500 focus-visible:ring-1 focus-visible:ring-offset-0"
                  />
                </div>

                {/* Areas of Interest */}
                <div className="space-y-2">
                  <Label className="text-slate-300">Areas of Interest</Label>

                  <AreasOfInterestInput
                    areasText={areasText}
                    areasOfInterest={areasOfInterest}
                    onChange={(text, areas) => {
                      setAreasText(text);
                      setAreasOfInterest(areas);
                    }}
                    onPickGeo={(geo) =>
                      setAreasGeo((prev) => [
                        ...prev.filter(
                          (g) => g.name.toLowerCase() !== geo.name.toLowerCase()
                        ),
                        geo,
                      ])
                    }
                  />

                  {/* Strict Area Match Checkbox */}
                  <div className="flex items-center space-x-2 pt-2">
                    <input
                      type="checkbox"
                      id="cf-strict-area-match"
                      checked={strictAreaMatch}
                      onChange={(e) => setStrictAreaMatch(e.target.checked)}
                      className="text-primary size-3.5 rounded border-slate-700 bg-slate-800 focus:ring-0 focus:ring-offset-0"
                    />
                    <label
                      htmlFor="cf-strict-area-match"
                      className="cursor-pointer text-[11px] font-medium text-slate-400 select-none"
                    >
                      Strict Area Match (Matches within 5 kms instead of 20 kms)
                    </label>
                  </div>
                </div>

                {/* Named Projects */}
                <div className="space-y-2">
                  <Label className="text-slate-300">Projects of Interest</Label>

                  <ProjectsOfInterestInput
                    projectsText={projectsText}
                    projects={projectsOfInterest}
                    strict={strictProjectMatch}
                    onChange={(text, projects) => {
                      setProjectsText(text);
                      setProjectsOfInterest(projects);
                    }}
                    onStrictChange={setStrictProjectMatch}
                    idPrefix="cf"
                  />
                </div>

                {/* Property Interests Checklist */}
                <div className="space-y-2">
                  <Label className="text-slate-300">
                    Property Category Interests
                  </Label>
                  <div className="grid grid-cols-1 gap-2 rounded-lg border border-slate-800/80 bg-slate-950/20 p-3">
                    {PROPERTY_INTEREST_OPTIONS.map((option) => {
                      const checked = propertyInterests.includes(option);
                      return (
                        <label
                          key={option}
                          className="flex cursor-pointer items-start gap-2.5 text-xs text-slate-300 select-none hover:text-white"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setPropertyInterests((prev) => [
                                  ...prev,
                                  option,
                                ]);
                              } else {
                                setPropertyInterests((prev) =>
                                  prev.filter((o) => o !== option)
                                );
                              }
                            }}
                            className="text-primary focus:ring-primary/40 mt-0.5 h-3.5 w-3.5 cursor-pointer rounded border-slate-700 bg-slate-800"
                          />
                          <span>{option}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-2 border-t border-slate-800 pt-4">
              <Label className="text-slate-300">Tags</Label>
              {loadingTags ? (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="size-3 animate-spin" />
                  Loading tags...
                </div>
              ) : tags.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No tags available. Create tags in Settings.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => {
                    const selected = selectedTagIds.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => toggleTag(tag.id)}
                        className={`inline-flex cursor-pointer items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
                          selected
                            ? 'ring-primary ring-2 ring-offset-1 ring-offset-slate-900'
                            : 'opacity-60 hover:opacity-100'
                        }`}
                        style={{
                          backgroundColor: tag.color + '20',
                          color: tag.color,
                          borderColor: tag.color,
                        }}
                      >
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Notes Field */}
            <div className="space-y-2 border-t border-slate-800 pt-4">
              <Label htmlFor="cf-notes" className="text-slate-300">
                Notes
              </Label>
              <Textarea
                id="cf-notes"
                value={notesText}
                onChange={(e) => setNotesText(e.target.value)}
                placeholder="Add any notes or description about the contact..."
                className="min-h-[80px] resize-y border-slate-700 bg-slate-800 text-xs text-white placeholder:text-slate-500"
              />
            </div>

            {/* Properties Association checklist */}
            {[
              'Buyer',
              'Seller',
              'Agent',
              'Developer',
              'Owner',
              'Owner & Buyer',
            ].includes(classification) && (
              <div className="space-y-2 border-t border-slate-800 pt-4">
                <Label className="text-slate-350">Associated Properties</Label>
                <div className="relative">
                  <Search className="absolute top-1/2 left-2.5 size-3 -translate-y-1/2 text-slate-500" />
                  <Input
                    value={propertySearch}
                    onChange={(e) => setPropertySearch(e.target.value)}
                    placeholder="Search properties to link..."
                    className="focus-visible:ring-primary h-8 border-slate-700 bg-slate-800 pl-8 text-xs text-white placeholder:text-slate-500 focus-visible:ring-1 focus-visible:ring-offset-0"
                  />
                </div>
                <div className="mt-2 max-h-40 space-y-1.5 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/20 p-2.5">
                  {loadingProperties ? (
                    <div className="flex items-center justify-center gap-1.5 py-4 text-xs text-slate-500">
                      <Loader2 className="text-primary size-3 animate-spin" />
                      Loading properties...
                    </div>
                  ) : filteredProperties.length === 0 ? (
                    <p className="py-4 text-center text-[11px] text-slate-500">
                      No matching properties found.
                    </p>
                  ) : (
                    filteredProperties.map((prop) => {
                      const checked = selectedPropertyIds.includes(prop.id);
                      return (
                        <label
                          key={prop.id}
                          className="hover:bg-slate-850/40 flex cursor-pointer items-start gap-2.5 rounded p-1.5 text-xs text-slate-300 select-none hover:text-white"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedPropertyIds((prev) => [
                                  ...prev,
                                  prop.id,
                                ]);
                              } else {
                                setSelectedPropertyIds((prev) =>
                                  prev.filter((id) => id !== prop.id)
                                );
                              }
                            }}
                            className="text-primary focus:ring-primary/40 mt-0.5 h-3.5 w-3.5 cursor-pointer rounded border-slate-700 bg-slate-800"
                          />
                          <div className="min-w-0 flex-1">
                            <span className="block truncate font-semibold text-slate-200">
                              {prop.title}
                            </span>
                            <span className="block truncate text-left text-[10px] text-slate-500">
                              {prop.location} •{' '}
                              {prop.price >= 10000000
                                ? `₹${(prop.price / 10000000).toFixed(2).replace(/\.00$/, '')} Cr`
                                : prop.price >= 100000
                                  ? `₹${(prop.price / 100000).toFixed(2).replace(/\.00$/, '')} Lakhs`
                                  : `₹${prop.price.toLocaleString('en-IN')}`}
                            </span>
                          </div>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="mx-0 mb-0 rounded-none rounded-b-xl border-t border-slate-800 bg-slate-950/40 p-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              {isEdit ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
