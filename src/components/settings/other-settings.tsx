'use client';

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Coins,
  Loader2,
  Save,
  Database,
  RefreshCw,
  Mail,
  Copy,
  Check,
  BarChart3,
} from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { MessageTemplate } from '@/types';
import { readStored, writeStored } from '@/lib/safe-storage';

const COUNTRIES = [
  { name: 'India', code: '91', currency: 'INR' },
  { name: 'United Arab Emirates', code: '971', currency: 'AED' },
  { name: 'United States', code: '1', currency: 'USD' },
  { name: 'United Kingdom', code: '44', currency: 'GBP' },
  { name: 'Germany', code: '49', currency: 'EUR' },
  { name: 'France', code: '33', currency: 'EUR' },
  { name: 'Australia', code: '61', currency: 'AUD' },
  { name: 'Singapore', code: '65', currency: 'SGD' },
  { name: 'Canada', code: '1', currency: 'CAD' },
];

export function OtherSettingsPanel() {
  const supabase = createClient();
  const { accountId, loading: authLoading, isOwner } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currency, setCurrency] = useState('INR');
  const [defaultCountryCode, setDefaultCountryCode] = useState('91');
  const [hasSettings, setHasSettings] = useState(false);
  const [selectedCountryIndex, setSelectedCountryIndex] = useState(0);
  const [useUsdOverride, setUseUsdOverride] = useState(false);

  const selectedCountry = COUNTRIES[selectedCountryIndex] || COUNTRIES[0];

  const handleCountrySelect = (index: number) => {
    setSelectedCountryIndex(index);
    const country = COUNTRIES[index];
    if (country) {
      setDefaultCountryCode(country.code);
      if (useUsdOverride) {
        setCurrency('USD');
      } else {
        setCurrency(country.currency);
      }
    }
  };

  const handleUsdOverrideChange = (checked: boolean) => {
    setUseUsdOverride(checked);
    const country = COUNTRIES[selectedCountryIndex];
    if (country) {
      if (checked) {
        setCurrency('USD');
      } else {
        setCurrency(country.currency);
      }
    }
  };

  // RERA Projects Sync State
  const [projectCount, setProjectCount] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);

  // Email Sync Config State
  const [syncActive, setSyncActive] = useState(false);
  const [autoReply, setAutoReply] = useState(false);
  const [autoReplyText, setAutoReplyText] = useState(
    'Hi {name}, thanks for your interest on the property listed on {source}. Kindly let me know your requirements and budget, I will share the appropriate properties.'
  );
  const [autoReplyTemplateName, setAutoReplyTemplateName] = useState<
    string | null
  >(null);
  const [approvedTemplates, setApprovedTemplates] = useState<MessageTemplate[]>(
    []
  );
  const [autoQualify, setAutoQualify] = useState(true);
  const [autoQualifySaving, setAutoQualifySaving] = useState(false);
  // Off unless the account says otherwise — the seller's floor is the
  // brokerage's to quote, not the bot's to volunteer.
  const [shareFinalPrice, setShareFinalPrice] = useState(false);
  const [shareFinalPriceSaving, setShareFinalPriceSaving] = useState(false);
  const [hasSyncConfig, setHasSyncConfig] = useState(false);
  const [syncConfigLoading, setSyncConfigLoading] = useState(true);
  const [syncConfigSaving, setSyncConfigSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  // Email sync verification code states
  const [verCode, setVerCode] = useState<string | null>(null);
  const [verLink, setVerLink] = useState<string | null>(null);
  const [verAt, setVerAt] = useState<string | null>(null);

  // Data-sharing consent (DPDP opt-in for anonymized market stats)
  const [consent, setConsent] = useState(false);
  const [consentAt, setConsentAt] = useState<string | null>(null);
  const [consentSaving, setConsentSaving] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    fetch('/api/account/data-sharing')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setConsent(!!data.consent);
          setConsentAt(data.consentAt ?? null);
        }
      })
      .catch(() => {
        // Pre-migration or transient failure — leave the toggle off.
      });
  }, [accountId]);

  const handleToggleConsent = async () => {
    if (!isOwner || consentSaving) return;
    const next = !consent;
    setConsentSaving(true);
    try {
      const res = await fetch('/api/account/data-sharing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consent: next }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to update');
      }
      const data = await res.json();
      setConsent(data.consent);
      setConsentAt(data.consentAt ?? null);
      toast.success(
        data.consent
          ? 'Thank you! Your anonymized market data now contributes to (and will unlock) area benchmarks.'
          : 'Data sharing turned off. Your data will be excluded from the next aggregation run.'
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to update data sharing'
      );
    } finally {
      setConsentSaving(false);
    }
  };

  const fetchProjectCount = useCallback(async () => {
    try {
      const { count, error } = await supabase
        .from('rera_projects')
        .select('*', { count: 'exact', head: true });

      if (!error && count !== null) {
        setProjectCount(count);
      }
    } catch (err) {
      console.error('Failed to fetch RERA project count:', err);
    }
  }, [supabase]);

  const fetchSyncConfig = useCallback(
    async (isInitial = false) => {
      if (!accountId) return;
      try {
        const { data, error } = await supabase
          .from('email_sync_configs')
          .select('*')
          .eq('account_id', accountId)
          .maybeSingle();

        if (error) {
          console.error('Error fetching email sync config:', error);
          if (isInitial) {
            toast.error('Failed to load email sync settings');
          }
          return;
        }

        if (data) {
          if (isInitial) {
            setSyncActive(data.is_active);
            setAutoReply(data.auto_reply_enabled);
            setAutoReplyText(
              data.auto_reply_text ||
                'Hi {name}, thanks for your interest on the property listed on {source}. Kindly let me know your requirements and budget, I will share the appropriate properties.'
            );
            setAutoReplyTemplateName(data.auto_reply_template_name || null);
            setHasSyncConfig(true);
          }
          setVerCode(data.last_verification_code || null);
          setVerLink(data.last_verification_link || null);
          setVerAt(data.last_verification_at || null);
        }
      } catch (err) {
        console.error('Unexpected error loading email sync config:', err);
      } finally {
        if (isInitial) {
          setSyncConfigLoading(false);
        }
      }
    },
    [accountId, supabase]
  );

  const fetchAutoQualify = useCallback(async () => {
    if (!accountId) return;
    const { data } = await supabase
      .from('whatsapp_config')
      .select('auto_qualify_leads, share_seller_final_price')
      .eq('account_id', accountId)
      .maybeSingle();
    if (data) {
      setAutoQualify(data.auto_qualify_leads !== false);
      setShareFinalPrice(data.share_seller_final_price === true);
    }
  }, [accountId, supabase]);

  const handleToggleShareFinalPrice = async () => {
    if (!accountId || shareFinalPriceSaving) return;
    const next = !shareFinalPrice;
    setShareFinalPriceSaving(true);
    const { data: saved, error } = await supabase
      .from('whatsapp_config')
      .update({ share_seller_final_price: next })
      .eq('account_id', accountId)
      .select('id');
    setShareFinalPriceSaving(false);
    if (error || !saved?.length) {
      toast.error('Failed to update price disclosure');
      return;
    }
    setShareFinalPrice(next);
    toast.success(
      next
        ? "Buyers asking about negotiation will hear the seller's final price"
        : "The seller's final price stays internal"
    );
  };

  const handleToggleAutoQualify = async () => {
    if (!accountId || autoQualifySaving) return;
    const next = !autoQualify;
    setAutoQualifySaving(true);
    const { data: saved, error } = await supabase
      .from('whatsapp_config')
      .update({ auto_qualify_leads: next })
      .eq('account_id', accountId)
      .select('id');
    setAutoQualifySaving(false);
    if (error || !saved?.length) {
      toast.error('Failed to update lead qualification');
      return;
    }
    setAutoQualify(next);
    toast.success(
      next
        ? 'Lead replies will be qualified automatically'
        : 'Lead replies left to your agents'
    );
  };

  const fetchApprovedTemplates = useCallback(async () => {
    if (!accountId) return;
    try {
      const { data, error } = await supabase
        .from('message_templates')
        .select('*')
        .eq('account_id', accountId)
        .eq('status', 'APPROVED');

      if (error) {
        console.error('Error fetching approved templates:', error);
        return;
      }
      setApprovedTemplates(data || []);
    } catch (err) {
      console.error('Unexpected error loading approved templates:', err);
    }
  }, [accountId, supabase]);

  useEffect(() => {
    if (!accountId) return;

    async function fetchSettings() {
      try {
        const { data, error } = await supabase
          .from('showcase_settings')
          .select('currency, default_country_code')
          .eq('account_id', accountId)
          .maybeSingle();

        if (error) {
          console.error('Error fetching currency settings:', error);
          toast.error('Failed to load currency settings');
          return;
        }

        if (data) {
          const loadedCurrency = data.currency || 'INR';
          const loadedCountryCode = data.default_country_code || '91';
          setCurrency(loadedCurrency);
          setDefaultCountryCode(loadedCountryCode);

          let idx = COUNTRIES.findIndex(
            (c) => c.code === loadedCountryCode && c.currency === loadedCurrency
          );
          if (idx === -1) {
            idx = COUNTRIES.findIndex((c) => c.code === loadedCountryCode);
          }
          if (idx !== -1) {
            setSelectedCountryIndex(idx);
          }

          const isUsd = loadedCurrency === 'USD';
          const isNorthAmerica = loadedCountryCode === '1';
          setUseUsdOverride(isUsd && !isNorthAmerica);

          setHasSettings(true);
        }
      } catch (err) {
        console.error('Unexpected error loading currency settings:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchSettings();
    fetchProjectCount();
    fetchSyncConfig(true);
    fetchApprovedTemplates();
    fetchAutoQualify();

    // Load last synced from localStorage if exists
    const stored = readStored('krera_last_synced');
    if (stored) {
      setLastSynced(stored);
    }
  }, [
    accountId,
    supabase,
    fetchProjectCount,
    fetchSyncConfig,
    fetchApprovedTemplates,
    fetchAutoQualify,
  ]);

  useEffect(() => {
    if (!accountId) return;

    // Poll sync config every 5 seconds to capture verification emails in real time
    const interval = setInterval(() => {
      fetchSyncConfig(false);
    }, 5000);

    return () => clearInterval(interval);
  }, [accountId, fetchSyncConfig]);

  const handleSaveSyncConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountId) return;

    setSyncConfigSaving(true);
    try {
      const payload = {
        account_id: accountId,
        is_active: syncActive,
        auto_reply_enabled: autoReply,
        auto_reply_text: autoReply ? autoReplyText : null,
        auto_reply_template_name: autoReply ? autoReplyTemplateName : null,
        updated_at: new Date().toISOString(),
      };

      if (hasSyncConfig) {
        const { data: saved, error } = await supabase
          .from('email_sync_configs')
          .update(payload)
          .eq('account_id', accountId)
          .select('id');

        if (error) throw error;
        if (!saved?.length)
          throw new Error('Your settings could not be saved.');
      } else {
        const { error } = await supabase
          .from('email_sync_configs')
          .insert([payload]);

        if (error) throw error;
        setHasSyncConfig(true);
      }

      toast.success('Email lead sync preferences saved successfully');
    } catch (err) {
      console.error('Error saving email sync settings:', err);
      toast.error('Failed to save email settings');
    } finally {
      setSyncConfigSaving(false);
    }
  };

  const handleCopyEmail = (emailStr: string) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(emailStr);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = emailStr;
        textArea.style.position = 'fixed';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopied(true);
      toast.success('Forwarding address copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard: ', err);
      toast.error('Failed to copy to clipboard');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountId) return;

    setSaving(true);
    try {
      if (hasSettings) {
        // Update
        const { data: saved, error } = await supabase
          .from('showcase_settings')
          .update({
            currency,
            default_country_code: defaultCountryCode,
            updated_at: new Date().toISOString(),
          })
          .eq('account_id', accountId)
          .select('account_id');
        if (!error && !saved?.length) {
          throw new Error('Your settings could not be saved.');
        }

        if (error) throw error;
      } else {
        // Insert a new showcase settings row with default details + currency
        const { error } = await supabase.from('showcase_settings').insert([
          {
            account_id: accountId,
            contact_phone: '',
            whatsapp_message_template:
              'Hi! I am interested in your property "{title}" in {location}. Please share details.',
            currency,
            default_country_code: defaultCountryCode,
          },
        ]);

        if (error) throw error;
        setHasSettings(true);
      }

      toast.success('Currency settings saved successfully');
    } catch (err) {
      console.error('Error saving currency settings:', err);
      toast.error('Failed to save currency settings');
    } finally {
      setSaving(false);
    }
  };

  const handleSyncProjects = async () => {
    setSyncing(true);
    const toastId = toast.loading('Syncing RERA projects from the cloud...');

    try {
      const res = await fetch('/api/projects/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server returned ${res.statusText}`);
      }

      const data = await res.json();
      const timeStr = new Date().toLocaleString();
      setLastSynced(timeStr);
      writeStored('krera_last_synced', timeStr);

      await fetchProjectCount();

      toast.success(
        `Synchronized ${data.total_upserted} projects (${data.seeded_count} core seeds, ${data.scraped_count} dynamic outskirts projects)`,
        { id: toastId }
      );
    } catch (err) {
      console.error('Failed to sync projects:', err);
      toast.error(
        err instanceof Error ? err.message : 'Failed to sync projects',
        { id: toastId }
      );
    } finally {
      setSyncing(false);
    }
  };

  if (loading || authLoading || syncConfigLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="text-primary size-8 animate-spin" />
      </div>
    );
  }

  const leadsDomain =
    process.env.NEXT_PUBLIC_LEADS_EMAIL_DOMAIN || 'leads.convoreal.com';
  const forwardingEmail = `lead-sync-${accountId}@${leadsDomain}`;

  const isVerificationRecent = verAt
    ? new Date().getTime() - new Date(verAt).getTime() < 7 * 24 * 60 * 60 * 1000
    : false;

  const getRelativeTimeString = (isoString: string | null) => {
    if (!isoString) return '';
    try {
      const diffMs = new Date().getTime() - new Date(isoString).getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return 'just now';
      if (diffMins === 1) return '1 minute ago';
      if (diffMins < 60) return `${diffMins} minutes ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours === 1) return '1 hour ago';
      if (diffHours < 24) return `${diffHours} hours ago`;
      const diffDays = Math.floor(diffHours / 24);
      if (diffDays === 1) return '1 day ago';
      return `${diffDays} days ago`;
    } catch {
      return '';
    }
  };

  return (
    <div className="space-y-6">
      {/* General & Currency Settings Card */}
      <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl font-bold text-white">
            <Coins className="text-primary size-5" />
            General & Currency Settings
          </CardTitle>
          <CardDescription className="text-slate-400">
            Configure general preferences and default currency symbols used
            across properties, flyers, shared layouts, and dashboards.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-6">
            <div className="max-w-md space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="country" className="text-slate-350 font-medium">
                  Default Workspace Country
                </Label>
                <select
                  id="country"
                  value={selectedCountryIndex}
                  onChange={(e) => handleCountrySelect(Number(e.target.value))}
                  className="focus:ring-primary flex h-10 w-full rounded-md border border-slate-800 bg-slate-950 px-3 text-xs font-medium text-slate-200 focus:ring-1 focus:outline-none"
                >
                  {COUNTRIES.map((c, idx) => (
                    <option key={`${c.code}-${c.currency}`} value={idx}>
                      {c.name} (+{c.code})
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-400">
                  Selecting your country automatically derives your default
                  local currency ({selectedCountry.currency}) and phone prefix
                  (+{selectedCountry.code}) across the workspace.
                </p>
              </div>

              {selectedCountry.currency !== 'USD' && (
                <div className="flex items-center gap-2 pt-1.5">
                  <input
                    id="usd-override"
                    type="checkbox"
                    checked={useUsdOverride}
                    onChange={(e) => handleUsdOverrideChange(e.target.checked)}
                    className="text-primary focus:ring-primary h-4 w-4 cursor-pointer rounded border-slate-800 bg-slate-950 focus:ring-offset-slate-900"
                  />
                  <Label
                    htmlFor="usd-override"
                    className="cursor-pointer text-xs font-normal text-slate-300 select-none"
                  >
                    Use US Dollar (USD, $) as workspace currency instead of
                    local currency ({selectedCountry.currency})
                  </Label>
                </div>
              )}
            </div>

            <div className="flex justify-end border-t border-slate-800 pt-4">
              <Button
                type="submit"
                disabled={saving}
                className="bg-primary text-primary-foreground hover:bg-primary-hover flex cursor-pointer items-center gap-2"
              >
                {saving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                Save Preferences
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* RERA Project Database Sync Card */}
      <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl font-bold text-white">
            <Database className="text-primary size-5" />
            RERA Project Registry Sourcing
          </CardTitle>
          <CardDescription className="text-slate-400">
            Sourced pipeline for Apartment, Villa, and Layout Projects. This
            populates your database with real registered projects in Bangalore
            and its outskirts to power autocomplete in property details.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col justify-between gap-4 rounded-lg border border-slate-800 bg-slate-950 p-4 md:flex-row md:items-center">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                <span>Database Sync Status</span>
                <span className="inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                  Online
                </span>
              </div>
              <div className="text-xs text-slate-400">
                Total Sourced Projects:{' '}
                <span className="font-bold text-white">
                  {projectCount ?? 'Loading...'}
                </span>
              </div>
              {lastSynced && (
                <div className="text-[10px] text-slate-500">
                  Last synced:{' '}
                  <span className="text-slate-400">{lastSynced}</span>
                </div>
              )}
            </div>

            <Button
              onClick={handleSyncProjects}
              disabled={syncing}
              className="bg-primary text-primary-foreground hover:bg-primary-hover flex cursor-pointer items-center gap-2 self-start md:self-auto"
            >
              {syncing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Sync RERA Projects
            </Button>
          </div>

          <div className="space-y-2 text-xs text-slate-500">
            <p>
              <strong>Surrounding Taluks Covered:</strong> Ingests projects
              matching Bangalore Urban, Bangalore Rural, Devanahalli, Hoskote,
              Sarjapur, Kanakapura, Jigani, Bagalur, Nelamangala, Doddaballapur,
              Anekal, Attibele, Bidadi, and surrounding layouts.
            </p>
            <p>
              <strong>AI Cloud Expansion:</strong> When the sync is triggered,
              the cloud pipeline automatically leverages Gemini AI Studio to
              identify newer registered real estate projects in Bangalore,
              resolving sublocality and promoter details directly in your
              database.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Email Lead Sourcing Card */}
      <Card
        className="border-slate-800 bg-slate-900/50 backdrop-blur-sm"
        data-tour="email-lead-sourcing"
      >
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl font-bold text-white">
            <Mail className="text-primary size-5" />
            Email Lead Sourcing (99acres, Magicbricks, Housing)
          </CardTitle>
          <CardDescription className="text-slate-400">
            Automatically ingest leads from major property portals directly from
            your email forwarding rules.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSaveSyncConfig} className="space-y-6">
            {/* Forwarding Address Box */}
            <div className="space-y-2">
              <Label className="text-xs font-medium text-slate-300">
                Your Inbound Forwarding Address
              </Label>
              <div className="flex max-w-xl items-center gap-2">
                <div className="flex h-10 flex-1 scrollbar-thin items-center justify-between overflow-x-auto rounded-md border border-slate-800 bg-slate-950 px-3 font-mono text-xs whitespace-nowrap text-slate-300 select-all">
                  <span>{forwardingEmail}</span>
                </div>
                <Button
                  type="button"
                  onClick={() => handleCopyEmail(forwardingEmail)}
                  className="flex h-10 cursor-pointer items-center gap-1.5 border border-slate-700 bg-slate-800 px-3 text-xs text-slate-200 hover:bg-slate-700"
                >
                  {copied ? (
                    <>
                      <Check className="size-3.5 text-emerald-400" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="size-3.5" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
              <p className="text-[10px] leading-relaxed text-slate-400">
                Configure your email inbox (e.g. Gmail / Outlook) to forward
                lead emails from{' '}
                <code className="text-primary rounded bg-slate-950 px-1 py-0.5 font-mono text-[9px]">
                  services@99acres.com
                </code>
                ,{' '}
                <code className="text-primary rounded bg-slate-950 px-1 py-0.5 font-mono text-[9px]">
                  info@magicbricks.com
                </code>
                , or{' '}
                <code className="text-primary rounded bg-slate-950 px-1 py-0.5 font-mono text-[9px]">
                  noreply@housing-mailer.com
                </code>{' '}
                to this email address.
              </p>
            </div>

            {/* Inbound Verification Alert Banner */}
            {isVerificationRecent && (verCode || verLink) && (
              <div className="mt-2 space-y-3 rounded-xl border border-indigo-500/30 bg-indigo-950/20 p-4 text-slate-200 backdrop-blur-md">
                <div className="flex items-center justify-between border-b border-indigo-500/20 pb-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-indigo-400">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75"></span>
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-500"></span>
                    </span>
                    Inbound Verification Received
                  </div>
                  <span className="text-slate-450 text-[10px]">
                    Captured {getRelativeTimeString(verAt)}
                  </span>
                </div>
                <div className="space-y-3 text-xs leading-relaxed">
                  <p className="text-slate-350 text-[11px]">
                    A forwarding verification email was just received on your
                    inbound address. Copy the code or click the confirmation
                    link to complete your forwarding setup.
                  </p>

                  {verCode && (
                    <div className="space-y-1">
                      <span className="text-[9px] font-semibold tracking-wider text-slate-400 uppercase">
                        Confirmation Code
                      </span>
                      <div className="flex max-w-sm items-center gap-2">
                        <div className="flex h-9 flex-1 items-center rounded-md border border-indigo-500/20 bg-slate-950 px-3 font-mono text-xs text-indigo-200 select-all">
                          {verCode}
                        </div>
                        <Button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(verCode);
                            toast.success('Confirmation code copied');
                          }}
                          className="flex h-9 cursor-pointer items-center gap-1 border border-indigo-500/20 bg-indigo-900/50 px-3 text-xs text-indigo-200 hover:bg-indigo-800/50"
                        >
                          <Copy className="size-3.5" />
                          Copy
                        </Button>
                      </div>
                    </div>
                  )}

                  {verLink && (
                    <div className="space-y-1">
                      <span className="text-[9px] font-semibold tracking-wider text-slate-400 uppercase">
                        Confirmation Link
                      </span>
                      <div className="flex items-center gap-2">
                        <a
                          href={verLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-350 flex h-9 flex-1 cursor-pointer items-center truncate rounded-md border border-indigo-500/20 bg-slate-950 px-3 font-mono text-[10px] underline hover:bg-slate-900"
                        >
                          {verLink}
                        </a>
                        <Button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(verLink);
                            toast.success('Confirmation link copied');
                          }}
                          className="flex h-9 shrink-0 cursor-pointer items-center gap-1 border border-indigo-500/20 bg-indigo-900/50 px-3 text-xs text-indigo-200 hover:bg-indigo-800/50"
                        >
                          <Copy className="size-3.5" />
                          Copy Link
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Premium Toggle Cards */}
            <div className="grid grid-cols-1 gap-4 pt-2 md:grid-cols-2">
              {/* Toggle Sync Active */}
              <div
                onClick={() => setSyncActive(!syncActive)}
                className={`flex cursor-pointer items-center justify-between rounded-xl border p-4 transition-all duration-300 select-none ${
                  syncActive
                    ? 'border-primary bg-primary/5 text-white shadow-[0_0_15px_rgba(99,102,241,0.05)]'
                    : 'border-slate-800 bg-slate-950/20 text-slate-400 hover:border-slate-700 hover:bg-slate-950/40'
                }`}
              >
                <div className="space-y-0.5 pr-2">
                  <h4 className="text-xs font-bold text-slate-100">
                    Enable Lead Synchronization
                  </h4>
                  <p className="text-[10px] leading-normal text-slate-400">
                    Accept forwarded portal emails and parse them automatically
                    into buyer contacts.
                  </p>
                </div>
                <div
                  className={`h-4 w-8 shrink-0 rounded-full p-0.5 transition-colors duration-200 ${syncActive ? 'bg-primary' : 'bg-slate-700'}`}
                >
                  <div
                    className={`h-3 w-3 rounded-full bg-white transition-transform duration-200 ${syncActive ? 'translate-x-4' : 'translate-x-0'}`}
                  />
                </div>
              </div>

              {/* Toggle Auto-Reply */}
              <div
                onClick={() => setAutoReply(!autoReply)}
                className={`flex cursor-pointer items-center justify-between rounded-xl border p-4 transition-all duration-300 select-none ${
                  autoReply
                    ? 'border-primary bg-primary/5 text-white shadow-[0_0_15px_rgba(99,102,241,0.05)]'
                    : 'border-slate-800 bg-slate-950/20 text-slate-400 hover:border-slate-700 hover:bg-slate-950/40'
                }`}
              >
                <div className="space-y-0.5 pr-2">
                  <h4 className="text-xs font-bold text-slate-100">
                    WhatsApp Auto-Reply
                  </h4>
                  <p className="text-[10px] leading-normal text-slate-400">
                    Automatically trigger a WhatsApp text message to new leads
                    when they are ingested.
                  </p>
                </div>
                <div
                  className={`h-4 w-8 shrink-0 rounded-full p-0.5 transition-colors duration-200 ${autoReply ? 'bg-primary' : 'bg-slate-700'}`}
                >
                  <div
                    className={`h-3 w-3 rounded-full bg-white transition-transform duration-200 ${autoReply ? 'translate-x-4' : 'translate-x-0'}`}
                  />
                </div>
              </div>

              {/* Toggle Auto-Qualify */}
              <div
                onClick={handleToggleAutoQualify}
                className={`flex cursor-pointer items-center justify-between rounded-xl border p-4 transition-all duration-300 select-none ${
                  autoQualify
                    ? 'border-primary bg-primary/5 text-white shadow-[0_0_15px_rgba(99,102,241,0.05)]'
                    : 'border-slate-800 bg-slate-950/20 text-slate-400 hover:border-slate-700 hover:bg-slate-950/40'
                } ${autoQualifySaving ? 'pointer-events-none opacity-60' : ''}`}
              >
                <div className="space-y-0.5 pr-2">
                  <h4 className="text-xs font-bold text-slate-100">
                    Auto-Qualify Lead Replies
                  </h4>
                  <p className="text-[10px] leading-normal text-slate-400">
                    Read the lead&apos;s answer, save it as their requirement,
                    then ask for what&apos;s missing or send matching listings.
                  </p>
                </div>
                <div
                  className={`h-4 w-8 shrink-0 rounded-full p-0.5 transition-colors duration-200 ${autoQualify ? 'bg-primary' : 'bg-slate-700'}`}
                >
                  <div
                    className={`h-3 w-3 rounded-full bg-white transition-transform duration-200 ${autoQualify ? 'translate-x-4' : 'translate-x-0'}`}
                  />
                </div>
              </div>

              {/* Toggle Seller's Final Price disclosure */}
              <div
                onClick={handleToggleShareFinalPrice}
                className={`flex cursor-pointer items-center justify-between rounded-xl border p-4 transition-all duration-300 select-none ${
                  shareFinalPrice
                    ? 'border-primary bg-primary/5 text-white shadow-[0_0_15px_rgba(99,102,241,0.05)]'
                    : 'border-slate-800 bg-slate-950/20 text-slate-400 hover:border-slate-700 hover:bg-slate-950/40'
                } ${shareFinalPriceSaving ? 'pointer-events-none opacity-60' : ''}`}
              >
                <div className="space-y-0.5 pr-2">
                  <h4 className="text-xs font-bold text-slate-100">
                    Quote the Seller&apos;s Final Price
                  </h4>
                  <p className="text-[10px] leading-normal text-slate-400">
                    Let the bot answer &ldquo;is this negotiable?&rdquo; with
                    the final price saved on the listing, instead of promising a
                    callback. Off keeps it internal.
                  </p>
                </div>
                <div
                  className={`h-4 w-8 shrink-0 rounded-full p-0.5 transition-colors duration-200 ${shareFinalPrice ? 'bg-primary' : 'bg-slate-700'}`}
                >
                  <div
                    className={`h-3 w-3 rounded-full bg-white transition-transform duration-200 ${shareFinalPrice ? 'translate-x-4' : 'translate-x-0'}`}
                  />
                </div>
              </div>
            </div>

            {/* Auto-Reply Settings */}
            {autoReply && (
              <div className="animate-fadeIn space-y-4 pt-2 duration-200">
                <div className="space-y-2">
                  <Label
                    htmlFor="autoReplyType"
                    className="text-xs font-medium text-slate-300"
                  >
                    Reply Method
                  </Label>
                  <select
                    id="autoReplyType"
                    value={autoReplyTemplateName || 'custom'}
                    onChange={(e) => {
                      const val = e.target.value;
                      setAutoReplyTemplateName(val === 'custom' ? null : val);
                    }}
                    className="focus:ring-primary flex h-10 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-medium text-slate-200 focus:ring-1 focus:outline-none"
                  >
                    <option value="custom">
                      Custom Text Message (within 24h window; auto-falls back to
                      Utility template if expired)
                    </option>
                    {approvedTemplates.map((t) => (
                      <option key={t.name} value={t.name}>
                        Template: {t.name} ({t.category})
                      </option>
                    ))}
                  </select>
                </div>

                {!autoReplyTemplateName ? (
                  <div className="space-y-2">
                    <Label
                      htmlFor="autoReplyText"
                      className="text-xs font-medium text-slate-300"
                    >
                      Auto-Reply Message Content
                    </Label>
                    <textarea
                      id="autoReplyText"
                      value={autoReplyText}
                      onChange={(e) => setAutoReplyText(e.target.value)}
                      className="focus:ring-primary flex min-h-24 w-full resize-none rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-xs leading-relaxed font-medium text-slate-200 focus:ring-1 focus:outline-none"
                      placeholder="Hi {name}, thank you for your query on {source}..."
                    />
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] leading-relaxed text-slate-400">
                      <span>Supported variables:</span>
                      <span>
                        <code className="py-0.2 text-primary rounded bg-slate-900 px-1 font-mono text-[9px]">{`{name}`}</code>{' '}
                        Lead&apos;s Name
                      </span>
                      <span>
                        <code className="py-0.2 text-primary rounded bg-slate-900 px-1 font-mono text-[9px]">{`{source}`}</code>{' '}
                        Portal Name (e.g. Housing)
                      </span>
                    </div>
                    <p className="pt-1 text-[10px] leading-relaxed text-amber-500/80">
                      If the 24-hour WhatsApp session has expired, the system
                      will automatically send the first approved
                      Utility/Marketing template instead of this text.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label className="text-xs font-medium text-slate-300">
                      Template Preview & Variables
                    </Label>
                    {(() => {
                      const selectedTpl = approvedTemplates.find(
                        (t) => t.name === autoReplyTemplateName
                      );
                      if (!selectedTpl) return null;
                      return (
                        <div className="border-slate-850 space-y-2 rounded-md border bg-slate-950 p-3.5">
                          <p className="rounded border border-slate-900 bg-slate-900/60 p-2.5 font-mono text-[11px] leading-relaxed text-slate-300">
                            {selectedTpl.body_text}
                          </p>
                          <div className="space-y-1 pt-1 text-[10px] text-slate-400">
                            <p className="font-semibold text-slate-300">
                              Variable mapping for this template:
                            </p>
                            <ul className="list-disc space-y-0.5 pl-4">
                              <li>
                                <code className="text-primary bg-slate-900 px-1">{`{{1}}`}</code>{' '}
                                maps to Lead&apos;s Name
                              </li>
                              <li>
                                <code className="text-primary bg-slate-900 px-1">{`{{2}}`}</code>{' '}
                                maps to Portal Name (e.g. Housing)
                              </li>
                            </ul>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}

            {/* Portal Setup Guide Accordion */}
            <div className="border-slate-850 mt-2 space-y-3 rounded-xl border bg-slate-950 p-4 text-xs">
              <div className="flex items-center gap-1.5 border-b border-slate-900 pb-2 font-bold text-slate-200">
                <Mail className="text-primary size-4 shrink-0" />
                Gmail / Outlook Auto-Forwarding Guide
              </div>
              <ol className="list-decimal space-y-2 pl-4 text-[11px] leading-relaxed text-slate-400">
                <li>
                  <strong>Create filter:</strong> In your business Gmail
                  settings, go to{' '}
                  <span className="text-slate-300">
                    Filters and Blocked Addresses
                  </span>{' '}
                  &gt;{' '}
                  <span className="text-slate-350">Create a new filter</span>.
                </li>
                <li>
                  <strong>Set Sender:</strong> Set &quot;From&quot; to match:
                  <code className="mt-1 block overflow-x-auto rounded bg-slate-900 p-1.5 font-mono text-[9px] whitespace-pre-wrap text-slate-300 select-all">
                    services@99acres.com OR info@magicbricks.com OR
                    noreply@housing-mailer.com
                  </code>
                </li>
                <li>
                  <strong>Set Action:</strong> Check{' '}
                  <span className="text-slate-300">Forward it to</span> and add
                  your address:{' '}
                  <code className="text-primary mr-1.5 font-mono font-semibold select-all">
                    {forwardingEmail}
                  </code>
                  <Button
                    type="button"
                    onClick={() => handleCopyEmail(forwardingEmail)}
                    className="text-slate-350 inline-flex h-5 cursor-pointer items-center gap-1 rounded border border-slate-800 bg-slate-900 px-1.5 font-sans text-[9px] hover:bg-slate-800"
                  >
                    <Copy className="size-2.5" />
                    Copy
                  </Button>
                </li>
                <li>
                  <strong>Verification Code:</strong> Gmail will send a
                  confirmation code. The webhook will intercept it and return
                  success automatically. Refresh Gmail and confirm the
                  forwarding filter.
                </li>
              </ol>
            </div>

            <div className="flex justify-end border-t border-slate-800 pt-4">
              <Button
                type="submit"
                disabled={syncConfigSaving}
                className="bg-primary text-primary-foreground hover:bg-primary-hover flex cursor-pointer items-center gap-2"
              >
                {syncConfigSaving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                Save Sync Preferences
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Anonymized Market Data (DPDP opt-in) Card */}
      <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl font-bold text-white">
            <BarChart3 className="text-primary size-5" />
            Anonymized Market Data
          </CardTitle>
          <CardDescription className="text-slate-400">
            Contribute anonymized listing &amp; demand statistics to build
            area-level market benchmarks — and unlock them for your account as
            they become available.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/30 p-4 text-[11px] leading-relaxed text-slate-400">
            <p>
              <strong className="text-slate-300">What is shared:</strong>{' '}
              aggregated, anonymized statistics only — e.g. median price,
              listing counts, and days-to-sell per locality and month. A
              statistic is published only when it is backed by at least 5
              different agencies, so your individual activity is never
              identifiable.
            </p>
            <p>
              <strong className="text-slate-300">What is never shared:</strong>{' '}
              your contacts, leads, conversations, names, phone numbers, or any
              individual listing. Your data is never sold to third parties in
              identifiable form.
            </p>
            <p>
              <strong className="text-slate-300">Your choice:</strong> this is
              optional and off by default. You can withdraw anytime here — your
              data is excluded from the very next aggregation. Details in our{' '}
              <Link href="/privacy" className="text-primary hover:underline">
                Privacy Policy
              </Link>
              .
            </p>
          </div>

          <div
            onClick={handleToggleConsent}
            role="switch"
            aria-checked={consent}
            aria-disabled={!isOwner}
            className={`flex items-center justify-between rounded-xl border p-4 transition-all duration-300 select-none ${
              !isOwner
                ? 'cursor-not-allowed border-slate-800 bg-slate-950/20 text-slate-500 opacity-70'
                : consent
                  ? 'border-primary bg-primary/5 cursor-pointer text-white shadow-[0_0_15px_rgba(99,102,241,0.05)]'
                  : 'cursor-pointer border-slate-800 bg-slate-950/20 text-slate-400 hover:border-slate-700 hover:bg-slate-950/40'
            }`}
          >
            <div className="space-y-0.5 pr-2">
              <h4 className="text-xs font-bold text-slate-100">
                Share anonymized market data
              </h4>
              <p className="text-[10px] leading-normal text-slate-400">
                {!isOwner
                  ? 'Only the account owner can change this setting.'
                  : consent && consentAt
                    ? `On since ${new Date(consentAt).toLocaleDateString()}. Tap to withdraw.`
                    : 'Opt in to contribute — and benefit from — area benchmarks.'}
              </p>
            </div>
            {consentSaving ? (
              <Loader2 className="size-4 shrink-0 animate-spin text-slate-400" />
            ) : (
              <div
                className={`h-4 w-8 shrink-0 rounded-full p-0.5 transition-colors duration-200 ${consent ? 'bg-primary' : 'bg-slate-700'}`}
              >
                <div
                  className={`h-3 w-3 rounded-full bg-white transition-transform duration-200 ${consent ? 'translate-x-4' : 'translate-x-0'}`}
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
