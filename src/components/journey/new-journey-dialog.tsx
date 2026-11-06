'use client';

/**
 * "New journey" picker — jump to (or start) any subject's journey.
 * Both selects are always offered regardless of which overview tab is
 * active; picking navigates to the focused view, where an empty
 * journey shows its add/import affordances.
 */

import { useEffect, useState } from 'react';
import { Building2, UserRound } from 'lucide-react';
import { toast } from 'sonner';

import { dealsHref } from '@/lib/deals/routes';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SearchableContactSelect } from '@/components/ui/searchable-contact-select';
import { SearchablePropertySelect } from '@/components/ui/searchable-property-select';
import type { Contact, Property } from '@/types';
import { navigateJourney } from './shared';
import { contactHandle } from '@/lib/contacts/reachability';
import { ilikeAcross, ilikeTerm } from '@/lib/postgrest-search';
import { PICKER_LIMIT, pickerTruncatedNotice } from '@/lib/journey/picker';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';

export function NewJourneyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const supabase = createClient();
  const { accountId } = useAuth();

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [contactsTruncated, setContactsTruncated] = useState(false);
  const [propertiesTruncated, setPropertiesTruncated] = useState(false);
  const [contactsLoaded, setContactsLoaded] = useState(false);
  const [propertiesLoaded, setPropertiesLoaded] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [propertySearch, setPropertySearch] = useState('');
  const contactTerm = ilikeTerm(useDebouncedValue(contactSearch, 300)) ?? '';
  const propertyTerm = ilikeTerm(useDebouncedValue(propertySearch, 300)) ?? '';

  useEffect(() => {
    if (!open || !accountId) return;
    let cancelled = false;
    (async () => {
      let query = supabase
        .from('contacts')
        .select('id, name, phone, name_tag')
        .eq('account_id', accountId);
      if (contactTerm) {
        query = query.or(
          ilikeAcross(['name', 'phone', 'name_tag'], contactTerm)
        );
      }
      const { data, error } = await query
        .order('created_at', { ascending: false })
        .limit(PICKER_LIMIT + 1);
      if (cancelled) return;
      if (error) {
        toast.error('Could not load contacts');
        return;
      }
      const found = (data ?? []) as Contact[];
      setContactsTruncated(found.length > PICKER_LIMIT);
      setContacts(found.slice(0, PICKER_LIMIT));
      setContactsLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, accountId, contactTerm, supabase]);

  useEffect(() => {
    if (!open || !accountId) return;
    let cancelled = false;
    (async () => {
      let query = supabase
        .from('properties')
        .select(
          'id, title, property_code, location, sublocality, project, tags'
        )
        .eq('account_id', accountId);
      if (propertyTerm) {
        query = query.or(
          ilikeAcross(
            ['title', 'property_code', 'location', 'sublocality', 'project'],
            propertyTerm
          )
        );
      }
      const { data, error } = await query
        .order('created_at', { ascending: false })
        .limit(PICKER_LIMIT + 1);
      if (cancelled) return;
      if (error) {
        toast.error('Could not load properties');
        return;
      }
      const found = (data ?? []) as Property[];
      setPropertiesTruncated(found.length > PICKER_LIMIT);
      setProperties(found.slice(0, PICKER_LIMIT));
      setPropertiesLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, accountId, propertyTerm, supabase]);

  // Same-pathname navigation (/journey → /journey?…) — must go through
  // the History API on this Next version; see navigateJourney.
  const go = (path: string) => {
    onOpenChange(false);
    navigateJourney(path);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-slate-800 bg-slate-950">
        <DialogHeader>
          <DialogTitle className="text-slate-100">Open a journey</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-300">
              <UserRound className="text-primary h-3.5 w-3.5" />
              Buyer journey
            </p>
            <SearchableContactSelect
              contacts={contacts.map((c) => ({
                id: c.id,
                name: c.name ?? contactHandle(c),
                phone: c.phone,
                name_tag: c.name_tag,
              }))}
              value={null}
              onChange={(id) => id && go(dealsHref('journey', { contact: id }))}
              placeholder={
                contactsLoaded ? 'Select a contact…' : 'Loading contacts…'
              }
              onSearchChange={setContactSearch}
              notice={
                contactsTruncated
                  ? pickerTruncatedNotice(
                      PICKER_LIMIT,
                      'contacts',
                      Boolean(contactTerm)
                    )
                  : null
              }
            />
          </div>
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-300">
              <Building2 className="text-primary h-3.5 w-3.5" />
              Property journey
            </p>
            <SearchablePropertySelect
              properties={properties}
              value={null}
              onChange={(id) =>
                id && go(dealsHref('journey', { property: id }))
              }
              placeholder={
                propertiesLoaded ? 'Select a property…' : 'Loading properties…'
              }
              onSearchChange={setPropertySearch}
              notice={
                propertiesTruncated
                  ? pickerTruncatedNotice(
                      PICKER_LIMIT,
                      'properties',
                      Boolean(propertyTerm)
                    )
                  : null
              }
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
