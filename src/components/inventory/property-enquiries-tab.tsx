'use client';

import { useState } from 'react';
import { useCan } from '@/hooks/use-can';
import type { Property } from '@/types';
import { Button } from '@/components/ui/button';
import { TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  Loader2,
  MessageSquare,
  Phone,
  CalendarPlus,
  Eye,
  AlertTriangle,
} from 'lucide-react';
import { NameTagBadge } from '@/components/contacts/name-tag-badge';
import { formatAuditDateTime } from '@/lib/audit-timestamps';
import { ScheduleDialog } from '@/components/calendar/schedule-dialog';
import { PropertyInterestFollowUpDialog } from '@/components/contacts/property-interest-follow-up-dialog';
import {
  dialableAudiencePhone,
  type AudienceContact,
} from '@/lib/inventory/listing-audience';

interface PropertyEnquiriesTabProps {
  property?: Property | null;
  enquiredContacts: AudienceContact[];
  loadingListingAudience: boolean;
  listingAudienceError: boolean;
  fetchListingEnquiries: () => Promise<void>;
}

export function PropertyEnquiriesTab({
  property,
  enquiredContacts,
  loadingListingAudience,
  listingAudienceError,
  fetchListingEnquiries,
}: PropertyEnquiriesTabProps) {
  const canEdit = useCan('send-messages');
  const [followUpContactId, setFollowUpContactId] = useState<string | null>(
    null
  );
  const [messageContact, setMessageContact] = useState<AudienceContact | null>(
    null
  );

  return (
    <>
      <TabsContent
        value="enquiries"
        className="m-0 flex min-h-0 flex-1 flex-col px-6 py-4 focus:outline-none"
      >
        <div className="border-primary/25 bg-primary/5 mb-4 flex items-center gap-3 rounded-xl border p-3.5">
          <div className="bg-primary text-primary-foreground flex size-9 shrink-0 items-center justify-center rounded-full">
            <MessageSquare className="size-4" />
          </div>
          <div>
            <div className="text-sm font-bold text-white">
              {loadingListingAudience
                ? 'Loading enquiries…'
                : `${enquiredContacts.length} contact${enquiredContacts.length === 1 ? '' : 's'} enquired`}
            </div>
            <div className="text-xs text-slate-400">
              Portal enquiries and contacts marked as directly interested
            </div>
          </div>
        </div>

        <div className="min-h-[30vh] flex-1 space-y-3 overflow-y-auto pr-1">
          {loadingListingAudience ? (
            <div className="flex items-center justify-center py-12 text-slate-500">
              <Loader2 className="text-primary mr-2 size-6 animate-spin" />
              Loading enquiries…
            </div>
          ) : listingAudienceError ? (
            <div className="rounded-xl border border-dashed border-rose-900/50 bg-rose-950/10 py-12 text-center">
              <AlertTriangle className="mx-auto mb-2 size-8 text-rose-400" />
              <p className="text-sm font-medium text-slate-300">
                Could not load enquired contacts
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={fetchListingEnquiries}
                className="mt-3 border-slate-700"
              >
                Try again
              </Button>
            </div>
          ) : enquiredContacts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/30 py-12 text-center">
              <MessageSquare className="mx-auto mb-2 size-8 text-slate-600" />
              <p className="text-sm font-medium text-slate-400">
                No enquiries recorded yet
              </p>
              <p className="text-slate-550 mt-1 text-xs">
                Portal leads and contacts marked as interested will appear here.
              </p>
            </div>
          ) : (
            enquiredContacts.map((contact) => {
              const displayName =
                contact.name || contact.phone || 'Unnamed contact';
              return (
                <div
                  key={contact.contactId}
                  className="rounded-xl border border-slate-800 bg-slate-900 p-3.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="truncate text-sm font-bold text-white">
                          {displayName}
                        </h4>
                        <NameTagBadge tag={contact.nameTag} />
                        {contact.classification && (
                          <Badge className="rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold text-emerald-400">
                            {contact.classification}
                          </Badge>
                        )}
                      </div>
                      {contact.phone && (
                        <p className="text-slate-450 mt-0.5 font-mono text-xs">
                          {contact.phone}
                        </p>
                      )}
                      {contact.lastAt && (
                        <p className="mt-1 text-[10px] text-slate-500">
                          Last enquiry {formatAuditDateTime(contact.lastAt)}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-2">
                    <a
                      href={`/contacts?contactId=${encodeURIComponent(contact.contactId)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-semibold text-slate-400 hover:bg-slate-800 hover:text-white"
                    >
                      <Eye className="size-3.5" /> View contact
                    </a>
                    {canEdit && contact.phone ? (
                      <a
                        href={`tel:${dialableAudiencePhone(contact.phone)}`}
                        className="text-primary hover:bg-primary/10 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-semibold"
                      >
                        <Phone className="size-3.5" /> Call
                      </a>
                    ) : null}
                    {canEdit ? (
                      <button
                        type="button"
                        onClick={() => setMessageContact(contact)}
                        className="text-primary hover:bg-primary/10 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-semibold"
                      >
                        <MessageSquare className="size-3.5" /> Message
                      </button>
                    ) : null}
                    {canEdit ? (
                      <button
                        type="button"
                        onClick={() => setFollowUpContactId(contact.contactId)}
                        className="bg-primary/10 text-primary hover:bg-primary/20 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold"
                      >
                        <CalendarPlus className="size-3.5" /> Follow up
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </TabsContent>

      <ScheduleDialog
        open={followUpContactId !== null}
        onOpenChange={(next) => {
          if (!next) setFollowUpContactId(null);
        }}
        contactId={followUpContactId}
        propertyId={property?.id ?? null}
        initialTitle={
          property
            ? `Follow up — ${property.property_code || property.title}`
            : undefined
        }
      />

      {messageContact && property ? (
        <PropertyInterestFollowUpDialog
          open
          onOpenChange={(next) => {
            if (!next) setMessageContact(null);
          }}
          contactId={messageContact.contactId}
          contactName={messageContact.name ?? ''}
          contactPhone={messageContact.phone}
          property={property}
          onSent={() => {
            void fetchListingEnquiries();
          }}
        />
      ) : null}
    </>
  );
}
