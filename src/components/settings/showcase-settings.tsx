'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Globe,
  Building,
  Phone,
  MessageSquare,
  Loader2,
  Save,
  Copy,
  CheckCircle2,
  BarChart3,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { BRANDING } from '@/config/branding';

/** Mirrors the reserved list in resolveSubdomainFromHost()
 *  (src/lib/showcase/public-data.ts) — these labels resolve to the main
 *  site, so an account claiming one would get a showcase nobody reaches. */
const RESERVED_SUBDOMAINS = ['www', 'app', 'admin', 'api'];

/** Mirrors MAX_NAME_LEN in /api/account. */
const MAX_NAME_LEN = 80;

const THEMES = [
  { value: 'violet', label: 'Violet (Default)' },
  { value: 'emerald', label: 'Emerald' },
  { value: 'cobalt', label: 'Cobalt' },
  { value: 'amber', label: 'Amber' },
  { value: 'rose', label: 'Rose' },
  { value: 'verdant', label: 'Verdant' },
];

const DEFAULT_TEMPLATE =
  'Hi! I am interested in your property "{title}" in {location}. Please share details.';

interface ShowcaseForm {
  /** Bound to accounts.name, not to showcase_settings — see below. */
  brandName: string;
  contactPhone: string;
  whatsappTemplate: string;
  metaPixelId: string;
  subdomain: string;
  theme: string;
}

const BLANK: ShowcaseForm = {
  brandName: '',
  contactPhone: '',
  whatsappTemplate: DEFAULT_TEMPLATE,
  metaPixelId: '',
  subdomain: '',
  theme: 'violet',
};

function ShareLinkCard({
  label,
  accent,
  description,
  url,
  copied,
  onCopy,
}: {
  label: string;
  accent: string;
  description: string;
  url: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="relative flex flex-col justify-between gap-3 overflow-hidden rounded-xl border border-slate-800 bg-slate-950/20 p-4">
      <div className="space-y-1">
        <span
          className={`block text-[10px] font-extrabold tracking-wider uppercase ${accent}`}
        >
          {label}
        </span>
        <p className="text-[10px] leading-tight text-slate-400">
          {description}
        </p>
        <code className="text-slate-350 mt-2 block rounded border border-slate-900 bg-slate-950 px-2.5 py-1.5 font-mono text-[11px] break-all select-all">
          {url}
        </code>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={onCopy}
          className="flex h-8 cursor-pointer items-center gap-1.5 border-slate-800 bg-slate-950 text-[11px] text-slate-200 hover:bg-slate-900"
        >
          {copied ? (
            <CheckCircle2 className="size-3.5 text-green-400" />
          ) : (
            <Copy className="size-3.5" />
          )}
          {copied ? 'Copied!' : 'Copy Link'}
        </Button>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-slate-250 inline-flex h-8 items-center justify-center gap-1 rounded-md border border-slate-800 bg-slate-950 px-3 text-[11px] hover:bg-slate-900 hover:text-white"
        >
          <Globe className="size-3.5" />
          Visit Showcase
        </a>
      </div>
    </div>
  );
}

function Section({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-bold text-white">
          {icon}
          {title}
        </CardTitle>
        <CardDescription className="text-slate-400">
          {description}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">{children}</CardContent>
    </Card>
  );
}

