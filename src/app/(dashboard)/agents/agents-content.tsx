'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import type { Contact, Property, ContactNote } from '@/types';
import { storagePublicUrl } from '@/lib/storage/url';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { NameTagBadge } from '@/components/contacts/name-tag-badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PropertyForm } from '@/components/inventory/property-form';
import { ConvoRealLoader } from '@/components/ui/convoreal-loader';
import { JourneyEmbed } from '@/components/journey/journey-embed';
import { ContactAppointments } from '@/components/calendar/contact-appointments';
import {
  Building,
  ChevronLeft,
  ChevronRight,
  Phone,
  Mail,
  Building2,
  Plus,
  Search,
  Unlink,
  Edit,
  MessageSquare,
  Loader2,
  Save,
  FileText,
  Users,
} from 'lucide-react';
import { readStored, writeStored } from '@/lib/safe-storage';

export default function AgentsPage() {
  const supabase = createClient();
  const { user, accountId } = useAuth();

  // Agent State
  const [agents, setAgents] = useState<Contact[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  // Below lg the two panes ride a horizontal scroll-snap track: the
  // directory takes ~85vw with the detail pane (pre-filled with the
  // selected agent) peeking in from the right, so first-time users can
  // SEE there's more. Swipe or tap snaps between the panes; desktop
  // shows both side by side and ignores the snapping entirely.
  const panesRef = useRef<HTMLDivElement>(null);
  const detailPaneRef = useRef<HTMLDivElement>(null);

  const scrollToDetail = () => {
    if (typeof window !== 'undefined' && window.innerWidth >= 1024) return;
    detailPaneRef.current?.scrollIntoView({
      behavior: 'smooth',
      inline: 'start',
      block: 'nearest',
    });
  };
  const scrollToList = () => {
    panesRef.current?.scrollTo({ left: 0, behavior: 'smooth' });
  };

  // Desktop: the split itself is controllable — a drag handle resizes
  // the directory pane (persisted), and a chevron collapses it so the
  // detail can take the full width.
  const [listWidth, setListWidth] = useState(320);
  const [listCollapsed, setListCollapsed] = useState(false);

  useEffect(() => {
    const saved = Number(readStored('agents-list-width'));
    if (saved >= 220 && saved <= 560) setListWidth(saved);
  }, []);

  const startResize = (e: React.PointerEvent) => {
    if (listCollapsed) return;
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = listWidth;
    const onMove = (ev: PointerEvent) => {
      setListWidth(
        Math.min(560, Math.max(220, startWidth + ev.clientX - startX))
      );
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      writeStored(
        'agents-list-width',
        String(Math.min(560, Math.max(220, startWidth + ev.clientX - startX)))
      );
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Detail tab state for selected agent
  const [requirementsText, setRequirementsText] = useState('');
  const [savingRequirements, setSavingRequirements] = useState(false);

  // Associated properties state
  const [properties, setProperties] = useState<Property[]>([]);
  const [loadingProperties, setLoadingProperties] = useState(false);
  const [propertyFormOpen, setPropertyFormOpen] = useState(false);
  const [selectedPropertyForEdit, setSelectedPropertyForEdit] =
    useState<Property | null>(null);

  // Notes state
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [newNoteText, setNewNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [loadingNotes, setLoadingNotes] = useState(false);

  // Get active agent details
  const selectedAgent = useMemo(() => {
    return agents.find((a) => a.id === selectedAgentId) || null;
  }, [agents, selectedAgentId]);

  // Fetch agents list
  const fetchAgents = useCallback(async () => {
    setLoadingAgents(true);
    try {
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .eq('classification', 'Agent')
        .order('name');

      if (error) throw error;
      setAgents(data || []);

      if (data && data.length > 0 && !selectedAgentId) {
        setSelectedAgentId(data[0].id);
      }
    } catch (err) {
      console.error('Error fetching agents:', err);
      toast.error('Failed to load agents list');
    } finally {
      setLoadingAgents(false);
    }
  }, [supabase, selectedAgentId]);

  // Fetch associated properties for active agent
  const fetchAssociatedProperties = useCallback(async () => {
    if (!selectedAgentId) return;
    setLoadingProperties(true);
    try {
      const { data, error } = await supabase
        .from('properties')
        .select('*')
        .eq('owner_contact_id', selectedAgentId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setProperties(data || []);
    } catch (err) {
      console.error('Error fetching properties:', err);
    } finally {
      setLoadingProperties(false);
    }
  }, [supabase, selectedAgentId]);

  // Fetch notes for active agent
  const fetchNotes = useCallback(async () => {
    if (!selectedAgentId) return;
    setLoadingNotes(true);
    try {
      const { data, error } = await supabase
        .from('contact_notes')
        .select('*')
        .eq('contact_id', selectedAgentId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setNotes(data || []);
    } catch (err) {
      console.error('Error fetching notes:', err);
    } finally {
      setLoadingNotes(false);
    }
  }, [supabase, selectedAgentId]);

  // Initial load
  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  // Reload detail states when active agent change
  useEffect(() => {
    if (selectedAgentId) {
      fetchAssociatedProperties();
      fetchNotes();
      if (selectedAgent) {
        setRequirementsText(selectedAgent.requirements ?? '');
      }
    } else {
      setProperties([]);
      setNotes([]);
      setRequirementsText('');
    }
  }, [selectedAgentId, fetchAssociatedProperties, fetchNotes, selectedAgent]);

  // Handle saving requirements
  const handleSaveRequirements = async () => {
    if (!selectedAgentId) return;
    setSavingRequirements(true);
    try {
      const { data, error } = await supabase
        .from('contacts')
        .update({
          requirements: requirementsText.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedAgentId)
        .select('id');

      if (error) throw error;
      if (!data?.length) throw new Error('That agent is no longer there.');
      toast.success('Agent requirements updated successfully');
      // Update local state copy
      setAgents((prev) =>
        prev.map((a) =>
          a.id === selectedAgentId
            ? { ...a, requirements: requirementsText.trim() || null }
            : a
        )
      );
    } catch (err) {
      console.error('Error saving requirements:', err);
      toast.error('Failed to update requirements');
    } finally {
      setSavingRequirements(false);
    }
  };

  // Add notes
  const handleAddNote = async () => {
    if (!selectedAgentId || !newNoteText.trim() || !user || !accountId) return;
    setSavingNote(true);
    try {
      const { error } = await supabase.from('contact_notes').insert({
        contact_id: selectedAgentId,
        user_id: user.id,
        account_id: accountId,
        note_text: newNoteText.trim(),
      });

      if (error) throw error;
      setNewNoteText('');
      fetchNotes();
      toast.success('Note added');
    } catch (err) {
      console.error('Error adding note:', err);
      toast.error('Failed to add note');
    } finally {
      setSavingNote(false);
    }
  };

  // Unlink property
  const handleUnlinkProperty = async (propertyId: string) => {
    try {
      const { data, error } = await supabase
        .from('properties')
        .update({ owner_contact_id: null })
        .eq('id', propertyId)
        .select('id');

      if (error) throw error;
      if (!data?.length) throw new Error('That property is no longer there.');
      toast.success('Property unlinked from agent');
      fetchAssociatedProperties();
    } catch (err) {
      console.error('Error unlinking property:', err);
      toast.error('Failed to unlink property');
    }
  };

  // Filtered agents list based on search bar
  const filteredAgents = useMemo(() => {
    if (!searchQuery.trim()) return agents;
    const q = searchQuery.toLowerCase();
    return agents.filter(
      (a) =>
        (a.name && a.name.toLowerCase().includes(q)) ||
        (a.company && a.company.toLowerCase().includes(q)) ||
        (a.phone?.includes(q) ?? false)
    );
  }, [agents, searchQuery]);

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
    <div
      ref={panesRef}
      className="flex h-[calc(100vh-3.5rem)] snap-x snap-mandatory overflow-x-auto overflow-y-hidden bg-slate-950 text-slate-100 lg:snap-none lg:overflow-hidden"
    >
      {/* LEFT PANE - Agent Directory. ~85vw on mobile so the detail
          pane peeks in from the right; desktop width is drag-resizable
          via the divider (and collapsible entirely). */}
      <div
        style={{ '--agents-list-w': `${listWidth}px` } as React.CSSProperties}
        className={`${
          listCollapsed ? 'lg:hidden' : ''
        } flex h-full w-[85vw] shrink-0 snap-start flex-col border-r border-slate-800 bg-slate-900/60 sm:w-[60vw] md:w-[45vw] lg:w-[var(--agents-list-w)] lg:snap-align-none`}
      >
        <div className="shrink-0 space-y-3 border-b border-slate-800 p-4">
          <div className="flex items-center justify-between">
            <h1 className="flex items-center gap-2 text-base font-semibold text-white">
              <Users className="text-primary size-4.5" />
              Agents Directory
            </h1>
          </div>
          <div className="relative">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search agents by name, company..."
              className="focus-visible:ring-primary h-8 border-slate-700 bg-slate-800 pl-9 text-xs text-white placeholder:text-slate-500 focus-visible:ring-1 focus-visible:ring-offset-0"
            />
          </div>
        </div>

        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {loadingAgents ? (
            <div className="flex items-center justify-center py-10">
              <ConvoRealLoader size={20} label="Loading agents" />
            </div>
          ) : filteredAgents.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500">
              No Agent contacts found. Ensure you tag contacts as Agent.
            </div>
          ) : (
            filteredAgents.map((agent) => {
              const active = agent.id === selectedAgentId;
              return (
                <button
                  key={agent.id}
                  onClick={() => {
                    setSelectedAgentId(agent.id);
                    scrollToDetail();
                  }}
                  className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-all duration-200 ${
                    active
                      ? 'bg-primary/10 border-primary/40 shadow-primary/5 text-white shadow-sm'
                      : 'border-slate-800/60 bg-slate-900/40 text-slate-300 hover:border-slate-700/60 hover:bg-slate-800/40'
                  }`}
                >
                  <Avatar className="size-9 border border-slate-800">
                    <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                      {getInitials(agent.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 truncate text-xs font-medium text-white">
                      <span className="truncate">
                        {agent.name || 'Unnamed Agent'}
                      </span>
                      <NameTagBadge tag={agent.name_tag} />
                    </div>
                    {agent.company && (
                      <div className="mt-0.5 truncate text-[10px] text-slate-400">
                        {agent.company}
                      </div>
                    )}
                    <div className="mt-0.5 truncate text-[10px] text-slate-500">
                      {agent.phone}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Desktop divider: drag to resize the directory, chevron to
          collapse/expand it. Not part of the mobile snap track. */}
      <div
        onPointerDown={startResize}
        className={`hidden w-2.5 shrink-0 flex-col items-center justify-center border-r border-slate-800 bg-slate-900/40 transition-colors hover:bg-slate-800/60 lg:flex ${
          listCollapsed ? '' : 'cursor-col-resize'
        }`}
      >
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setListCollapsed((c) => !c)}
          title={
            listCollapsed ? 'Show agents directory' : 'Hide agents directory'
          }
          className="flex h-12 w-full cursor-pointer items-center justify-center text-slate-500 hover:text-white"
        >
          {listCollapsed ? (
            <ChevronRight className="size-3.5" />
          ) : (
            <ChevronLeft className="size-3.5" />
          )}
        </button>
      </div>

      {/* RIGHT PANE - Agent Detail Showcase. 92vw on mobile — snapping
          to it leaves a sliver of the directory peeking on the left. */}
      <div
        ref={detailPaneRef}
        className="flex h-full w-[92vw] shrink-0 snap-start flex-col overflow-hidden bg-slate-950/20 lg:w-auto lg:flex-1 lg:shrink lg:snap-align-none"
      >
        {selectedAgent ? (
          <div className="flex h-full min-h-0 flex-col">
            {/* Mobile only: back to the directory + a horizontal agent
                switcher, so hopping between agents doesn't require
                going back — the active tab (journey, notes, …) carries
                over to the newly selected agent. Desktop always shows
                both panes. */}
            <div className="flex shrink-0 items-center border-b border-slate-800 bg-slate-900/40 lg:hidden">
              <button
                type="button"
                onClick={scrollToList}
                title="All agents"
                className="flex shrink-0 cursor-pointer items-center gap-1 py-2.5 pr-1.5 pl-3 text-xs font-semibold text-slate-400 hover:text-white"
              >
                <ChevronLeft className="size-4" />
              </button>
              <div className="flex flex-1 items-center gap-1.5 overflow-x-auto overscroll-x-contain px-1.5 py-1.5">
                {filteredAgents.map((agent) => {
                  const active = agent.id === selectedAgentId;
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => setSelectedAgentId(agent.id)}
                      className={`flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border py-1 pr-2.5 pl-1 transition-all ${
                        active
                          ? 'bg-primary/15 border-primary/50 text-white'
                          : 'border-slate-800 bg-slate-900/40 text-slate-400 hover:border-slate-700 hover:text-white'
                      }`}
                    >
                      <Avatar className="size-5 border border-slate-800">
                        <AvatarFallback className="bg-primary/10 text-primary text-[8px] font-bold">
                          {getInitials(agent.name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-[10px] font-semibold whitespace-nowrap">
                        {(agent.name || 'Unnamed').split(' ')[0]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Profil Summary Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/30 p-4 sm:p-6">
              <div className="flex items-center gap-4">
                <Avatar className="size-16 border border-slate-800">
                  <AvatarFallback className="bg-primary/10 text-primary text-xl font-bold">
                    {getInitials(selectedAgent.name)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold text-white">
                      {selectedAgent.name || 'Unnamed Agent'}
                    </h2>
                    <NameTagBadge tag={selectedAgent.name_tag} />
                    <span className="inline-flex items-center rounded-full border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 text-[9px] font-semibold tracking-wider text-sky-400 uppercase">
                      Agent
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-400">
                    <a
                      href={`tel:${selectedAgent.phone}`}
                      className="hover:text-primary flex items-center gap-1 text-slate-300 transition-colors"
                    >
                      <Phone className="size-3.5" />
                      {selectedAgent.phone}
                    </a>
                    {selectedAgent.email && (
                      <span className="text-slate-350 flex items-center gap-1">
                        <Mail className="size-3.5" />
                        {selectedAgent.email}
                      </span>
                    )}
                    {selectedAgent.company && (
                      <span className="text-slate-350 flex items-center gap-1">
                        <Building2 className="size-3.5" />
                        {selectedAgent.company}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Content Tabs */}
            <Tabs
              defaultValue="properties"
              className="flex min-h-0 flex-1 flex-col"
            >
              {/* Scrollable strip — three uppercase labels overflow
                  narrow panels; clipping ate "…& NOTES" before. */}
              <div className="shrink-0 overflow-x-auto overscroll-x-contain border-b border-slate-800 bg-slate-900/10 px-6">
                <TabsList className="h-12 w-max min-w-full space-x-6 border-b-0 bg-transparent p-0">
                  <TabsTrigger
                    value="properties"
                    className="data-[state=active]:border-primary data-[state=active]:text-primary h-full shrink-0 rounded-none border-b-2 border-transparent bg-transparent px-0 text-xs font-medium tracking-wider whitespace-nowrap text-slate-400"
                  >
                    SHOWCASE PROPERTIES ({properties.length})
                  </TabsTrigger>
                  <TabsTrigger
                    value="requirements"
                    className="data-[state=active]:border-primary data-[state=active]:text-primary h-full shrink-0 rounded-none border-b-2 border-transparent bg-transparent px-0 text-xs font-medium tracking-wider whitespace-nowrap text-slate-400"
                  >
                    REQUIREMENTS & NOTES
                  </TabsTrigger>
                  <TabsTrigger
                    value="journey"
                    className="data-[state=active]:border-primary data-[state=active]:text-primary h-full shrink-0 rounded-none border-b-2 border-transparent bg-transparent px-0 text-xs font-medium tracking-wider whitespace-nowrap text-slate-400"
                  >
                    JOURNEY
                  </TabsTrigger>
                  <TabsTrigger
                    value="schedule"
                    className="data-[state=active]:border-primary data-[state=active]:text-primary h-full shrink-0 rounded-none border-b-2 border-transparent bg-transparent px-0 text-xs font-medium tracking-wider whitespace-nowrap text-slate-400"
                  >
                    SCHEDULE
                  </TabsTrigger>
                </TabsList>
              </div>

              {/* Showcase Properties Tab */}
              <TabsContent
                value="properties"
                className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6 focus-visible:outline-none"
              >
                <div className="mb-4 flex shrink-0 items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      Showcase Properties
                    </h3>
                    <p className="text-slate-450 mt-0.5 text-xs">
                      Properties owned, represented, or listed by this agent.
                    </p>
                  </div>
                  <Button
                    onClick={() => {
                      setSelectedPropertyForEdit(null);
                      setPropertyFormOpen(true);
                    }}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-4 text-xs font-bold"
                  >
                    <Plus className="size-3.5" />
                    Add Property
                  </Button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto">
                  {loadingProperties ? (
                    <div className="flex items-center justify-center py-20">
                      <ConvoRealLoader size={24} label="Loading properties" />
                    </div>
                  ) : properties.length === 0 ? (
                    <div className="mx-auto mt-4 max-w-lg rounded-xl border border-dashed border-slate-800 bg-slate-900/20 py-16 text-center">
                      <Building className="text-slate-750 mx-auto mb-4 size-12 opacity-45" />
                      <h4 className="mb-1 text-sm font-semibold text-white">
                        No Showcase Properties
                      </h4>
                      <p className="mx-auto max-w-xs text-xs text-slate-400">
                        Link properties listed by this agent to showcase them on
                        this portfolio page.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                      {properties.map((prop) => (
                        <div
                          key={prop.id}
                          className="group flex flex-col overflow-hidden rounded-xl border border-slate-800/80 bg-slate-900/40 transition-all duration-300 hover:border-slate-700/80"
                        >
                          <div className="relative h-36 shrink-0 overflow-hidden bg-slate-950">
                            {prop.images &&
                            prop.images.length > 0 &&
                            prop.images[0] ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={storagePublicUrl(prop.images[0])}
                                alt={prop.title}
                                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                              />
                            ) : (
                              <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-slate-600">
                                <Building className="size-8 opacity-30" />
                                <span className="text-[10px]">No Photos</span>
                              </div>
                            )}
                            <div className="absolute top-2 left-2">
                              <span className="py-0.2 rounded border border-slate-800 bg-slate-950/80 px-1.5 text-[8px] font-semibold tracking-wider text-slate-300 uppercase">
                                {prop.status}
                              </span>
                            </div>
                          </div>
                          <div className="flex flex-1 flex-col justify-between p-4">
                            <div>
                              <h4 className="group-hover:text-primary truncate text-xs font-semibold text-white transition-colors">
                                {prop.title}
                              </h4>
                              <p className="mt-0.5 truncate text-[10px] text-slate-400">
                                {prop.location}
                              </p>
                              <div className="text-primary mt-2 text-xs font-bold">
                                {prop.price >= 10000000
                                  ? `₹${(prop.price / 10000000).toFixed(2).replace(/\.00$/, '')} Cr`
                                  : prop.price >= 100000
                                    ? `₹${(prop.price / 100000).toFixed(2).replace(/\.00$/, '')} Lakhs`
                                    : `₹${prop.price.toLocaleString('en-IN')}`}
                              </div>
                            </div>

                            <div className="mt-3 flex shrink-0 justify-end gap-2 border-t border-slate-800/80 pt-3">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setSelectedPropertyForEdit(prop);
                                  setPropertyFormOpen(true);
                                }}
                                className="h-7 cursor-pointer gap-1 px-2 text-[10px] text-slate-400 hover:bg-slate-800 hover:text-white"
                              >
                                <Edit className="size-3" />
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleUnlinkProperty(prop.id)}
                                className="text-slate-450 h-7 cursor-pointer gap-1 px-2 text-[10px] hover:bg-slate-800 hover:text-red-400"
                              >
                                <Unlink className="size-3" />
                                Unlink
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* Requirements & Notes Tab — stacks on narrow panels;
                  the old fixed two-column flex crushed the editor
                  into an unreadable sliver below ~lg widths. */}
              <TabsContent
                value="requirements"
                className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6 focus-visible:outline-none lg:flex-row lg:overflow-hidden"
              >
                {/* Requirements Editor (Left half) */}
                <div className="flex min-h-[280px] flex-1 flex-col rounded-xl border border-slate-800/80 bg-slate-900/30 p-5 lg:h-full lg:overflow-hidden">
                  <div className="mb-3 flex shrink-0 items-center justify-between">
                    <h3 className="flex items-center gap-1.5 text-sm font-semibold text-white">
                      <FileText className="text-primary size-4" />
                      Agent Requirements & Brief
                    </h3>
                    <Button
                      size="sm"
                      onClick={handleSaveRequirements}
                      disabled={savingRequirements}
                      className="bg-primary hover:bg-primary/90 text-primary-foreground h-8 cursor-pointer gap-1 text-xs font-bold"
                    >
                      {savingRequirements ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Save className="size-3.5" />
                      )}
                      Save requirements
                    </Button>
                  </div>

                  <div className="flex-1 overflow-hidden">
                    <Textarea
                      value={requirementsText}
                      onChange={(e) => setRequirementsText(e.target.value)}
                      placeholder="Specify agent focus, target sublocalities, client profile requirements, matching preferences..."
                      className="focus-visible:ring-primary h-full w-full resize-none rounded-lg border-slate-800 bg-slate-950/40 p-4 text-xs text-slate-200 placeholder:text-slate-500 focus-visible:ring-1 focus-visible:ring-offset-0"
                    />
                  </div>
                </div>

                {/* Notes Roster (Right half) */}
                <div className="flex w-full shrink-0 flex-col rounded-xl border border-slate-800/80 bg-slate-900/30 p-5 lg:h-full lg:w-80 lg:overflow-hidden">
                  <h3 className="mb-3 flex shrink-0 items-center gap-1.5 text-sm font-semibold text-white">
                    <MessageSquare className="text-primary size-4" />
                    Agent Notes
                  </h3>

                  <div className="mb-4 shrink-0 space-y-2">
                    <Textarea
                      value={newNoteText}
                      onChange={(e) => setNewNoteText(e.target.value)}
                      placeholder="Add brief details, todo points, tasks..."
                      className="border-slate-850 focus-visible:ring-primary h-16 resize-none bg-slate-950/40 text-xs text-white placeholder:text-slate-500 focus-visible:ring-1 focus-visible:ring-offset-0"
                    />
                    <Button
                      size="sm"
                      onClick={handleAddNote}
                      disabled={savingNote || !newNoteText.trim()}
                      className="bg-primary hover:bg-primary/90 text-primary-foreground h-8 w-full cursor-pointer text-xs font-bold"
                    >
                      {savingNote && (
                        <Loader2 className="mr-1 size-3 animate-spin" />
                      )}
                      Add note
                    </Button>
                  </div>

                  <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
                    {loadingNotes ? (
                      <div className="flex items-center justify-center py-6">
                        <ConvoRealLoader size={16} label="Loading notes" />
                      </div>
                    ) : notes.length === 0 ? (
                      <p className="py-6 text-center text-[11px] text-slate-500">
                        No notes recorded yet
                      </p>
                    ) : (
                      notes.map((note) => (
                        <div
                          key={note.id}
                          className="border-slate-850 text-slate-350 rounded-lg border bg-slate-950/30 p-3 text-[11px]"
                        >
                          <p className="leading-relaxed whitespace-pre-wrap">
                            {note.note_text}
                          </p>
                          <span className="text-slate-550 mt-1.5 block text-[9px]">
                            {new Date(note.created_at).toLocaleDateString(
                              undefined,
                              {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              }
                            )}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </TabsContent>

              {/* Journey Tab — this agent's buyer journey, embedded */}
              <TabsContent
                value="journey"
                className="min-h-0 flex-1 overflow-y-auto p-6 focus-visible:outline-none"
              >
                <JourneyEmbed mode="buyer" subjectId={selectedAgent.id} />
              </TabsContent>

              {/* Schedule Tab — appointments involving this agent */}
              <TabsContent
                value="schedule"
                className="min-h-0 flex-1 overflow-y-auto p-6 focus-visible:outline-none"
              >
                <ContactAppointments
                  key={selectedAgent.id}
                  contactId={selectedAgent.id}
                />
              </TabsContent>
            </Tabs>
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center text-slate-400">
            <Users className="mb-4 size-16 animate-pulse text-slate-700 opacity-40" />
            <h3 className="mb-1 text-base font-semibold text-white">
              Select an Agent
            </h3>
            <p className="text-xs text-slate-500">
              Select an agent from the directory sidebar to view showcase
              properties and notes.
            </p>
          </div>
        )}
      </div>

      {/* Property Form Modal */}
      {selectedAgent && (
        <PropertyForm
          open={propertyFormOpen}
          onOpenChange={setPropertyFormOpen}
          property={selectedPropertyForEdit}
          defaultOwnerId={selectedAgent.id}
          onSaved={() => {
            fetchAssociatedProperties();
          }}
        />
      )}
    </div>
  );
}
