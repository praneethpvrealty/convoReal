'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Loader2,
  Save,
  Cpu,
  Key,
  CheckCircle,
  Lock,
  AlertTriangle,
} from 'lucide-react';
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
import type {
  ImageProviderId,
  ImageProvidersStatus,
} from '@/lib/ai/provider-status';
import { BRANDING } from '@/config/branding';

const PROVIDER_CARDS: {
  id: ImageProviderId;
  brand: string;
  brandClass: string;
  badge: string;
  badgeClass: string;
  title: string;
  description: string;
}[] = [
  {
    id: 'huggingface',
    brand: '🤗 Hugging Face',
    brandClass: 'text-indigo-400',
    badge: 'Free Endpoint',
    badgeClass: 'bg-green-500/10 text-green-400 border-green-500/20',
    title: 'Stable Diffusion XL',
    description:
      'Generates backgrounds for free using open-source models. Also supports Image-to-Image editing to modify and enhance existing property uploads.',
  },
  {
    id: 'google',
    brand: '⚡ Google Cloud',
    brandClass: 'text-sky-400',
    badge: 'Paid API',
    badgeClass: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    title: 'Google Gemini Image',
    description:
      'Generates ultra-high-quality property visuals using Google AI Studio. Faster processing with consistent performance (no queue wait times).',
  },
  {
    id: 'stability',
    brand: '🎨 Stability AI',
    brandClass: 'text-fuchsia-400',
    badge: 'Paid API',
    badgeClass: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    title: 'Stable Diffusion 3.5 / Ultra',
    description:
      'Photoreal property renders with strong prompt adherence. Choose an SD 3.5 variant or Ultra below.',
  },
];