export function ShowcaseSettingsPanel() {
  const supabase = createClient();
  const {
    accountId,
    user,
    account,
    canEditSettings,
    refreshProfile,
    loading: authLoading,
  } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copiedUrlType, setCopiedUrlType] = useState<
    'company' | 'personal' | null
  >(null);
  const [hasRow, setHasRow] = useState(false);
  const [form, setForm] = useState<ShowcaseForm>(BLANK);
  const [saved, setSaved] = useState<ShowcaseForm>(BLANK);

  const set = <K extends keyof ShowcaseForm>(key: K, value: ShowcaseForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    if (authLoading || !accountId) return;

    async function fetchSettings() {
      try {
        const { data, error } = await supabase
          .from('showcase_settings')
          .select('*')
          .eq('account_id', accountId)
          .maybeSingle();

        if (error) {
          console.error('Error fetching showcase settings:', error);
          toast.error('Failed to load showcase settings');
          return;
        }

        if (data) {
          setHasRow(true);
          const loaded: Omit<ShowcaseForm, 'brandName'> = {
            contactPhone: data.contact_phone || '',
            whatsappTemplate: data.whatsapp_message_template || '',
            metaPixelId: data.meta_pixel_id || '',
            subdomain: data.subdomain || '',
            theme: data.theme || 'violet',
          };
          setForm((prev) => ({ ...prev, ...loaded }));
          setSaved((prev) => ({ ...prev, ...loaded }));
        }
      } catch (err) {
        console.error('Unexpected error loading showcase settings:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchSettings();
  }, [accountId, authLoading, supabase]);

  // The brand name is the account's name — the single copy of it. Seeded
  // separately because useAuth resolves the account summary on its own
  // schedule, and re-seeded after a save so the field tracks the rename.
  useEffect(() => {
    if (!account?.name) return;
    setForm((prev) => ({ ...prev, brandName: account.name }));
    setSaved((prev) => ({ ...prev, brandName: account.name }));
  }, [account?.name]);

  const dirty = (Object.keys(form) as (keyof ShowcaseForm)[]).some(
    (key) => form[key].trim() !== saved[key].trim()
  );

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountId || !dirty) return;

    const subdomain = form.subdomain.trim().toLowerCase();
    if (subdomain && RESERVED_SUBDOMAINS.includes(subdomain)) {
      toast.error(`"${subdomain}" is reserved — pick another subdomain.`);
      return;
    }

    setSaving(true);
    try {
      const brandName = form.brandName.trim();
      if (brandName !== saved.brandName.trim()) {
        const res = await fetch('/api/account', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: brandName }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? 'Failed to update the brand name');
        }
        await refreshProfile();
        // Banked immediately: if the showcase write below fails, the
        // rename still happened and must not be replayed on retry.
        setSaved((prev) => ({ ...prev, brandName }));
      }

      const payload = {
        account_id: accountId,
        contact_phone: form.contactPhone.trim(),
        whatsapp_message_template: form.whatsappTemplate.trim(),
        meta_pixel_id: form.metaPixelId.trim() || null,
        subdomain: subdomain || null,
        theme: form.theme,
        updated_at: new Date().toISOString(),
      };

      const { error } = hasRow
        ? await supabase
            .from('showcase_settings')
            .update(payload)
            .eq('account_id', accountId)
        : await supabase.from('showcase_settings').insert([payload]);

      if (error) {
        // The subdomain column is UNIQUE account-wide, so a clash here
        // means another brokerage already claimed the label.
        if (error.code === '23505') {
          toast.error(`"${subdomain}" is already taken — try another.`);
          return;
        }
        throw error;
      }

      setHasRow(true);
      setForm((prev) => ({ ...prev, brandName, subdomain }));
      setSaved({ ...form, brandName, subdomain });
      toast.success('Showcase settings saved');
    } catch (err) {
      console.error('Error saving showcase settings:', err);
      toast.error(
        err instanceof Error ? err.message : 'Failed to save showcase settings'
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading || authLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="text-primary size-8 animate-spin" />
      </div>
    );
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const companyUrl = origin ? `${origin}/?account_id=${accountId}` : '';
  const personalUrl = origin && user?.id ? `${origin}/?ref=${user.id}` : '';

  const handleCopyLink = (url: string, type: 'company' | 'personal') => {
    if (!url) return;
    navigator.clipboard.writeText(url);
    setCopiedUrlType(type);
    toast.success(
      `${type === 'company' ? 'Company' : 'Personal Agent'} showcase link copied!`
    );
    setTimeout(() => setCopiedUrlType(null), 2000);
  };

  return (
    <form onSubmit={handleSave} className="space-y-6">
      {accountId && (
        <Section
          icon={<Globe className="text-primary size-5" />}
          title="Share Links"
          description="Send these to buyers. Published properties appear on both."
        >
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ShareLinkCard
              label="Company Showcase Link"
              accent="text-primary"
              description="Showcases all published properties listed across the entire account inventory."
              url={companyUrl}
              copied={copiedUrlType === 'company'}
              onCopy={() => handleCopyLink(companyUrl, 'company')}
            />
            <ShareLinkCard
              label="My Personal Agent Showcase Link"
              accent="text-indigo-400"
              description="Showcases exclusively properties created or posted by you."
              url={personalUrl}
              copied={copiedUrlType === 'personal'}
              onCopy={() => handleCopyLink(personalUrl, 'personal')}
            />
          </div>
        </Section>
      )}

      <Section
        icon={<Building className="text-primary size-5" />}
        title="Brand"
        description="How the showcase introduces you, and where it lives."
      >
        <div className="space-y-2">
          <Label htmlFor="brandName" className="text-slate-350 font-medium">
            Brand Name
          </Label>
          <div className="relative">
            <Building className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500" />
            <Input
              id="brandName"
              value={form.brandName}
              onChange={(e) => set('brandName', e.target.value)}
              placeholder={BRANDING.name}
              maxLength={MAX_NAME_LEN}
              disabled={!canEditSettings}
              required
              className="focus:border-primary focus:ring-primary border-slate-800 bg-slate-950 pl-10 text-white placeholder:text-slate-600 focus:ring-1"
            />
          </div>
          <p className="text-[11px] text-slate-400">
            {canEditSettings
              ? 'Your business name. The same one appears on the showcase, in WhatsApp reminders and inquiries, and on invitations — editing it here or on the Profile tab changes both.'
              : 'Only account admins can change the brand name.'}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="subdomain" className="text-slate-350 font-medium">
            Showcase Subdomain (e.g. agency1)
          </Label>
          <div className="relative">
            <Globe className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500" />
            <Input
              id="subdomain"
              value={form.subdomain}
              onChange={(e) =>
                set(
                  'subdomain',
                  e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')
                )
              }
              placeholder="e.g. myagency"
              className="focus:border-primary focus:ring-primary placeholder:text-slate-650 border-slate-800 bg-slate-950 pl-10 text-white focus:ring-1"
            />
          </div>
          <p className="text-[11px] text-slate-400">
            Serves your showcase at{' '}
            <code className="text-primary">{`https://${form.subdomain || 'your-subdomain'}.${BRANDING.baseDomain}`}</code>
            . This only resolves once a wildcard{' '}
            <code className="text-primary">{`*.${BRANDING.baseDomain}`}</code>{' '}
            DNS record exists and the host holds a matching certificate — see
            docs/domain-rehosting-guide.md. Until then, keep using the share
            links above.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="theme" className="text-slate-350 font-medium">
            Showcase Theme Accent Color
          </Label>
          <Select
            value={form.theme}
            onValueChange={(value) => set('theme', value as string)}
          >
            <SelectTrigger
              id="theme"
              className="border-slate-800 bg-slate-950 text-white"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {THEMES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-slate-400">
            The default color branding for your public showcase URL.
          </p>
        </div>
      </Section>

      <Section
        icon={<Phone className="text-primary size-5" />}
        title="Contact"
        description="How buyers reach you from a listing."
      >
        <div className="space-y-2">
          <Label htmlFor="contactPhone" className="text-slate-350 font-medium">
            Public Contact Phone Number
          </Label>
          <div className="relative">
            <Phone className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500" />
            <Input
              id="contactPhone"
              value={form.contactPhone}
              onChange={(e) => set('contactPhone', e.target.value)}
              placeholder="e.g. +91 98765 43210"
              required
              className="focus:border-primary focus:ring-primary border-slate-800 bg-slate-950 pl-10 text-white placeholder:text-slate-600 focus:ring-1"
            />
          </div>
          <p className="text-[11px] text-slate-400">
            The primary contact number displayed on listings. This will also be
            the WhatsApp contact phone (include country code, e.g., 91 for
            India).
          </p>
        </div>

        <div className="space-y-2">
          <Label
            htmlFor="whatsappTemplate"
            className="text-slate-350 font-medium"
          >
            WhatsApp Inquiry Message Template
          </Label>
          <div className="relative">
            <MessageSquare className="absolute top-3 left-3 size-4 text-slate-500" />
            <Textarea
              id="whatsappTemplate"
              value={form.whatsappTemplate}
              onChange={(e) => set('whatsappTemplate', e.target.value)}
              placeholder="e.g. Hi! I am interested in your property {title}..."
              required
              rows={3}
              className="focus:border-primary focus:ring-primary min-h-[80px] border-slate-800 bg-slate-950 pl-10 text-white placeholder:text-slate-600 focus:ring-1"
            />
          </div>
          <p className="text-[11px] text-slate-400">
            The prefilled text message that opens when visitors click
            &quot;Inquire via WhatsApp&quot;. Use{' '}
            <code className="text-primary rounded bg-slate-950 px-1 py-0.5">{`{title}`}</code>{' '}
            and{' '}
            <code className="text-primary rounded bg-slate-950 px-1 py-0.5">{`{location}`}</code>{' '}
            as dynamic placeholders.
          </p>
        </div>
      </Section>

      <Section
        icon={<BarChart3 className="text-primary size-5" />}
        title="Tracking"
        description="Optional. Attribute showcase traffic in Meta Events Manager."
      >
        <div className="space-y-2">
          <Label htmlFor="metaPixelId" className="text-slate-350 font-medium">
            Meta Pixel ID / Dataset ID
          </Label>
          <div className="relative">
            <BarChart3 className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500" />
            <Input
              id="metaPixelId"
              value={form.metaPixelId}
              onChange={(e) => set('metaPixelId', e.target.value)}
              placeholder="e.g. 1856890568341240"
              className="focus:border-primary focus:ring-primary placeholder:text-slate-650 border-slate-800 bg-slate-950 pl-10 text-white focus:ring-1"
            />
          </div>
          <p className="text-[11px] text-slate-400">
            Paste your Meta Pixel ID or Dataset ID from Events Manager here.
            Fires ViewContent and Lead events to track listing views and
            conversions.
          </p>
        </div>
      </Section>

      <div className="flex items-center justify-end gap-3">
        {dirty && (
          <span className="text-[11px] text-slate-400">Unsaved changes</span>
        )}
        <Button
          type="submit"
          disabled={saving || !dirty}
          className="bg-primary text-primary-foreground hover:bg-primary-hover flex cursor-pointer items-center gap-2"
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          Save Configuration
        </Button>
      </div>
    </form>
  );
}
