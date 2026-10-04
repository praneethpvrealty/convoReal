'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, Plus, Search, X } from 'lucide-react';
import type { Contact } from '@/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NameTagBadge } from '@/components/contacts/name-tag-badge';
import { hasPhone } from '@/lib/contacts/reachability';
import type { SetPropertyFormField } from '@/hooks/usePropertyForm';
import type { PropertyFormValues } from '@/lib/inventory/property-form-state';

interface OwnerSectionProps {
  values: PropertyFormValues;
  set: SetPropertyFormField;
  contacts: Contact[];
  contactedContactIds: Set<string>;
  ownerSearchInput: string;
  setOwnerSearchInput: (value: string) => void;
  handleGoToChat: (contactId: string) => Promise<void>;
}

export function OwnerSection({
  values,
  set,
  contacts,
  contactedContactIds,
  ownerSearchInput,
  setOwnerSearchInput,
  handleGoToChat,
}: OwnerSectionProps) {
  const { ownerContactId, listingSource, interestedContactIds } = values;
  const [contactSearchInput, setContactSearchInput] = useState('');
  const [isContactDropdownOpen, setIsContactDropdownOpen] = useState(false);

  const [isOwnerDropdownOpen, setIsOwnerDropdownOpen] = useState(false);

  // Close owner dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-owner-dropdown]')) {
        setIsOwnerDropdownOpen(false);
      }
    }
    if (isOwnerDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () =>
        document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOwnerDropdownOpen]);

  const contactSearchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        contactSearchRef.current &&
        !contactSearchRef.current.contains(event.target as Node)
      ) {
        setIsContactDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const contactSearchResults = useMemo(() => {
    if (!contactSearchInput.trim()) return [];
    const query = contactSearchInput.toLowerCase();
    return contacts.filter((c) => {
      if (c.classification !== 'Buyer' && c.classification !== 'Agent')
        return false;
      if (interestedContactIds.includes(c.id)) return false;
      // The share goes out over WhatsApp — an email-only contact has
      // nowhere to receive it.
      if (!hasPhone(c)) return false;
      return (
        (c.name || '').toLowerCase().includes(query) ||
        (c.phone ?? '').toLowerCase().includes(query) ||
        (c.email || '').toLowerCase().includes(query)
      );
    });
  }, [contacts, contactSearchInput, interestedContactIds]);

  const interestedContacts = useMemo(() => {
    return contacts.filter((c) => interestedContactIds.includes(c.id));
  }, [contacts, interestedContactIds]);

  const handleAddInterestedContact = (contactId: string) => {
    if (!interestedContactIds.includes(contactId)) {
      set('interestedContactIds', (prev) => [...prev, contactId]);
    }
    setContactSearchInput('');
    setIsContactDropdownOpen(false);
  };

  // Handle owner selection with auto-detection of listing source
  function handleOwnerSelect(contactId: string | null) {
    set('ownerContactId', contactId);
    setIsOwnerDropdownOpen(false);

    // Set search input to display the selected contact's name
    if (contactId) {
      const selectedContact = contacts.find((c) => c.id === contactId);
      if (selectedContact) {
        setOwnerSearchInput(
          selectedContact.name || selectedContact.phone || ''
        );
        // Auto-detect listing source based on selected contact's classification
        const classification =
          selectedContact.classification?.toLowerCase() || '';
        if (classification === 'agent') {
          set('listingSource', 'agent');
        } else {
          set('listingSource', 'owner');
        }
      }
    } else {
      setOwnerSearchInput('');
    }
  }

  // Filter contacts for owner search
  const filteredOwnerContacts = useMemo(() => {
    if (!ownerSearchInput.trim()) return contacts;
    const query = ownerSearchInput.toLowerCase();
    return contacts.filter(
      (c) =>
        c.name?.toLowerCase().includes(query) ||
        c.phone?.toLowerCase().includes(query) ||
        c.email?.toLowerCase().includes(query)
    );
  }, [contacts, ownerSearchInput]);

  return (
    <div
      id="pf-owner"
      className="scroll-mt-2 space-y-4 rounded-lg border border-slate-800 bg-slate-950/20 p-4"
    >
      <h4 className="text-sm font-semibold text-white">Owner & Inquiries</h4>

      <div className="grid grid-cols-2 gap-4">
        <div
          className="col-span-2 space-y-1.5 md:col-span-1"
          data-owner-dropdown
        >
          <Label htmlFor="prop-owner" className="text-slate-300">
            Select Contact (Owner/Agent)
          </Label>
          <div className="relative">
            <Input
              type="text"
              placeholder="Search by name, phone or email..."
              value={ownerSearchInput}
              onChange={(e) => {
                setOwnerSearchInput(e.target.value);
                setIsOwnerDropdownOpen(true);
              }}
              onFocus={() => setIsOwnerDropdownOpen(true)}
              readOnly={!!ownerContactId}
              className={`h-9 border-slate-700 bg-slate-800 text-sm text-white placeholder:text-slate-500 ${
                ownerContactId ? 'cursor-default' : ''
              }`}
            />
            {ownerContactId && (
              <button
                type="button"
                onClick={() => handleOwnerSelect(null)}
                className="absolute top-1/2 right-2 -translate-y-1/2 text-slate-500 hover:text-white"
              >
                ×
              </button>
            )}
            {ownerContactId && (
              <div className="absolute top-1/2 right-8 -translate-y-1/2">
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] ${
                    listingSource === 'agent'
                      ? 'bg-blue-500/20 text-blue-400'
                      : 'bg-amber-500/20 text-amber-400'
                  }`}
                >
                  {listingSource === 'agent' ? 'Agent' : 'Owner'}
                </span>
              </div>
            )}
            {isOwnerDropdownOpen && filteredOwnerContacts.length > 0 && (
              <div className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border border-slate-700 bg-slate-800 shadow-lg">
                {filteredOwnerContacts.map((contact) => (
                  <button
                    key={contact.id}
                    type="button"
                    onClick={() => handleOwnerSelect(contact.id)}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-700 ${
                      ownerContactId === contact.id
                        ? 'bg-primary/20 text-primary'
                        : 'text-white'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      <span className="truncate">
                        {contact.name || 'Unnamed'} ({contact.phone})
                      </span>
                      <NameTagBadge tag={contact.name_tag} />
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] ${
                        contact.classification === 'Agent'
                          ? 'bg-blue-500/20 text-blue-400'
                          : contact.classification === 'Owner'
                            ? 'bg-amber-500/20 text-amber-400'
                            : 'bg-slate-600 text-slate-300'
                      }`}
                    >
                      {contact.classification}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="col-span-2 space-y-1.5 md:col-span-1">
          <Label htmlFor="prop-listing-source" className="text-slate-300">
            Listing Source
          </Label>
          {ownerContactId ? (
            <div className="flex h-9 items-center rounded-md border border-slate-700 bg-slate-800 px-3">
              <span
                className={`text-sm font-medium ${
                  listingSource === 'agent' ? 'text-blue-400' : 'text-amber-400'
                }`}
              >
                {listingSource === 'agent'
                  ? 'Referred by Agent'
                  : 'Direct (from Owner)'}
              </span>
            </div>
          ) : (
            <div className="flex h-9 items-center rounded-md border border-slate-700 bg-slate-800/50 px-3">
              <span className="text-sm text-slate-500">
                Select a contact first
              </span>
            </div>
          )}
          <p className="text-[10px] leading-normal font-medium text-slate-500">
            Auto-detected based on selected contact&apos;s classification
          </p>
        </div>

        <div className="col-span-2 space-y-3" ref={contactSearchRef}>
          <div className="flex items-center justify-between">
            <Label className="text-slate-350 font-medium">
              Contacts with Shown Interest (Buyers & Agents)
            </Label>
            <span className="rounded-full border border-slate-800 bg-slate-900 px-2 py-0.5 text-[10px] font-medium text-slate-500">
              {interestedContacts.length} Linked
            </span>
          </div>

          {/* Autocomplete Contact Search Input */}
          <div className="relative">
            <div className="relative">
              <Search className="absolute top-2.5 left-3 h-4 w-4 text-slate-500" />
              <Input
                type="text"
                placeholder="Search Buyer or Agent by name, phone or email..."
                value={contactSearchInput}
                onChange={(e) => {
                  setContactSearchInput(e.target.value);
                  setIsContactDropdownOpen(true);
                }}
                onFocus={() => setIsContactDropdownOpen(true)}
                className="h-9 border-slate-700 bg-slate-800 pr-9 pl-9 text-xs text-white placeholder:text-slate-500"
              />
              {contactSearchInput && (
                <button
                  type="button"
                  onClick={() => {
                    setContactSearchInput('');
                    setIsContactDropdownOpen(false);
                  }}
                  className="absolute top-2.5 right-3 text-slate-500 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Dropdown search results */}
            {isContactDropdownOpen && contactSearchInput.trim() && (
              <div className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-slate-700 bg-slate-900 p-1 shadow-xl">
                {contactSearchResults.length > 0 ? (
                  contactSearchResults.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleAddInterestedContact(c.id)}
                      className="flex w-full items-center justify-between rounded px-2.5 py-1.5 text-left text-xs text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
                    >
                      <div className="truncate pr-4">
                        <span className="flex items-center gap-1.5 truncate font-semibold text-slate-200">
                          <span className="truncate">
                            {c.name || 'Unnamed'} ({c.phone})
                          </span>
                          <NameTagBadge tag={c.name_tag} />
                        </span>
                        <span className="block truncate text-[10px] text-slate-500">
                          Classification: {c.classification}
                        </span>
                      </div>
                      <Plus className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                    </button>
                  ))
                ) : (
                  <div className="py-2 text-center text-xs text-slate-500">
                    No matching Buyers or Agents found (or already linked)
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Linked Contacts list */}
          <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border border-slate-700 bg-slate-900 p-2">
            {interestedContacts.length > 0 ? (
              interestedContacts.map((c) => {
                const isHot =
                  c.lead_temp === 'HOT' || c.status === 'pending_review';
                const isContacted =
                  contactedContactIds.has(c.id) || !!c.last_contacted_at;
                const isCold = c.lead_temp === 'COLD' || c.lead_temp === 'Dead';

                // Style based on interest and contact status
                let cardBorderClass = 'border-slate-800 bg-slate-800/20';
                if (isHot) {
                  cardBorderClass =
                    'border-[#00ff88]/40 bg-[#00ff88]/5 shadow-[0_0_8px_rgba(0,255,136,0.06)]';
                } else if (isCold) {
                  cardBorderClass = 'border-rose-950/30 bg-rose-950/5';
                } else if (isContacted) {
                  cardBorderClass = 'border-emerald-600/30 bg-emerald-950/5';
                }

                return (
                  <div
                    key={c.id}
                    className={`flex items-center justify-between gap-3 rounded-md border p-2.5 text-xs transition-all ${cardBorderClass}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-bold text-slate-200">
                          {c.name || 'Unnamed'}
                        </span>
                        <NameTagBadge tag={c.name_tag} />
                        <span className="text-[10px] text-slate-500">
                          ({c.phone})
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                          {c.classification || 'Buyer'}
                        </span>
                        <span className="text-[10px] text-slate-600">•</span>

                        {/* Status badges */}
                        {isHot && (
                          <span className="animate-pulse rounded border border-[#00ff88]/30 bg-[#00ff88]/10 px-1.5 py-0.5 text-[9px] font-bold text-[#00ff88] uppercase">
                            Interested (Hot)
                          </span>
                        )}
                        {isContacted && (
                          <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[9px] font-medium text-white uppercase">
                            Contacted
                          </span>
                        )}
                        {isCold && (
                          <span className="rounded border border-rose-950/50 bg-rose-950/40 px-1.5 py-0.5 text-[9px] font-medium text-rose-400 uppercase">
                            Not Interested
                          </span>
                        )}
                        {!isHot && !isContacted && !isCold && (
                          <span className="bg-slate-850 rounded border border-slate-700 px-1.5 py-0.5 text-[9px] font-medium text-slate-400 uppercase">
                            Not Contacted
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleGoToChat(c.id)}
                        className="hover:bg-slate-750 rounded border border-slate-700 bg-slate-800 p-1.5 text-slate-400 transition-colors hover:text-emerald-400"
                        title="Go to WhatsApp Chat Inbox"
                        aria-label="Open Chat"
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          set('interestedContactIds', (prev) =>
                            prev.filter((id) => id !== c.id)
                          );
                        }}
                        className="rounded border border-slate-700 bg-slate-800 p-1.5 text-slate-400 transition-colors hover:border-rose-900/50 hover:bg-rose-950/50 hover:text-rose-400"
                        title="Remove link"
                        aria-label="Remove Contact Link"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="py-6 text-center text-xs text-slate-500">
                No interested contacts linked to this property yet. Use the
                search bar above to link contacts.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
