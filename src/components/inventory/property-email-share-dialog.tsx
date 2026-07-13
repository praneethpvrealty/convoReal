'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import type { Property, Contact } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Loader2, Mail, X, Copy, Check, ExternalLink, Paperclip, Search } from 'lucide-react';
import { buildPropertyShareEmailContent } from '@/lib/email/property-share-email';

interface PropertyEmailShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  property: Property | null;
}

interface EmailRecipient {
  id: string; // contact id, or `manual:<email>` for typed-in addresses
  name: string;
  email: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function firstName(name: string): string {
  return (name || '').trim().split(/\s+/)[0] || name;
}

function parseDocumentTitle(raw: string, index: number): string {
  try {
    const parsed = JSON.parse(raw) as { url?: string; title?: string };
    return parsed.title?.trim() || `Document ${index + 1}`;
  } catch {
    return `Document ${index + 1}`;
  }
}

export function PropertyEmailShareDialog({ open, onOpenChange, property }: PropertyEmailShareDialogProps) {
  const supabase = createClient();
  const { accountId, profile } = useAuth();

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [recipients, setRecipients] = useState<EmailRecipient[]>([]);
  const [manualEmailInput, setManualEmailInput] = useState('');

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [bodyDirty, setBodyDirty] = useState(false);
  const [copied, setCopied] = useState(false);

  const documentTitles = useMemo(
    () => (property?.documents || []).map((d, i) => parseDocumentTitle(d, i)),
    [property?.documents]
  );

  const fetchContacts = useCallback(async () => {
    if (!accountId) return;
    setLoadingContacts(true);
    try {
      const { data, error } = await supabase
        .from('contacts')
        .select('id, name, email, phone, classification')
        .eq('account_id', accountId)
        .eq('status', 'active')
        .not('email', 'is', null)
        .order('name');
      if (error) throw error;
      setContacts((data || []).filter((c) => c.email && EMAIL_PATTERN.test(c.email)) as Contact[]);
    } catch {
      toast.error('Could not load contacts');
    } finally {
      setLoadingContacts(false);
    }
  }, [supabase, accountId]);

  // Reset + regenerate the draft each time the dialog opens for a property.
  useEffect(() => {
    if (!open || !property) return;
    setRecipients([]);
    setManualEmailInput('');
    setContactSearch('');
    setBodyDirty(false);
    setCopied(false);
    fetchContacts();
    const { subject: s, body: b } = buildPropertyShareEmailContent(property, {
      agentName: profile?.full_name || null,
      agentPhone: profile?.phone || null,
    });
    setSubject(s);
    setBody(b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, property?.id]);

  // Regenerate the greeting when recipients change, as long as the agent
  // hasn't started hand-editing the body (don't clobber their edits).
  useEffect(() => {
    if (!open || !property || bodyDirty) return;
    const { body: b } = buildPropertyShareEmailContent(property, {
      recipientNames: recipients.map((r) => firstName(r.name)),
      agentName: profile?.full_name || null,
      agentPhone: profile?.phone || null,
    });
    setBody(b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipients]);

  const filteredContacts = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    const pool = q
      ? contacts.filter(
          (c) => c.name?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q)
        )
      : contacts;
    return pool.filter((c) => !recipients.some((r) => r.id === c.id));
  }, [contacts, contactSearch, recipients]);

  function addContactRecipient(contact: Contact) {
    if (!contact.email) return;
    setRecipients((prev) => [...prev, { id: contact.id, name: contact.name || contact.email!, email: contact.email! }]);
    setContactSearch('');
  }

  function addManualEmail() {
    const email = manualEmailInput.trim();
    if (!email) return;
    if (!EMAIL_PATTERN.test(email)) {
      toast.error('Enter a valid email address');
      return;
    }
    if (recipients.some((r) => r.email.toLowerCase() === email.toLowerCase())) {
      toast.error('That address is already added');
      return;
    }
    setRecipients((prev) => [...prev, { id: `manual:${email}`, name: email.split('@')[0], email }]);
    setManualEmailInput('');
  }

  function removeRecipient(id: string) {
    setRecipients((prev) => prev.filter((r) => r.id !== id));
  }

  const toList = recipients.map((r) => r.email);

