'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Globe, Building, Phone, MessageSquare, Loader2, Save, ExternalLink, Copy, CheckCircle2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import type { ShowcaseSettings } from '@/types';
import { BRANDING } from '@/config/branding';

export function ShowcaseSettingsPanel() {
  const supabase = createClient();
  const { accountId, user, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copiedUrlType, setCopiedUrlType] = useState<'company' | 'personal' | null>(null);
  const [settings, setSettings] = useState<ShowcaseSettings | null>(null);

  const [websiteName, setWebsiteName] = useState(BRANDING.name);
  const [websiteUrl, setWebsiteUrl] = useState(BRANDING.websiteUrl);
  const [contactPhone, setContactPhone] = useState('');
  const [whatsappTemplate, setWhatsappTemplate] = useState(
    'Hi! I am interested in your property "{title}" in {location}. Please share details.'
  );
  const [metaPixelId, setMetaPixelId] = useState('');
  const [subdomain, setSubdomain] = useState('');


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
          setSettings(data);
          setWebsiteName(data.website_name || BRANDING.name);
          setWebsiteUrl(data.website_url || BRANDING.websiteUrl);
          setContactPhone(data.contact_phone || '');
          setWhatsappTemplate(data.whatsapp_message_template || '');
          setMetaPixelId(data.meta_pixel_id || '');
          setSubdomain(data.subdomain || '');

        }
      } catch (err) {
        console.error('Unexpected error loading showcase settings:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchSettings();
  }, [accountId, authLoading, supabase]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountId) return;

    setSaving(true);
    try {
      const payload = {
        account_id: accountId,
        website_name: websiteName.trim(),
        website_url: websiteUrl.trim(),
        contact_phone: contactPhone.trim(),
        whatsapp_message_template: whatsappTemplate.trim(),
        meta_pixel_id: metaPixelId.trim() || null,
        subdomain: subdomain.trim().toLowerCase() || null,
        updated_at: new Date().toISOString(),
      };

      if (settings) {
        // Update
        const { data, error } = await supabase
          .from('showcase_settings')
          .update(payload)
          .eq('account_id', accountId)
          .select()
          .single();

        if (error) throw error;
        setSettings(data);
      } else {
        // Insert
        const { data, error } = await supabase
          .from('showcase_settings')
          .insert([payload])
          .select()
          .single();

        if (error) throw error;
        setSettings(data);
      }

      toast.success('Showcase settings saved successfully');
    } catch (err) {
      console.error('Error saving showcase settings:', err);
      toast.error('Failed to save showcase settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading || authLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  const shareableUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/?account_id=${accountId}`
    : '';

  const personalShareableUrl = typeof window !== 'undefined' && user?.id
    ? `${window.location.origin}/?ref=${user.id}`
    : '';


  const handleCopyLink = (url: string, type: 'company' | 'personal') => {
    if (!url) return;
    navigator.clipboard.writeText(url);
    setCopiedUrlType(type);
    toast.success(`${type === 'company' ? 'Company' : 'Personal Agent'} showcase link copied!`);
    setTimeout(() => setCopiedUrlType(null), 2000);
  };

  return (
    <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="text-xl font-bold text-white flex items-center gap-2">
          <Globe className="size-5 text-primary" />
          Public Showcase Settings
        </CardTitle>
        <CardDescription className="text-slate-400">
          Configure details for your public inventory showcase website. Published properties will display these contact details.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {accountId && (
          <div className="mb-8 grid grid-cols-1 lg:grid-cols-2 gap-4 animate-fade-in">
            {/* Company Link */}
            <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/20 flex flex-col justify-between gap-3 relative overflow-hidden group">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none" />
              <div className="space-y-1">
                <span className="text-[10px] text-primary font-extrabold uppercase tracking-wider block">Company Showcase Link</span>
                <p className="text-[10px] text-slate-400 leading-tight">
                  Showcases all published properties listed across the entire account inventory.
                </p>
                <code className="text-[11px] text-slate-350 break-all select-all font-mono bg-slate-950 px-2.5 py-1.5 rounded border border-slate-900 block mt-2">
                  {shareableUrl}
                </code>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => handleCopyLink(shareableUrl, 'company')}
                  className="border-slate-800 bg-slate-950 hover:bg-slate-900 text-slate-200 text-[11px] h-8 flex items-center gap-1.5 cursor-pointer"
                >
                  {copiedUrlType === 'company' ? (
                    <CheckCircle2 className="size-3.5 text-green-400" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                  {copiedUrlType === 'company' ? 'Copied!' : 'Copy Link'}
                </Button>
                <a
                  href={shareableUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center rounded-md border border-slate-800 bg-slate-950 hover:bg-slate-900 text-slate-250 text-[11px] h-8 px-3 gap-1 hover:text-white"
                >
                  <Globe className="size-3.5" />
                  Visit Showcase
                </a>
              </div>
            </div>

            {/* Personal Agent Link */}
            <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/20 flex flex-col justify-between gap-3 relative overflow-hidden group">
              <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 via-transparent to-transparent pointer-events-none" />
              <div className="space-y-1">
                <span className="text-[10px] text-indigo-400 font-extrabold uppercase tracking-wider block">My Personal Agent Showcase Link</span>
                <p className="text-[10px] text-slate-400 leading-tight">
                  Showcases exclusively properties created or posted by you.
                </p>
                <code className="text-[11px] text-slate-350 break-all select-all font-mono bg-slate-950 px-2.5 py-1.5 rounded border border-slate-900 block mt-2">
                  {personalShareableUrl}
                </code>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => handleCopyLink(personalShareableUrl, 'personal')}
                  className="border-slate-800 bg-slate-950 hover:bg-slate-900 text-slate-200 text-[11px] h-8 flex items-center gap-1.5 cursor-pointer"
                >
                  {copiedUrlType === 'personal' ? (
                    <CheckCircle2 className="size-3.5 text-green-400" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                  {copiedUrlType === 'personal' ? 'Copied!' : 'Copy Link'}
                </Button>
                <a
                  href={personalShareableUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center rounded-md border border-slate-800 bg-slate-950 hover:bg-slate-900 text-slate-250 text-[11px] h-8 px-3 gap-1 hover:text-white"
                >
                  <Globe className="size-3.5" />
                  Visit Showcase
                </a>
              </div>
            </div>
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="websiteName" className="text-slate-350 font-medium">
                Website Name / Title
              </Label>
              <div className="relative">
                <Building className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
                <Input
                  id="websiteName"
                  value={websiteName}
                  onChange={(e) => setWebsiteName(e.target.value)}
                  placeholder={BRANDING.name}
                  required
                  className="pl-10 bg-slate-950 border-slate-800 text-white placeholder:text-slate-600 focus:border-primary focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="websiteUrl" className="text-slate-350 font-medium flex items-center justify-between">
                <span>Website URL / Domain</span>
                {websiteUrl && (
                  <a
                    href={websiteUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-primary hover:underline flex items-center gap-0.5"
                  >
                    Visit <ExternalLink className="size-3" />
                  </a>
                )}
              </Label>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
                <Input
                  id="websiteUrl"
                  type="url"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  placeholder={BRANDING.websiteUrl}
                  required
                  className="pl-10 bg-slate-950 border-slate-800 text-white placeholder:text-slate-600 focus:border-primary focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="subdomain" className="text-slate-350 font-medium">
              Showcase Subdomain (e.g. agency1)
            </Label>
            <div className="relative">
              <Globe className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
              <Input
                id="subdomain"
                value={subdomain}
                onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="e.g. myagency"
                className="pl-10 bg-slate-950 border-slate-800 text-white placeholder:text-slate-650 focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>
            <p className="text-[11px] text-slate-400">
              If configured, your showcase site will be accessible directly at <code className="text-primary">{`https://${subdomain || 'your-subdomain'}.${BRANDING.baseDomain}`}</code> (or locally at <code className="text-primary">{`http://${subdomain || 'your-subdomain'}.localhost:3000`}</code>).
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="contactPhone" className="text-slate-350 font-medium">
              Public Contact Phone Number
            </Label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
              <Input
                id="contactPhone"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="e.g. +91 98765 43210"
                required
                className="pl-10 bg-slate-950 border-slate-800 text-white placeholder:text-slate-600 focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>
            <p className="text-[11px] text-slate-400">
              The primary contact number displayed on listings. This will also be the WhatsApp contact phone (include country code, e.g., 91 for India).
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="whatsappTemplate" className="text-slate-350 font-medium">
              WhatsApp Inquiry Message Template
            </Label>
            <div className="relative">
              <MessageSquare className="absolute left-3 top-3 size-4 text-slate-500" />
              <Textarea
                id="whatsappTemplate"
                value={whatsappTemplate}
                onChange={(e) => setWhatsappTemplate(e.target.value)}
                placeholder="e.g. Hi! I am interested in your property {title}..."
                required
                rows={3}
                className="pl-10 bg-slate-950 border-slate-800 text-white placeholder:text-slate-600 focus:border-primary focus:ring-1 focus:ring-primary min-h-[80px]"
              />
            </div>
            <p className="text-[11px] text-slate-400">
              The prefilled text message that opens when visitors click &quot;Inquire via WhatsApp&quot;. Use <code className="bg-slate-950 px-1 py-0.5 rounded text-primary">{`{title}`}</code> and <code className="bg-slate-950 px-1 py-0.5 rounded text-primary">{`{location}`}</code> as dynamic placeholders.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="metaPixelId" className="text-slate-350 font-medium">
              Meta Pixel ID / Dataset ID (Optional)
            </Label>
            <div className="relative">
              <Globe className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
              <Input
                id="metaPixelId"
                value={metaPixelId}
                onChange={(e) => setMetaPixelId(e.target.value)}
                placeholder="e.g. 1856890568341240"
                className="pl-10 bg-slate-950 border-slate-800 text-white placeholder:text-slate-650 focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>
            <p className="text-[11px] text-slate-400">
              Paste your Meta Pixel ID or Dataset ID from Events Manager here. Fires ViewContent and Lead events to track listing views and conversions.
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
              Save Configuration
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
