'use client';

import { BookOpen, Box, LayoutGrid, Sparkles, UserRound } from 'lucide-react';

import {
  AGENCY_SHOWCASE_DESIGNS,
  isAgencyShowcaseDesign,
  showcasePreviewUrl,
  type ShowcaseStyle,
} from '@/lib/showcase/style';

const OPTIONS: Array<{
  value: ShowcaseStyle;
  label: string;
  description: string;
  icon: typeof Sparkles;
}> = [
  {
    value: 'spotlight',
    label: 'Spotlight',
    description: 'Cinematic, photo-first listings',
    icon: Sparkles,
  },
  {
    value: 'editorial',
    label: 'Editorial',
    description: 'Refined magazine presentation',
    icon: BookOpen,
  },
  {
    value: 'gallery',
    label: 'Gallery',
    description: 'Fast, visual property browsing',
    icon: LayoutGrid,
  },
  {
    value: 'signature',
    label: 'Signature',
    description: 'Brand-led premium presentation',
    icon: UserRound,
  },
];

interface ShowcasePresentationControlsProps {
  title: string;
  description: string;
  value: ShowcaseStyle;
  threeDimensional: boolean;
  disabled?: boolean;
  previewUrl?: string;
  onValueChange: (value: ShowcaseStyle) => void;
  onThreeDimensionalChange: (enabled: boolean) => void;
}

export function ShowcasePresentationControls({
  title,
  description,
  value,
  threeDimensional,
  disabled = false,
  previewUrl,
  onValueChange,
  onThreeDimensionalChange,
}: ShowcasePresentationControlsProps) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-slate-200">{title}</p>
        <p className="mt-1 text-xs text-slate-500">{description}</p>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {AGENCY_SHOWCASE_DESIGNS.map((design) => (
          <button
            key={design.value}
            type="button"
            aria-pressed={value === design.value}
            disabled={disabled}
            onClick={() => {
              onValueChange(design.value);
              onThreeDimensionalChange(false);
            }}
            className={`overflow-hidden rounded-xl border text-left transition-colors disabled:opacity-50 ${value === design.value ? 'border-primary ring-primary/30 ring-2' : 'border-slate-800'}`}
          >
            <div
              aria-hidden
              className="space-y-2 p-4"
              style={{
                backgroundColor: design.background,
                color: design.foreground,
              }}
            >
              <div
                className="h-2 w-16 rounded"
                style={{ backgroundColor: design.accent }}
              />
              <div className="flex gap-2">
                {[0, 1, 2].map((item) => (
                  <div key={item} className="flex-1 space-y-1">
                    <div
                      className="h-12 rounded-md opacity-25"
                      style={{ backgroundColor: design.accent }}
                    />
                    <div
                      className="h-1 w-3/4 rounded opacity-60"
                      style={{ backgroundColor: design.foreground }}
                    />
                    <div
                      className="h-1 w-1/2 rounded opacity-30"
                      style={{ backgroundColor: design.foreground }}
                    />
                  </div>
                ))}
              </div>
            </div>
            <span className="block p-3">
              <span className="block text-sm font-semibold text-white">
                {design.label}
              </span>
              <span className="mt-1 block text-xs text-slate-400">
                {design.description}
              </span>
            </span>
          </button>
        ))}
      </div>
      {previewUrl && (
        <a
          href={showcasePreviewUrl(previewUrl, value)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center rounded-lg border border-slate-700 px-4 text-sm font-medium text-slate-200"
        >
          Preview selected design
        </a>
      )}
      <p className="text-xs text-slate-500">Existing designs</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {OPTIONS.map((option) => {
          const Icon = option.icon;
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => onValueChange(option.value)}
              className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                selected
                  ? 'border-primary bg-primary/10 text-white'
                  : 'border-slate-800 bg-slate-900/50 text-slate-300 hover:border-slate-700 hover:bg-slate-900'
              }`}
            >
              <span
                className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
                  selected
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                <Icon className="size-4" />
              </span>
              <span>
                <span className="block text-sm font-semibold">
                  {option.label}
                </span>
                <span className="mt-1 block text-xs text-slate-500">
                  {option.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {!isAgencyShowcaseDesign(value) && (
        <button
          type="button"
          aria-pressed={threeDimensional}
          disabled={disabled}
          onClick={() => onThreeDimensionalChange(!threeDimensional)}
          className={`flex w-full items-center gap-3 rounded-xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
            threeDimensional
              ? 'border-primary/50 bg-primary/5'
              : 'border-slate-800 bg-slate-900/40'
          }`}
        >
          <span className="bg-slate-850 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
            <Box className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-white">
              3D property transitions
            </span>
            <span className="mt-1 block text-xs text-slate-500">
              Listings flip one at a time on mobile and move with depth on
              desktop.
            </span>
          </span>
          <span
            className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
              threeDimensional
                ? 'bg-primary text-primary-foreground'
                : 'bg-slate-800 text-slate-400'
            }`}
          >
            {threeDimensional ? 'On' : 'Off'}
          </span>
        </button>
      )}
    </div>
  );
}
