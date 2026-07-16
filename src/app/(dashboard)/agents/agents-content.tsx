'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import type { Contact, Property, ContactNote } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PropertyForm } from '@/components/inventory/property-form';
import { ConvoRealLoader } from '@/components/ui/convoreal-loader';
import {
  Building,
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

export default function AgentsPage() {
  const supabase = createClient();
  const { user, accountId } = useAuth();

  // Agent State
  const [agents, setAgents] = useState<Contact[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  // Detail tab state for selected agent
  const [requirementsText, setRequirementsText] = useState('');
  const [savingRequirements, setSavingRequirements] = useState(false);

  // Associated properties state
  const [properties, setProperties] = useState<Property[]>([]);
  const [loadingProperties, setLoadingProperties] = useState(false);
  const [propertyFormOpen, setPropertyFormOpen] = useState(false);
  const [selectedPropertyForEdit, setSelectedPropertyForEdit] = useState<Property | null>(null);

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
      const { error } = await supabase
        .from('contacts')
        .update({
          requirements: requirementsText.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedAgentId);

      if (error) throw error;
      toast.success('Agent requirements updated successfully');
      // Update local state copy
      setAgents((prev) =>
        prev.map((a) =>
          a.id === selectedAgentId ? { ...a, requirements: requirementsText.trim() || null } : a
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
      const { error } = await supabase
        .from('properties')
        .update({ owner_contact_id: null })
        .eq('id', propertyId);

      if (error) throw error;
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
        a.phone.includes(q)
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
    <div className="flex h-[calc(100vh-3.5rem)] bg-slate-950 text-slate-100 overflow-hidden">
      {/* LEFT PANE - Agent Directory */}
      <div className="w-80 border-r border-slate-800 bg-slate-900/60 flex flex-col h-full shrink-0">
        <div className="p-4 border-b border-slate-800 space-y-3 shrink-0">
          <div className="flex items-center justify-between">
            <h1 className="text-base font-semibold text-white flex items-center gap-2">
              <Users className="size-4.5 text-primary" />
              Agents Directory
            </h1>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search agents by name, company..."
              className="pl-9 bg-slate-800 border-slate-700 text-xs text-white placeholder:text-slate-500 h-8 focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-0"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loadingAgents ? (
            <div className="flex items-center justify-center py-10">
              <ConvoRealLoader size={20} label="Loading agents" />
            </div>
          ) : filteredAgents.length === 0 ? (
            <div className="text-center py-10 text-slate-500 text-xs">
              No Agent contacts found. Ensure you tag contacts as Agent.
            </div>
          ) : (
            filteredAgents.map((agent) => {
              const active = agent.id === selectedAgentId;
              return (
                <button
                  key={agent.id}
                  onClick={() => setSelectedAgentId(agent.id)}
                  className={`w-full text-left flex items-center gap-3 p-3 rounded-lg border transition-all duration-200 ${
                    active
                      ? 'bg-primary/10 border-primary/40 text-white shadow-sm shadow-primary/5'
                      : 'bg-slate-900/40 border-slate-800/60 hover:bg-slate-800/40 hover:border-slate-700/60 text-slate-300'
                  }`}
                >
                  <Avatar className="size-9 border border-slate-800">
                    <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                      {getInitials(agent.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-xs truncate text-white">
                      {agent.name || 'Unnamed Agent'}
                    </div>
                    {agent.company && (
                      <div className="text-[10px] text-slate-400 truncate mt-0.5">
                        {agent.company}
                      </div>
                    )}
                    <div className="text-[10px] text-slate-500 truncate mt-0.5">
                      {agent.phone}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* RIGHT PANE - Agent Detail Showcase */}
      <div className="flex-1 flex flex-col h-full bg-slate-950/20 overflow-hidden">
        {selectedAgent ? (
          <div className="flex flex-col h-full min-h-0">
            {/* Profil Summary Header */}
            <div className="p-6 border-b border-slate-800 bg-slate-900/30 flex items-center justify-between shrink-0">
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
                    <span className="inline-flex items-center rounded-full border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 text-[9px] uppercase tracking-wider font-semibold text-sky-400">
                      Agent
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-2 text-xs text-slate-400">
                    <a
                      href={`tel:${selectedAgent.phone}`}
                      className="flex items-center gap-1 hover:text-primary transition-colors text-slate-300"
                    >
                      <Phone className="size-3.5" />
                      {selectedAgent.phone}
                    </a>
                    {selectedAgent.email && (
                      <span className="flex items-center gap-1 text-slate-350">
                        <Mail className="size-3.5" />
                        {selectedAgent.email}
                      </span>
                    )}
                    {selectedAgent.company && (
                      <span className="flex items-center gap-1 text-slate-350">
                        <Building2 className="size-3.5" />
                        {selectedAgent.company}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Content Tabs */}
            <Tabs defaultValue="properties" className="flex-1 flex flex-col min-h-0">
              <div className="px-6 border-b border-slate-800 bg-slate-900/10 shrink-0">
                <TabsList className="bg-transparent border-b-0 space-x-6 p-0 h-12">
                  <TabsTrigger
                    value="properties"
                    className="h-full rounded-none border-b-2 border-transparent data-[state=active]:border-primary bg-transparent text-slate-400 data-[state=active]:text-primary px-0 font-medium text-xs tracking-wider"
                  >
                    SHOWCASE PROPERTIES ({properties.length})
                  </TabsTrigger>
                  <TabsTrigger
                    value="requirements"
                    className="h-full rounded-none border-b-2 border-transparent data-[state=active]:border-primary bg-transparent text-slate-400 data-[state=active]:text-primary px-0 font-medium text-xs tracking-wider"
                  >
                    REQUIREMENTS & NOTES
                  </TabsTrigger>
                </TabsList>
              </div>

              {/* Showcase Properties Tab */}
              <TabsContent
                value="properties"
                className="flex-1 overflow-y-auto p-6 focus-visible:outline-none flex flex-col min-h-0"
              >
                <div className="flex items-center justify-between mb-4 shrink-0">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Showcase Properties</h3>
                    <p className="text-xs text-slate-450 mt-0.5">
                      Properties owned, represented, or listed by this agent.
                    </p>
                  </div>
                  <Button
                    onClick={() => {
                      setSelectedPropertyForEdit(null);
                      setPropertyFormOpen(true);
                    }}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold h-8 flex items-center gap-1.5 cursor-pointer px-4 rounded-md"
                  >
                    <Plus className="size-3.5" />
                    Add Property
                  </Button>
                </div>

                <div className="flex-1 overflow-y-auto min-h-0">
                  {loadingProperties ? (
                    <div className="flex items-center justify-center py-20">
                      <ConvoRealLoader size={24} label="Loading properties" />
                    </div>
                  ) : properties.length === 0 ? (
                    <div className="text-center py-16 border border-dashed border-slate-800 rounded-xl bg-slate-900/20 max-w-lg mx-auto mt-4">
                      <Building className="size-12 mx-auto text-slate-755 mb-4 opacity-45" />
                      <h4 className="text-sm font-semibold text-white mb-1">No Showcase Properties</h4>
                      <p className="text-xs text-slate-400 max-w-xs mx-auto">
                        Link properties listed by this agent to showcase them on this portfolio page.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {properties.map((prop) => (
                        <div
                          key={prop.id}
                          className="flex flex-col rounded-xl border border-slate-800/80 bg-slate-900/40 overflow-hidden hover:border-slate-700/80 transition-all duration-300 group"
                        >
                          <div className="relative h-36 bg-slate-950 overflow-hidden shrink-0">
                            {prop.images && prop.images.length > 0 && prop.images[0] ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={prop.images[0]}
                                alt={prop.title}
                                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                              />
                            ) : (
                              <div className="w-full h-full flex flex-col items-center justify-center text-slate-600 gap-1.5">
                                <Building className="size-8 opacity-30" />
                                <span className="text-[10px]">No Photos</span>
                              </div>
                            )}
                            <div className="absolute top-2 left-2">
                              <span className="text-[8px] tracking-wider font-semibold uppercase px-1.5 py-0.2 bg-slate-950/80 border border-slate-800 text-slate-300 rounded">
                                {prop.status}
                              </span>
                            </div>
                          </div>
                          <div className="p-4 flex-1 flex flex-col justify-between">
                            <div>
                              <h4 className="text-xs font-semibold text-white truncate group-hover:text-primary transition-colors">
                                {prop.title}
                              </h4>
                              <p className="text-[10px] text-slate-400 truncate mt-0.5">
                                {prop.location}
                              </p>
                              <div className="text-xs font-bold text-primary mt-2">
                                {prop.price >= 10000000 
                                  ? `₹${(prop.price / 10000000).toFixed(2).replace(/\.00$/, '')} Cr` 
                                  : prop.price >= 100000 
                                    ? `₹${(prop.price / 100000).toFixed(2).replace(/\.00$/, '')} Lakhs` 
                                    : `₹${prop.price.toLocaleString('en-IN')}`}
                              </div>
                            </div>

                            <div className="flex justify-end gap-2 border-t border-slate-800/80 pt-3 mt-3 shrink-0">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setSelectedPropertyForEdit(prop);
                                  setPropertyFormOpen(true);
                                }}
                                className="h-7 px-2 text-[10px] text-slate-400 hover:text-white hover:bg-slate-800 gap-1 cursor-pointer"
                              >
                                <Edit className="size-3" />
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleUnlinkProperty(prop.id)}
                                className="h-7 px-2 text-[10px] text-slate-450 hover:text-red-400 hover:bg-slate-800 gap-1 cursor-pointer"
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

              {/* Requirements & Notes Tab */}
              <TabsContent
                value="requirements"
                className="flex-1 overflow-hidden p-6 focus-visible:outline-none flex gap-6 min-h-0"
              >
                {/* Requirements Editor (Left half) */}
                <div className="flex-1 flex flex-col bg-slate-900/30 border border-slate-800/80 rounded-xl p-5 h-full overflow-hidden">
                  <div className="flex items-center justify-between mb-3 shrink-0">
                    <h3 className="text-sm font-semibold text-white flex items-center gap-1.5">
                      <FileText className="size-4 text-primary" />
                      Agent Requirements & Brief
                    </h3>
                    <Button
                      size="sm"
                      onClick={handleSaveRequirements}
                      disabled={savingRequirements}
                      className="bg-primary hover:bg-primary/90 text-primary-foreground h-8 text-xs font-bold gap-1 cursor-pointer"
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
                      className="w-full h-full bg-slate-950/40 border-slate-800 text-xs text-slate-200 placeholder:text-slate-500 resize-none focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-0 p-4 rounded-lg"
                    />
                  </div>
                </div>

                {/* Notes Roster (Right half) */}
                <div className="w-80 flex flex-col bg-slate-900/30 border border-slate-800/80 rounded-xl p-5 h-full shrink-0 overflow-hidden">
                  <h3 className="text-sm font-semibold text-white mb-3 shrink-0 flex items-center gap-1.5">
                    <MessageSquare className="size-4 text-primary" />
                    Agent Notes
                  </h3>

                  <div className="space-y-2 mb-4 shrink-0">
                    <Textarea
                      value={newNoteText}
                      onChange={(e) => setNewNoteText(e.target.value)}
                      placeholder="Add brief details, todo points, tasks..."
                      className="bg-slate-950/40 border-slate-850 text-xs text-white placeholder:text-slate-500 h-16 resize-none focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-0"
                    />
                    <Button
                      size="sm"
                      onClick={handleAddNote}
                      disabled={savingNote || !newNoteText.trim()}
                      className="bg-primary hover:bg-primary/90 text-primary-foreground w-full h-8 text-xs font-bold cursor-pointer"
                    >
                      {savingNote && <Loader2 className="size-3 animate-spin mr-1" />}
                      Add note
                    </Button>
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
                    {loadingNotes ? (
                      <div className="flex items-center justify-center py-6">
                        <ConvoRealLoader size={16} label="Loading notes" />
                      </div>
                    ) : notes.length === 0 ? (
                      <p className="text-slate-500 text-[11px] text-center py-6">No notes recorded yet</p>
                    ) : (
                      notes.map((note) => (
                        <div
                          key={note.id}
                          className="p-3 bg-slate-950/30 border border-slate-850 rounded-lg text-[11px] text-slate-350"
                        >
                          <p className="whitespace-pre-wrap leading-relaxed">{note.note_text}</p>
                          <span className="block text-[9px] text-slate-550 mt-1.5">
                            {new Date(note.created_at).toLocaleDateString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
            <Users className="size-16 text-slate-700 mb-4 opacity-40 animate-pulse" />
            <h3 className="text-base font-semibold text-white mb-1">Select an Agent</h3>
            <p className="text-xs text-slate-500">
              Select an agent from the directory sidebar to view showcase properties and notes.
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
