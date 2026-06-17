'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import type { Contact, Tag, ContactTag, Property } from '@/types';
import { POPULAR_SUBLOCALITIES } from '@/lib/data/real-estate-data';
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
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Search } from 'lucide-react';

const SUGGESTED_AREAS = ['Whitefield', 'Koramangala', 'Not specific', 'East Bangalore', 'Indiranagar', 'Jayanagar'];

const PROPERTY_INTEREST_OPTIONS = [
  'Vacant plot',
  'Vacant building',
  'Rental building with some ROI',
  'Old building selling at site rate',
];

function formatPriceLabel(amountStr: string) {
  const amount = Number(amountStr);
  if (isNaN(amount) || amount <= 0) return '';
  if (amount >= 10000000) {
    const cr = amount / 10000000;
    return `₹${cr.toFixed(2).replace(/\.00$/, '')} Cr`;
  } else if (amount >= 100000) {
    const lakhs = amount / 100000;
    return `₹${lakhs.toFixed(2).replace(/\.00$/, '')} Lakhs`;
  }
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

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
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [classification, setClassification] = useState<'Owner' | 'Seller' | 'Buyer' | 'Agent' | 'Others'>('Others');
  const [leadTemp, setLeadTemp] = useState<'HOT' | 'COLD' | 'Not Responding' | 'Dead' | ''>('');
  const [lastInquiredPropertyId, setLastInquiredPropertyId] = useState<string | null>(null);
  const [referrer, setReferrer] = useState('');
  const [referrerContactId, setReferrerContactId] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [showReferrerSuggestions, setShowReferrerSuggestions] = useState(false);
  const [source, setSource] = useState('');
  const [saving, setSaving] = useState(false);

  // Notes state
  const [notesText, setNotesText] = useState('');
  const [recentNoteId, setRecentNoteId] = useState<string | null>(null);

  // Associated Properties state
  const [propertiesList, setPropertiesList] = useState<Property[]>([]);
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>([]);
  const [loadingProperties, setLoadingProperties] = useState(false);
  const [propertySearch, setPropertySearch] = useState('');

  // Real estate preferences
  const [minBudget, setMinBudget] = useState('');
  const [maxBudget, setMaxBudget] = useState('');
  const [noBudget, setNoBudget] = useState(false);
  const [areasOfInterest, setAreasOfInterest] = useState<string[]>([]);
  const [areasText, setAreasText] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [propertyInterests, setPropertyInterests] = useState<string[]>([]);
  const [minRoi, setMinRoi] = useState('');
  const [localitiesDb, setLocalitiesDb] = useState<{ major: string[] } | null>(null);

  async function ensureLocalitiesLoaded() {
    if (!localitiesDb) {
      const db = await import('@/lib/data/bengaluru-localities');
      setLocalitiesDb({ major: db.getMajorAreas() });
    }
  }

  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);

  const fetchTags = useCallback(async () => {
    setLoadingTags(true);
    const { data } = await supabase
      .from('tags')
      .select('*')
      .order('name');
    if (data) setTags(data);
    setLoadingTags(false);
  }, [supabase]);

  const fetchContacts = useCallback(async () => {
    const { data } = await supabase
      .from('contacts')
      .select('*')
      .order('name');
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

  const fetchRecentNote = useCallback(async (contactId: string) => {
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
  }, [supabase]);

  const fetchAssociatedProperties = useCallback(async (contactId: string) => {
    const { data } = await supabase
      .from('properties')
      .select('id')
      .eq('owner_contact_id', contactId);
    if (data) {
      setSelectedPropertyIds(data.map((p) => p.id));
    } else {
      setSelectedPropertyIds([]);
    }
  }, [supabase]);

  useEffect(() => {
    if (open) {
      setName(contact?.name ?? '');
      setPhone(contact?.phone ?? '');
      setEmail(contact?.email ?? '');
      setCompany(contact?.company ?? '');
      setClassification((contact as Contact)?.classification ?? 'Others');
      setLeadTemp(contact?.lead_temp ?? '');
      setLastInquiredPropertyId(contact?.last_inquired_property_id ?? null);
      setReferrer(contact?.referrer ?? '');
      setReferrerContactId(contact?.referrer_contact_id ?? null);
      setMinBudget(contact?.min_budget ? String(contact.min_budget) : '');
      setMaxBudget(contact?.max_budget ? String(contact.max_budget) : '');
      setNoBudget(!!contact?.no_budget);
      const initialAreas = contact?.areas_of_interest ?? [];
      setAreasOfInterest(initialAreas);
      setAreasText(initialAreas.join(', ') + (initialAreas.length > 0 ? ', ' : ''));
      setPropertyInterests(contact?.property_interests ?? []);
      setMinRoi((contact as any)?.min_roi ? String((contact as any).min_roi) : '');
      setSource(contact?.source ?? '');
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
  }, [open, contact, contactTags, fetchTags, fetchContacts, fetchProperties, fetchRecentNote, fetchAssociatedProperties]);

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
    return contacts.filter(
      (c) =>
        c.id !== contact?.id &&
        ((c.name && c.name.toLowerCase().includes(referrer.toLowerCase())) ||
         (c.phone && c.phone.includes(referrer)))
    ).slice(0, 5);
  }, [contacts, referrer, contact]);

  const activeQuery = useMemo(() => {
    const segments = areasText.split(',');
    return segments.length > 0 ? segments[segments.length - 1].trim() : '';
  }, [areasText]);

  const matchingSublocalities = useMemo(() => {
    if (!activeQuery) return [];
    const dataset = localitiesDb?.major || POPULAR_SUBLOCALITIES;
    return dataset.filter(area =>
      area.toLowerCase().includes(activeQuery.toLowerCase())
    ).slice(0, 10);
  }, [activeQuery, localitiesDb]);

  function handleAreasTextChange(val: string) {
    setAreasText(val);
    const parsed = val.split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    const unique = Array.from(new Set(parsed));
    setAreasOfInterest(unique);
  }

  function handleToggleArea(area: string) {
    const isChecked = areasOfInterest.includes(area);
    let updated: string[];
    if (isChecked) {
      updated = areasOfInterest.filter(a => a !== area);
    } else {
      const cleanList = areasOfInterest.filter(a => a.toLowerCase() !== activeQuery.toLowerCase());
      updated = [...cleanList, area];
    }
    setAreasOfInterest(updated);
    setAreasText(updated.join(', ') + (updated.length > 0 ? ', ' : ''));
  }

  function handleAddSuggestion(area: string) {
    if (!areasOfInterest.includes(area)) {
      const updated = [...areasOfInterest, area];
      setAreasOfInterest(updated);
      setAreasText(updated.join(', ') + (updated.length > 0 ? ', ' : ''));
    }
  }



  function toggleTag(tagId: string) {
    setSelectedTagIds((prev) =>
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!phone.trim()) {
      toast.error('Phone number is required');
      return;
    }

    setSaving(true);

    try {
      if (!user || !accountId) throw new Error('Not authenticated or account not loaded');

      let contactId = contact?.id;

      const fieldsToSave = {
        name: name.trim() || null,
        phone: phone.trim(),
        email: email.trim() || null,
        company: company.trim() || null,
        classification,
        lead_temp: leadTemp || null,
        last_inquired_property_id: lastInquiredPropertyId,
        referrer: referrer.trim() || null,
        referrer_contact_id: referrerContactId,
        min_budget: minBudget ? Number(minBudget) : null,
        max_budget: maxBudget ? Number(maxBudget) : null,
        no_budget: noBudget,
        areas_of_interest: areasOfInterest,
        property_interests: propertyInterests,
        min_roi: minRoi ? Number(minRoi) : null,
        source: source.trim() || null,
        updated_at: new Date().toISOString(),
      };

      if (isEdit && contactId) {
        const { error } = await supabase
          .from('contacts')
          .update(fieldsToSave)
          .eq('id', contactId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('contacts')
          .insert({
            user_id: user.id,
            account_id: accountId,
            ...fieldsToSave,
            updated_at: undefined, // Let database use its default/trigger for updated_at on insert
          })
          .select('id')
          .single();
        if (error) throw error;
        contactId = data.id;
      }

      // Sync tags
      if (contactId) {
        await supabase
          .from('contact_tags')
          .delete()
          .eq('contact_id', contactId);

        if (selectedTagIds.length > 0) {
          const tagRows = selectedTagIds.map((tag_id) => ({
            contact_id: contactId!,
            tag_id,
          }));
          const { error: tagError } = await supabase
            .from('contact_tags')
            .insert(tagRows);
          if (tagError) throw tagError;
        }
      }

      // Save Notes
      if (contactId) {
        if (recentNoteId) {
          if (notesText.trim()) {
            const { error: noteErr } = await supabase
              .from('contact_notes')
              .update({ note_text: notesText.trim() })
              .eq('id', recentNoteId);
            if (noteErr) throw noteErr;
          } else {
            await supabase
              .from('contact_notes')
              .delete()
              .eq('id', recentNoteId);
          }
        } else if (notesText.trim()) {
          const { error: noteErr } = await supabase
            .from('contact_notes')
            .insert({
              contact_id: contactId,
              user_id: user.id,
              account_id: accountId,
              note_text: notesText.trim(),
            });
          if (noteErr) throw noteErr;
        }
      }

      // Sync properties (only if classification is Buyer/Seller/Agent/Owner)
      if (contactId && ['Buyer', 'Seller', 'Agent', 'Owner'].includes(classification)) {
        await supabase
          .from('properties')
          .update({ owner_contact_id: null })
          .eq('owner_contact_id', contactId);

        if (selectedPropertyIds.length > 0) {
          const { error: propErr } = await supabase
            .from('properties')
            .update({ owner_contact_id: contactId })
            .in('id', selectedPropertyIds);
          if (propErr) throw propErr;
        }
      }
 
      toast.success(isEdit ? 'Contact updated' : 'Contact created');
      onOpenChange(false);
      onSaved();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save contact';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-200 sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white">
            {isEdit ? 'Edit Contact' : 'Add Contact'}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {isEdit
              ? 'Update the contact details below.'
              : 'Fill in the details to create a new contact.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cf-name" className="text-slate-300">
              Name
            </Label>
            <Input
              id="cf-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="John Doe"
              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cf-phone" className="text-slate-300">
              Phone <span className="text-red-400">*</span>
            </Label>
            <Input
              id="cf-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 234 567 8900"
              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
            />
            <p className="text-xs text-slate-500">
              Include country code, e.g. +1 for US
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cf-email" className="text-slate-300">
              Email
            </Label>
            <Input
              id="cf-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="john@example.com"
              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
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
              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
            />
          </div>

          <div className="space-y-2 relative">
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
                className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 pr-16 animate-none"
              />
              {referrerContactId && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] bg-primary/20 text-primary border border-primary/30 px-1.5 py-0.5 rounded font-medium">
                  Linked
                </span>
              )}
            </div>
            
            {showReferrerSuggestions && filteredReferrerContacts.length > 0 && (
              <div className="absolute z-50 w-full mt-1 bg-slate-900 border border-slate-700 rounded-md shadow-lg max-h-48 overflow-y-auto p-1 space-y-0.5">
                <div className="text-[10px] text-slate-500 font-semibold px-2 py-1 border-b border-slate-800 mb-1">
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
                    className="w-full text-left flex items-center justify-between px-2 py-1.5 hover:bg-slate-800 rounded text-xs text-slate-200"
                  >
                    <div>
                      <span className="font-semibold">{c.name || 'Unnamed'}</span>
                      <span className="text-slate-400 ml-1.5 text-[10px]">({c.phone})</span>
                    </div>
                    <span className="text-[10px] bg-slate-800 px-1 py-0.5 rounded text-slate-400 font-bold">
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
              onChange={(e) => setClassification(e.target.value as 'Owner' | 'Seller' | 'Buyer' | 'Agent' | 'Others')}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
            >
              <option value="Others">Others</option>
              <option value="Owner">Owner</option>
              <option value="Seller">Seller</option>
              <option value="Buyer">Buyer</option>
              <option value="Agent">Agent</option>
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
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
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
            <Label htmlFor="cf-lead-temp" className="text-slate-300">
              Lead Temperature / Status
            </Label>
            <select
              id="cf-lead-temp"
              value={leadTemp}
              onChange={(e) => setLeadTemp(e.target.value as 'HOT' | 'COLD' | 'Not Responding' | 'Dead' | '')}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
            >
              <option value="">None</option>
              <option value="HOT">🔥 HOT</option>
              <option value="COLD">❄️ COLD</option>
              <option value="Not Responding">⏳ Not Responding</option>
              <option value="Dead">💀 Dead</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cf-inquired-property" className="text-slate-300">
              Shown Interest / Inquired Property
            </Label>
            <select
              id="cf-inquired-property"
              value={lastInquiredPropertyId || ''}
              onChange={(e) => setLastInquiredPropertyId(e.target.value || null)}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
            >
              <option value="">None</option>
              {propertiesList.map((prop) => (
                <option key={prop.id} value={prop.id}>
                  {prop.property_code ? `[${prop.property_code}] ` : ''}{prop.title}
                </option>
              ))}
            </select>
          </div>

          {/* Real Estate Preferences */}
          {classification === 'Buyer' && (
            <div className="border-t border-slate-800 pt-4 mt-2 space-y-4">
              <h4 className="text-sm font-bold text-white tracking-wide uppercase">Real Estate Preferences</h4>

              {/* Budget Fields */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-slate-300">Budget Range (INR)</Label>
                  <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer select-none">
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
                      className="rounded border-slate-750 bg-slate-800 text-primary focus:ring-primary/40 h-3.5 w-3.5"
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
                      className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-8 text-xs disabled:opacity-40"
                    />
                    {minBudget && (
                      <span className="text-[10px] text-primary font-semibold block">{formatPriceLabel(minBudget)}</span>
                    )}
                  </div>
                  <div className="space-y-1">
                    <Input
                      type="number"
                      disabled={noBudget}
                      value={maxBudget}
                      onChange={(e) => setMaxBudget(e.target.value)}
                      placeholder="Max Budget"
                      className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-8 text-xs disabled:opacity-40"
                    />
                    {maxBudget && (
                      <span className="text-[10px] text-primary font-semibold block">{formatPriceLabel(maxBudget)}</span>
                    )}
                  </div>
                </div>
              </div>

              {/* ROI Preference Field */}
              <div className="space-y-2">
                <Label htmlFor="cf-min-roi" className="text-slate-300">Expected Min ROI (%)</Label>
                <Input
                  id="cf-min-roi"
                  type="number"
                  step="0.01"
                  value={minRoi}
                  onChange={(e) => setMinRoi(e.target.value)}
                  placeholder="e.g. 4.5"
                  className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-8.5 text-xs focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-0"
                />
              </div>

              {/* Areas of Interest */}
              <div className="space-y-2">
                <Label className="text-slate-300">Areas of Interest</Label>
                
                <div className="relative">
                  <Input
                    value={areasText}
                    onChange={(e) => {
                      ensureLocalitiesLoaded();
                      handleAreasTextChange(e.target.value);
                    }}
                    onFocus={() => {
                      ensureLocalitiesLoaded();
                      setIsFocused(true);
                    }}
                    onBlur={() => {
                      // Slight delay to allow clicking on dropdown items
                      setTimeout(() => setIsFocused(false), 200);
                    }}
                    placeholder="Type area (e.g. Whitefield, Koramangala)..."
                    className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-8 text-xs w-full focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-0"
                  />

                  {isFocused && matchingSublocalities.length > 0 && (
                    <div 
                      className="absolute z-50 w-full mt-1 bg-slate-900 border border-slate-700 rounded-md shadow-lg max-h-48 overflow-y-auto p-1 space-y-0.5"
                      onMouseDown={(e) => {
                        // Prevent input blur so checks can be toggled without losing focus
                        e.preventDefault();
                      }}
                    >
                      <div className="text-[10px] text-slate-500 font-semibold px-2 py-1 border-b border-slate-850 mb-1">
                        Matching Sublocalities:
                      </div>
                      {matchingSublocalities.map((area) => {
                        const isChecked = areasOfInterest.includes(area);
                        return (
                          <label
                            key={area}
                            className="flex items-center gap-2 px-2 py-1 hover:bg-slate-800 rounded text-xs text-slate-200 cursor-pointer select-none"
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => handleToggleArea(area)}
                              className="rounded border-slate-700 bg-slate-800 text-primary focus:ring-0 focus:ring-offset-0 size-3.5"
                            />
                            <span>{area}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Suggestions Bank */}
                <div className="flex flex-wrap gap-1 pt-1.5">
                  <span className="text-[10px] text-slate-500 font-semibold w-full">Quick Add Suggestions:</span>
                  {SUGGESTED_AREAS.map(area => {
                    const exists = areasOfInterest.includes(area);
                    return (
                      <button
                        key={area}
                        type="button"
                        disabled={exists}
                        onClick={() => handleAddSuggestion(area)}
                        className="text-[10px] px-2 py-0.5 rounded border border-slate-800 bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-200 disabled:opacity-30 disabled:hover:bg-slate-900 disabled:hover:text-slate-400"
                      >
                        +{area}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Property Interests Checklist */}
              <div className="space-y-2">
                <Label className="text-slate-300">Property Category Interests</Label>
                <div className="grid grid-cols-1 gap-2 bg-slate-950/20 border border-slate-800/80 rounded-lg p-3">
                  {PROPERTY_INTEREST_OPTIONS.map(option => {
                    const checked = propertyInterests.includes(option);
                    return (
                      <label key={option} className="flex items-start gap-2.5 text-xs text-slate-300 cursor-pointer select-none hover:text-white">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setPropertyInterests(prev => [...prev, option]);
                            } else {
                              setPropertyInterests(prev => prev.filter(o => o !== option));
                            }
                          }}
                          className="rounded border-slate-700 bg-slate-800 text-primary focus:ring-primary/40 mt-0.5 h-3.5 w-3.5 cursor-pointer"
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
              <div className="flex items-center gap-2 text-slate-500 text-sm">
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
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors cursor-pointer ${
                        selected
                          ? 'ring-2 ring-primary ring-offset-1 ring-offset-slate-900'
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
              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 min-h-[80px] text-xs resize-y"
            />
          </div>

          {/* Properties Association checklist */}
          {['Buyer', 'Seller', 'Agent', 'Owner'].includes(classification) && (
            <div className="space-y-2 border-t border-slate-800 pt-4">
              <Label className="text-slate-350">Associated Properties</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-slate-500" />
                <Input
                  value={propertySearch}
                  onChange={(e) => setPropertySearch(e.target.value)}
                  placeholder="Search properties to link..."
                  className="pl-8 bg-slate-800 border-slate-700 text-xs h-8 text-white placeholder:text-slate-500 focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-0"
                />
              </div>
              <div className="max-h-40 overflow-y-auto border border-slate-800 bg-slate-950/20 rounded-lg p-2.5 space-y-1.5 mt-2">
                {loadingProperties ? (
                  <div className="flex items-center justify-center py-4 text-xs text-slate-500 gap-1.5">
                    <Loader2 className="size-3 animate-spin text-primary" />
                    Loading properties...
                  </div>
                ) : filteredProperties.length === 0 ? (
                  <p className="text-[11px] text-slate-500 text-center py-4">No matching properties found.</p>
                ) : (
                  filteredProperties.map((prop) => {
                    const checked = selectedPropertyIds.includes(prop.id);
                    return (
                      <label
                        key={prop.id}
                        className="flex items-start gap-2.5 text-xs text-slate-300 cursor-pointer select-none hover:text-white hover:bg-slate-850/40 p-1.5 rounded"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedPropertyIds((prev) => [...prev, prop.id]);
                            } else {
                              setSelectedPropertyIds((prev) => prev.filter((id) => id !== prop.id));
                            }
                          }}
                          className="rounded border-slate-700 bg-slate-800 text-primary focus:ring-primary/40 mt-0.5 h-3.5 w-3.5 cursor-pointer"
                        />
                        <div className="min-w-0 flex-1">
                          <span className="font-semibold text-slate-200 block truncate">{prop.title}</span>
                          <span className="text-[10px] text-slate-500 block truncate text-left">
                            {prop.location} • {prop.price >= 10000000 
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
 
          <DialogFooter className="bg-slate-900 border-slate-700">
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
