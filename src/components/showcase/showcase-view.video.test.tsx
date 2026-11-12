// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "disableJavaScriptFileLoading": true, "disableCSSFileLoading": true } }

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { Property, ShowcaseSettings } from '@/types';
import { toPublicListingView } from '@/lib/inventory/showcase-visibility';

beforeAll(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) })
    )
  );
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';
});

vi.mock('@/lib/pulse/tracker', () => ({
  createShowcaseTracker: () => ({ track: vi.fn(), flush: vi.fn() }),
}));
vi.mock('@/components/showcase/ask-property-chat', () => ({
  AskPropertyChat: () => null,
}));
vi.mock('@/components/showcase/showcase-lead-bot', () => ({
  ShowcaseLeadBot: () => null,
}));
vi.mock('@/components/showcase/similar-properties', () => ({
  SimilarProperties: () => null,
}));
vi.mock('@/components/showcase/add-to-inventory', () => ({
  AddToInventory: () => null,
  useShowcaseImportViewers: () => ({ offersImport: false }),
}));

import { ShowcaseView } from './showcase-view';

function row(extra: Partial<Property>): Property {
  return {
    id: 'prop-1',
    account_id: 'acct-1',
    title: '10490 Sq.Ft. Plot in Upkar Layout',
    price: 45107000,
    location: 'Upkar layout, Thirumagondanahalli',
    sublocality: 'Upkar Layout',
    city: 'Bengaluru',
    type: 'Residential Land/ Plot',
    status: 'Available',
    listing_type: 'Sale',
    is_published: true,
    features: [],
    images: [],
    property_code: 'PROP-2576',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...extra,
  } as unknown as Property;
}

const settings = {
  id: 's1',
  account_id: 'acct-1',
  is_active: true,
  contact_phone: '+919900277111',
} as unknown as ShowcaseSettings;

function renderPublished(extra: Partial<Property>) {
  const property = toPublicListingView(row(extra), { revealExact: false });
  return render(
    <ShowcaseView
      properties={[property]}
      settings={settings}
      accountId="acct-1"
      initialPropertyId={property.id}
      disableSavedState
    />
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('showcase detail — listing video', () => {
  it('[MED-002] plays a stored walkthrough once the public payload has been built', () => {
    const { container } = renderPublished({
      video_url: 'property-videos/acct-1/wa-1.mp4',
      video_status: 'ready',
    });
    const video = container.querySelector('video');
    expect(video?.getAttribute('src')).toBe(
      'https://proj.supabase.co/storage/v1/object/public/property-videos/acct-1/wa-1.mp4'
    );
  });

  it('[MED-002] embeds the YouTube copy when it is ready', () => {
    const { container } = renderPublished({
      video_url: 'property-videos/acct-1/wa-1.mp4',
      video_status: 'ready',
      youtube_video_id: 'qsNMu-WsgYY',
      youtube_status: 'ready',
    });
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('iframe')?.getAttribute('src')).toBe(
      'https://www.youtube-nocookie.com/embed/qsNMu-WsgYY'
    );
  });

  it('[MED-002] shows nothing for a walkthrough still being processed', () => {
    const { container } = renderPublished({
      video_url: 'property-videos/acct-1/wa-1.mp4',
      video_status: 'processing',
    });
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
  });
});