  function openInGmail() {
    if (toList.length === 0) {
      toast.error('Add at least one recipient first');
      return;
    }
    const url = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(toList.join(','))}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function openInMailApp() {
    if (toList.length === 0) {
      toast.error('Add at least one recipient first');
      return;
    }
    window.location.href = `mailto:${encodeURIComponent(toList.join(','))}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  async function copyBody() {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      toast.success('Email body copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy to clipboard');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="size-5 text-primary" /> Share via Email
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Prefills a draft from this listing&apos;s details. Review, then open it in Gmail or your mail app to send.
          </DialogDescription>
        </DialogHeader>

        {!property ? (
          <div className="py-10 flex justify-center">
            <Loader2 className="size-6 animate-spin text-slate-500" />
          </div>
        ) : (
          <div className="space-y-5">
            {/* Recipients */}
            <div className="space-y-2">
              <Label className="text-slate-300">To</Label>
              {recipients.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {recipients.map((r) => (
                    <Badge
                      key={r.id}
                      className="bg-slate-800 text-slate-200 border border-slate-700 font-medium gap-1.5 pr-1 py-1"
                    >
                      {r.name} <span className="text-slate-500">({r.email})</span>
                      <button
                        type="button"
                        onClick={() => removeRecipient(r.id)}
                        className="ml-1 rounded-full hover:bg-slate-700 p-0.5"
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}

              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-500" />
                <Input
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  placeholder="Search contacts by name or email..."
                  className="pl-8 bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-9"
                />
              </div>
              {contactSearch.trim() && (
                <div className="border border-slate-800 rounded-md max-h-40 overflow-y-auto divide-y divide-slate-800">
                  {loadingContacts ? (
                    <div className="p-3 text-xs text-slate-500 flex items-center gap-2">
                      <Loader2 className="size-3.5 animate-spin" /> Loading contacts...
                    </div>
                  ) : filteredContacts.length === 0 ? (
                    <div className="p-3 text-xs text-slate-500">No matching contacts with an email on file.</div>
                  ) : (
                    filteredContacts.slice(0, 8).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => addContactRecipient(c)}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-slate-800 flex items-center justify-between gap-2"
                      >
                        <span className="text-slate-200 font-medium truncate">{c.name}</span>
                        <span className="text-slate-500 truncate">{c.email}</span>
                      </button>
                    ))
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <Input
                  value={manualEmailInput}
                  onChange={(e) => setManualEmailInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addManualEmail();
                    }
                  }}
                  placeholder="Or type any other email address..."
                  className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-9"
                />
                <Button type="button" variant="outline" size="sm" onClick={addManualEmail} className="h-9 border-slate-700">
                  Add
                </Button>
              </div>
            </div>

            {/* Subject */}
            <div className="space-y-1.5">
              <Label htmlFor="email-share-subject" className="text-slate-300">Subject</Label>
              <Input
                id="email-share-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>

            {/* Body */}
            <div className="space-y-1.5">
              <Label htmlFor="email-share-body" className="text-slate-300">Body</Label>
              <Textarea
                id="email-share-body"
                value={body}
                onChange={(e) => {
                  setBody(e.target.value);
                  setBodyDirty(true);
                }}
                rows={14}
                className="bg-slate-800 border-slate-700 text-white font-mono text-xs leading-relaxed min-h-72"
              />
            </div>

            {/* Attachment reminder */}
            {documentTitles.length > 0 && (
              <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-500/20 bg-amber-500/5 text-xs text-amber-300">
                <Paperclip className="size-3.5 shrink-0 mt-0.5" />
                <div>
                  This draft can&apos;t carry attachments. Remember to attach{' '}
                  {documentTitles.length === 1 ? documentTitles[0] : documentTitles.join(', ')} from the listing before sending.
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-800">
              <Button type="button" onClick={openInGmail} className="bg-primary hover:bg-primary/90 text-primary-foreground gap-1.5">
                <ExternalLink className="size-4" /> Open in Gmail
              </Button>
              <Button type="button" variant="outline" onClick={openInMailApp} className="border-slate-700 hover:bg-slate-800 gap-1.5">
                <Mail className="size-4" /> Open in Mail App
              </Button>
              <Button type="button" variant="outline" onClick={copyBody} className="border-slate-700 hover:bg-slate-800 gap-1.5">
                {copied ? <Check className="size-4 text-emerald-400" /> : <Copy className="size-4" />}
                {copied ? 'Copied' : 'Copy Body'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
