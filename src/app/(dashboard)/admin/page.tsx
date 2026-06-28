'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import {
  Shield,
  Activity,
  Building,
  Users,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Save,
  Info,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

interface WhatsappConfig {
  account_id: string;
  phone_number_id: string | null;
  status: string;
  integration_type: string;
  owner_name: string;
  owner_email: string;
}

interface Organization {
  id: string;
  name: string;
  created_at: string;
  owner_name: string;
  owner_email: string;
}

export default function AdminDashboardPage() {
  const { user, profileLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<'overview' | 'settings' | 'sandbox' | 'analytics' | 'organizations'>('overview');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // DB Data State
  const [whatsappConfigs, setWhatsappConfigs] = useState<WhatsappConfig[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [metrics, setMetrics] = useState({ usersCount: 0, orgsCount: 0 });
  const [fallbackConfigAccountId, setFallbackConfigAccountId] = useState<string | null>(null);
  const [featureToggles, setFeatureToggles] = useState<Record<string, boolean>>({
    selfRegistrationEnabled: true,
    sandboxTrialsEnabled: true,
  });

  // Sandbox Config State
  const [sandboxPhoneNumberId, setSandboxPhoneNumberId] = useState('');
  const [sandboxWabaId, setSandboxWabaId] = useState('');
  const [sandboxAccessToken, setSandboxAccessToken] = useState('');
  const [sandboxVerifyToken, setSandboxVerifyToken] = useState('');
  const [sandboxDisplayName, setSandboxDisplayName] = useState('ConvoReal Sandbox');
  const [sandboxEnabled, setSandboxEnabled] = useState(false);
  const [testingSandbox, setTestingSandbox] = useState(false);

  // Sandbox Analytics State
  const [sandboxTenants, setSandboxTenants] = useState<Array<Record<string, unknown>>>([]);
  const [sandboxAnalyticsLoading, setSandboxAnalyticsLoading] = useState(false);
  const [sandboxStats, setSandboxStats] = useState({
    activeTrials: 0,
    expiredTrials: 0,
    totalMessagesUsed: 0,
    avgMessagesPerTenant: 0,
    conversionRate: 0,
  });

  useEffect(() => {
    async function fetchAdminData() {
      try {
        const res = await fetch('/api/admin/settings');
        if (!res.ok) {
          if (res.status === 403) {
            toast.error('Access Denied: Super Admin role required');
          } else {
            toast.error('Failed to load admin settings');
          }
          setLoading(false);
          return;
        }

        const data = await res.json();
        setWhatsappConfigs(data.whatsappConfigs || []);
        setOrganizations(data.organizations || []);
        setMetrics(data.metrics || { usersCount: 0, orgsCount: 0 });
        setFallbackConfigAccountId(data.settings?.fallback_whatsapp_account_id || null);
        if (data.settings?.feature_toggles) {
          setFeatureToggles(data.settings.feature_toggles);
        }
        // Load sandbox config if present
        if (data.settings?.sandbox_config) {
          const sc = data.settings.sandbox_config;
          setSandboxPhoneNumberId(sc.phone_number_id || '');
          setSandboxWabaId(sc.waba_id || '');
          setSandboxAccessToken(sc.access_token ? '••••••••••••••••' : '');
          setSandboxVerifyToken(sc.verify_token || '');
          setSandboxDisplayName(sc.display_name || 'ConvoReal Sandbox');
          setSandboxEnabled(sc.enabled || false);
        }
        setLoading(false);
      } catch (err) {
        console.error('Error fetching admin settings:', err);
        toast.error('Internal server error loading settings');
        setLoading(false);
      }
    }

    if (!profileLoading && user) {
      fetchAdminData();
    }
  }, [user, profileLoading]);

  async function handleSaveSettings() {
    try {
      setSaving(true);
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fallback_whatsapp_account_id: fallbackConfigAccountId,
          feature_toggles: featureToggles,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to update settings');
      }

      toast.success('Admin settings successfully updated');
    } catch (err) {
      console.error('Error saving settings:', err);
      toast.error('Failed to save settings changes');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveSandboxConfig() {
    try {
      setSaving(true);
      const payload: Record<string, unknown> = {
        phone_number_id: sandboxPhoneNumberId.trim() || null,
        waba_id: sandboxWabaId.trim() || null,
        verify_token: sandboxVerifyToken.trim() || null,
        display_name: sandboxDisplayName.trim() || 'ConvoReal Sandbox',
        enabled: sandboxEnabled,
      };
      // Only send token if it was changed (not masked)
      if (sandboxAccessToken && sandboxAccessToken !== '••••••••••••••••') {
        payload.access_token = sandboxAccessToken.trim();
      }

      const res = await fetch('/api/admin/sandbox-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update sandbox config');
      }

      toast.success('Sandbox configuration saved successfully');
    } catch (err) {
      console.error('Error saving sandbox config:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to save sandbox config');
    } finally {
      setSaving(false);
    }
  }

  async function handleTestSandboxConnection() {
    try {
      setTestingSandbox(true);
      const res = await fetch('/api/admin/sandbox-config', { method: 'GET' });
      const data = await res.json();

      if (data.connected) {
        toast.success(`Sandbox connected: ${data.phone_info?.verified_name || 'API OK'}`);
      } else {
        toast.error(data.message || 'Sandbox connection failed');
      }
    } catch (err) {
      console.error('Error testing sandbox:', err);
      toast.error('Failed to test sandbox connection');
    } finally {
      setTestingSandbox(false);
    }
  }

  async function fetchSandboxAnalytics() {
    try {
      setSandboxAnalyticsLoading(true);
      const res = await fetch('/api/admin/sandbox-tenants?include_expired=true');
      if (!res.ok) throw new Error('Failed to fetch sandbox tenants');
      const data = await res.json();
      const tenants = (data.tenants || []) as Array<Record<string, unknown>>;
      setSandboxTenants(tenants);

      // Calculate stats
      const now = new Date().getTime();
      const active = tenants.filter((t) => {
        const endsAt = (t.trial_ends_at as string | null);
        return endsAt ? new Date(endsAt).getTime() > now : true;
      });
      const expired = tenants.filter((t) => {
        const endsAt = (t.trial_ends_at as string | null);
        return endsAt ? new Date(endsAt).getTime() <= now : false;
      });
      const totalMessages = tenants.reduce((sum, t) => sum + ((t.sandbox_message_count as number) || 0), 0);
      const migratedCount = tenants.filter((t) => !!t.migrated_from_sandbox_at).length;
      const totalCount = tenants.length;

      setSandboxStats({
        activeTrials: active.length,
        expiredTrials: expired.length,
        totalMessagesUsed: totalMessages,
        avgMessagesPerTenant: totalCount > 0 ? Math.round(totalMessages / totalCount) : 0,
        conversionRate: totalCount > 0 ? Math.round((migratedCount / totalCount) * 100) : 0,
      });
    } catch (err) {
      console.error('Error fetching sandbox analytics:', err);
      toast.error('Failed to load sandbox analytics');
    } finally {
      setSandboxAnalyticsLoading(false);
    }
  }

  async function handleBulkMigrate() {
    const selected = sandboxTenants
      .filter((t) => (t as unknown as { selected?: boolean }).selected)
      .map((t) => t.account_id as string);

    if (selected.length === 0) {
      toast.error('Select at least one tenant to migrate');
      return;
    }

    if (!confirm(`Migrate ${selected.length} tenant(s) to Official API using the same credentials? This will apply the SAME phone number and token to ALL selected tenants.`)) {
      return;
    }

    // For bulk migration, we need credentials from the first selected tenant or ask admin
    // In practice, bulk migration should use a prompt for shared credentials
    toast.info('Bulk migration requires entering credentials. Please migrate tenants individually from their settings page.');
  }

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-slate-400">Loading Admin Dashboard...</p>
        </div>
      </div>
    );
  }

  const selectedFallback = whatsappConfigs.find((c) => c.account_id === fallbackConfigAccountId);

  return (
    <div className="space-y-6">
      {/* Admin Title */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Shield className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-black tracking-tight text-white uppercase">
            Global Admin Control Center
          </h1>
        </div>
        <p className="text-sm text-slate-400">
          Manage system configurations, organizations, feature toggles, and dynamic fallbacks.
        </p>
      </div>

      {/* Admin Navigation Tabs */}
      <div className="flex border-b border-slate-800 gap-2">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-all ${
            activeTab === 'overview'
              ? 'border-primary text-white bg-primary/5'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-all ${
            activeTab === 'settings'
              ? 'border-primary text-white bg-primary/5'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          Fallback & Settings
        </button>
        <button
          onClick={() => setActiveTab('sandbox')}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-all ${
            activeTab === 'sandbox'
              ? 'border-primary text-white bg-primary/5'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          Sandbox Config
        </button>
        <button
          onClick={() => { setActiveTab('analytics'); fetchSandboxAnalytics(); }}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-all ${
            activeTab === 'analytics'
              ? 'border-primary text-white bg-primary/5'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          Sandbox Analytics
        </button>
        <button
          onClick={() => setActiveTab('organizations')}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-all ${
            activeTab === 'organizations'
              ? 'border-primary text-white bg-primary/5'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          Organizations
        </button>
      </div>

      {/* Tab Contents */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Metrics Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-semibold text-slate-400">Total Users</CardTitle>
                <Users className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-black text-white">{metrics.usersCount}</div>
                <p className="text-xs text-slate-500 mt-1">Platform-wide registered profiles</p>
              </CardContent>
            </Card>

            <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-semibold text-slate-400">Organizations</CardTitle>
                <Building className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-black text-white">{metrics.orgsCount}</div>
                <p className="text-xs text-slate-500 mt-1">Active business tenants</p>
              </CardContent>
            </Card>

            <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-semibold text-slate-400">WhatsApp Senders</CardTitle>
                <Activity className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-black text-white">{whatsappConfigs.length}</div>
                <p className="text-xs text-slate-500 mt-1">Configured account credentials</p>
              </CardContent>
            </Card>
          </div>

          {/* Current Fallback Status Alert */}
          {selectedFallback ? (
            <Alert className="bg-emerald-950/30 border-emerald-600/30 text-slate-200">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <AlertTitle className="text-emerald-400 font-bold">Active Fallback OTP Sender Configured</AlertTitle>
              <AlertDescription className="text-xs text-slate-400 mt-1">
                System OTP login codes will be sent from account:{' '}
                <strong className="text-slate-200">
                  {selectedFallback.owner_name} ({selectedFallback.owner_email})
                </strong>{' '}
                using method <strong className="text-slate-200">{selectedFallback.integration_type}</strong> (Phone ID:{' '}
                {selectedFallback.phone_number_id || 'N/A'}).
              </AlertDescription>
            </Alert>
          ) : (
            <Alert className="bg-amber-950/30 border-amber-600/30 text-slate-200">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              <AlertTitle className="text-amber-400 font-bold">No Explicit Fallback Sender Configured</AlertTitle>
              <AlertDescription className="text-xs text-slate-400 mt-1">
                The system is currently defaulting to the very first registered config row in the database. Go to the{' '}
                <button
                  onClick={() => setActiveTab('settings')}
                  className="underline text-primary font-semibold cursor-pointer"
                >
                  Fallback & Settings
                </button>{' '}
                tab to configure one explicitly.
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}

      {activeTab === 'settings' && (
        <div className="space-y-6 max-w-3xl">
          <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
            <CardHeader>
              <CardTitle className="text-white text-base">OTP Fallback Routing Configuration</CardTitle>
              <CardDescription className="text-slate-400">
                Choose which account&apos;s Meta credentials will send the system-wide login OTP verification codes.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-300">Selected Sender Account</label>
                <select
                  value={fallbackConfigAccountId || ''}
                  onChange={(e) => setFallbackConfigAccountId(e.target.value || null)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                >
                  <option value="">-- No Fallback Config Selected (Use database default) --</option>
                  {whatsappConfigs.map((cfg) => (
                    <option key={cfg.account_id} value={cfg.account_id}>
                      {cfg.owner_name} ({cfg.owner_email}) - {cfg.integration_type.toUpperCase()} [ID:{' '}
                      {cfg.phone_number_id || 'N/A'}]
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-500 leading-relaxed flex items-start gap-1.5 pt-1">
                  <Info className="h-3.5 w-3.5 text-slate-400 shrink-0 mt-0.5" />
                  Ensure the selected sender account has an approved Utility Template named{' '}
                  <code className="text-slate-300">whatsapp_otp</code> to deliver OTP codes to Indian (+91) recipients
                  without getting blocked by Meta.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
            <CardHeader>
              <CardTitle className="text-white text-base">Global Feature Toggles</CardTitle>
              <CardDescription className="text-slate-400">
                Enable or disable specific modules and trials globally across the platform.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Toggle Self-registration */}
              <div className="flex items-center justify-between p-3 rounded-xl border border-slate-800 bg-slate-950/40">
                <div className="space-y-0.5">
                  <div className="text-sm font-semibold text-white">Self Sign-up Registration</div>
                  <p className="text-xs text-slate-500">Allow new clients to create accounts on this CRM instance.</p>
                </div>
                <input
                  type="checkbox"
                  checked={featureToggles.selfRegistrationEnabled}
                  onChange={(e) =>
                    setFeatureToggles((prev) => ({ ...prev, selfRegistrationEnabled: e.target.checked }))
                  }
                  className="rounded border-slate-700 bg-slate-800 text-primary focus:ring-0 focus:ring-offset-0 h-4 w-4 cursor-pointer"
                />
              </div>

              {/* Toggle Sandbox mode */}
              <div className="flex items-center justify-between p-3 rounded-xl border border-slate-800 bg-slate-950/40">
                <div className="space-y-0.5">
                  <div className="text-sm font-semibold text-white">Sandbox Mode Trials</div>
                  <p className="text-xs text-slate-500">Enable 7-day sandbox trials for new connections.</p>
                </div>
                <input
                  type="checkbox"
                  checked={featureToggles.sandboxTrialsEnabled}
                  onChange={(e) =>
                    setFeatureToggles((prev) => ({ ...prev, sandboxTrialsEnabled: e.target.checked }))
                  }
                  className="rounded border-slate-700 bg-slate-800 text-primary focus:ring-0 focus:ring-offset-0 h-4 w-4 cursor-pointer"
                />
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center gap-2">
            <Button onClick={handleSaveSettings} disabled={saving} className="rounded-xl px-5">
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving Settings...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Save Admin Settings
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {activeTab === 'sandbox' && (
        <div className="space-y-6 max-w-3xl">
          <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
            <CardHeader>
              <CardTitle className="text-white text-base">Shared Sandbox WhatsApp Configuration</CardTitle>
              <CardDescription className="text-slate-400">
                Configure the system-wide WhatsApp Business number that all sandbox trial tenants will share. This requires a dedicated Meta Cloud API phone number.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Enable Toggle */}
              <div className="flex items-center justify-between p-3 rounded-xl border border-slate-800 bg-slate-950/40">
                <div className="space-y-0.5">
                  <div className="text-sm font-semibold text-white">Enable Sandbox Mode</div>
                  <p className="text-xs text-slate-500">Allow users to start 7-day sandbox trials.</p>
                </div>
                <input
                  type="checkbox"
                  checked={sandboxEnabled}
                  onChange={(e) => setSandboxEnabled(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-800 text-primary focus:ring-0 focus:ring-offset-0 h-4 w-4 cursor-pointer"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-300">Display Name</label>
                <input
                  type="text"
                  value={sandboxDisplayName}
                  onChange={(e) => setSandboxDisplayName(e.target.value)}
                  placeholder="ConvoReal Sandbox"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <p className="text-xs text-slate-500">
                  This name appears to leads when they receive messages from the shared number.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-300">Phone Number ID</label>
                <input
                  type="text"
                  value={sandboxPhoneNumberId}
                  onChange={(e) => setSandboxPhoneNumberId(e.target.value)}
                  placeholder="e.g. 100234567890123"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-300">WABA ID (Optional)</label>
                <input
                  type="text"
                  value={sandboxWabaId}
                  onChange={(e) => setSandboxWabaId(e.target.value)}
                  placeholder="e.g. 100234567890456"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-300">Permanent Access Token</label>
                <input
                  type="password"
                  value={sandboxAccessToken}
                  onChange={(e) => setSandboxAccessToken(e.target.value)}
                  placeholder="Enter Meta access token"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <p className="text-xs text-slate-500">
                  {sandboxAccessToken === '••••••••••••••••' 
                    ? 'Token is hidden. Re-enter to update.' 
                    : 'This token will be encrypted before storage.'}
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-300">Webhook Verify Token</label>
                <input
                  type="text"
                  value={sandboxVerifyToken}
                  onChange={(e) => setSandboxVerifyToken(e.target.value)}
                  placeholder="Create a custom verify token"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <p className="text-xs text-slate-500">
                  Must match the verify token configured in Meta webhook settings for this number.
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center gap-3">
            <Button onClick={handleSaveSandboxConfig} disabled={saving} className="rounded-xl px-5">
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Save Sandbox Config
                </>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={handleTestSandboxConnection}
              disabled={testingSandbox}
              className="rounded-xl px-5 border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800"
            >
              {testingSandbox ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Testing...
                </>
              ) : (
                <>
                  <Activity className="h-4 w-4" />
                  Test Connection
                </>
              )}
            </Button>
          </div>

          <Alert className="bg-blue-950/30 border-blue-600/30 text-slate-200">
            <Info className="h-4 w-4 text-blue-400" />
            <AlertTitle className="text-blue-400 font-bold">Important Configuration Notes</AlertTitle>
            <AlertDescription className="text-xs text-slate-400 mt-1 space-y-1">
              <p>1. This phone number must be dedicated to sandbox use and not used by any tenant directly.</p>
              <p>2. Ensure Meta webhooks for this number point to: <code className="text-slate-300">{typeof window !== 'undefined' ? window.location.origin : ''}/api/whatsapp/webhook</code></p>
              <p>3. All sandbox conversations are billed to this account. Monitor usage and costs carefully.</p>
              <p>4. Maximum 5 unique recipient numbers can be added per Meta test number in sandbox mode.</p>
            </AlertDescription>
          </Alert>
        </div>
      )}

      {activeTab === 'analytics' && (
        <div className="space-y-6">
          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-semibold text-slate-400">Active Trials</CardTitle>
                <Activity className="h-4 w-4 text-emerald-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-black text-white">{sandboxStats.activeTrials}</div>
                <p className="text-xs text-slate-500 mt-1">Currently active sandbox tenants</p>
              </CardContent>
            </Card>

            <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-semibold text-slate-400">Expired Trials</CardTitle>
                <AlertTriangle className="h-4 w-4 text-amber-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-black text-white">{sandboxStats.expiredTrials}</div>
                <p className="text-xs text-slate-500 mt-1">Trials that have ended</p>
              </CardContent>
            </Card>

            <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-semibold text-slate-400">Messages Used</CardTitle>
                <Users className="h-4 w-4 text-blue-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-black text-white">{sandboxStats.totalMessagesUsed}</div>
                <p className="text-xs text-slate-500 mt-1">Avg {sandboxStats.avgMessagesPerTenant} per tenant</p>
              </CardContent>
            </Card>

            <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-semibold text-slate-400">Conversion Rate</CardTitle>
                <CheckCircle2 className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-black text-white">{sandboxStats.conversionRate}%</div>
                <p className="text-xs text-slate-500 mt-1">Upgraded to Official API</p>
              </CardContent>
            </Card>
          </div>

          {/* Sandbox Tenants Table */}
          <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-white text-base">Sandbox Tenants</CardTitle>
                <CardDescription className="text-slate-400">
                  All sandbox accounts and their usage statistics.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchSandboxAnalytics}
                disabled={sandboxAnalyticsLoading}
                className="border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800"
              >
                {sandboxAnalyticsLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Activity className="h-4 w-4" />
                )}
                Refresh
              </Button>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <table className="w-full border-collapse text-left text-sm text-slate-300">
                  <thead className="bg-slate-950/50 text-xs font-bold uppercase tracking-wider text-slate-400 border-b border-slate-850">
                    <tr>
                      <th className="px-4 py-3">Code</th>
                      <th className="px-4 py-3">Owner</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Messages</th>
                      <th className="px-4 py-3">Expiry</th>
                      <th className="px-4 py-3">Contacts</th>
                      <th className="px-4 py-3">Migrated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850">
                    {sandboxTenants.map((tenant: Record<string, unknown>) => {
                      const owner = tenant.owner as Record<string, unknown> | undefined;
                      const stats = tenant.stats as Record<string, number> | undefined;
                      const isExpired = tenant.trial_ends_at
                        ? new Date(tenant.trial_ends_at as string).getTime() <= Date.now()
                        : false;
                      const isMigrated = !!tenant.migrated_from_sandbox_at;

                      return (
                        <tr key={tenant.account_id as string} className="hover:bg-slate-950/20">
                          <td className="px-4 py-3">
                            <code className="text-primary font-mono text-xs bg-primary/10 px-2 py-1 rounded">
                              #{tenant.sandbox_code as string || 'N/A'}
                            </code>
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-white font-medium">{owner?.full_name as string || 'Unknown'}</div>
                            <div className="text-slate-500 text-xs">{owner?.email as string || ''}</div>
                          </td>
                          <td className="px-4 py-3">
                            {isMigrated ? (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-400 bg-blue-400/10 px-2 py-1 rounded">
                                <CheckCircle2 className="size-3" />
                                Migrated
                              </span>
                            ) : isExpired ? (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-red-400 bg-red-400/10 px-2 py-1 rounded">
                                <AlertTriangle className="size-3" />
                                Expired
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded">
                                <Activity className="size-3" />
                                Active
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-white">{tenant.sandbox_message_count as number || 0} / {tenant.sandbox_message_limit as number || 50}</div>
                            <div className="w-24 h-1.5 rounded-full bg-slate-800 mt-1 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-primary"
                                style={{
                                  width: `${Math.min(100, (((tenant.sandbox_message_count as number) || 0) / ((tenant.sandbox_message_limit as number) || 50)) * 100)}%`,
                                }}
                              />
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs">
                            {tenant.trial_ends_at
                              ? new Date(tenant.trial_ends_at as string).toLocaleDateString()
                              : 'N/A'}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-400">
                            {stats?.contacts || 0}
                          </td>
                          <td className="px-4 py-3 text-xs">
                            {isMigrated ? (
                              <span className="text-blue-400">
                                {new Date(tenant.migrated_from_sandbox_at as string).toLocaleDateString()}
                              </span>
                            ) : (
                              <span className="text-slate-500">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {sandboxTenants.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                          {sandboxAnalyticsLoading ? 'Loading...' : 'No sandbox tenants found.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'organizations' && (
        <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
          <CardHeader>
            <CardTitle className="text-white text-base">Registered CRM Tenants</CardTitle>
            <CardDescription className="text-slate-400">
              Overview of all organizations and account groups created on the platform.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full border-collapse text-left text-sm text-slate-300">
                <thead className="bg-slate-950/50 text-xs font-bold uppercase tracking-wider text-slate-400 border-b border-slate-850">
                  <tr>
                    <th className="px-6 py-4">Organization Name</th>
                    <th className="px-6 py-4">Owner Name</th>
                    <th className="px-6 py-4">Owner Email</th>
                    <th className="px-6 py-4">Created Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850">
                  {organizations.map((org) => (
                    <tr key={org.id} className="hover:bg-slate-950/20">
                      <td className="px-6 py-4 font-bold text-white">{org.name || 'Personal Account'}</td>
                      <td className="px-6 py-4">{org.owner_name}</td>
                      <td className="px-6 py-4 text-slate-400">{org.owner_email}</td>
                      <td className="px-6 py-4 text-xs text-slate-500">
                        {new Date(org.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                  {organizations.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center text-slate-500">
                        No organizations found in database.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
