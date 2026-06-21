'use client';

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Coins, Loader2, Save, Database, RefreshCw } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { BRANDING } from '@/config/branding';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';


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
    
    // Load last synced from localStorage if exists
    const stored = localStorage.getItem('krera_last_synced');
    if (stored) {
      setLastSynced(stored);
    }
  }, [accountId, supabase, fetchProjectCount]);

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

  if (loading || authLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

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
    </div>
  );
}

