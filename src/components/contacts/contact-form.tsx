'use client';

import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import type { Contact, Tag, ContactTag } from '@/types';
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
import { Loader2 } from 'lucide-react';

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
  const [saving, setSaving] = useState(false);

  // Real estate preferences
  const [minBudget, setMinBudget] = useState('');
  const [maxBudget, setMaxBudget] = useState('');
  const [noBudget, setNoBudget] = useState(false);
  const [areasOfInterest, setAreasOfInterest] = useState<string[]>([]);
  const [areasText, setAreasText] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [propertyInterests, setPropertyInterests] = useState<string[]>([]);
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

  useEffect(() => {
    if (open) {
      setName(contact?.name ?? '');
      setPhone(contact?.phone ?? '');
      setEmail(contact?.email ?? '');
      setCompany(contact?.company ?? '');
      setClassification((contact as any)?.classification ?? 'Others');
      setMinBudget(contact?.min_budget ? String(contact.min_budget) : '');
      setMaxBudget(contact?.max_budget ? String(contact.max_budget) : '');
      setNoBudget(!!contact?.no_budget);
      const initialAreas = contact?.areas_of_interest ?? [];
      setAreasOfInterest(initialAreas);
      setAreasText(initialAreas.join(', ') + (initialAreas.length > 0 ? ', ' : ''));
      setPropertyInterests(contact?.property_interests ?? []);
      setSelectedTagIds(contactTags.map((ct) => ct.tag_id));
      fetchTags();
    }
  }, [open, contact]);

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

  async function fetchTags() {
    setLoadingTags(true);
    const { data } = await supabase
      .from('tags')
      .select('*')
      .order('name');
    if (data) setTags(data);
    setLoadingTags(false);
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
        min_budget: minBudget ? Number(minBudget) : null,
        max_budget: maxBudget ? Number(maxBudget) : null,
        no_budget: noBudget,
        areas_of_interest: areasOfInterest,
        property_interests: propertyInterests,
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

          <div className="space-y-2">
            <Label htmlFor="cf-classification" className="text-slate-300">
              Classification
            </Label>
            <select
              id="cf-classification"
              value={classification}
              onChange={(e) => setClassification(e.target.value as any)}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
            >
              <option value="Others">Others</option>
              <option value="Owner">Owner</option>
              <option value="Seller">Seller</option>
              <option value="Buyer">Buyer</option>
              <option value="Agent">Agent</option>
            </select>
          </div>

          {/* Real Estate Preferences */}
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
