'use client';

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Coins, Loader2, Save, Database, RefreshCw, Mail, Copy, Check } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { BRANDING } from '@/config/branding';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { MessageTemplate } from '@/types';


export function OtherSettingsPanel() {
  const supabase = createClient();
  const { accountId, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currency, setCurrency] = useState('INR');
  const [hasSettings, setHasSettings] = useState(false);

  // RERA Projects Sync State
  const [projectCount, setProjectCount] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);

  // Email Sync Config State
  const [syncActive, setSyncActive] = useState(false);
  const [autoReply, setAutoReply] = useState(false);
  const [autoReplyText, setAutoReplyText] = useState('Hi {name}, thanks for your interest on {source}. We will get back to you shortly.');
  const [autoReplyTemplateName, setAutoReplyTemplateName] = useState<string | null>(null);
  const [approvedTemplates, setApprovedTemplates] = useState<MessageTemplate[]>([]);
  const [hasSyncConfig, setHasSyncConfig] = useState(false);
  const [syncConfigLoading, setSyncConfigLoading] = useState(true);
  const [syncConfigSaving, setSyncConfigSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  // Email sync verification code states
  const [verCode, setVerCode] = useState<string | null>(null);
  const [verLink, setVerLink] = useState<string | null>(null);
  const [verAt, setVerAt] = useState<string | null>(null);

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

  const fetchSyncConfig = useCallback(async (isInitial = false) => {
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
          setAutoReplyText(data.auto_reply_text || 'Hi {name}, thanks for your interest on {source}. We will get back to you shortly.');
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
  }, [accountId, supabase]);

  const fetchApprovedTemplates = useCallback(async () => {
    if (!accountId) return;
    try {
      const { data, error } = await supabase
        .from('message_templates')
        .select('name, category, body_text')
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
          .select('currency')
          .eq('account_id', accountId)
          .maybeSingle();

        if (error) {
          console.error('Error fetching currency settings:', error);
          toast.error('Failed to load currency settings');
          return;
        }

        if (data) {
          setCurrency(data.currency || 'INR');
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
    
    // Load last synced from localStorage if exists
    const stored = localStorage.getItem('krera_last_synced');
    if (stored) {
      setLastSynced(stored);
    }
  }, [accountId, supabase, fetchProjectCount, fetchSyncConfig, fetchApprovedTemplates]);

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
        const { error } = await supabase
          .from('email_sync_configs')
          .update(payload)
          .eq('account_id', accountId);

        if (error) throw error;
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
        const textArea = document.createElement("textarea");
        textArea.value = emailStr;
        textArea.style.position = "fixed";
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
        const { error } = await supabase
          .from('showcase_settings')
          .update({
            currency,
            updated_at: new Date().toISOString(),
          })
          .eq('account_id', accountId);

        if (error) throw error;
      } else {
        // Insert a new showcase settings row with default details + currency
        const { error } = await supabase
          .from('showcase_settings')
          .insert([{
            account_id: accountId,
            website_name: BRANDING.name,
            website_url: BRANDING.websiteUrl,
            contact_phone: '',
            whatsapp_message_template: 'Hi! I am interested in your property "{title}" in {location}. Please share details.',
            currency,
          }]);

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
      localStorage.setItem('krera_last_synced', timeStr);
      
      await fetchProjectCount();
      
      toast.success(
        `Synchronized ${data.total_upserted} projects (${data.seeded_count} core seeds, ${data.scraped_count} dynamic outskirts projects)`,
        { id: toastId }
      );
    } catch (err) {
      console.error('Failed to sync projects:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to sync projects', { id: toastId });
    } finally {
      setSyncing(false);
    }
  };

  if (loading || authLoading || syncConfigLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  const leadsDomain = process.env.NEXT_PUBLIC_LEADS_EMAIL_DOMAIN || 'leads.convoreal.com';
  const forwardingEmail = `lead-sync-${accountId}@${leadsDomain}`;

  const isVerificationRecent = verAt ? (new Date().getTime() - new Date(verAt).getTime() < 7 * 24 * 60 * 60 * 1000) : false;

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
          <CardTitle className="text-xl font-bold text-white flex items-center gap-2">
            <Coins className="size-5 text-primary" />
            General & Currency Settings
          </CardTitle>
          <CardDescription className="text-slate-400">
            Configure general preferences and default currency symbols used across properties, flyers, shared layouts, and dashboards.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-6">
            <div className="space-y-2 max-w-md">
              <Label htmlFor="currency" className="text-slate-350 font-medium">
                System Default Currency
              </Label>
              <select
                id="currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="flex h-10 w-full rounded-md border border-slate-800 bg-slate-950 px-3 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-primary font-medium"
              >
                <option value="INR">INR (₹) - Rupees</option>
                <option value="USD">USD ($) - Dollars</option>
                <option value="EUR">EUR (€) - Euros</option>
                <option value="GBP">GBP (£) - Pounds</option>
                <option value="AED">AED (د.إ) - Dirhams</option>
              </select>
              <p className="text-[11px] text-slate-400">
                Primary currency code. Indian Rupees use dynamic Lakhs/Crores representations automatically.
              </p>
            </div>

            <div className="flex justify-end pt-4 border-t border-slate-800">
              <Button
                type="submit"
                disabled={saving}
                className="bg-primary text-primary-foreground hover:bg-primary-hover flex items-center gap-2 cursor-pointer"
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
          <CardTitle className="text-xl font-bold text-white flex items-center gap-2">
            <Database className="size-5 text-primary" />
            RERA Project Registry Sourcing
          </CardTitle>
          <CardDescription className="text-slate-400">
            Sourced pipeline for Apartment, Villa, and Layout Projects. This populates your database with real registered projects in Bangalore and its outskirts to power autocomplete in property details.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                <span>Database Sync Status</span>
                <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400 border border-emerald-500/20">
                  Online
                </span>
              </div>
              <div className="text-xs text-slate-400">
                Total Sourced Projects: <span className="font-bold text-white">{projectCount ?? 'Loading...'}</span>
              </div>
              {lastSynced && (
                <div className="text-[10px] text-slate-500">
                  Last synced: <span className="text-slate-400">{lastSynced}</span>
                </div>
              )}
            </div>

            <Button
              onClick={handleSyncProjects}
              disabled={syncing}
              className="bg-primary text-primary-foreground hover:bg-primary-hover flex items-center gap-2 cursor-pointer self-start md:self-auto"
            >
              {syncing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Sync RERA Projects
            </Button>
          </div>

          <div className="text-xs text-slate-500 space-y-2">
            <p>
              <strong>Surrounding Taluks Covered:</strong> Ingests projects matching Bangalore Urban, Bangalore Rural, Devanahalli, Hoskote, Sarjapur, Kanakapura, Jigani, Bagalur, Nelamangala, Doddaballapur, Anekal, Attibele, Bidadi, and surrounding layouts.
            </p>
            <p>
              <strong>AI Cloud Expansion:</strong> When the sync is triggered, the cloud pipeline automatically leverages Gemini AI Studio to identify newer registered real estate projects in Bangalore, resolving sublocality and promoter details directly in your database.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Email Lead Sourcing Card */}
      <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-xl font-bold text-white flex items-center gap-2">
            <Mail className="size-5 text-primary" />
            Email Lead Sourcing (99acres, Magicbricks, Housing)
          </CardTitle>
          <CardDescription className="text-slate-400">
            Automatically ingest leads from major property portals directly from your email forwarding rules.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSaveSyncConfig} className="space-y-6">
            
            {/* Forwarding Address Box */}
            <div className="space-y-2">
              <Label className="text-slate-300 font-medium text-xs">
                Your Inbound Forwarding Address
              </Label>
              <div className="flex items-center gap-2 max-w-xl">
                <div className="flex-1 flex items-center justify-between bg-slate-950 border border-slate-800 rounded-md px-3 h-10 text-xs font-mono text-slate-300 select-all overflow-x-auto whitespace-nowrap scrollbar-thin">
                  <span>{forwardingEmail}</span>
                </div>
                <Button
                  type="button"
                  onClick={() => handleCopyEmail(forwardingEmail)}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 h-10 px-3 flex items-center gap-1.5 cursor-pointer text-xs"
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
              <p className="text-[10px] text-slate-400 leading-relaxed">
                Configure your email inbox (e.g. Gmail / Outlook) to forward lead emails from <code className="bg-slate-950 px-1 py-0.5 rounded text-primary text-[9px] font-mono">services@99acres.com</code>, <code className="bg-slate-950 px-1 py-0.5 rounded text-primary text-[9px] font-mono">info@magicbricks.com</code>, or <code className="bg-slate-950 px-1 py-0.5 rounded text-primary text-[9px] font-mono">noreply@housing-mailer.com</code> to this email address.
              </p>
            </div>

            {/* Inbound Verification Alert Banner */}
            {isVerificationRecent && (verCode || verLink) && (
              <div className="p-4 rounded-xl border border-indigo-500/30 bg-indigo-950/20 backdrop-blur-md text-slate-200 space-y-3 mt-2">
                <div className="flex items-center justify-between border-b border-indigo-500/20 pb-2">
                  <div className="font-bold text-indigo-400 flex items-center gap-2 text-xs">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
                    </span>
                    Inbound Verification Received
                  </div>
                  <span className="text-[10px] text-slate-450">
                    Captured {getRelativeTimeString(verAt)}
                  </span>
                </div>
                <div className="space-y-3 text-xs leading-relaxed">
                  <p className="text-slate-350 text-[11px]">
                    A forwarding verification email was just received on your inbound address. Copy the code or click the confirmation link to complete your forwarding setup.
                  </p>
                  
                  {verCode && (
                    <div className="space-y-1">
                      <span className="text-[9px] text-slate-400 font-semibold uppercase tracking-wider">Confirmation Code</span>
                      <div className="flex items-center gap-2 max-w-sm">
                        <div className="flex-1 bg-slate-950 border border-indigo-500/20 rounded-md px-3 h-9 flex items-center text-xs font-mono text-indigo-200 select-all">
                          {verCode}
                        </div>
                        <Button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(verCode);
                            toast.success('Confirmation code copied');
                          }}
                          className="bg-indigo-900/50 hover:bg-indigo-800/50 text-indigo-200 border border-indigo-500/20 h-9 px-3 text-xs flex items-center gap-1 cursor-pointer"
                        >
                          <Copy className="size-3.5" />
                          Copy
                        </Button>
                      </div>
                    </div>
                  )}

                  {verLink && (
                    <div className="space-y-1">
                      <span className="text-[9px] text-slate-400 font-semibold uppercase tracking-wider">Confirmation Link</span>
                      <div className="flex items-center gap-2">
                        <a
                          href={verLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 bg-slate-950 hover:bg-slate-900 border border-indigo-500/20 rounded-md px-3 h-9 flex items-center text-[10px] font-mono text-indigo-350 truncate underline cursor-pointer"
                        >
                          {verLink}
                        </a>
                        <Button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(verLink);
                            toast.success('Confirmation link copied');
                          }}
                          className="bg-indigo-900/50 hover:bg-indigo-800/50 text-indigo-200 border border-indigo-500/20 h-9 px-3 text-xs flex items-center gap-1 cursor-pointer shrink-0"
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              {/* Toggle Sync Active */}
              <div
                onClick={() => setSyncActive(!syncActive)}
                className={`p-4 rounded-xl border transition-all duration-300 cursor-pointer flex items-center justify-between select-none ${
                  syncActive
                    ? 'border-primary bg-primary/5 text-white shadow-[0_0_15px_rgba(99,102,241,0.05)]'
                    : 'border-slate-800 bg-slate-950/20 text-slate-400 hover:border-slate-700 hover:bg-slate-950/40'
                }`}
              >
                <div className="space-y-0.5 pr-2">
                  <h4 className="text-xs font-bold text-slate-100">Enable Lead Synchronization</h4>
                  <p className="text-[10px] text-slate-400 leading-normal">
                    Accept forwarded portal emails and parse them automatically into buyer contacts.
                  </p>
                </div>
                <div className={`w-8 h-4 rounded-full p-0.5 transition-colors duration-200 shrink-0 ${syncActive ? 'bg-primary' : 'bg-slate-700'}`}>
                  <div className={`w-3 h-3 rounded-full bg-white transition-transform duration-200 ${syncActive ? 'translate-x-4' : 'translate-x-0'}`} />
                </div>
              </div>

              {/* Toggle Auto-Reply */}
              <div
                onClick={() => setAutoReply(!autoReply)}
                className={`p-4 rounded-xl border transition-all duration-300 cursor-pointer flex items-center justify-between select-none ${
                  autoReply
                    ? 'border-primary bg-primary/5 text-white shadow-[0_0_15px_rgba(99,102,241,0.05)]'
                    : 'border-slate-800 bg-slate-950/20 text-slate-400 hover:border-slate-700 hover:bg-slate-950/40'
                }`}
              >
                <div className="space-y-0.5 pr-2">
                  <h4 className="text-xs font-bold text-slate-100">WhatsApp Auto-Reply</h4>
                  <p className="text-[10px] text-slate-400 leading-normal">
                    Automatically trigger a WhatsApp text message to new leads when they are ingested.
                  </p>
                </div>
                <div className={`w-8 h-4 rounded-full p-0.5 transition-colors duration-200 shrink-0 ${autoReply ? 'bg-primary' : 'bg-slate-700'}`}>
                  <div className={`w-3 h-3 rounded-full bg-white transition-transform duration-200 ${autoReply ? 'translate-x-4' : 'translate-x-0'}`} />
                </div>
              </div>
            </div>

            {/* Auto-Reply Settings */}
            {autoReply && (
              <div className="space-y-4 pt-2 animate-fadeIn duration-200">
                <div className="space-y-2">
                  <Label htmlFor="autoReplyType" className="text-slate-300 font-medium text-xs">
                    Reply Method
                  </Label>
                  <select
                    id="autoReplyType"
                    value={autoReplyTemplateName || 'custom'}
                    onChange={(e) => {
                      const val = e.target.value;
                      setAutoReplyTemplateName(val === 'custom' ? null : val);
                    }}
                    className="flex h-10 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-primary font-medium"
                  >
                    <option value="custom">Custom Text Message (Restricted to 24h window)</option>
                    {approvedTemplates.map((t) => (
                      <option key={t.name} value={t.name}>
                        Template: {t.name} ({t.category})
                      </option>
                    ))}
                  </select>
                </div>

                {!autoReplyTemplateName ? (
                  <div className="space-y-2">
                    <Label htmlFor="autoReplyText" className="text-slate-300 font-medium text-xs">
                      Auto-Reply Message Content
                    </Label>
                    <textarea
                      id="autoReplyText"
                      value={autoReplyText}
                      onChange={(e) => setAutoReplyText(e.target.value)}
                      className="flex min-h-24 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-primary font-medium resize-none leading-relaxed"
                      placeholder="Hi {name}, thank you for your query on {source}..."
                    />
                    <div className="text-[10px] text-slate-400 leading-relaxed flex flex-wrap gap-x-3 gap-y-1">
                      <span>Supported variables:</span>
                      <span><code className="bg-slate-900 px-1 py-0.2 rounded text-primary text-[9px] font-mono">{`{name}`}</code> Lead&apos;s Name</span>
                      <span><code className="bg-slate-900 px-1 py-0.2 rounded text-primary text-[9px] font-mono">{`{source}`}</code> Portal Name (e.g. Housing)</span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label className="text-slate-300 font-medium text-xs">
                      Template Preview & Variables
                    </Label>
                    {(() => {
                      const selectedTpl = approvedTemplates.find(t => t.name === autoReplyTemplateName);
                      if (!selectedTpl) return null;
                      return (
                        <div className="p-3.5 rounded-md border border-slate-850 bg-slate-950 space-y-2">
                          <p className="text-[11px] text-slate-300 font-mono leading-relaxed bg-slate-900/60 p-2.5 rounded border border-slate-900">
                            {selectedTpl.body_text}
                          </p>
                          <div className="text-[10px] text-slate-400 space-y-1 pt-1">
                            <p className="font-semibold text-slate-300">Variable mapping for this template:</p>
                            <ul className="list-disc pl-4 space-y-0.5">
                              <li><code className="bg-slate-900 px-1 text-primary">{`{{1}}`}</code> maps to Lead&apos;s Name</li>
                              <li><code className="bg-slate-900 px-1 text-primary">{`{{2}}`}</code> maps to Portal Name (e.g. Housing)</li>
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
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-850 text-xs space-y-3 mt-2">
              <div className="font-bold text-slate-200 flex items-center gap-1.5 border-b border-slate-900 pb-2">
                <Mail className="size-4 text-primary shrink-0" />
                Gmail / Outlook Auto-Forwarding Guide
              </div>
              <ol className="list-decimal pl-4 space-y-2 text-slate-400 leading-relaxed text-[11px]">
                <li>
                  <strong>Create filter:</strong> In your business Gmail settings, go to <span className="text-slate-300">Filters and Blocked Addresses</span> &gt; <span className="text-slate-350">Create a new filter</span>.
                </li>
                <li>
                  <strong>Set Sender:</strong> Set &quot;From&quot; to match:
                  <code className="block bg-slate-900 text-slate-300 font-mono p-1.5 rounded mt-1 text-[9px] select-all overflow-x-auto whitespace-pre-wrap">
                    services@99acres.com OR info@magicbricks.com OR noreply@housing-mailer.com
                  </code>
                </li>
                <li>
                  <strong>Set Action:</strong> Check <span className="text-slate-300">Forward it to</span> and add your address: <code className="text-primary font-mono select-all font-semibold mr-1.5">{forwardingEmail}</code>
                  <Button
                    type="button"
                    onClick={() => handleCopyEmail(forwardingEmail)}
                    className="inline-flex items-center gap-1 bg-slate-900 hover:bg-slate-800 text-slate-350 border border-slate-800 h-5 px-1.5 rounded cursor-pointer text-[9px] font-sans"
                  >
                    <Copy className="size-2.5" />
                    Copy
                  </Button>
                </li>
                <li>
                  <strong>Verification Code:</strong> Gmail will send a confirmation code. The webhook will intercept it and return success automatically. Refresh Gmail and confirm the forwarding filter.
                </li>
              </ol>
            </div>

            <div className="flex justify-end pt-4 border-t border-slate-800">
              <Button
                type="submit"
                disabled={syncConfigSaving}
                className="bg-primary text-primary-foreground hover:bg-primary-hover flex items-center gap-2 cursor-pointer"
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
    </div>
  );
}

