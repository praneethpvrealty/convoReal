// @vitest-environment happy-dom

// ============================================================
// Guards what StepMedia renders in each of its three states.
//
// The caption used to appear only under a video player, so every
// illustration shipped unlabelled — and the captions written ahead of
// the recordings were invisible until the day a video landed. These
// pin the three outcomes: illustration + caption, player + caption,
// and nothing at all when a slot has neither.
// ============================================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';

import { StepMedia } from './step-media';

// Both halves of the registry lookup are stubbed: the slug map so
// these don't move whenever real captions are edited, and the embed
// URL so happy-dom isn't handed a youtube.com iframe it will try to
// fetch — the URL normalisation itself is covered in media.test.ts.
vi.mock('@/lib/onboarding/media', () => ({
  getOnboardingMedia: (slug: string) => ({
    videoUrl:
      slug === 'recorded' ? 'https://www.youtube.com/watch?v=abc123' : null,
    caption: 'Caption text',
  }),
  toEmbedUrl: () => 'about:blank',
}));

afterEach(cleanup);

describe('StepMedia', () => {
  it('captions an illustration while its video is unrecorded', () => {
    const { container } = render(
      // @ts-expect-error — a stand-in slug, resolved by the mock above.
      <StepMedia slug="unrecorded" title="Step">
        <div data-testid="illustration" />
      </StepMedia>
    );

    expect(screen.getByTestId('illustration')).toBeTruthy();
    expect(screen.getByText('Caption text')).toBeTruthy();
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('carries the same caption over to the player once recorded', () => {
    const { container } = render(
      // @ts-expect-error — a stand-in slug, resolved by the mock above.
      <StepMedia slug="recorded" title="Step">
        <div data-testid="illustration" />
      </StepMedia>
    );

    // The video replaces the illustration rather than joining it.
    expect(container.querySelector('iframe')).toBeTruthy();
    expect(screen.queryByTestId('illustration')).toBeNull();
    expect(screen.getByText('Caption text')).toBeTruthy();
  });

  it('stays silent when a slot has neither illustration nor video', () => {
    // A caption alone would describe a figure that isn't there.
    const { container } = render(
      // @ts-expect-error — a stand-in slug, resolved by the mock above.
      <StepMedia slug="unrecorded" title="Step" />
    );

    expect(container.innerHTML).toBe('');
  });
});
