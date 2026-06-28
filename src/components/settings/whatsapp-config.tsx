'use client';

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Eye,
  EyeOff,
  Copy,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  Zap,
  AlertTriangle,
  RotateCcw,
  ArrowUpRight,
  History,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import type { WhatsAppConfig as WhatsAppConfigType } from '@/types';

const MASKED_TOKEN = '••••••••••••••••';

type ConnectionStatus = 'connected' | 'disconnected' | 'unknown';
type ResetReason = 'token_corrupted' | 'meta_api_error' | null;

export function WhatsAppConfig() {
  const supabase = createClient();
  // After multi-user, whatsapp_config is one-row-per-account, not
  // one-row-per-user. We pull `accountId` straight off the auth
  // context and key every read off it — so a teammate who just
  // joined an account sees the inviter's saved config without
  // having to re-enter anything.
  const { user, accountId, loading: authLoading, profileLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [config, setConfig] = useState<WhatsAppConfigType | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('unknown');
  const [resetReason, setResetReason] = useState<ResetReason>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');

  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [pin, setPin] = useState('');
  const [catalogId, setCatalogId] = useState('');
  const [autoSyncCatalog, setAutoSyncCatalog] = useState(false);
  const [tokenEdited, setTokenEdited] = useState(false);
  const [integrationType, setIntegrationType] = useState<'sandbox' | 'web_qr' | 'official_api'>('official_api');
  const [sandboxSystemPhone, setSandboxSystemPhone] = useState<string | null>(null);

  // Migration state
  const [showMigrationModal, setShowMigrationModal] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [migrationPin, setMigrationPin] = useState('');
  const [migrationToken, setMigrationToken] = useState('');
  const [migrationPhoneId, setMigrationPhoneId] = useState('');
  const [migrationWabaId, setMigrationWabaId] = useState('');
  const [migrationNotifyLeads, setMigrationNotifyLeads] = useState(true);

  // True once /register has succeeded on Meta's side (timestamp set
  // in the row). When false, the saved config is metadata-only and
  // Meta will silently drop every inbound event — that's the
  // multi-number bug that prompted this work.
  const isRegistered = Boolean(config?.registered_at);
  const lastRegistrationError = config?.last_registration_error ?? null;

  const [verifyingRegistration, setVerifyingRegistration] = useState(false);
  type RegistrationProbe = {
    live: boolean;
    checks: Record<string, boolean | null>;
    errors?: string[];
    last_registration_error?: string | null;
    registered_at?: string | null;
    subscribed_apps_at?: string | null;
  };
  const [registrationProbe, setRegistrationProbe] =
    useState<RegistrationProbe | null>(null);

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/whatsapp/webhook`
      : '';

  const fetchConfig = useCallback(async (acctId: string) => {
    setLoading(true);
    try {
      // Load form values from Supabase (shows what's in DB).
      // Switched from `user_id` (which would only match the row's
      // original author) to `account_id` so every member of the
      // account sees the same saved configuration. UNIQUE(account_id)
      // on the table guarantees the .maybeSingle() return type
      // remains accurate.
      const { data, error } = await supabase
        .from('whatsapp_config')
        .select('*')
        .eq('account_id', acctId)
        .maybeSingle();

      if (error) {
        console.error('Failed to load config row:', error);
      }

      if (data) {
        setConfig(data);
        setPhoneNumberId(data.phone_number_id || '');
        setWabaId(data.waba_id || '');
        setAccessToken(MASKED_TOKEN);
        setVerifyToken('');
        setPin('');
        setCatalogId(data.catalog_id || '');
        setAutoSyncCatalog(data.auto_sync_catalog || false);
        setIntegrationType((data.integration_type as 'sandbox' | 'web_qr' | 'official_api') || 'official_api');
        setTokenEdited(false);
      } else {
        setConfig(null);
        setPhoneNumberId('');
        setWabaId('');
        setAccessToken('');
        setVerifyToken('');
        setPin('');
        setCatalogId('');
        setAutoSyncCatalog(false);
        setIntegrationType('official_api');
        setTokenEdited(false);
      }
      // Clear any stale probe result when reloading the row.
      setRegistrationProbe(null);

      // Then verify health via the API (decrypts token + pings Meta)
      if (data) {
        try {
          const res = await fetch('/api/whatsapp/config', { method: 'GET' });
          const payload = await res.json();

          if (payload.connected) {
            setConnectionStatus('connected');
            setResetReason(null);
            setStatusMessage('');
          if (payload.catalog_id !== undefined) setCatalogId(payload.catalog_id || '');
          if (payload.auto_sync_catalog !== undefined) setAutoSyncCatalog(payload.auto_sync_catalog || false);
          if (payload.sandbox_system_phone !== undefined) setSandboxSystemPhone(payload.sandbox_system_phone || null);
          } else {
            setConnectionStatus('disconnected');
            setResetReason(payload.needs_reset ? 'token_corrupted' : payload.reason === 'meta_api_error' ? 'meta_api_error' : null);
            setStatusMessage(payload.message || '');
          }
        } catch (err) {
          console.error('Health check failed:', err);
          setConnectionStatus('disconnected');
        }
      } else {
        setConnectionStatus('disconnected');
        setResetReason(null);
        setStatusMessage('');
      }
    } catch (err) {
      console.error('fetchConfig error:', err);
      toast.error('Failed to load WhatsApp configuration');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    // Need both the auth session (`!authLoading`) AND the profile
    // (`!profileLoading`, which carries `accountId`). Without the
    // second guard, the effect would fire with `accountId === null`
    // for the first render window and bail without ever retrying
    // once the profile arrives.
    if (authLoading || profileLoading) return;
    if (!user || !accountId) {
      setLoading(false);
      return;
    }
    fetchConfig(accountId);
  }, [authLoading, profileLoading, user, accountId, fetchConfig]);

  async function handleSave() {
    if (integrationType === 'official_api') {
      if (!phoneNumberId.trim()) {
        toast.error('Phone Number ID is required');
        return;
      }
      if (!config && (!accessToken.trim() || !tokenEdited)) {
        toast.error('Access Token is required for initial setup');
        return;
      }
    }

    try {
      setSaving(true);

      // Always POST through the API — it verifies with Meta and encrypts
      // the access_token server-side with ENCRYPTION_KEY. Skipping this
      // and writing direct to Supabase stores the token in plaintext,
      // which then fails decryption on every subsequent health check.
      const payload: Record<string, unknown> = {
        phone_number_id: integrationType === 'official_api' ? phoneNumberId.trim() : null,
        waba_id: integrationType === 'official_api' ? (wabaId.trim() || null) : null,
        verify_token: integrationType === 'official_api' ? (verifyToken.trim() || null) : null,
        pin: integrationType === 'official_api' ? (pin.trim() || null) : null,
        catalog_id: integrationType === 'official_api' ? (catalogId.trim() || null) : null,
        auto_sync_catalog: integrationType === 'official_api' ? autoSyncCatalog : false,
        integration_type: integrationType,
      };

      if (integrationType === 'official_api') {
        if (tokenEdited && accessToken !== MASKED_TOKEN && accessToken.trim()) {
          payload.access_token = accessToken.trim();
        } else if (config && config.integration_type === 'official_api') {
          // Existing config — reuse stored encrypted token by decrypting on the
          // server. But our POST handler requires an access_token to verify
          // with Meta. If the user didn't change the token, we need to signal
          // that. Simplest: require token re-entry if they're updating.
          toast.error('Please re-enter the Access Token to save changes');
          setSaving(false);
          return;
        } else {
          toast.error('Please enter the Access Token to save Official API configuration');
          setSaving(false);
          return;
        }
      }

      const res = await fetch('/api/whatsapp/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || 'Failed to save configuration');
        setSaving(false);
        return;
      }

      // The route now returns a structured outcome:
      //   * registered=true   → number is live, events will flow
      //   * registered=false  → credentials saved but /register
      //                         failed; UI shows the specific error
      //                         and a retry path. registration_error
      //                         is human-readable from Meta.
      if (data.registered === false && data.registration_error) {
        toast.error(
          `Saved, but Meta couldn't register the number: ${data.registration_error}`,
          { duration: 12000 },
        );
      } else {
        toast.success(
          data.phone_info?.verified_name
            ? `Live — ${data.phone_info.verified_name} can now receive events.`
            : 'WhatsApp connected. Events will start flowing within a minute.',
        );
        // Clear the PIN so subsequent saves don't accidentally
        // re-register (which would void the active subscription if
        // the PIN became stale).
        setPin('');
      }

      if (accountId) await fetchConfig(accountId);
    } catch (err) {
      console.error('Save error:', err);
      toast.error('Failed to save configuration');
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    try {
      setTesting(true);
      const res = await fetch('/api/whatsapp/config', { method: 'GET' });
      const payload = await res.json();

      if (payload.connected) {
        setConnectionStatus('connected');
        setResetReason(null);
        setStatusMessage('');
        toast.success(
          payload.phone_info?.verified_name
            ? `Connected to ${payload.phone_info.verified_name}`
            : 'API connection successful'
        );
      } else {
        setConnectionStatus('disconnected');
        setResetReason(payload.needs_reset ? 'token_corrupted' : payload.reason === 'meta_api_error' ? 'meta_api_error' : null);
        setStatusMessage(payload.message || '');
        toast.error(payload.message || 'API connection failed');
      }
    } catch (err) {
      console.error('Test connection error:', err);
      setConnectionStatus('disconnected');
      toast.error('Connection test failed. Check network and try again.');
    } finally {
      setTesting(false);
    }
  }

  async function handleVerifyRegistration() {
    setVerifyingRegistration(true);
    setRegistrationProbe(null);
    try {
      const res = await fetch('/api/whatsapp/config/verify-registration', {
        method: 'GET',
      });
      const data = (await res.json()) as RegistrationProbe;
      setRegistrationProbe(data);
      if (data.live) {
        toast.success('Number is fully wired — Meta is delivering events.');
      } else {
        toast.error(
          'Number is not fully registered. See the checks below for which step failed.',
          { duration: 8000 },
        );
      }
      if (accountId) await fetchConfig(accountId);
    } catch (err) {
      console.error('verify-registration failed:', err);
      toast.error('Could not reach the verification endpoint.');
    } finally {
      setVerifyingRegistration(false);
    }
  }

  async function handleReset() {
    if (!confirm('This will delete the current WhatsApp config so you can re-enter it. Continue?')) {
      return;
    }

    try {
      setResetting(true);
      const res = await fetch('/api/whatsapp/config', { method: 'DELETE' });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || 'Failed to reset configuration');
        return;
      }

      toast.success('Configuration cleared. You can now re-enter your credentials.');
      setConfig(null);
      setPhoneNumberId('');
      setWabaId('');
      setAccessToken('');
      setVerifyToken('');
      setCatalogId('');
      setAutoSyncCatalog(false);
      setTokenEdited(false);
      setConnectionStatus('disconnected');
      setResetReason(null);
      setStatusMessage('');
    } catch (err) {
      console.error('Reset error:', err);
      toast.error('Failed to reset configuration');
    } finally {
      setResetting(false);
    }
  }

  async function handleMigrateToOfficial() {
    if (!migrationPhoneId.trim()) {
      toast.error('Phone Number ID is required');
      return;
    }
    if (!migrationToken.trim()) {
      toast.error('Access Token is required');
      return;
    }

    try {
      setMigrating(true);
      const res = await fetch('/api/whatsapp/migrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone_number_id: migrationPhoneId.trim(),
          waba_id: migrationWabaId.trim() || null,
          access_token: migrationToken.trim(),
          verify_token: verifyToken.trim() || null,
          pin: migrationPin.trim() || null,
          catalog_id: catalogId.trim() || null,
          auto_sync_catalog: autoSyncCatalog,
          notify_leads: migrationNotifyLeads,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || 'Migration failed');
        setMigrating(false);
        return;
      }

      toast.success(data.message || 'Successfully upgraded to Official API!');
      if (data.leads_notified > 0) {
        toast.info(`Notified ${data.leads_notified} active leads about your new number.`);
      }

      setShowMigrationModal(false);
      setMigrationPhoneId('');
      setMigrationToken('');
      setMigrationPin('');
      setMigrationWabaId('');

      if (accountId) await fetchConfig(accountId);
    } catch (err) {
      console.error('Migration error:', err);
      toast.error('Failed to migrate. Please try again.');
    } finally {
      setMigrating(false);
    }
  }

  function handleCopyWebhookUrl() {
    navigator.clipboard.writeText(webhookUrl);
    toast.success('Webhook URL copied to clipboard');
  }

  const renderSetupInstructions = () => {
    if (integrationType === 'sandbox') {
      return (
        <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
          <CardHeader>
            <CardTitle className="text-white text-base">Sandbox Instructions</CardTitle>
            <CardDescription className="text-slate-400">
              Test with real WhatsApp using a shared sandbox number.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Accordion>
              <AccordionItem className="border-slate-700">
                <AccordionTrigger className="text-slate-300 hover:text-white hover:no-underline">
                  <span className="flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
                    Activate Your Trial
                  </span>
                </AccordionTrigger>
                <AccordionContent className="text-slate-400">
                  <p className="text-sm">
                    Click <strong>Save Configuration</strong> to activate your 7-day sandbox trial. A unique code (e.g., <code>#{config?.sandbox_code || 'convo123'}</code>) will be assigned to your account.
                  </p>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem className="border-slate-700">
                <AccordionTrigger className="text-slate-300 hover:text-white hover:no-underline">
                  <span className="flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">2</span>
                    Share Your Test Link
                  </span>
                </AccordionTrigger>
                <AccordionContent className="text-slate-400">
                  <p className="text-sm">
                    Copy your <strong>Quick Test Link</strong> and share it with a lead. The link opens WhatsApp with your unique code pre-filled. This ensures messages route directly to your inbox.
                  </p>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem className="border-slate-700">
                <AccordionTrigger className="text-slate-300 hover:text-white hover:no-underline">
                  <span className="flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">3</span>
                    First Message Must Include Code
                  </span>
                </AccordionTrigger>
                <AccordionContent className="text-slate-400">
                  <p className="text-sm">
                    The lead&apos;s first message must include your code (e.g., <code>#{config?.sandbox_code || 'convo123'} Hello, I&apos;m interested</code>). After that first contact, normal conversation works without the code.
                  </p>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem className="border-slate-700">
                <AccordionTrigger className="text-slate-300 hover:text-white hover:no-underline">
                  <span className="flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">4</span>
                    Reply Within 24 Hours
                  </span>
                </AccordionTrigger>
                <AccordionContent className="text-slate-400">
                  <p className="text-sm">
                    You can reply freely within 24 hours of the lead&apos;s last message. After 24 hours, replies use pre-approved templates to ensure delivery.
                  </p>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>
      );
    }



    // Default: Official API
    return (
      <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
        <CardHeader>
          <CardTitle className="text-white text-base">Setup Instructions</CardTitle>
          <CardDescription className="text-slate-400">
            Follow these steps to connect your WhatsApp Business API.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion>
            <AccordionItem className="border-slate-700">
              <AccordionTrigger className="text-slate-300 hover:text-white hover:no-underline">
                <span className="flex items-center gap-2">
                  <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
                  Create a Meta App
                </span>
              </AccordionTrigger>
              <AccordionContent className="text-slate-400">
                <ol className="list-decimal list-inside space-y-1 text-sm">
                  <li>Go to <span className="text-primary">developers.facebook.com</span></li>
                  <li>Click &quot;My Apps&quot; and then &quot;Create App&quot;</li>
                  <li>Select &quot;Business&quot; as the app type</li>
                  <li>Fill in app details and create</li>
                </ol>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem className="border-slate-700">
              <AccordionTrigger className="text-slate-300 hover:text-white hover:no-underline">
                <span className="flex items-center gap-2">
                  <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">2</span>
                  Add WhatsApp Product
                </span>
              </AccordionTrigger>
              <AccordionContent className="text-slate-400">
                <ol className="list-decimal list-inside space-y-1 text-sm">
                  <li>In your app dashboard, click &quot;Add Product&quot;</li>
                  <li>Find &quot;WhatsApp&quot; and click &quot;Set Up&quot;</li>
                  <li>Follow the setup wizard to link your business</li>
                </ol>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem className="border-slate-700">
              <AccordionTrigger className="text-slate-300 hover:text-white hover:no-underline">
                <span className="flex items-center gap-2">
                  <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">3</span>
                  Get API Credentials
                </span>
              </AccordionTrigger>
              <AccordionContent className="text-slate-400">
                <p className="text-sm">
                  Copy the Phone Number ID and Permanent Access Token, then paste them into the credentials form on this page.
                </p>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem className="border-slate-700">
              <AccordionTrigger className="text-slate-300 hover:text-white hover:no-underline">
                <span className="flex items-center gap-2">
                  <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">4</span>
                  Configure Webhooks
                </span>
              </AccordionTrigger>
              <AccordionContent className="text-slate-400">
                <p className="text-sm">
                  In WhatsApp Configuration, paste the Webhook URL and verify token from this page, and subscribe to the <code>messages</code> webhook event.
                </p>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          <div className="mt-4 pt-4 border-t border-slate-700">
            <a
              href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors"
            >
              <ExternalLink className="size-3.5" />
              Meta WhatsApp API Documentation
            </a>
          </div>
        </CardContent>
      </Card>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  const showResetBanner = resetReason === 'token_corrupted';

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px] mt-4">
      {/* Main config form */}
      <div className="space-y-6">
        {/* Corrupted-token reset banner */}
        {showResetBanner && (
          <Alert className="bg-amber-950/40 border-amber-600/40">
            <div className="flex items-start gap-3">
              <AlertTriangle className="size-5 text-amber-400 mt-0.5 shrink-0" />
              <div className="flex-1">
                <AlertTitle className="text-amber-200 mb-1">
                  Stored token can&apos;t be decrypted
                </AlertTitle>
                <AlertDescription className="text-amber-100/80 text-sm">
                  {statusMessage}
                </AlertDescription>
                <Button
                  onClick={handleReset}
                  disabled={resetting}
                  size="sm"
                  className="mt-3 bg-amber-600 hover:bg-amber-700 text-white"
                >
                  {resetting ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Resetting...
                    </>
                  ) : (
                    <>
                      <RotateCcw className="size-4" />
                      Reset Configuration
                    </>
                  )}
                </Button>
              </div>
            </div>
          </Alert>
        )}

        {/* Connection Status — context-aware per integration type */}
        {integrationType === 'sandbox' && config ? (
          <Alert className="bg-emerald-950/30 border-emerald-700/50">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-emerald-400" />
              <AlertTitle className="text-emerald-200 mb-0">
                Sandbox Trial Active
              </AlertTitle>
            </div>
            <AlertDescription className="text-slate-400">
              Your shared sandbox number is ready to receive test messages. Share your unique code with leads to start testing.
            </AlertDescription>
          </Alert>
        ) : integrationType === 'sandbox' && !config ? (
          <Alert className="bg-amber-950/30 border-amber-700/50">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-400" />
              <AlertTitle className="text-amber-200 mb-0">
                Sandbox Not Activated
              </AlertTitle>
            </div>
            <AlertDescription className="text-slate-400">
              Click <strong>Save Configuration</strong> to activate your 7-day sandbox trial and get your unique code.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert className="bg-slate-900 border-slate-700">
            <div className="flex items-center gap-2">
              {connectionStatus === 'connected' ? (
                <CheckCircle2 className="size-4 text-primary" />
              ) : (
                <XCircle className="size-4 text-red-500" />
              )}
              <AlertTitle className="text-white mb-0">
                {connectionStatus === 'connected' ? 'Credentials valid' : 'Not Connected'}
              </AlertTitle>
            </div>
            <AlertDescription className="text-slate-400">
              {connectionStatus === 'connected'
                ? 'Your access token authenticates with Meta. See Registration status below for whether webhooks are actually wired.'
                : statusMessage ||
                  'Configure your Meta API credentials below to connect your WhatsApp Business account.'}
            </AlertDescription>
          </Alert>
        )}

        {/* Registration Status — only for Official API */}
        {config && integrationType !== 'sandbox' && (
          <Alert
            className={
              isRegistered
                ? 'bg-emerald-950/30 border-emerald-700/50'
                : 'bg-amber-950/30 border-amber-700/50'
            }
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                {isRegistered ? (
                  <CheckCircle2 className="size-4 text-emerald-400" />
                ) : (
                  <AlertTriangle className="size-4 text-amber-400" />
                )}
                <AlertTitle
                  className={
                    'mb-0 ' + (isRegistered ? 'text-emerald-200' : 'text-amber-200')
                  }
                >
                  {isRegistered
                    ? 'Registered — Meta will deliver events to ConvoReal'
                    : 'Not registered — Meta will not deliver events'}
                </AlertTitle>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleVerifyRegistration}
                disabled={verifyingRegistration}
                className="border-slate-700 bg-transparent text-slate-200 hover:bg-slate-800 h-7"
              >
                {verifyingRegistration ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Zap className="size-3.5" />
                )}
                Verify with Meta
              </Button>
            </div>
            <AlertDescription className="text-slate-400 mt-2 text-xs leading-relaxed">
              {isRegistered ? (
                <>
                  Subscribed since{' '}
                  {config.registered_at
                    ? new Date(config.registered_at).toLocaleString()
                    : 'unknown'}
                  . Click <strong>Verify with Meta</strong> if events
                  stop arriving.
                </>
              ) : lastRegistrationError ? (
                <>
                  Last attempt failed with:{' '}
                  <span className="text-red-300">
                    &quot;{lastRegistrationError}&quot;
                  </span>
                  . Enter (or correct) the 2-step PIN below and click
                  Save Configuration to retry.
                </>
              ) : (
                <>
                  This number was saved before registration tracking
                  existed, or registration was skipped. Enter the
                  2-step PIN below and click Save Configuration to
                  subscribe it.
                </>
              )}
            </AlertDescription>

            {registrationProbe && (
              <div className="mt-3 rounded border border-slate-700 bg-slate-900/60 px-3 py-2 space-y-1.5 text-[11px]">
                <p className="font-medium text-slate-200">
                  Diagnostic — last run: {' '}
                  <span className={registrationProbe.live ? 'text-emerald-400' : 'text-amber-400'}>
                    {registrationProbe.live ? 'live' : 'not live'}
                  </span>
                </p>
                <ul className="space-y-0.5 text-slate-400">
                  {Object.entries(registrationProbe.checks).map(([k, v]) => (
                    <li key={k} className="flex items-center gap-1.5">
                      {v === true ? (
                        <CheckCircle2 className="size-3 text-emerald-400 shrink-0" />
                      ) : v === false ? (
                        <XCircle className="size-3 text-red-400 shrink-0" />
                      ) : (
                        <span className="size-3 rounded-full border border-slate-600 shrink-0" />
                      )}
                      <code className="text-slate-300">{k}</code>
                    </li>
                  ))}
                </ul>
                {(registrationProbe.errors ?? []).length > 0 && (
                  <ul className="pt-1 space-y-0.5 text-red-300">
                    {registrationProbe.errors?.map((e, i) => (
                      <li key={i}>• {e}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Alert>
        )}

        {/* Migration History Banner */}
        {config?.migrated_from_sandbox_at && (
          <Alert className="bg-blue-950/30 border-blue-700/50">
            <div className="flex items-center gap-2">
              <History className="size-4 text-blue-400" />
              <AlertTitle className="text-blue-200 mb-0">
                Upgraded from Sandbox
              </AlertTitle>
            </div>
            <AlertDescription className="text-slate-400 mt-2 text-xs">
              You migrated from sandbox <strong className="text-slate-300">#{config.migrated_sandbox_code || config.sandbox_code}</strong> on{' '}
              {new Date(config.migrated_from_sandbox_at).toLocaleDateString()}. 
              All your conversations and contacts were preserved.
            </AlertDescription>
          </Alert>
        )}

        {/* Integration Method Selection */}
        <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
          <CardHeader>
            <CardTitle className="text-white">Integration Method</CardTitle>
            <CardDescription className="text-slate-400">
              Choose how you want to connect WhatsApp. Official API is recommended for production.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Official API — First and Recommended */}
              <button
                type="button"
                onClick={() => setIntegrationType('official_api')}
                className={`p-4 rounded-xl border text-left transition-all relative ${
                  integrationType === 'official_api'
                    ? 'bg-primary/10 border-primary ring-1 ring-primary'
                    : 'bg-slate-800 border-slate-700 hover:border-slate-600'
                }`}
              >
                <div className="absolute -top-2 left-4">
                  <span className="text-[10px] font-bold text-white bg-primary px-2 py-0.5 rounded-full">
                    RECOMMENDED
                  </span>
                </div>
                <div className="flex items-center justify-between mb-2 mt-1">
                  <span className="font-bold text-white">Official API</span>
                  <span className="text-xs font-bold text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded">Permanent</span>
                </div>
                <p className="text-xs text-slate-400">
                  Meta Cloud API. Best for production.
                </p>
              </button>

              {/* Sandbox */}
              <button
                type="button"
                onClick={() => setIntegrationType('sandbox')}
                className={`p-4 rounded-xl border text-left transition-all ${
                  integrationType === 'sandbox'
                    ? 'bg-primary/10 border-primary ring-1 ring-primary'
                    : 'bg-slate-800 border-slate-700 hover:border-slate-600'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-white">Sandbox</span>
                  <span className="text-xs font-bold text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded">7-Day Trial</span>
                </div>
                <p className="text-xs text-slate-400">
                  Shared number for testing. Instant setup.
                </p>
              </button>
            </div>
          </CardContent>
        </Card>

        {/* API Credentials (Only shown for Official API) */}
        {integrationType === 'official_api' && (
          <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
            <CardHeader>
              <CardTitle className="text-white">API Credentials</CardTitle>
              <CardDescription className="text-slate-400">
                Enter your Meta WhatsApp Business API credentials.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-slate-300">Phone Number ID</Label>
                <Input
                  placeholder="e.g. 100234567890123"
                  value={phoneNumberId}
                  onChange={(e) => setPhoneNumberId(e.target.value)}
                  className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-slate-300">WhatsApp Business Account ID</Label>
                <Input
                  placeholder="e.g. 100234567890456"
                  value={wabaId}
                  onChange={(e) => setWabaId(e.target.value)}
                  className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-slate-300">Permanent Access Token</Label>
                <div className="relative">
                  <Input
                    type={showToken ? 'text' : 'password'}
                    placeholder="Enter your access token"
                    value={accessToken}
                    onChange={(e) => {
                      setAccessToken(e.target.value);
                      setTokenEdited(true);
                    }}
                    onFocus={() => {
                      if (accessToken === MASKED_TOKEN) {
                        setAccessToken('');
                        setTokenEdited(true);
                      }
                    }}
                    className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
                  >
                    {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                {config && !tokenEdited && (
                  <p className="text-xs text-slate-500">
                    Token is hidden for security. Re-enter it to update configuration.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-slate-300">Webhook Verify Token</Label>
                <Input
                  placeholder="Create a custom verify token"
                  value={verifyToken}
                  onChange={(e) => setVerifyToken(e.target.value)}
                  className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                />
                <p className="text-xs text-slate-500">
                  A custom string you create. Must match the token you set in Meta webhook settings.
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-slate-300">Meta Commerce Catalog ID (Optional)</Label>
                <Input
                  placeholder="e.g. 100234567890999"
                  value={catalogId}
                  onChange={(e) => setCatalogId(e.target.value)}
                  className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                />
                <p className="text-xs text-slate-500">
                  Required for sending property listings directly as WhatsApp Product cards. Find this in Facebook Commerce Manager.
                </p>
              </div>

              {catalogId.trim() && (
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="auto-sync-catalog"
                    checked={autoSyncCatalog}
                    onChange={(e) => setAutoSyncCatalog(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-800 text-primary focus:ring-0 focus:ring-offset-0 h-4 w-4 cursor-pointer"
                  />
                  <Label htmlFor="auto-sync-catalog" className="text-slate-350 text-xs font-semibold cursor-pointer select-none">
                    Auto-sync properties to Meta Catalog on creation/update
                  </Label>
                </div>
              )}

              <div className="space-y-2">
                <Label className="text-slate-300">
                  Two-step verification PIN
                  {!isRegistered && (
                    <span className="ml-1 text-red-400">*</span>
                  )}
                </Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="6-digit PIN from Meta WhatsApp Manager"
                  value={pin}
                  onChange={(e) =>
                    setPin(e.target.value.replace(/\D/g, '').slice(0, 6))
                  }
                  className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 tracking-widest"
                />
                <p className="text-xs text-slate-500 leading-relaxed">
                  Required the first time you connect a number, and any
                  time you swap to a different number. Set it in{' '}
                  <strong className="text-slate-300">
                    Meta Business Manager → WhatsApp Accounts → Phone
                    Numbers → Two-step verification
                  </strong>
                  . Without this PIN, Meta saves your credentials but
                  won&apos;t actually route inbound messages to ConvoReal —
                  the symptom that hits second numbers under a shared
                  WABA. Leave blank to keep an existing registration
                  untouched.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Sandbox Info */}
        {integrationType === 'sandbox' && (
          <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
            <CardHeader>
              <CardTitle className="text-white">Sandbox Connection</CardTitle>
              <CardDescription className="text-slate-400">
                Your unique trial code and shared sandbox number.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Unique Code Display */}
              {config?.sandbox_code && (
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
                  <Label className="text-primary text-xs font-bold uppercase tracking-wider mb-2 block">
                    Your Unique Sandbox Code
                  </Label>
                  <div className="flex items-center gap-3">
                    <code className="text-2xl font-mono font-bold text-white bg-slate-950 px-3 py-2 rounded-lg border border-slate-800">
                      #{config.sandbox_code}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(`#${config.sandbox_code}`)
                        toast.success('Code copied to clipboard')
                      }}
                      className="border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800"
                    >
                      <Copy className="size-4" />
                    </Button>
                  </div>
                  <p className="text-slate-400 text-xs mt-2">
                    Leads must include this code in their first message to route to your inbox.
                  </p>
                </div>
              )}

              {/* wa.me Link */}
              {config?.sandbox_code && (
                <div className="space-y-2">
                  <Label className="text-slate-300 text-sm">Quick Test Link</Label>
                  <p className="text-slate-400 text-xs">
                    Share this link with leads. It opens WhatsApp with your code pre-filled.
                  </p>
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      value={sandboxSystemPhone 
                        ? `https://wa.me/${sandboxSystemPhone}?text=%23${config.sandbox_code}%20Hi%2C%20I%27m%20interested`
                        : 'Configure system sandbox number in admin panel first'
                      }
                      className="bg-slate-800 border-slate-700 text-slate-300 font-mono text-sm"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      disabled={!sandboxSystemPhone}
                      onClick={() => {
                        if (sandboxSystemPhone) {
                          navigator.clipboard.writeText(`https://wa.me/${sandboxSystemPhone}?text=%23${config.sandbox_code}%20Hi%2C%20I%27m%20interested`)
                          toast.success('Link copied to clipboard')
                        }
                      }}
                      className="shrink-0 border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800"
                    >
                      <Copy className="size-4" />
                    </Button>
                  </div>
                  {!sandboxSystemPhone && (
                    <p className="text-amber-400 text-xs">
                      Ask your admin to configure the shared sandbox number before sharing this link.
                    </p>
                  )}
                </div>
              )}

              {/* Trial Status */}
              {config?.trial_ends_at && (
                <div className="flex items-center justify-between rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="size-4 text-amber-400" />
                    <span className="text-amber-200 text-sm font-medium">
                      Trial Active
                    </span>
                  </div>
                  <span className="text-amber-400 text-xs">
                    Expires {new Date(config.trial_ends_at).toLocaleDateString()}
                  </span>
                </div>
              )}

              {/* Message Usage */}
              {config?.sandbox_message_count !== undefined && (
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Messages Used</span>
                    <span className="text-slate-300">
                      {config.sandbox_message_count} / {config.sandbox_message_limit || 50}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{
                        width: `${Math.min(100, ((config.sandbox_message_count || 0) / (config.sandbox_message_limit || 50)) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Instructions */}
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-3">
                <h4 className="text-sm font-semibold text-white">How Sandbox Works</h4>
                <ol className="space-y-2 text-xs text-slate-400 list-decimal list-inside">
                  <li>
                    Save this configuration to activate your 7-day trial
                  </li>
                  <li>
                    Share your test link with leads (includes your unique code)
                  </li>
                  <li>
                    Lead sends message with code (e.g., <code className="text-slate-300">#{config?.sandbox_code || 'your-code'} Hello</code>)
                  </li>
                  <li>
                    Message routes to your inbox automatically
                  </li>
                  <li>
                    After first contact, normal chat works without the code
                  </li>
                  <li>
                    You have {config?.sandbox_message_limit || 50} messages to test with
                  </li>
                </ol>
              </div>

              {/* Upgrade to Official API */}
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <ArrowUpRight className="size-5 text-emerald-400" />
                  <h4 className="text-sm font-semibold text-emerald-200">Ready to Go Live?</h4>
                </div>
                <p className="text-xs text-slate-400">
                  Upgrade to Official API to get your own WhatsApp Business number, remove message limits, and keep all your conversations and contacts.
                </p>
                <Button
                  onClick={() => setShowMigrationModal(true)}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white w-full"
                >
                  <ArrowUpRight className="size-4 mr-2" />
                  Upgrade to Official API
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* QR Scan Info */}
        {integrationType === 'web_qr' && (
          <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
            <CardHeader>
              <CardTitle className="text-white">QR Scan (WhatsApp Web)</CardTitle>
              <CardDescription className="text-slate-400">
                Connect your standard personal/business phone number by scanning a QR code.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 leading-relaxed text-slate-300 text-sm">
                <p className="mb-2">
                  No API credentials, Meta App setup, or permanent tokens are needed for this method.
                </p>
                <p className="text-slate-400 text-xs">
                  Save this configuration to register your 2-day QR scan trial. 
                  After saving, scan the generated pairing QR code using Linked Devices on your phone.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Webhook URL — only for Official API */}
        {integrationType === 'official_api' && (
          <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
            <CardHeader>
              <CardTitle className="text-white">Webhook Configuration</CardTitle>
              <CardDescription className="text-slate-400">
                Use this URL as your webhook callback in the Meta App Dashboard.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label className="text-slate-300">Webhook Callback URL</Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={webhookUrl}
                    className="bg-slate-800 border-slate-700 text-slate-300 font-mono text-sm"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleCopyWebhookUrl}
                    className="shrink-0 border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800"
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Configuration'
            )}
          </Button>
          {integrationType === 'official_api' && (
            <Button
              variant="outline"
              onClick={handleTestConnection}
              disabled={testing || !config}
              className="border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800"
            >
              {testing ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Testing...
                </>
              ) : (
                <>
                  <Zap className="size-4" />
                  Test API Connection
                </>
              )}
            </Button>
          )}
          {config && (
            <Button
              variant="outline"
              onClick={handleReset}
              disabled={resetting}
              className="border-red-900 text-red-400 hover:text-red-300 hover:bg-red-950/40"
            >
              {resetting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Resetting...
                </>
              ) : (
                <>
                  <RotateCcw className="size-4" />
                  Reset Configuration
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Setup Instructions Sidebar */}
      <div>
        {renderSetupInstructions()}
      </div>

      {/* Migration Modal */}
      {showMigrationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="p-6 space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-white">Upgrade to Official API</h2>
                  <p className="text-sm text-slate-400 mt-1">
                    Get your own WhatsApp Business number
                  </p>
                </div>
                <button
                  onClick={() => setShowMigrationModal(false)}
                  className="text-slate-400 hover:text-white transition-colors"
                >
                  <XCircle className="size-6" />
                </button>
              </div>

              {/* Migration Benefits */}
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-2">
                <h3 className="text-sm font-semibold text-emerald-200">What You Get</h3>
                <ul className="space-y-1.5 text-xs text-slate-400">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="size-3.5 text-emerald-400 shrink-0" />
                    Your own WhatsApp Business number
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="size-3.5 text-emerald-400 shrink-0" />
                    No message limits
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="size-3.5 text-emerald-400 shrink-0" />
                    All conversations and contacts preserved
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="size-3.5 text-emerald-400 shrink-0" />
                    Custom templates and catalog support
                  </li>
                </ul>
              </div>

              {/* Warning */}
              <Alert className="bg-amber-950/30 border-amber-700/50">
                <AlertTriangle className="size-4 text-amber-400" />
                <AlertDescription className="text-xs text-amber-200/80">
                  Your leads will need to message your new number. We can optionally notify your active conversations about the change.
                </AlertDescription>
              </Alert>

              {/* Migration Form */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-slate-300">Phone Number ID <span className="text-red-400">*</span></Label>
                  <Input
                    placeholder="e.g. 100234567890123"
                    value={migrationPhoneId}
                    onChange={(e) => setMigrationPhoneId(e.target.value)}
                    className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-300">WhatsApp Business Account ID</Label>
                  <Input
                    placeholder="e.g. 100234567890456"
                    value={migrationWabaId}
                    onChange={(e) => setMigrationWabaId(e.target.value)}
                    className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-300">Permanent Access Token <span className="text-red-400">*</span></Label>
                  <div className="relative">
                    <Input
                      type={showToken ? 'text' : 'password'}
                      placeholder="Enter your access token"
                      value={migrationToken}
                      onChange={(e) => setMigrationToken(e.target.value)}
                      className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken(!showToken)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
                    >
                      {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-300">Two-step verification PIN</Label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="6-digit PIN from Meta"
                    value={migrationPin}
                    onChange={(e) => setMigrationPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 tracking-widest"
                  />
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <input
                    type="checkbox"
                    id="notify-leads"
                    checked={migrationNotifyLeads}
                    onChange={(e) => setMigrationNotifyLeads(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-800 text-primary focus:ring-0 focus:ring-offset-0 h-4 w-4 cursor-pointer"
                  />
                  <Label htmlFor="notify-leads" className="text-slate-300 text-sm cursor-pointer select-none">
                    Notify active leads about my new number
                  </Label>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setShowMigrationModal(false)}
                  className="flex-1 border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleMigrateToOfficial}
                  disabled={migrating || !migrationPhoneId.trim() || !migrationToken.trim()}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {migrating ? (
                    <>
                      <Loader2 className="size-4 animate-spin mr-2" />
                      Upgrading...
                    </>
                  ) : (
                    <>
                      <ArrowUpRight className="size-4 mr-2" />
                      Upgrade Now
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
