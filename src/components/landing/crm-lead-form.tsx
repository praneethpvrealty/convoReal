'use client';

import { useMemo, useState } from 'react';
import { Loader2, MessageCircle, CheckCircle2 } from 'lucide-react';

const ROLES = ['Independent agent', 'Broker', 'Builder / Developer', 'Agency / Team'];
const TEAM_SIZES = ['Just me', '2–5', '6–20', '20+'];

function getSessionKey(): string {
  try {
    const existing = localStorage.getItem('showcase_session_key');
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    localStorage.setItem('showcase_session_key', fresh);
    return fresh;
  } catch {
    return crypto.randomUUID();
  }
}

const FALLBACK_WHATSAPP = process.env.NEXT_PUBLIC_CONVOREAL_SALES_WHATSAPP || '';

export function CrmLeadForm() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState(ROLES[0]);
  const [city, setCity] = useState('');
  const [teamSize, setTeamSize] = useState(TEAM_SIZES[0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ whatsappLink: string | null } | null>(null);
  const sessionKey = useMemo(getSessionKey, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || !phone.trim()) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/public/crm-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || undefined,
          phone: phone.trim(),
          role,
          city: city.trim() || undefined,
          team_size: teamSize,
          session_key: sessionKey,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { whatsappLink?: string | null; error?: string };
      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.');
        return;
      }
      const fallback = FALLBACK_WHATSAPP
        ? `https://wa.me/${FALLBACK_WHATSAPP.replace(/\D/g, '')}?text=${encodeURIComponent("Hi! I'm interested in ConvoReal.")}`
        : null;
      setDone({ whatsappLink: data.whatsappLink || fallback });
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-8 text-center space-y-4 max-w-lg mx-auto">
        <CheckCircle2 className="size-12 text-emerald-500 mx-auto" />
        <h3 className="text-xl font-bold text-white">Thanks — we&apos;ll be in touch!</h3>
        <p className="text-sm text-slate-300">
          {done.whatsappLink
            ? 'Want to skip the wait? Message us on WhatsApp and we&apos;ll get you set up.'
            : 'Our team will reach out to you shortly.'}
        </p>
        {done.whatsappLink && (
          <a
            href={done.whatsappLink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-5 py-3 rounded-xl transition-colors"
          >
            <MessageCircle className="size-5 fill-white text-emerald-600" />
            Chat with us on WhatsApp
          </a>
        )}
      </div>
    );
  }

  const inputCls =
    'w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none';

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 space-y-4 max-w-lg mx-auto">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5">
            WhatsApp number <span className="text-red-400">*</span>
          </label>
          <input
            type="tel"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="98450 12345"
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5">I am a…</label>
          <select value={role} onChange={(e) => setRole(e.target.value)} className={inputCls}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5">City</label>
          <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Bangalore" className={inputCls} />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-semibold text-slate-300 mb-1.5">Team size</label>
          <select value={teamSize} onChange={(e) => setTeamSize(e.target.value)} className={inputCls}>
            {TEAM_SIZES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={submitting || !phone.trim()}
        className="w-full inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-bold py-3 rounded-xl transition-colors"
      >
        {submitting && <Loader2 className="size-4 animate-spin" />}
        Talk to us
      </button>
      <p className="text-xs text-slate-500 text-center">No spam. We&apos;ll reach out on WhatsApp.</p>
    </form>
  );
}