export function AiSettingsPanel() {
  const supabase = createClient();
  const { accountId, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [flyerAiProvider, setFlyerAiProvider] = useState<
    'google' | 'huggingface' | 'stability'
  >('huggingface');
  const [stabilityModel, setStabilityModel] = useState('sd3.5-large');
  const [hasSettingsRecord, setHasSettingsRecord] = useState(false);
  const [status, setStatus] = useState<ImageProvidersStatus | null>(null);

  useEffect(() => {
    if (authLoading || !accountId) return;

    async function fetchSettings() {
      try {
        const res = await fetch('/api/ai/image-providers');
        if (res.ok) {
          const json = (await res.json()) as { data: ImageProvidersStatus };
          setStatus(json.data);
        }

        const { data, error } = await supabase
          .from('showcase_settings')
          .select('flyer_ai_provider, flyer_stability_model')
          .eq('account_id', accountId)
          .maybeSingle();

        if (error) {
          console.error('Error fetching AI settings:', error);
          toast.error('Failed to load AI settings');
          return;
        }

        if (data) {
          setHasSettingsRecord(true);
          setFlyerAiProvider(data.flyer_ai_provider || 'huggingface');
          if (data.flyer_stability_model)
            setStabilityModel(data.flyer_stability_model);
        }
      } catch (err) {
        console.error('Unexpected error loading AI settings:', err);
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
        flyer_ai_provider: flyerAiProvider,
        flyer_stability_model: stabilityModel,
        updated_at: new Date().toISOString(),
      };

      if (hasSettingsRecord) {
        const { data: saved, error } = await supabase
          .from('showcase_settings')
          .update(payload)
          .eq('account_id', accountId)
          .select('account_id');

        if (error) throw error;
        if (!saved?.length) {
          throw new Error('Your settings could not be saved.');
        }
      } else {
        const { error } = await supabase
          .from('showcase_settings')
          .insert([payload]);

        if (error) throw error;
        setHasSettingsRecord(true);
      }

      toast.success('AI configuration saved successfully');
    } catch (err) {
      console.error('Error saving AI settings:', err);
      toast.error('Failed to save AI settings');
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

  const selfHosted = status?.selfHosted ?? false;
  const providerStatus = (id: ImageProviderId) =>
    status?.providers.find((p) => p.id === id);
  const isAvailable = (id: ImageProviderId) =>
    providerStatus(id)?.available ?? true;
  const selectedUnavailable = !isAvailable(flyerAiProvider);

  return (
    <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl font-bold text-white">
          <Cpu className="text-primary size-5 animate-pulse" />
          AI & Flyer Configuration
        </CardTitle>
        <CardDescription className="text-slate-400">
          Choose which AI image generator is used for listing flyers.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="space-y-6">
          <div className="space-y-4">
            <Label className="text-slate-350 block font-medium">
              Flyer AI Image Generator Preference
            </Label>

            {/* Visual selector cards */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {PROVIDER_CARDS.map((card) => {
                const available = isAvailable(card.id);
                const selected = flyerAiProvider === card.id;
                const envVar = providerStatus(card.id)?.envVar;

                return (
                  <div
                    key={card.id}
                    role="radio"
                    aria-checked={selected}
                    aria-disabled={!available}
                    onClick={() => available && setFlyerAiProvider(card.id)}
                    className={`relative flex flex-col justify-between overflow-hidden rounded-xl border p-5 transition-all duration-300 select-none ${
                      !available
                        ? 'border-slate-850 cursor-not-allowed bg-slate-950/40 text-slate-500 opacity-60'
                        : selected
                          ? 'border-primary bg-primary/5 cursor-pointer text-white shadow-[0_0_15px_rgba(99,102,241,0.08)]'
                          : 'cursor-pointer border-slate-800 bg-slate-950/20 text-slate-400 hover:border-slate-700 hover:bg-slate-950/40'
                    }`}
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span
                          className={`flex items-center gap-1.5 text-xs font-extrabold tracking-wider uppercase ${card.brandClass}`}
                        >
                          {card.brand}
                        </span>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${card.badgeClass}`}
                        >
                          {card.badge}
                        </span>
                      </div>
                      <h4 className="text-base font-bold text-slate-100">
                        {card.title}
                      </h4>
                      <p className="text-[11px] leading-normal text-slate-400">
                        {card.description}
                      </p>
                    </div>
                    <div className="mt-4 flex items-start gap-1.5 border-t border-slate-800/60 pt-3 text-[10px] text-slate-500">
                      {available ? (
                        <>
                          <CheckCircle className="size-3.5 shrink-0 text-green-500/70" />
                          <span>
                            Available
                            {selfHosted && envVar ? ` — ${envVar} is set` : ''}
                          </span>
                        </>
                      ) : (
                        <>
                          <Lock className="size-3.5 shrink-0" />
                          <span>
                            {selfHosted && envVar
                              ? `Unavailable — set ${envVar} to enable`
                              : `Unavailable on your account — email ${BRANDING.supportEmail} to switch it on`}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {selectedUnavailable && (
              <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-300/90">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  Your saved generator is not available right now, so flyer
                  generation will fail. Pick one of the available generators
                  above.
                </span>
              </div>
            )}

            {/* Stability model picker — only when Stability is selected */}
            {flyerAiProvider === 'stability' && (
              <div className="mt-4 space-y-2">
                <Label className="text-slate-350 block text-sm font-medium">
                  Stability model
                </Label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: 'sd3.5-large', label: 'SD 3.5 Large' },
                    { value: 'sd3.5-large-turbo', label: 'SD 3.5 Turbo' },
                    { value: 'sd3.5-medium', label: 'SD 3.5 Medium' },
                    { value: 'ultra', label: 'Ultra' },
                  ].map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => setStabilityModel(m.value)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                        stabilityModel === m.value
                          ? 'border-primary text-primary bg-primary/10'
                          : 'border-slate-700 text-slate-400 hover:border-slate-600'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] leading-relaxed text-slate-500">
                  Large is the best all-round quality; Turbo is faster and
                  cheaper; Ultra is the highest-fidelity flagship.
                </p>
              </div>
            )}

            {selfHosted && (
              <div className="border-slate-850 text-slate-450 mt-4 flex items-start gap-3 rounded-xl border bg-slate-950 p-3.5 text-xs leading-relaxed">
                <Key className="text-primary mt-0.5 size-4.5 shrink-0" />
                <div>
                  <span className="mb-0.5 block font-bold text-slate-300">
                    Self-hosted setup
                  </span>
                  Set the provider keys in your server environment (
                  <code className="rounded bg-slate-900 px-1 py-0.5 font-mono text-[10px] text-slate-300">
                    .env.local
                  </code>{' '}
                  in development):{' '}
                  <code className="text-primary rounded bg-slate-900 px-1 py-0.5 font-mono text-[10px]">
                    HF_ACCESS_TOKEN
                  </code>{' '}
                  for Hugging Face,{' '}
                  <code className="text-primary rounded bg-slate-900 px-1 py-0.5 font-mono text-[10px]">
                    GEMINI_API_KEY
                  </code>{' '}
                  (billing enabled) for Google Cloud, and{' '}
                  <code className="text-primary rounded bg-slate-900 px-1 py-0.5 font-mono text-[10px]">
                    STABILITY_API_KEY
                  </code>{' '}
                  for Stability AI. Restart the server after changing them.
                </div>
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
              Save Configuration
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
