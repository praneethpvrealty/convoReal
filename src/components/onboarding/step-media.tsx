'use client';

// Video slot for onboarding steps. Renders the registered walkthrough
// video when one exists for the slug; otherwise renders the children
// (an illustration) so every step ships useful today and upgrades to
// video with a one-line registry change.
//
// The caption sits under either one, so the line explaining the figure
// survives the swap to video rather than appearing only afterwards.

import {
  getOnboardingMedia,
  toEmbedUrl,
  type OnboardingMediaSlug,
} from '@/lib/onboarding/media';

interface StepMediaProps {
  slug: OnboardingMediaSlug;
  title: string;
  children?: React.ReactNode;
  className?: string;
}

export function StepMedia({
  slug,
  title,
  children,
  className,
}: StepMediaProps) {
  const media = getOnboardingMedia(slug);
  const embed = media.videoUrl ? toEmbedUrl(media.videoUrl) : null;

  const caption = media.caption ? (
    <p className="mt-2 text-center text-xs text-slate-500">{media.caption}</p>
  ) : null;

  if (embed) {
    return (
      <div className={className}>
        <div className="aspect-video w-full overflow-hidden rounded-xl border border-slate-700 bg-slate-950">
          <iframe
            src={embed}
            title={title}
            className="h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
        {caption}
      </div>
    );
  }

  // No illustration and no video — a caption alone would describe a
  // figure that isn't there.
  if (!children) return null;
  return (
    <div className={className}>
      {children}
      {caption}
    </div>
  );
}
