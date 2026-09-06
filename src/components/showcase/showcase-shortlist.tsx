'use client';

import { useRef, useState } from 'react';
import { BookmarkCheck, CheckCircle, X } from 'lucide-react';
import type { Property } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getShowcaseSessionKey } from '@/lib/pulse/session-key';

interface ShowcaseShortlistProps {
  properties: Property[];
  accountId: string;
  referrerContactId?: string;
  name: string;
  phone: string;
  email: string;
  onRemove: (id: string) => void;
  onClear: () => void;
}

export function ShowcaseShortlist(props: ShowcaseShortlistProps) {
  const [open, setOpen] = useState(false);
  if (!props.properties.length && !open) return null;
  return (
    <>
      {!open && (
        <div
          data-showcase-shortlist
          className="fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-lg flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-700 bg-slate-950/95 p-3 shadow-xl backdrop-blur"
          style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
        >
          <span
            className="flex items-center gap-2 text-sm font-semibold text-white"
            aria-live="polite"
          >
            <BookmarkCheck className="size-4" />
            {props.properties.length} shortlisted
          </span>
          <Button
            className="min-h-11 flex-1 whitespace-nowrap"
            onClick={() => setOpen(true)}
          >
            Enquire about selected
          </Button>
        </div>
      )}
      {open && <ShortlistEnquiry {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

function ShortlistEnquiry({
  properties,
  accountId,
  referrerContactId,
  name: initialName,
  phone: initialPhone,
  email: initialEmail,
  onRemove,
  onClear,
  onClose,
}: ShowcaseShortlistProps & { onClose: () => void }) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [email, setEmail] = useState(initialEmail);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [sentCount, setSentCount] = useState(0);
  const inFlight = useRef(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current || !properties.length || !name.trim() || !phone.trim())
      return;
    inFlight.current = true;
    setPending(true);
    setError('');
    try {
      const response = await fetch('/api/public/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId,
          propertyIds: properties.map((property) => property.id),
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim() || undefined,
          message: message.trim() || undefined,
          referrerContactId,
          sessionKey: getShowcaseSessionKey(),
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.success !== true)
        throw new Error(
          result?.error || 'Could not send your enquiry. Please try again.'
        );
      setSentCount(properties.length);
      onClear();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not send your enquiry. Please try again.'
      );
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !pending) onClose();
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {sentCount ? 'Enquiry sent' : 'Your shortlist'}
          </DialogTitle>
          <DialogDescription>
            {sentCount
              ? `Your enquiry includes ${sentCount} ${sentCount === 1 ? 'property' : 'properties'}. The team will follow up with you.`
              : 'Review your properties and send one enquiry for all of them.'}
          </DialogDescription>
        </DialogHeader>
        {sentCount ? (
          <div className="space-y-4">
            <CheckCircle className="size-9 text-emerald-500" />
            <Button onClick={onClose}>Continue browsing</Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <ul className="space-y-2">
              {properties.map((property) => (
                <li
                  key={property.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 p-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium break-words">
                      {property.title}
                    </p>
                    <p className="text-xs text-slate-400">
                      {property.property_code || property.location}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-11 shrink-0"
                    aria-label={`Remove ${property.title} from shortlist`}
                    disabled={pending}
                    onClick={() => onRemove(property.id)}
                  >
                    <X className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
            {!properties.length && (
              <p>
                Your shortlist is empty. Close this window to choose properties.
              </p>
            )}
            {properties.length > 0 && (
              <>
                <label className="block space-y-1 text-sm">
                  <span>Your name</span>
                  <Input
                    required
                    maxLength={120}
                    autoComplete="name"
                    value={name}
                    disabled={pending}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <label className="block space-y-1 text-sm">
                  <span>Mobile number</span>
                  <Input
                    required
                    type="tel"
                    maxLength={30}
                    autoComplete="tel"
                    value={phone}
                    disabled={pending}
                    onChange={(event) => setPhone(event.target.value)}
                  />
                </label>
                <label className="block space-y-1 text-sm">
                  <span>Email (optional)</span>
                  <Input
                    type="email"
                    maxLength={254}
                    autoComplete="email"
                    value={email}
                    disabled={pending}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </label>
                <label className="block space-y-1 text-sm">
                  <span>Message (optional)</span>
                  <Textarea
                    maxLength={2000}
                    value={message}
                    disabled={pending}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder="Please share more details or arrange visits for these properties."
                  />
                </label>
                <p className="text-xs text-slate-400">
                  By sending this enquiry, you agree to be contacted about these
                  properties.
                </p>
              </>
            )}
            {error && (
              <p role="alert" className="text-sm text-red-400">
                {error}
              </p>
            )}
            <Button
              type="submit"
              className="min-h-11 w-full"
              disabled={pending || !properties.length}
            >
              {pending
                ? 'Sending…'
                : `Send enquiry for ${properties.length} ${properties.length === 1 ? 'property' : 'properties'}`}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
