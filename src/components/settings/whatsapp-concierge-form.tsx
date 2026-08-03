'use client';

// "Do it for me" intake for the guided WhatsApp setup. Posts to
// /api/whatsapp/setup-request, which drops the request into the
// master-account concierge pipeline and hands back a wa.me link to
// the sales/support number.

import { useState } from 'react';
import { toast } from 'sonner';
import {
  CheckCircle2,
  HeartHandshake,
  Loader2,
  MessageCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export function WhatsAppConciergeForm() {
  const [name, setName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [phone, setPhone] = useState('');
  const [numberInUse, setNumberInUse] = useState<boolean | null>(null);
  const [city, setCity] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ whatsappLink: string | null } | null>(
    null
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!phone.trim()) {
      toast.error('Please share the number you want to connect.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/whatsapp/setup-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          business_name: businessName.trim(),
          phone: phone.trim(),
          number_in_use: numberInUse === true,
          city: city.trim(),
          notes: notes.trim(),
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        whatsappLink?: string | null;
      };
      if (!res.ok) {
        toast.error(data.error || 'Could not send that — try again.');
        return;
      }
      setDone({ whatsappLink: data.whatsappLink ?? null });
    } catch {
      toast.error('Could not send that — check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <Card className="border-emerald-700/40 bg-emerald-950/30 ring-0 ring-transparent">
        <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
          <CheckCircle2 className="size-10 text-emerald-400" />
          <div>
            <p className="text-lg font-bold text-white">Request received</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-slate-400">
              Our team will reach out on WhatsApp within one working day and set
              the whole thing up with you on a call. Nothing else to do here.
            </p>
          </div>
          {done.whatsappLink && (
            <Button
              className="gap-2"
              onClick={() => window.open(done.whatsappLink!, '_blank')}
            >
              <MessageCircle className="size-4" /> Message us now instead
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-slate-700 bg-slate-900 ring-0 ring-transparent">
      <CardHeader>
        <div className="flex items-center gap-2">
          <HeartHandshake className="text-primary size-5" />
          <CardTitle className="text-white">
            We&apos;ll set it up for you
          </CardTitle>
        </div>
        <CardDescription className="text-slate-400">
          Leave your details and our team does the entire Meta setup with you on
          a WhatsApp call — free for beta accounts. You only need the number you
          want to run your business on.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-slate-300">Your name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Priya Sharma"
                className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">Business / firm name</Label>
              <Input
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="e.g. Sharma Realty"
                className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-slate-300">
              WhatsApp number to connect <span className="text-red-400">*</span>
            </Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. 98765 43210"
              inputMode="tel"
              className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
            />
            <p className="text-xs text-slate-500">
              This becomes your business number — buyers will message it. It can
              be a new SIM or your existing business number.
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-slate-300">
              Is that number currently used in the WhatsApp app on a phone?
            </Label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: true, label: 'Yes' },
                { value: false, label: 'No / new number' },
              ].map((opt) => (
                <button
                  key={String(opt.value)}
                  type="button"
                  onClick={() => setNumberInUse(opt.value)}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
                    numberInUse === opt.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {numberInUse === true && (
              <p className="text-xs text-amber-400">
                No problem — it just needs one extra migration step, which we
                handle on the call. Your chats on the phone are not deleted.
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-slate-300">City</Label>
              <Input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="e.g. Hyderabad"
                className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">Anything we should know?</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional"
                className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
              />
            </div>
          </div>

          <Button type="submit" disabled={saving} className="w-full gap-2">
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Sending…
              </>
            ) : (
              'Request free setup'
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
