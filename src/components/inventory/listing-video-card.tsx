'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Clapperboard, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NARRATION_LANGUAGES, type NarrationLanguage } from '@/lib/video/listing-video';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';

interface VideoState {
  video_url: string | null;
  video_status: 'queued' | 'processing' | 'ready' | 'failed' | null;
  video_language: string | null;
  video_error: string | null;
}

/**
 * "Generate listing video" card on the property form (edit mode only —
 * the render needs saved photos). Queues the job via
 * POST /api/properties/[id]/generate-video, polls the property row
 * while queued/processing, and previews the MP4 once ready.
 */
export function ListingVideoCard({ propertyId }: { propertyId: string }) {
  const [state, setState] = useState<VideoState | null>(null);
  const [language, setLanguage] = useState<NarrationLanguage>('en-IN');
  const [submitting, setSubmitting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from('properties')
      .select('video_url, video_status, video_language, video_error')
      .eq('id', propertyId)
      .maybeSingle();
    if (data) {
      setState(data as VideoState);
      if (data.video_language && data.video_language in NARRATION_LANGUAGES) {
        setLanguage(data.video_language as NarrationLanguage);
      }
    }
    return data as VideoState | null;
  };

  useEffect(() => {
    refresh();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId]);

  // Poll every 5s only while a render is in flight.
  useEffect(() => {
    const active = state?.video_status === 'queued' || state?.video_status === 'processing';
    if (active && !pollRef.current) {
      pollRef.current = setInterval(refresh, 5000);
    } else if (!active && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.video_status]);

  const generate = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/properties/${propertyId}/generate-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Failed (HTTP ${res.status})`);
      toast.success(
        `Video queued (${AI_FEATURE_COSTS.listing_video} cr) — usually ready in about a minute.`,
      );
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to queue video');
    } finally {
      setSubmitting(false);
    }
  };

  const busy = state?.video_status === 'queued' || state?.video_status === 'processing';

  return (
    <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
      <div className="flex items-center gap-2">
        <Clapperboard className="size-4 text-primary" />
        <Label className="text-slate-300">Listing Video</Label>
        <Sparkles className="size-3.5 text-primary/70" />
      </div>
      <p className="text-xs text-slate-500">
        Auto-builds a WhatsApp-ready teaser from this listing&apos;s photos —
        motion, captions, narration in your chosen language, and music.
        Costs {AI_FEATURE_COSTS.listing_video} cr per render.
      </p>

      {state?.video_status === 'ready' && state.video_url && (
        <video
          src={state.video_url}
          controls
          playsInline
          className="w-full max-w-[240px] rounded-lg border border-slate-800"
        />
      )}
      {state?.video_status === 'failed' && state.video_error && (
        <p className="text-xs text-red-400">
          Last attempt failed (credits refunded): {state.video_error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value as NarrationLanguage)}
          disabled={busy || submitting}
          className="h-9 rounded-lg border border-slate-700 bg-slate-800 px-2 text-xs text-slate-200"
          aria-label="Narration language"
        >
          {Object.entries(NARRATION_LANGUAGES).map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
        <Button
          type="button"
          size="sm"
          onClick={generate}
          disabled={busy || submitting}
          className="bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          {busy || submitting ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              {state?.video_status === 'processing' ? 'Rendering…' : 'Queued…'}
            </>
          ) : state?.video_status === 'ready' ? (
            <>
              <RefreshCw className="size-3.5" />
              Regenerate
            </>
          ) : (
            <>
              <Sparkles className="size-3.5" />
              Generate video
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
