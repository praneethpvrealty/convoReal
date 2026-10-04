'use client';

import type { Dispatch, SetStateAction } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useTopupModal } from '@/components/layout/topup-modal-context';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';
import type { SetPropertyFormField } from '@/hooks/usePropertyForm';
import type { PropertyFormValues } from '@/lib/inventory/property-form-state';

interface DescriptionSectionProps {
  values: PropertyFormValues;
  set: SetPropertyFormField;
  isLand: boolean;
  locationGuarded: boolean;
  generatingDescription: boolean;
  setGeneratingDescription: Dispatch<SetStateAction<boolean>>;
}

export function DescriptionSection({
  values,
  set,
  isLand,
  locationGuarded,
  generatingDescription,
  setGeneratingDescription,
}: DescriptionSectionProps) {
  const router = useRouter();
  const { openTopupModal } = useTopupModal();
  const {
    title,
    description,
    type,
    bedrooms,
    bathrooms,
    areaSqft,
    areaUnit,
    landArea,
    landAreaUnit,
    frontage,
    depth,
    sublocality,
    city,
    stateVal,
    address,
    features,
  } = values;

  async function handleGenerateAIDescription() {
    if (!title.trim()) {
      toast.error('Please enter a Property Title first');
      return;
    }
    setGeneratingDescription(true);
    try {
      const response = await fetch('/api/ai/generate-description', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: title.trim(),
          type,
          location:
            [
              locationGuarded ? '' : address.trim(),
              sublocality.trim(),
              city.trim(),
              stateVal.trim(),
            ]
              .filter(Boolean)
              .join(', ') || null,
          bedrooms: bedrooms.trim() ? Number(bedrooms) : null,
          bathrooms: bathrooms.trim() ? Number(bathrooms) : null,
          area: isLand
            ? landArea.trim()
              ? Number(landArea)
              : null
            : areaSqft.trim()
              ? Number(areaSqft)
              : null,
          areaUnit: isLand ? landAreaUnit : areaUnit,
          frontage: frontage.trim() || null,
          depth: depth.trim() || null,
          features,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        if (response.status === 402) {
          if (
            errData.upgradeRequired &&
            typeof errData.upgradeRequired === 'string'
          ) {
            toast.error(
              errData.error || 'AI features require a plan upgrade.',
              {
                action: {
                  label: 'Upgrade plan',
                  onClick: () => router.push('/settings?tab=billing'),
                },
              }
            );
          } else {
            toast.error(
              errData.error || `You've used all your credits for this month.`,
              {
                action: { label: 'Buy credits', onClick: openTopupModal },
              }
            );
          }
          return;
        }
        throw new Error(errData.error || 'Failed to generate description');
      }

      const data = await response.json();
      set('description', data.description || '');
      toast.success('Description generated successfully!');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast.error(errorMessage || 'Failed to generate description');
    } finally {
      setGeneratingDescription(false);
    }
  }

  return (
    <div id="pf-description" className="scroll-mt-2 space-y-1.5 pt-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor="prop-description" className="text-slate-300">
          Description
        </Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleGenerateAIDescription}
          disabled={generatingDescription || !title.trim()}
          className="text-primary hover:text-primary-hover hover:bg-primary/10 border-primary/20 flex h-7 items-center gap-1 rounded-md border px-2.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
        >
          {generatingDescription ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <span>✨</span> Generate with AI
              <Badge
                variant="outline"
                className="border-primary/30 text-primary/80 ml-1 h-4 px-1 text-[9px] font-medium"
              >
                {AI_FEATURE_COSTS.property_description} cr
              </Badge>
            </>
          )}
        </Button>
      </div>
      <Textarea
        id="prop-description"
        value={description}
        onChange={(e) => set('description', e.target.value)}
        placeholder="Describe the property's design, styling details, location benefits, etc..."
        rows={4}
        className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
      />
      <p className="text-[10px] leading-normal font-medium text-slate-500">
        💡{' '}
        <span className="font-semibold text-slate-400">
          Tip for better AI results:
        </span>{' '}
        fill out title, area, amenities, landmarks, and other specs before
        generating.
      </p>
    </div>
  );
}
