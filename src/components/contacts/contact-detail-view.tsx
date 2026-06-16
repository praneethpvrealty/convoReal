'use client';

import { useState, useEffect, useCallback, useMemo, createElement } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import type { Contact, Tag, ContactNote, CustomField, Deal, Property } from '@/types';
import { POPULAR_SUBLOCALITIES } from '@/lib/data/real-estate-data';
import { PropertyForm } from '@/components/inventory/property-form';
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
  MessageSquare,
  Users,
  Building,
  Unlink,
  Edit,
} from 'lucide-react';
import { getCurrencyIcon } from '@/lib/currency-utils';

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

  const [currency, setCurrency] = useState('INR');
  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedPhone, setCopiedPhone] = useState(false);

  // Details tab
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editCompany, setEditCompany] = useState('');
  const [editSource, setEditSource] = useState('');

  const fetchCurrency = useCallback(async () => {
    try {
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
  }, [supabase]);
  const [editClassification, setEditClassification] = useState<'Owner' | 'Seller' | 'Buyer' | 'Agent' | 'Others'>('Others');
  const [editLeadTemp, setEditLeadTemp] = useState<'HOT' | 'COLD' | 'Not Responding' | 'Dead' | ''>('');
  const [editLastInquiredPropertyId, setEditLastInquiredPropertyId] = useState<string | null>(null);
  const [allProperties, setAllProperties] = useState<Property[]>([]);
  const [editReferrer, setEditReferrer] = useState('');
  const [editReferrerContactId, setEditReferrerContactId] = useState<string | null>(null);
  const [showReferrerSuggestions, setShowReferrerSuggestions] = useState(false);
  const [contactsList, setContactsList] = useState<Contact[]>([]);
  const [savingDetails, setSavingDetails] = useState(false);
  const [approving, setApproving] = useState(false);
  const [inquiredProperty, setInquiredProperty] = useState<Property | null>(null);
  const [sendDetailsOnApprove, setSendDetailsOnApprove] = useState(true);

  // Requirements for Agent/Owner/Seller/etc
  const [editRequirements, setEditRequirements] = useState('');

  // Associated Properties for Owner/Seller/Agent
  const [associatedProperties, setAssociatedProperties] = useState<Property[]>([]);
  const [loadingProperties, setLoadingProperties] = useState(false);
  const [propertyFormOpen, setPropertyFormOpen] = useState(false);
  const [selectedPropertyForEdit, setSelectedPropertyForEdit] = useState<Property | null>(null);

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

  const fetchAllProperties = useCallback(async () => {
    const { data } = await supabase
      .from('properties')
      .select('*')
      .order('title');
    if (data) setAllProperties(data);
  }, [supabase]);


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
      setEditSource(data.source ?? '');
      setEditClassification((data as Contact).classification ?? 'Others');
      setEditLeadTemp((data as Contact).lead_temp ?? '');
      setEditLastInquiredPropertyId(data.last_inquired_property_id ?? null);
      setEditReferrer(data.referrer ?? '');
      setEditReferrerContactId(data.referrer_contact_id ?? null);
      setEditRequirements(data.requirements ?? '');
      setEditMinBudget(data.min_budget ? String(data.min_budget) : '');
      setEditMaxBudget(data.max_budget ? String(data.max_budget) : '');
      setEditNoBudget(!!data.no_budget);
      const initialAreas = data.areas_of_interest ?? [];
      setEditAreasOfInterest(initialAreas);
      setEditAreasText(initialAreas.join(', ') + (initialAreas.length > 0 ? ', ' : ''));
      setEditPropertyInterests(data.property_interests ?? []);

      // Fetch last inquired property details
      if (data.last_inquired_property_id) {
        const { data: propData } = await supabase
          .from('properties')
          .select('*')
          .eq('id', data.last_inquired_property_id)
          .maybeSingle();
        setInquiredProperty(propData || null);
      } else {
        setInquiredProperty(null);
      }
    }
    setLoading(false);
  }, [contactId, supabase]);

  const fetchAssociatedProperties = useCallback(async () => {
    if (!contactId) return;
    setLoadingProperties(true);
    const { data, error } = await supabase
      .from('properties')
      .select('*')
      .eq('owner_contact_id', contactId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching associated properties:', error);
    } else {
      setAssociatedProperties(data || []);
    }
    setLoadingProperties(false);
  }, [contactId, supabase]);

  async function handleUnlinkProperty(propertyId: string) {
    try {
      const { error } = await supabase
        .from('properties')
        .update({ owner_contact_id: null })
        .eq('id', propertyId);

      if (error) throw error;
      toast.success('Property unlinked successfully');
      fetchAssociatedProperties();
      onUpdated();
    } catch (err) {
      console.error('Failed to unlink property:', err);
      toast.error('Failed to unlink property');
    }
  }

  async function handleLinkInterestProperty(propertyId: string | null) {
    try {
      const { error } = await supabase
        .from('contacts')
        .update({ last_inquired_property_id: propertyId })
        .eq('id', contactId);

      if (error) throw error;
      toast.success(propertyId ? 'Interest property linked successfully' : 'Interest property cleared');
      setEditLastInquiredPropertyId(propertyId);
      
      if (propertyId) {
        const { data: propData } = await supabase
          .from('properties')
          .select('*')
          .eq('id', propertyId)
          .maybeSingle();
        setInquiredProperty(propData || null);
      } else {
        setInquiredProperty(null);
      }
      onUpdated();
    } catch (err) {
      console.error('Failed to update interest property:', err);
      toast.error('Failed to update interest property');
    }
  }


  useEffect(() => {
    async function loadContacts() {
      const { data } = await supabase
        .from('contacts')
        .select('*')
        .order('name');
      if (data) setContactsList(data);
    }
    if (contactId) {
      loadContacts();
    }
  }, [contactId, supabase]);

  const filteredReferrerContacts = useMemo(() => {
    if (!editReferrer.trim()) return [];
    return contactsList.filter(
      (c) =>
        c.id !== contactId &&
        ((c.name && c.name.toLowerCase().includes(editReferrer.toLowerCase())) ||
         (c.phone && c.phone.includes(editReferrer)))
    ).slice(0, 5);
  }, [contactsList, editReferrer, contactId]);

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
      fetchCurrency();
      fetchContact();
      fetchTags();
      fetchNotes();
      fetchCustomFields();
      fetchDeals();
      fetchAssociatedProperties();
      fetchAllProperties();
    }
  }, [open, contactId, fetchCurrency, fetchContact, fetchTags, fetchNotes, fetchCustomFields, fetchDeals, fetchAssociatedProperties, fetchAllProperties]);

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

    const cleanPhone = contact.phone.replace(/\D/g, '');
    if (!cleanPhone) {
      toast.error('Invalid phone number');
      return;
    }

    let appOpened = false;
    const handleBlur = () => {
      appOpened = true;
    };
    window.addEventListener('blur', handleBlur);

    // Try opening native WhatsApp client
    window.location.href = `whatsapp://send?phone=${cleanPhone}`;

    setTimeout(async () => {
      window.removeEventListener('blur', handleBlur);
      if (!appOpened) {
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
    }, 1500);
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
        source: editSource.trim() || null,
        lead_temp: editLeadTemp || null,
        last_inquired_property_id: editLastInquiredPropertyId,
        referrer: editReferrer.trim() || null,
        referrer_contact_id: editReferrerContactId,
        requirements: editRequirements.trim() || null,
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

  async function sendPropertyDetailsHelper() {
    if (!contactId || !inquiredProperty) return;

    // Find or create conversation
    let convId: string | null = null;
    const { data: existingConv } = await supabase
      .from('conversations')
      .select('id')
      .eq('contact_id', contactId)
      .maybeSingle();

    if (existingConv) {
      convId = existingConv.id;
    } else {
      const { data: newConv, error: createConvErr } = await supabase
        .from('conversations')
        .insert({
          account_id: accountId,
          user_id: user?.id,
          contact_id: contactId,
          status: 'open'
        })
        .select('id')
        .single();

      if (createConvErr) {
        console.error('Failed to create conversation:', createConvErr);
        throw createConvErr;
      }
      convId = newConv.id;
    }

    const messageText = `Here are the complete details for the property "${inquiredProperty.title}" you inquired about:\n\n📍 *Exact Address:* ${inquiredProperty.location}\n🗺️ *Google Maps Link:* ${inquiredProperty.google_map_link || 'Not available'}`;

    const res = await fetch('/api/whatsapp/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: convId,
        message_type: 'text',
        content_text: messageText,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to send WhatsApp message');
    }
  }

  async function handleSendPropertyDetails() {
    setApproving(true);
    try {
      await sendPropertyDetailsHelper();
      toast.success('Property details sent successfully via WhatsApp!');
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to send property details');
    } finally {
      setApproving(false);
    }
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

      if (sendDetailsOnApprove && inquiredProperty) {
        try {
          await sendPropertyDetailsHelper();
          toast.success('Approved & property details sent via WhatsApp!');
        } catch (waErr) {
          console.error('Failed to auto-send WhatsApp details:', waErr);
          toast.warning('Contact approved, but failed to send WhatsApp details (check WhatsApp configuration).');
        }
      } else {
        toast.success('Contact approved and added to CRM!');
      }

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
                    {contact.referrer && (
                      <span className="flex items-center gap-1 text-slate-400">
                        <Users className="size-3 text-slate-500" />
                        Ref: {contact.referrer}
                      </span>
                    )}
                    {contact.source && (
                      <span className="inline-flex items-center rounded bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary border border-primary/20">
                        {contact.source}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </SheetHeader>

            {/* Review Status Banner */}
            {contact.status === 'pending_review' && (
              <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-3 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400 border border-amber-500/20 animate-pulse">
                      Needs Review
                    </span>
                    <span className="text-xs text-amber-300">
                      Inquiry request from {contact.referrer || 'External Source'}. Please verify details.
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    {inquiredProperty && (
                      <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={sendDetailsOnApprove}
                          onChange={(e) => setSendDetailsOnApprove(e.target.checked)}
                          className="rounded border-slate-700 bg-slate-800 text-primary focus:ring-0 focus:ring-offset-0"
                        />
                        Send details via WhatsApp
                      </label>
                    )}
                    <Button
                      size="sm"
                      onClick={approveContact}
                      disabled={approving}
                      className="bg-amber-500 hover:bg-amber-600 disabled:bg-amber-500/50 text-slate-950 font-bold text-xs py-1 h-7 rounded px-3 cursor-pointer flex items-center gap-1 shrink-0"
                    >
                      {approving && <Loader2 className="size-3 animate-spin" />}
                      Approve
                    </Button>
                  </div>
                </div>
                {inquiredProperty && (
                  <div className="bg-slate-950/40 border border-slate-800/80 rounded-lg p-3 space-y-2.5 text-xs">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Inquired Property</span>
                        <span className="text-xs font-bold text-white">{inquiredProperty.title}</span>
                      </div>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={handleSendPropertyDetails}
                        disabled={approving}
                        className="bg-slate-900 border-slate-800 text-slate-300 text-[10px] h-6 py-0 px-2.5 flex items-center gap-1 cursor-pointer"
                      >
                        <MessageSquare className="size-3 text-green-500 fill-green-500" />
                        Send Complete Info via WhatsApp
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 border-t border-slate-800/50 pt-2 text-[11px] text-slate-400">
                      <div>
                        <span className="text-slate-500 font-medium">Exact Location: </span>
                        <span className="text-slate-300 font-semibold">{inquiredProperty.location}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 font-medium">Google Map Link: </span>
                        {inquiredProperty.google_map_link ? (
                          <a href={inquiredProperty.google_map_link} target="_blank" rel="noreferrer" className="text-primary hover:underline font-semibold block truncate max-w-xs">
                            {inquiredProperty.google_map_link}
                          </a>
                        ) : (
                          <span className="text-slate-500 italic">No link configured</span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            <Tabs defaultValue="details" className="flex-1 flex flex-col min-h-0">
              <TabsList className="bg-slate-800/50 border-b border-slate-700 mx-4 mt-3 overflow-x-auto flex-nowrap scrollbar-none justify-start">
                <TabsTrigger
                  value="details"
                  className="data-active:bg-slate-800 data-active:text-primary text-slate-400 shrink-0"
                >
                  Details
                </TabsTrigger>
                {editClassification === 'Buyer' && (
                  <TabsTrigger
                    value="preferences"
                    className="data-active:bg-slate-800 data-active:text-primary text-slate-400 shrink-0"
                  >
                    Preferences
                  </TabsTrigger>
                )}
                {['Owner', 'Seller', 'Agent', 'Buyer'].includes(editClassification) && (
                  <TabsTrigger
                    value="properties"
                    className="data-active:bg-slate-800 data-active:text-primary text-slate-400 shrink-0"
                  >
                    Properties
                  </TabsTrigger>
                )}
                <TabsTrigger
                  value="tags"
                  className="data-active:bg-slate-800 data-active:text-primary text-slate-400 shrink-0"
                >
                  Tags
                </TabsTrigger>
                <TabsTrigger
                  value="notes"
                  className="data-active:bg-slate-800 data-active:text-primary text-slate-400 shrink-0"
                >
                  Notes
                </TabsTrigger>
                <TabsTrigger
                  value="custom"
                  className="data-active:bg-slate-800 data-active:text-primary text-slate-400 shrink-0"
                >
                  Custom Fields
                </TabsTrigger>
                <TabsTrigger
                  value="deals"
                  className="data-active:bg-slate-800 data-active:text-primary text-slate-400 shrink-0"
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
                  <div className="space-y-1.5 relative">
                    <Label className="text-slate-400 text-xs">Referer</Label>
                    <div className="relative">
                      <Input
                        value={editReferrer}
                        onChange={(e) => {
                          setEditReferrer(e.target.value);
                          setEditReferrerContactId(null);
                          setShowReferrerSuggestions(true);
                        }}
                        onFocus={() => setShowReferrerSuggestions(true)}
                        onBlur={() => {
                          setTimeout(() => setShowReferrerSuggestions(false), 200);
                        }}
                        className="bg-slate-800 border-slate-700 text-white h-8 text-sm w-full pr-16 animate-none"
                        placeholder="Search existing contact or type a name..."
                      />
                      {editReferrerContactId && (
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
                              setEditReferrer(c.name || 'Unnamed');
                              setEditReferrerContactId(c.id);
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

                  <div className="space-y-1.5">
                    <Label className="text-slate-400 text-xs">Source</Label>
                    <select
                      value={editSource}
                      onChange={(e) => setEditSource(e.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-white focus:border-primary focus:outline-none"
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

                  <div className="space-y-1.5">
                    <Label className="text-slate-400 text-xs">Lead Temperature / Status</Label>
                    <select
                      value={editLeadTemp}
                      onChange={(e) => setEditLeadTemp(e.target.value as 'HOT' | 'COLD' | 'Not Responding' | 'Dead' | '')}
                      className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-white focus:border-primary focus:outline-none"
                    >
                      <option value="">None</option>
                      <option value="HOT">🔥 HOT</option>
                      <option value="COLD">❄️ COLD</option>
                      <option value="Not Responding">⏳ Not Responding</option>
                      <option value="Dead">💀 Dead</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-slate-400 text-xs">Shown Interest / Inquired Property</Label>
                    <select
                      value={editLastInquiredPropertyId || ''}
                      onChange={(e) => setEditLastInquiredPropertyId(e.target.value || null)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-white focus:border-primary focus:outline-none"
                    >
                      <option value="">None</option>
                      {allProperties.map((prop) => (
                        <option key={prop.id} value={prop.id}>
                          {prop.property_code ? `[${prop.property_code}] ` : ''}{prop.title}
                        </option>
                      ))}
                    </select>
                  </div>
                  {editClassification === 'Agent' && (
                    <div className="space-y-1.5">
                      <Label className="text-slate-400 text-xs">Agent Requirements</Label>
                      <Textarea
                        value={editRequirements}
                        onChange={(e) => setEditRequirements(e.target.value)}
                        placeholder="Enter agent requirements, focus areas, or client requests..."
                        className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 min-h-[100px] text-sm resize-y"
                      />
                    </div>
                  )}
                  {inquiredProperty && contact?.status !== 'pending_review' && (
                    <div className="bg-slate-950/20 border border-slate-850/60 rounded-lg p-3 space-y-2 text-xs mb-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider block">Inquired Property</span>
                          <span className="text-xs font-bold text-white">{inquiredProperty.title}</span>
                        </div>
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={handleSendPropertyDetails}
                          disabled={approving}
                          className="bg-slate-900 border-slate-800 text-slate-350 text-[10px] h-6 py-0 px-2 flex items-center gap-1 cursor-pointer"
                        >
                          <MessageSquare className="size-3 text-green-500 fill-green-500" />
                          Send Details via WhatsApp
                        </Button>
                      </div>
                      <div className="grid grid-cols-1 gap-1.5 text-[10px] text-slate-400 border-t border-slate-800/40 pt-1.5">
                        <div>
                          <span className="text-slate-500">Exact Location: </span>
                          <span className="text-slate-300">{inquiredProperty.location}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">Google Map Link: </span>
                          {inquiredProperty.google_map_link ? (
                            <a href={inquiredProperty.google_map_link} target="_blank" rel="noreferrer" className="text-primary hover:underline block truncate max-w-xs">
                              {inquiredProperty.google_map_link}
                            </a>
                          ) : (
                            <span className="text-slate-500 italic">No link configured</span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

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
              {editClassification === 'Buyer' && (
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
              )}

              {/* Properties Tab (Owner / Seller / Agent / Buyer) */}
              {['Owner', 'Seller', 'Agent', 'Buyer'].includes(editClassification) && (
                <TabsContent value="properties" className="flex-1 overflow-y-auto px-4 py-3 flex flex-col min-h-0">
                  {['Buyer', 'Agent'].includes(editClassification) ? (
                    // Shown Interest Properties Layout
                    <div className="flex flex-col flex-1 min-h-0">
                      <div className="flex flex-col gap-1.5 shrink-0 mb-4 bg-slate-900/40 border border-slate-800 rounded-lg p-3">
                        <Label htmlFor="detail-interest-property" className="text-xs font-semibold text-slate-350">
                          Assign Shown Interest / Inquired Property
                        </Label>
                        <select
                          id="detail-interest-property"
                          value={editLastInquiredPropertyId || ''}
                          onChange={(e) => handleLinkInterestProperty(e.target.value || null)}
                          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-white focus:border-primary focus:outline-none font-medium"
                        >
                          <option value="">No Property Selected</option>
                          {allProperties.map((prop) => (
                            <option key={prop.id} value={prop.id}>
                              {prop.property_code ? `[${prop.property_code}] ` : ''}{prop.title}
                            </option>
                          ))}
                        </select>
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          Linking a property associates this contact as an Interested Lead for that listing.
                        </p>
                      </div>

                      <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
                        <h4 className="text-xs font-semibold text-slate-400 mb-2">Currently Interested Listing</h4>
                        {!inquiredProperty ? (
                          <div className="text-center py-8 border border-dashed border-slate-800 rounded-lg bg-slate-900/20">
                            <Building className="size-8 mx-auto text-slate-700 mb-2 opacity-50" />
                            <p className="text-xs text-slate-500 max-w-[240px] mx-auto">
                              No inquiry or interest property is currently assigned. Select a property above to assign interest.
                            </p>
                          </div>
                        ) : (
                          <div className="rounded-lg bg-slate-850/60 border border-slate-800 p-3 hover:border-slate-700/80 transition-all duration-200">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <span className="text-[9px] px-1.5 py-0.2 bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 rounded uppercase font-bold tracking-wider inline-block mb-1.5">
                                  SHOWN INTEREST
                                </span>
                                <h5 className="text-xs font-semibold text-white truncate">
                                  {inquiredProperty.property_code ? `[${inquiredProperty.property_code}] ` : ''}
                                  {inquiredProperty.title}
                                </h5>
                                <p className="text-[10px] text-slate-400 mt-0.5 truncate">{inquiredProperty.location}</p>
                                <div className="flex items-center gap-2 mt-1.5">
                                  <span className="text-[10px] text-primary font-bold">
                                    {inquiredProperty.price >= 10000000 
                                      ? `₹${(inquiredProperty.price / 10000000).toFixed(2).replace(/\.00$/, '')} Cr` 
                                      : inquiredProperty.price >= 100000 
                                        ? `₹${(inquiredProperty.price / 100000).toFixed(2).replace(/\.00$/, '')} Lakhs` 
                                        : `₹${inquiredProperty.price.toLocaleString('en-IN')}`}
                                  </span>
                                  <span className="text-[9px] px-1.5 py-0.2 bg-slate-800 border border-slate-700 text-slate-300 rounded uppercase font-semibold">
                                    {inquiredProperty.status}
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleLinkInterestProperty(null)}
                                  className="h-7 w-7 p-0 text-slate-400 hover:text-red-400 hover:bg-slate-800"
                                  title="Remove interest link"
                                >
                                  <Unlink className="size-3" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    // Managed Properties Layout (for Owner / Seller)
                    <div className="flex flex-col flex-1 min-h-0">
                      <div className="flex items-center justify-between mb-3 shrink-0">
                        <h4 className="text-xs font-semibold text-slate-300">Managed Properties</h4>
                        <Button
                          size="sm"
                          onClick={() => {
                            setSelectedPropertyForEdit(null);
                            setPropertyFormOpen(true);
                          }}
                          className="bg-primary hover:bg-primary/90 text-primary-foreground h-7 text-xs font-bold flex items-center gap-1 cursor-pointer"
                        >
                          <Plus className="size-3" />
                          Add Property
                        </Button>
                      </div>

                      <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
                        {loadingProperties ? (
                          <div className="flex items-center justify-center py-8">
                            <Loader2 className="size-5 animate-spin text-slate-500" />
                          </div>
                        ) : associatedProperties.length === 0 ? (
                          <div className="text-center py-8 border border-dashed border-slate-800 rounded-lg bg-slate-900/40">
                            <Building className="size-8 mx-auto text-slate-600 mb-2 opacity-55" />
                            <p className="text-xs text-slate-400 max-w-[240px] mx-auto">
                              No properties associated with this contact. Add one to display it here.
                            </p>
                          </div>
                        ) : (
                          associatedProperties.map((prop) => (
                            <div
                              key={prop.id}
                              className="rounded-lg bg-slate-850/60 border border-slate-800 p-3 hover:border-slate-700/80 transition-all duration-200"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <h5 className="text-xs font-semibold text-white truncate">{prop.title}</h5>
                                  <p className="text-[10px] text-slate-400 mt-0.5 truncate">{prop.location}</p>
                                  <div className="flex items-center gap-2 mt-1.5">
                                    <span className="text-[10px] text-primary font-bold">
                                      {prop.price >= 10000000 
                                        ? `₹${(prop.price / 10000000).toFixed(2).replace(/\.00$/, '')} Cr` 
                                        : prop.price >= 100000 
                                          ? `₹${(prop.price / 100000).toFixed(2).replace(/\.00$/, '')} Lakhs` 
                                          : `₹${prop.price.toLocaleString('en-IN')}`}
                                    </span>
                                    <span className="text-[9px] px-1.5 py-0.2 bg-slate-800 border border-slate-700 text-slate-300 rounded uppercase font-semibold">
                                      {prop.status}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                      setSelectedPropertyForEdit(prop);
                                      setPropertyFormOpen(true);
                                    }}
                                    className="h-7 w-7 p-0 text-slate-400 hover:text-white hover:bg-slate-800"
                                  >
                                    <Edit className="size-3" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleUnlinkProperty(prop.id)}
                                    className="h-7 w-7 p-0 text-slate-400 hover:text-red-400 hover:bg-slate-800"
                                    title="Unlink from contact"
                                  >
                                    <Unlink className="size-3" />
                                  </Button>
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </TabsContent>
              )}


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
                            {createElement(getCurrencyIcon(deal.currency || currency), { className: "size-3" })}
                            {(() => {
                              const activeCurrency = deal.currency || currency;
                              if (activeCurrency === 'INR') {
                                const val = Number(deal.value || 0);
                                if (val >= 10000000) {
                                  return `₹${(val / 10000000).toFixed(2).replace(/\.00$/, '')} Cr`;
                                } else if (val >= 100000) {
                                  return `₹${(val / 100000).toFixed(2).replace(/\.00$/, '')} Lakhs`;
                                }
                                return new Intl.NumberFormat('en-IN', {
                                  style: 'currency',
                                  currency: 'INR',
                                  maximumFractionDigits: 0,
                                }).format(val);
                              }
                              return new Intl.NumberFormat('en-US', {
                                style: 'currency',
                                currency: activeCurrency,
                                maximumFractionDigits: 0,
                              }).format(Number(deal.value || 0));
                            })()}
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

            {/* Property Form Modal */}
            <PropertyForm
              open={propertyFormOpen}
              onOpenChange={setPropertyFormOpen}
              property={selectedPropertyForEdit}
              defaultOwnerId={contactId}
              onSaved={() => {
                fetchAssociatedProperties();
                onUpdated();
              }}
            />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
