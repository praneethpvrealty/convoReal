'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Megaphone, Sparkles, Loader2, CheckCircle2, MessageCircle, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { showcaseImageUrl, SHOWCASE_IMAGE_WIDTHS } from '@/lib/showcase-image';
import { storagePublicUrl } from '@/lib/storage/url';
import { AD_COPY_LIMITS } from '@/lib/meta-ads/ad-copy';
import { BUDGET_BOUNDS, RADIUS_BOUNDS } from '@/lib/meta-ads/campaign-build';
import type { Property } from '@/types';

interface PromotePropertyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  property: Property | null;
}

type Step = 'creative' | 'budget' | 'review';
const BUDGET_CHIPS = [300, 500, 800];
const DURATION_CHIPS = [7, 14, 30];

export function PromotePropertyDialog({ open, onOpenChange, property }: PromotePropertyDialogProps) {
  const [connState, setConnState] = useState<'loading' | 'ready' | 'not_connected'>('loading');
  const [step, setStep] = useState<Step>('creative');

  const [selectedImage, setSelectedImage] = useState('');
  const [headline, setHeadline] = useState('');
  const [primaryText, setPrimaryText] = useState('');
  const [generating, setGenerating] = useState(false);

  const [targetMode, setTargetMode] = useState<'radius' | 'city'>('radius');
  const [targetCity, setTargetCity] = useState('');
  const [radiusKm, setRadiusKm] = useState(5);
  const [dailyBudget, setDailyBudget] = useState('500');
  const [durationDays, setDurationDays] = useState<number | null>(14);

  const [policyChecked, setPolicyChecked] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launched, setLaunched] = useState(false);

  const images = useMemo(() => property?.images?.filter(Boolean) ?? [], [property]);

  // Reset + fetch connection status each time the dialog opens.
  useEffect(() => {
    if (!open || !property) return;
    setStep('creative');
    setSelectedImage(images[0] ?? '');
    setHeadline('');
    setPrimaryText('');
    setTargetMode('radius');
    setTargetCity('');
    setRadiusKm(5);
    setDailyBudget('500');
    setDurationDays(14);
    setPolicyChecked(false);
    setLaunched(false);
    setConnState('loading');

    (async () => {
      try {
        const res = await fetch('/api/meta-ads/config');
        const data = await res.json();
        setConnState(data.connected && !data.needsAssetSelection ? 'ready' : 'not_connected');
      } catch {
        setConnState('not_connected');
      }
    })();
  }, [open, property, images]);

  const generateCopy = useCallback(async () => {
    if (!property) return;
    setGenerating(true);
    try {
      const res = await fetch('/api/ai/ad-copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property_id: property.id }),
      });
      const data = await res.json();
      if (res.status === 402) {
        toast.error('Not enough credits to generate ad copy.');
        return;
      }
      if (!res.ok || !data.copy) {
        toast.error(data.error || 'Could not generate ad copy.');
        return;
      }
      setHeadline(data.copy.headline);
      setPrimaryText(data.copy.primaryText);
    } catch {
      toast.error('Could not generate ad copy.');
    } finally {
      setGenerating(false);
    }
  }, [property]);

  async function launch() {
    if (!property || !policyChecked) return;
    setLaunching(true);
    try {
      const res = await fetch('/api/meta-ads/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_id: property.id,
          daily_budget_inr: budgetNum,
          duration_days: durationDays ?? undefined,
          radius_km: radiusKm,
          target_city: targetMode === 'city' ? targetCity.trim() : undefined,
          headline,
          primary_text: primaryText,
          image_url: selectedImage,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Could not launch the ad.');
        return;
      }
      setLaunched(true);
    } catch {
      toast.error('Could not launch the ad.');
    } finally {
      setLaunching(false);
    }
  }

  if (!property) return null;

  const canContinueCreative = !!selectedImage && headline.trim().length > 0 && primaryText.trim().length > 0;
  const budgetNum = Number(dailyBudget) || 0;
  const totalEstimate = durationDays ? budgetNum * durationDays : null;
  const canContinueBudget =
    budgetNum >= BUDGET_BOUNDS.minInr && (targetMode === 'radius' || targetCity.trim().length > 1);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-primary" />
            Promote on Instagram &amp; Facebook
          </DialogTitle>
          <DialogDescription>{property.title}</DialogDescription>
        </DialogHeader>

        {connState === 'loading' && (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}

        {connState === 'not_connected' && (
          <div className="py-6 text-center space-y-4">
            <p className="text-sm text-muted-foreground">
              Connect your Meta account and choose an ad account to run property ads.
            </p>
            <a
              href="/settings?tab=ads"
              className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground text-sm font-medium h-9 px-4 hover:bg-primary/90"
            >
              Go to Ads settings
            </a>
          </div>
        )}

        {connState === 'ready' && launched && (
          <div className="py-8 text-center space-y-4">
            <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto" />
            <h3 className="text-lg font-semibold">Your ad is live!</h3>
            <p className="text-sm text-muted-foreground">
              It&apos;s now running on Instagram &amp; Facebook. Leads will land in your inbox, tagged with this ad.
            </p>
            <a
              href="/ads"
              className="inline-flex items-center justify-center rounded-md border text-sm font-medium h-9 px-4 hover:bg-muted"
            >
              View in Ads dashboard
            </a>
          </div>
        )}

        {connState === 'ready' && !launched && (
          <div className="space-y-5">
            {/* Step indicator */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {(['creative', 'budget', 'review'] as Step[]).map((s, i) => (
                <span key={s} className={step === s ? 'font-semibold text-foreground' : ''}>
                  {i + 1}. {s === 'creative' ? 'Creative' : s === 'budget' ? 'Audience & budget' : 'Review'}
                  {i < 2 && <span className="mx-2 text-muted-foreground/40">→</span>}
                </span>
              ))}
            </div>

            {step === 'creative' && (
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium">Photo</label>
                  {images.length > 0 ? (
                    <div className="grid grid-cols-4 gap-2 mt-1.5">
                      {images.slice(0, 8).map((img) => (
                        <button
                          key={img}
                          type="button"
                          onClick={() => setSelectedImage(img)}
                          className={`aspect-square rounded-md overflow-hidden border-2 transition-colors ${
                            selectedImage === img ? 'border-primary' : 'border-transparent hover:border-muted-foreground/30'
                          }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={showcaseImageUrl(storagePublicUrl(img), SHOWCASE_IMAGE_WIDTHS.thumb)} alt="" className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground mt-1.5">This property has no photos — add one to advertise it.</p>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Ad text</label>
                  <Button type="button" size="sm" variant="outline" onClick={generateCopy} disabled={generating}>
                    {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
                    Generate with AI
                  </Button>
                </div>

                <div className="space-y-1">
                  <Input value={headline} onChange={(e) => setHeadline(e.target.value.slice(0, AD_COPY_LIMITS.headline))} placeholder="Headline" />
                  <p className="text-[11px] text-muted-foreground text-right">{headline.length}/{AD_COPY_LIMITS.headline}</p>
                </div>
                <div className="space-y-1">
                  <Textarea
                    value={primaryText}
                    onChange={(e) => setPrimaryText(e.target.value.slice(0, AD_COPY_LIMITS.primaryText))}
                    rows={3}
                    placeholder="Primary text — what buyers see above the image"
                  />
                  <p className="text-[11px] text-muted-foreground text-right">{primaryText.length}/{AD_COPY_LIMITS.primaryText}</p>
                </div>

                {/* Instagram-style preview */}
                {selectedImage && (
                  <div className="rounded-lg border overflow-hidden max-w-xs mx-auto">
                    <div className="flex items-center gap-2 p-2 text-xs font-semibold">
                      <div className="h-6 w-6 rounded-full bg-muted" />
                      your_page
                    </div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={showcaseImageUrl(storagePublicUrl(selectedImage), SHOWCASE_IMAGE_WIDTHS.card)} alt="" className="w-full aspect-square object-cover" />
                    <div className="p-2 space-y-1">
                      <div className="bg-emerald-600 text-white text-xs font-semibold text-center rounded py-1.5 flex items-center justify-center gap-1">
                        <MessageCircle className="h-3.5 w-3.5" /> Send WhatsApp message
                      </div>
                      {headline && <p className="text-xs font-semibold">{headline}</p>}
                      {primaryText && <p className="text-[11px] text-muted-foreground">{primaryText}</p>}
                    </div>
                  </div>
                )}

                <div className="flex justify-end">
                  <Button onClick={() => setStep('budget')} disabled={!canContinueCreative}>
                    Continue
                  </Button>
                </div>
              </div>
            )}

            {step === 'budget' && (
              <div className="space-y-5">
                <div>
                  <label className="text-sm font-medium">Who should see this ad?</label>
                  <div className="flex gap-2 mt-1.5">
                    <button
                      type="button"
                      onClick={() => setTargetMode('radius')}
                      className={`text-xs px-3 py-1.5 rounded-full border ${targetMode === 'radius' ? 'border-primary text-primary' : 'text-muted-foreground'}`}
                    >
                      Near this property
                    </button>
                    <button
                      type="button"
                      onClick={() => setTargetMode('city')}
                      className={`text-xs px-3 py-1.5 rounded-full border ${targetMode === 'city' ? 'border-primary text-primary' : 'text-muted-foreground'}`}
                    >
                      A specific city
                    </button>
                  </div>

                  {targetMode === 'radius' ? (
                    <div className="mt-3">
                      <label className="text-sm">
                        Radius: <span className="text-primary">{radiusKm} km</span> around this property
                      </label>
                      <input
                        type="range"
                        min={RADIUS_BOUNDS.minKm}
                        max={RADIUS_BOUNDS.maxKm}
                        value={radiusKm}
                        onChange={(e) => setRadiusKm(Number(e.target.value))}
                        className="w-full mt-2"
                      />
                      <p className="text-xs text-muted-foreground">
                        If this property has no map location set, we&apos;ll target its city instead.
                      </p>
                    </div>
                  ) : (
                    <div className="mt-3">
                      <Input
                        value={targetCity}
                        onChange={(e) => setTargetCity(e.target.value)}
                        placeholder="e.g. Bengaluru"
                      />
                      <p className="text-xs text-muted-foreground mt-1.5">
                        Reach buyers in another city — useful when your audience isn&apos;t local to the property (e.g. Bengaluru buyers for a Coorg homestay).
                      </p>
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-sm font-medium">Daily budget (₹)</label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    value={dailyBudget}
                    onChange={(e) => setDailyBudget(e.target.value.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, ''))}
                    className="mt-1.5"
                  />
                  <div className="flex gap-2 mt-2">
                    {BUDGET_CHIPS.map((b) => (
                      <button
                        key={b}
                        type="button"
                        onClick={() => setDailyBudget(String(b))}
                        className={`text-xs px-2.5 py-1 rounded-full border ${budgetNum === b ? 'border-primary text-primary' : 'text-muted-foreground'}`}
                      >
                        ₹{b}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium">Run for</label>
                  <div className="flex gap-2 mt-1.5">
                    {DURATION_CHIPS.map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setDurationDays(d)}
                        className={`text-xs px-2.5 py-1 rounded-full border ${durationDays === d ? 'border-primary text-primary' : 'text-muted-foreground'}`}
                      >
                        {d} days
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setDurationDays(null)}
                      className={`text-xs px-2.5 py-1 rounded-full border ${durationDays === null ? 'border-primary text-primary' : 'text-muted-foreground'}`}
                    >
                      Ongoing
                    </button>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  Billed by Meta directly to your card — ConvoReal doesn&apos;t charge for ad delivery.
                </p>

                <div className="flex justify-between">
                  <Button variant="ghost" onClick={() => setStep('creative')}>
                    <ArrowLeft className="h-4 w-4 mr-1.5" /> Back
                  </Button>
                  <Button onClick={() => setStep('review')} disabled={!canContinueBudget}>
                    Continue
                  </Button>
                </div>
              </div>
            )}

            {step === 'review' && (
              <div className="space-y-4">
                <div className="rounded-lg border p-4 space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Daily budget</span><span>₹{budgetNum}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Duration</span><span>{durationDays ? `${durationDays} days` : 'Ongoing'}</span></div>
                  {totalEstimate !== null && (
                    <div className="flex justify-between font-medium"><span>Estimated total spend</span><span>₹{totalEstimate.toLocaleString('en-IN')}</span></div>
                  )}
                  <div className="flex justify-between"><span className="text-muted-foreground">Target</span><span>{targetMode === 'city' ? targetCity.trim() : `${radiusKm} km radius`}</span></div>
                </div>

                <label className="flex items-start gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={policyChecked} onChange={(e) => setPolicyChecked(e.target.checked)} className="mt-0.5" />
                  <span>My ad follows housing-ad rules — no discrimination on religion, caste, gender, or family status.</span>
                </label>

                <div className="flex justify-between">
                  <Button variant="ghost" onClick={() => setStep('budget')}>
                    <ArrowLeft className="h-4 w-4 mr-1.5" /> Back
                  </Button>
                  <Button onClick={launch} disabled={!policyChecked || launching}>
                    {launching && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                    Launch ad
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
