'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Save, Cpu, Key, CheckCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export function AiSettingsPanel() {
  const supabase = createClient();
  const { accountId, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [flyerAiProvider, setFlyerAiProvider] = useState<'google' | 'huggingface' | 'stability'>(
    'huggingface'
  );
  const [stabilityModel, setStabilityModel] = useState('sd3.5-large');
  const [hasSettingsRecord, setHasSettingsRecord] = useState(false);

  useEffect(() => {
    if (authLoading || !accountId) return;

    async function fetchSettings() {
      try {
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
          if (data.flyer_stability_model) setStabilityModel(data.flyer_stability_model);
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
        const { error } = await supabase
          .from('showcase_settings')
          .update(payload)
          .eq('account_id', accountId);

        if (error) throw error;
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
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="text-xl font-bold text-white flex items-center gap-2">
          <Cpu className="size-5 text-primary animate-pulse" />
          AI & Flyer Configuration
        </CardTitle>
        <CardDescription className="text-slate-400">
          Configure AI text-to-image preferences and provider credentials for listing flyers.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="space-y-6">
          <div className="space-y-4">
            <Label className="text-slate-350 font-medium block">
              Flyer AI Image Generator Preference
            </Label>
            
            {/* Visual selector cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              
              {/* Option Hugging Face */}
              <div
                onClick={() => setFlyerAiProvider('huggingface')}
                className={`p-5 rounded-xl border transition-all duration-300 cursor-pointer flex flex-col justify-between relative overflow-hidden select-none ${
                  flyerAiProvider === 'huggingface'
                    ? 'border-primary bg-primary/5 text-white shadow-[0_0_15px_rgba(99,102,241,0.08)]'
                    : 'border-slate-800 bg-slate-950/20 text-slate-400 hover:border-slate-700 hover:bg-slate-950/40'
                }`}
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold uppercase text-xs tracking-wider flex items-center gap-1.5 text-indigo-400">
                      🤗 Hugging Face
                    </span>
                    <span className="text-[10px] bg-green-500/10 text-green-400 font-bold px-2 py-0.5 rounded-full border border-green-500/20">
                      Free Endpoint
                    </span>
                  </div>
                  <h4 className="text-base font-bold text-slate-100">Stable Diffusion XL</h4>
                  <p className="text-[11px] text-slate-400 leading-normal">
                    Generates backgrounds for free using open-source models. Also supports Image-to-Image editing to modify and enhance existing property uploads.
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center gap-1.5 text-[10px] text-slate-500">
                  <Key className="size-3.5" /> Required: HF_ACCESS_TOKEN
                </div>
              </div>

              {/* Option Google Paid */}
              <div
                onClick={() => setFlyerAiProvider('google')}
                className={`p-5 rounded-xl border transition-all duration-300 cursor-pointer flex flex-col justify-between relative overflow-hidden select-none ${
                  flyerAiProvider === 'google'
                    ? 'border-primary bg-primary/5 text-white shadow-[0_0_15px_rgba(99,102,241,0.08)]'
                    : 'border-slate-800 bg-slate-950/20 text-slate-400 hover:border-slate-700 hover:bg-slate-950/40'
                }`}
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold uppercase text-xs tracking-wider flex items-center gap-1.5 text-sky-400">
                      ⚡ Google Cloud
                    </span>
                    <span className="text-[10px] bg-amber-500/10 text-amber-400 font-bold px-2 py-0.5 rounded-full border border-amber-500/20">
                      Paid API
                    </span>
                  </div>
                  <h4 className="text-base font-bold text-slate-100">Google Gemini Image</h4>
                  <p className="text-[11px] text-slate-400 leading-normal">
                    Generates ultra-high-quality property visuals using Google AI Studio. Faster processing with consistent performance (no queue wait times).
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center gap-1.5 text-[10px] text-slate-500">
                  <Key className="size-3.5" /> Required: GEMINI_API_KEY (Paid Tier)
                </div>
              </div>

              {/* Option Stability AI */}
              <div
                onClick={() => setFlyerAiProvider('stability')}
                className={`p-5 rounded-xl border transition-all duration-300 cursor-pointer flex flex-col justify-between relative overflow-hidden select-none ${
                  flyerAiProvider === 'stability'
                    ? 'border-primary bg-primary/5 text-white shadow-[0_0_15px_rgba(99,102,241,0.08)]'
                    : 'border-slate-800 bg-slate-950/20 text-slate-400 hover:border-slate-700 hover:bg-slate-950/40'
                }`}
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold uppercase text-xs tracking-wider flex items-center gap-1.5 text-fuchsia-400">
                      🎨 Stability AI
                    </span>
                    <span className="text-[10px] bg-amber-500/10 text-amber-400 font-bold px-2 py-0.5 rounded-full border border-amber-500/20">
                      Paid API
                    </span>
                  </div>
                  <h4 className="text-base font-bold text-slate-100">Stable Diffusion 3.5 / Ultra</h4>
                  <p className="text-[11px] text-slate-400 leading-normal">
                    Photoreal property renders with strong prompt adherence. Choose an SD 3.5 variant or Ultra below.
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center gap-1.5 text-[10px] text-slate-500">
                  <Key className="size-3.5" /> Required: STABILITY_API_KEY
                </div>
              </div>

            </div>

            {/* Stability model picker — only when Stability is selected */}
            {flyerAiProvider === 'stability' && (
              <div className="mt-4 space-y-2">
                <Label className="text-slate-350 font-medium block text-sm">Stability model</Label>
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
                      className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                        stabilityModel === m.value
                          ? 'border-primary text-primary bg-primary/10'
                          : 'border-slate-700 text-slate-400 hover:border-slate-600'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Large is the best all-round quality; Turbo is faster and cheaper; Ultra is the highest-fidelity flagship.
                </p>
              </div>
            )}

            {/* Note alert context */}
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-850 flex items-start gap-3 mt-4 text-xs text-slate-450 leading-relaxed">
              <CheckCircle className="size-4.5 text-primary shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-slate-300 block mb-0.5">Configuration Instructions</span>
                To enable Hugging Face generation, please add your free Hugging Face API key as <code className="bg-slate-900 px-1 py-0.5 rounded text-primary text-[10px] font-mono">HF_ACCESS_TOKEN</code> inside your <code className="bg-slate-900 px-1 py-0.5 rounded text-slate-300 text-[10px] font-mono">.env.local</code>. For Google Cloud, verify that <code className="bg-slate-900 px-1 py-0.5 rounded text-primary text-[10px] font-mono">GEMINI_API_KEY</code> has billing enabled. For Stability AI, add <code className="bg-slate-900 px-1 py-0.5 rounded text-primary text-[10px] font-mono">STABILITY_API_KEY</code>.
              </div>
            </div>

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
