'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import type { Contact, Tag, ContactNote, CustomField, Deal } from '@/types';
import { POPULAR_SUBLOCALITIES } from '@/lib/data/real-estate-data';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Phone,
  Mail,
  Building2,
  Copy,
  Check,
  Loader2,
  Plus,
  Trash2,
  Save,
  DollarSign,
  MessageSquare,
} from 'lucide-react';

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

interface ContactDetailViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string | null;
  onUpdated: () => void;
}

export function ContactDetailView({
  open,
  onOpenChange,
  contactId,
  onUpdated,
}: ContactDetailViewProps) {
  const supabase = createClient();
  const { user, accountId } = useAuth();
  const router = useRouter();

  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedPhone, setCopiedPhone] = useState(false);

  // Details tab
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editCompany, setEditCompany] = useState('');
  const [editClassification, setEditClassification] = useState<'Owner' | 'Seller' | 'Buyer' | 'Agent' | 'Others'>('Others');
  const [savingDetails, setSavingDetails] = useState(false);
  const [approving, setApproving] = useState(false);

  // Real estate preferences
  const [editMinBudget, setEditMinBudget] = useState('');
  const [editMaxBudget, setEditMaxBudget] = useState('');
  const [editNoBudget, setEditNoBudget] = useState(false);
  const [editAreasOfInterest, setEditAreasOfInterest] = useState<string[]>([]);
  const [editAreasText, setEditAreasText] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [editPropertyInterests, setEditPropertyInterests] = useState<string[]>([]);
  const [localitiesDb, setLocalitiesDb] = useState<{ major: string[] } | null>(null);

  async function ensureLocalitiesLoaded() {
    if (!localitiesDb) {
      const db = await import('@/lib/data/bengaluru-localities');
      setLocalitiesDb({ major: db.getMajorAreas() });
    }
  }
  const [savingPreferences, setSavingPreferences] = useState(false);

  // Tags tab
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [contactTagIds, setContactTagIds] = useState<string[]>([]);
  const [savingTags, setSavingTags] = useState(false);

  // Notes tab
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [newNote, setNewNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [loadingNotes, setLoadingNotes] = useState(false);

  // Custom fields tab
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [savingCustom, setSavingCustom] = useState(false);
  const [loadingCustom, setLoadingCustom] = useState(false);

  // Deals tab
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loadingDeals, setLoadingDeals] = useState(false);

  const fetchContact = useCallback(async () => {
    if (!contactId) return;
    setLoading(true);

    const { data } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', contactId)
      .single();

    if (data) {
      setContact(data);
      setEditName(data.name ?? '');
      setEditPhone(data.phone);
      setEditEmail(data.email ?? '');
      setEditCompany(data.company ?? '');
      setEditClassification((data as Contact).classification ?? 'Others');
      setEditMinBudget(data.min_budget ? String(data.min_budget) : '');
      setEditMaxBudget(data.max_budget ? String(data.max_budget) : '');
      setEditNoBudget(!!data.no_budget);
      const initialAreas = data.areas_of_interest ?? [];
      setEditAreasOfInterest(initialAreas);
      setEditAreasText(initialAreas.join(', ') + (initialAreas.length > 0 ? ', ' : ''));
      setEditPropertyInterests(data.property_interests ?? []);
    }
    setLoading(false);
  }, [contactId, supabase]);

  const fetchTags = useCallback(async () => {
    if (!contactId) return;

    const [tagsRes, contactTagsRes] = await Promise.all([
      supabase.from('tags').select('*').order('name'),
      supabase.from('contact_tags').select('tag_id').eq('contact_id', contactId),
    ]);

    if (tagsRes.data) setAllTags(tagsRes.data);
    if (contactTagsRes.data) {
      setContactTagIds(contactTagsRes.data.map((ct) => ct.tag_id));
    }
  }, [contactId, supabase]);

  const fetchNotes = useCallback(async () => {
    if (!contactId) return;
    setLoadingNotes(true);

    const { data } = await supabase
      .from('contact_notes')
      .select('*')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false });

    if (data) setNotes(data);
    setLoadingNotes(false);
  }, [contactId, supabase]);

  const fetchCustomFields = useCallback(async () => {
    if (!contactId) return;
    setLoadingCustom(true);

    const [fieldsRes, valuesRes] = await Promise.all([
      supabase.from('custom_fields').select('*').order('field_name'),
      supabase
        .from('contact_custom_values')
        .select('*')
        .eq('contact_id', contactId),
    ]);

    if (fieldsRes.data) setCustomFields(fieldsRes.data);
    if (valuesRes.data) {
      const map: Record<string, string> = {};
      valuesRes.data.forEach((v) => {
        map[v.custom_field_id] = v.value ?? '';
      });
      setCustomValues(map);
    }
    setLoadingCustom(false);
  }, [contactId, supabase]);

  const fetchDeals = useCallback(async () => {
    if (!contactId) return;
    setLoadingDeals(true);
    const { data } = await supabase
      .from('deals')
      .select('*, stage:pipeline_stages(*)')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false });
    setDeals((data ?? []) as Deal[]);
    setLoadingDeals(false);
  }, [contactId, supabase]);

  useEffect(() => {
    if (open && contactId) {
      fetchContact();
      fetchTags();
      fetchNotes();
      fetchCustomFields();
      fetchDeals();
    }
  }, [open, contactId, fetchContact, fetchTags, fetchNotes, fetchCustomFields, fetchDeals]);

  async function copyPhone() {
    if (!contact) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopiedPhone(true);
    setTimeout(() => setCopiedPhone(false), 2000);
  }

  async function handleWhatsAppClick() {
    if (!contact || !accountId) {
      toast.error('Account not loaded or contact not loaded');
      return;
    }

    try {
      const { data: existing, error } = await supabase
        .from('conversations')
        .select('id')
        .eq('account_id', accountId)
        .eq('contact_id', contact.id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.error('Error finding conversation:', error);
      }

      if (existing) {
        router.push(`/inbox?c=${existing.id}`);
        return;
      }

      const { data: newConv, error: createError } = await supabase
        .from('conversations')
        .insert({
          account_id: accountId,
          user_id: user?.id,
          contact_id: contact.id,
        })
        .select('id')
        .single();

      if (createError) {
        toast.error('Failed to start chat thread');
        console.error('Create conversation error:', createError);
        return;
      }

      router.push(`/inbox?c=${newConv.id}`);
    } catch (err) {
      console.error('WhatsApp redirect error:', err);
      toast.error('Something went wrong');
    }
  }

  async function saveDetails() {
    if (!contactId || !editPhone.trim()) {
      toast.error('Phone number is required');
      return;
    }

    setSavingDetails(true);
    const { error } = await supabase
      .from('contacts')
      .update({
        name: editName.trim() || null,
        phone: editPhone.trim(),
        email: editEmail.trim() || null,
        company: editCompany.trim() || null,
        classification: editClassification,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contactId);

    if (error) {
      toast.error('Failed to update contact');
    } else {
      toast.success('Contact updated');
      fetchContact();
      onUpdated();
    }
    setSavingDetails(false);
  }

  async function approveContact() {
    if (!contactId) return;
    setApproving(true);
    try {
      const { error } = await supabase
        .from('contacts')
        .update({
          status: 'active',
          updated_at: new Date().toISOString()
        })
        .eq('id', contactId);

      if (error) throw error;

      toast.success('Contact approved and added to CRM!');
      fetchContact();
      onUpdated();
    } catch (err) {
      console.error('Failed to approve contact:', err);
      toast.error('Failed to approve contact');
    } finally {
      setApproving(false);
    }
  }

  const activeQuery = useMemo(() => {
    const segments = editAreasText.split(',');
    return segments.length > 0 ? segments[segments.length - 1].trim() : '';
  }, [editAreasText]);

  const matchingSublocalities = useMemo(() => {
    if (!activeQuery) return [];
    const dataset = localitiesDb?.major || POPULAR_SUBLOCALITIES;
    return dataset.filter(area =>
      area.toLowerCase().includes(activeQuery.toLowerCase())
    ).slice(0, 10);
  }, [activeQuery, localitiesDb]);

  function handleAreasTextChange(val: string) {
    setEditAreasText(val);
    const parsed = val.split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    const unique = Array.from(new Set(parsed));
    setEditAreasOfInterest(unique);
  }

  function handleToggleArea(area: string) {
    const isChecked = editAreasOfInterest.includes(area);
    let updated: string[];
    if (isChecked) {
      updated = editAreasOfInterest.filter(a => a !== area);
    } else {
      const cleanList = editAreasOfInterest.filter(a => a.toLowerCase() !== activeQuery.toLowerCase());
      updated = [...cleanList, area];
    }
    setEditAreasOfInterest(updated);
    setEditAreasText(updated.join(', ') + (updated.length > 0 ? ', ' : ''));
  }

  function handleAddSuggestion(area: string) {
    if (!editAreasOfInterest.includes(area)) {
      const updated = [...editAreasOfInterest, area];
      setEditAreasOfInterest(updated);
      setEditAreasText(updated.join(', ') + (updated.length > 0 ? ', ' : ''));
    }
  }

  async function savePreferences() {
    if (!contactId) return;
    setSavingPreferences(true);

    const { error } = await supabase
      .from('contacts')
      .update({
        min_budget: editMinBudget ? Number(editMinBudget) : null,
        max_budget: editMaxBudget ? Number(editMaxBudget) : null,
        no_budget: editNoBudget,
        areas_of_interest: editAreasOfInterest,
        property_interests: editPropertyInterests,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contactId);

    if (error) {
      toast.error('Failed to update preferences');
    } else {
      toast.success('Real estate preferences updated');
      fetchContact();
      onUpdated();
    }
    setSavingPreferences(false);
  }

  async function toggleTag(tagId: string) {
    if (!contactId) return;
    setSavingTags(true);

    const isSelected = contactTagIds.includes(tagId);

    if (isSelected) {
      const { error } = await supabase
        .from('contact_tags')
        .delete()
        .eq('contact_id', contactId)
        .eq('tag_id', tagId);
      if (!error) {
        setContactTagIds((prev) => prev.filter((id) => id !== tagId));
        onUpdated();
      }
    } else {
      const { error } = await supabase
        .from('contact_tags')
        .insert({ contact_id: contactId, tag_id: tagId });
      if (!error) {
        setContactTagIds((prev) => [...prev, tagId]);
        onUpdated();
      }
    }
    setSavingTags(false);
  }

  async function addNote() {
    if (!contactId || !newNote.trim()) return;
    setSavingNote(true);

    if (!user || !accountId) {
      toast.error('Not authenticated or account not loaded');
      setSavingNote(false);
      return;
    }

    const { error } = await supabase.from('contact_notes').insert({
      contact_id: contactId,
      user_id: user.id,
      account_id: accountId,
      note_text: newNote.trim(),
    });

    if (error) {
      toast.error('Failed to add note');
    } else {
      setNewNote('');
      fetchNotes();
      toast.success('Note added');
    }
    setSavingNote(false);
  }

  async function deleteNote(noteId: string) {
    const { error } = await supabase
      .from('contact_notes')
      .delete()
      .eq('id', noteId);

    if (error) {
      toast.error('Failed to delete note');
    } else {
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      toast.success('Note deleted');
    }
  }

  async function saveCustomFields() {
    if (!contactId) return;
    setSavingCustom(true);

    try {
      // Delete existing values and re-insert
      await supabase
        .from('contact_custom_values')
        .delete()
        .eq('contact_id', contactId);

      const rows = Object.entries(customValues)
        .filter(([, val]) => val.trim())
        .map(([fieldId, val]) => ({
          contact_id: contactId,
          custom_field_id: fieldId,
          value: val.trim(),
        }));

      if (rows.length > 0) {
        const { error } = await supabase
          .from('contact_custom_values')
          .insert(rows);
        if (error) throw error;
      }

      toast.success('Custom fields saved');
    } catch {
      toast.error('Failed to save custom fields');
    }
    setSavingCustom(false);
  }

  function getInitials(name?: string | null) {
    if (!name) return '?';
    return name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="bg-slate-900 border-slate-700 text-slate-200 sm:max-w-lg w-full p-0"
      >
        {loading || !contact ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="flex flex-col h-full">
            {/* Header */}
            <SheetHeader className="p-4 border-b border-slate-700/50">
              <div className="flex items-center gap-3">
                <Avatar className="size-12 bg-slate-800 border border-slate-700">
                  <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
                    {getInitials(contact.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <SheetTitle className="text-white truncate">
                    {contact.name || 'Unknown'}
                  </SheetTitle>
                  <SheetDescription className="text-slate-400 text-xs mt-0.5">
                    Contact details
                  </SheetDescription>
                  <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-slate-400">
                    <a
                      href={`tel:${contact.phone}`}
                      className="flex items-center gap-1 hover:text-primary transition-colors cursor-pointer text-slate-300"
                    >
                      <Phone className="size-3" />
                      {contact.phone}
                    </a>
                    <button
                      onClick={copyPhone}
                      className="flex items-center gap-1 hover:text-primary transition-colors cursor-pointer"
                      title="Copy phone number"
                    >
                      {copiedPhone ? (
                        <Check className="size-3 text-primary" />
                      ) : (
                        <Copy className="size-3" />
                      )}
                    </button>
                    <button
                      onClick={handleWhatsAppClick}
                      className="flex items-center gap-1.5 text-emerald-400 hover:text-emerald-350 hover:bg-emerald-500/10 border border-emerald-500/20 rounded-md px-2 py-0.5 transition-all cursor-pointer font-medium"
                    >
                      <MessageSquare className="size-3 text-emerald-400 fill-current" />
                      WhatsApp Chat
                    </button>
                    {contact.email && (
                      <span className="flex items-center gap-1">
                        <Mail className="size-3" />
                        {contact.email}
                      </span>
                    )}
                    {contact.company && (
                      <span className="flex items-center gap-1">
                        <Building2 className="size-3" />
                        {contact.company}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </SheetHeader>

            {/* Review Status Banner */}
            {contact.status === 'pending_review' && (
              <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2.5 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400 border border-amber-500/20 animate-pulse">
                    Needs Review
                  </span>
                  <span className="text-xs text-amber-300">
                    Added from {contact.company || 'External Source'}. Please verify details.
                  </span>
                </div>
                <Button
                  size="sm"
                  onClick={approveContact}
                  disabled={approving}
                  className="bg-amber-500 hover:bg-amber-600 disabled:bg-amber-500/50 text-slate-950 font-bold text-xs py-1 h-7 rounded px-3 cursor-pointer flex items-center gap-1"
                >
                  {approving && <Loader2 className="size-3 animate-spin" />}
                  Approve
                </Button>
              </div>
            )}

            {/* Tabs */}
            <Tabs defaultValue="details" className="flex-1 flex flex-col min-h-0">
              <TabsList className="bg-slate-800/50 border-b border-slate-700 mx-4 mt-3 overflow-x-auto flex-nowrap scrollbar-none justify-start">
                <TabsTrigger
                  value="details"
                  className="data-active:bg-slate-800 data-active:text-primary text-slate-400"
                >
                  Details
                </TabsTrigger>
                <TabsTrigger
                  value="preferences"
                  className="data-active:bg-slate-800 data-active:text-primary text-slate-400"
                >
                  Preferences
                </TabsTrigger>
                <TabsTrigger
                  value="tags"
                  className="data-active:bg-slate-800 data-active:text-primary text-slate-400"
                >
                  Tags
                </TabsTrigger>
                <TabsTrigger
                  value="notes"
                  className="data-active:bg-slate-800 data-active:text-primary text-slate-400"
                >
                  Notes
                </TabsTrigger>
                <TabsTrigger
                  value="custom"
                  className="data-active:bg-slate-800 data-active:text-primary text-slate-400"
                >
                  Custom Fields
                </TabsTrigger>
                <TabsTrigger
                  value="deals"
                  className="data-active:bg-slate-800 data-active:text-primary text-slate-400"
                >
                  Deals
                </TabsTrigger>
              </TabsList>

              {/* Details Tab */}
              <TabsContent value="details" className="flex-1 overflow-y-auto px-4 py-3">
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-slate-400 text-xs">Name</Label>
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="bg-slate-800 border-slate-700 text-white h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-slate-400 text-xs">
                      Phone <span className="text-red-400">*</span>
                    </Label>
                    <Input
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      className="bg-slate-800 border-slate-700 text-white h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-slate-400 text-xs">Email</Label>
                    <Input
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      className="bg-slate-800 border-slate-700 text-white h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-slate-400 text-xs">Company</Label>
                    <Input
                      value={editCompany}
                      onChange={(e) => setEditCompany(e.target.value)}
                      className="bg-slate-800 border-slate-700 text-white h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-slate-400 text-xs">Classification</Label>
                    <select
                      value={editClassification}
                      onChange={(e) => setEditClassification(e.target.value as 'Owner' | 'Seller' | 'Buyer' | 'Agent' | 'Others')}
                      className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-white focus:border-primary focus:outline-none"
                    >
                      <option value="Others">Others</option>
                      <option value="Owner">Owner</option>
                      <option value="Seller">Seller</option>
                      <option value="Buyer">Buyer</option>
                      <option value="Agent">Agent</option>
                    </select>
                  </div>
                  <Button
                    onClick={saveDetails}
                    disabled={savingDetails}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground w-full"
                    size="sm"
                  >
                    {savingDetails ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Save className="size-3.5" />
                    )}
                    Save Changes
                  </Button>
                </div>
              </TabsContent>

              {/* Preferences Tab */}
              <TabsContent value="preferences" className="flex-1 overflow-y-auto px-4 py-3">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-slate-400 text-xs font-semibold">Budget Range (INR)</Label>
                      <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={editNoBudget}
                          onChange={(e) => {
                            setEditNoBudget(e.target.checked);
                            if (e.target.checked) {
                              setEditMinBudget('');
                              setEditMaxBudget('');
                            }
                          }}
                          className="rounded border-slate-750 bg-slate-800 text-primary focus:ring-primary/40 h-3.5 w-3.5"
                        />
                        No Budget Limit
                      </label>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-[10px] text-slate-500">Min Budget</Label>
                        <Input
                          type="number"
                          disabled={editNoBudget}
                          value={editMinBudget}
                          onChange={(e) => setEditMinBudget(e.target.value)}
                          placeholder="Min Budget"
                          className="bg-slate-800 border-slate-700 text-white h-8 text-xs disabled:opacity-40"
                        />
                        {editMinBudget && (
                          <span className="text-[10px] text-primary font-semibold block">{formatPriceLabel(editMinBudget)}</span>
                        )}
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-slate-500">Max Budget</Label>
                        <Input
                          type="number"
                          disabled={editNoBudget}
                          value={editMaxBudget}
                          onChange={(e) => setEditMaxBudget(e.target.value)}
                          placeholder="Max Budget"
                          className="bg-slate-800 border-slate-700 text-white h-8 text-xs disabled:opacity-40"
                        />
                        {editMaxBudget && (
                          <span className="text-[10px] text-primary font-semibold block">{formatPriceLabel(editMaxBudget)}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Areas of Interest */}
                  <div className="space-y-2">
                    <Label className="text-slate-400 text-xs font-semibold">Areas of Interest</Label>
                    
                    <div className="relative">
                      <Input
                        value={editAreasText}
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
                            const isChecked = editAreasOfInterest.includes(area);
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
                        const exists = editAreasOfInterest.includes(area);
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

                  {/* Property Category Interests */}
                  <div className="space-y-2">
                    <Label className="text-slate-400 text-xs font-semibold">Property Category Interests</Label>
                    <div className="grid grid-cols-1 gap-2 bg-slate-950/20 border border-slate-800/80 rounded-lg p-3">
                      {PROPERTY_INTEREST_OPTIONS.map(option => {
                        const checked = editPropertyInterests.includes(option);
                        return (
                          <label key={option} className="flex items-start gap-2.5 text-xs text-slate-350 cursor-pointer select-none hover:text-white">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setEditPropertyInterests(prev => [...prev, option]);
                                } else {
                                  setEditPropertyInterests(prev => prev.filter(o => o !== option));
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

                  <Button
                    onClick={savePreferences}
                    disabled={savingPreferences}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground w-full mt-2"
                    size="sm"
                  >
                    {savingPreferences ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Save className="size-3.5" />
                    )}
                    Save Preferences
                  </Button>
                </div>
              </TabsContent>

              {/* Tags Tab */}
              <TabsContent value="tags" className="flex-1 overflow-y-auto px-4 py-3">
                <div className="space-y-3">
                  <p className="text-xs text-slate-400">
                    Click a tag to add or remove it from this contact.
                  </p>
                  {allTags.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      No tags available. Create tags in Settings.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {allTags.map((tag) => {
                        const selected = contactTagIds.includes(tag.id);
                        return (
                          <button
                            key={tag.id}
                            onClick={() => toggleTag(tag.id)}
                            disabled={savingTags}
                            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-all cursor-pointer ${
                              selected
                                ? 'ring-2 ring-primary ring-offset-1 ring-offset-slate-900'
                                : 'opacity-50 hover:opacity-80'
                            }`}
                            style={{
                              backgroundColor: tag.color + '20',
                              color: tag.color,
                            }}
                          >
                            {selected && <Check className="size-3 mr-1" />}
                            {tag.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* Notes Tab */}
              <TabsContent value="notes" className="flex-1 flex flex-col min-h-0 px-4 py-3">
                <div className="space-y-2 mb-3">
                  <Textarea
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder="Write a note..."
                    className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 min-h-[60px] text-sm resize-none"
                  />
                  <Button
                    onClick={addNote}
                    disabled={!newNote.trim() || savingNote}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground"
                    size="sm"
                  >
                    {savingNote ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Plus className="size-3.5" />
                    )}
                    Add Note
                  </Button>
                </div>

                <div className="flex-1 overflow-y-auto space-y-2">
                  {loadingNotes ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="size-5 animate-spin text-slate-500" />
                    </div>
                  ) : notes.length === 0 ? (
                    <p className="text-sm text-slate-500 text-center py-8">
                      No notes yet.
                    </p>
                  ) : (
                    notes.map((note) => (
                      <div
                        key={note.id}
                        className="rounded-lg bg-slate-800/50 border border-slate-700/50 p-3 group"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm text-slate-300 whitespace-pre-wrap flex-1">
                            {note.note_text}
                          </p>
                          <button
                            onClick={() => deleteNote(note.id)}
                            className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-all cursor-pointer shrink-0"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                        <p className="text-xs text-slate-500 mt-1.5">
                          {new Date(note.created_at).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </TabsContent>

              {/* Custom Fields Tab */}
              <TabsContent value="custom" className="flex-1 overflow-y-auto px-4 py-3">
                {loadingCustom ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="size-5 animate-spin text-slate-500" />
                  </div>
                ) : customFields.length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-8">
                    No custom fields defined. Create them in Settings.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {customFields.map((field) => (
                      <div key={field.id} className="space-y-1.5">
                        <Label className="text-slate-400 text-xs capitalize">
                          {field.field_name}
                        </Label>
                        <Input
                          value={customValues[field.id] ?? ''}
                          onChange={(e) =>
                            setCustomValues((prev) => ({
                              ...prev,
                              [field.id]: e.target.value,
                            }))
                          }
                          placeholder={`Enter ${field.field_name}...`}
                          className="bg-slate-800 border-slate-700 text-white h-8 text-sm placeholder:text-slate-500"
                        />
                      </div>
                    ))}
                    <Button
                      onClick={saveCustomFields}
                      disabled={savingCustom}
                      className="bg-primary hover:bg-primary/90 text-primary-foreground w-full"
                      size="sm"
                    >
                      {savingCustom ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Save className="size-3.5" />
                      )}
                      Save Custom Fields
                    </Button>
                  </div>
                )}
              </TabsContent>

              {/* Deals Tab */}
              <TabsContent value="deals" className="flex-1 overflow-y-auto px-4 py-3">
                {loadingDeals ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="size-5 animate-spin text-primary" />
                  </div>
                ) : deals.length === 0 ? (
                  <p className="text-xs text-slate-500">No deals yet</p>
                ) : (
                  <div className="space-y-2">
                    {deals.map((deal) => (
                      <div
                        key={deal.id}
                        className="rounded-lg border border-slate-700 bg-slate-800/50 p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-white">
                            {deal.title}
                          </p>
                          {deal.stage && (
                            <span
                              className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                              style={{
                                backgroundColor: `${deal.stage.color}20`,
                                color: deal.stage.color,
                              }}
                            >
                              {deal.stage.name}
                            </span>
                          )}
                        </div>
                        <div className="mt-1.5 flex items-center justify-between text-xs text-slate-400">
                          <span className="flex items-center gap-1">
                            <DollarSign className="size-3" />
                            {new Intl.NumberFormat('en-US', {
                              style: 'currency',
                              currency: deal.currency || 'USD',
                              maximumFractionDigits: 0,
                            }).format(Number(deal.value || 0))}
                          </span>
                          {deal.status && deal.status !== 'open' && (
                            <span
                              className={
                                deal.status === 'won'
                                  ? 'text-primary'
                                  : 'text-red-400'
                              }
                            >
                              {deal.status}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
