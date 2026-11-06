// @vitest-environment happy-dom

import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { SupabaseClient } from '@supabase/supabase-js';

import { emptyPropertyFormValues } from '@/lib/inventory/property-form-state';
import type { Property } from '@/types';

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), toastMock),
}));

vi.mock('@/components/inventory/property-form/client-image', () => ({
  compressImageOnClient: (file: File) => Promise.resolve(file),
}));

vi.mock('@/components/inventory/listing-video-card', () => ({
  ListingVideoCard: () => null,
}));

vi.mock('@/components/inventory/floor-plans-editor', () => ({
  FloorPlansEditor: () => null,
}));

import { MediaSection } from './media-section';

class FailingImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_value: string) {
    queueMicrotask(() => this.onerror?.());
  }
}

function storageClient(failNames: string[]) {
  const uploaded: string[] = [];
  const upload = vi.fn((path: string, file: File) => {
    if (failNames.includes(file.name)) {
      return Promise.resolve({ error: { message: 'bucket refused' } });
    }
    uploaded.push(path);
    return Promise.resolve({ error: null });
  });
  const client = {
    storage: { from: () => ({ upload }) },
  } as unknown as SupabaseClient;
  return { client, uploaded };
}

function renderSection(
  client: SupabaseClient,
  set = vi.fn(),
  property: Property | null = null,
  overrides: Partial<Parameters<typeof MediaSection>[0]> = {}
) {
  const values = emptyPropertyFormValues(null);
  const utils = render(
    <MediaSection
      values={values}
      set={set}
      property={property}
      accountId="acct-1"
      supabase={client}
      canEdit
      isLand={false}
      uploadPlanImage={vi.fn()}
      readingEKhata={false}
      eKhataInputRef={createRef<HTMLInputElement>()}
      onReadEKhata={vi.fn()}
      lockingImagePath={null}
      setLockingImagePath={vi.fn()}
      removingVideo={false}
      setRemovingVideo={vi.fn()}
      uploadingDocument={false}
      setUploadingDocument={vi.fn()}
      uploadingImage={false}
      setUploadingImage={vi.fn()}
      {...overrides}
    />
  );
  return { ...utils, set, values };
}

function file(name: string, type: string) {
  return new File(['x'], name, { type });
}

function applied<T>(set: ReturnType<typeof vi.fn>, field: string, prev: T) {
  const call = set.mock.calls.find(([key]) => key === field);
  if (!call) throw new Error(`${field} was never set`);
  const update = call[1] as T | ((p: T) => T);
  return typeof update === 'function' ? (update as (p: T) => T)(prev) : update;
}

beforeEach(() => {
  vi.stubGlobal('Image', FailingImage);
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('MediaSection uploads', () => {
  it('[UIX-030] keeps the photos that uploaded and names the one that failed', async () => {
    const { client, uploaded } = storageClient(['broken.jpg']);
    const { container, set } = renderSection(client);
    const input = container.querySelector<HTMLInputElement>(
      'input[type="file"][accept="image/*"]'
    )!;

    fireEvent.change(input, {
      target: {
        files: [
          file('front.jpg', 'image/jpeg'),
          file('broken.jpg', 'image/jpeg'),
          file('hall.jpg', 'image/jpeg'),
        ],
      },
    });

    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(uploaded).toHaveLength(2);
    const images = applied<string[]>(set, 'images', ['']);
    expect(images).toHaveLength(2);
    expect(images.every((url) => url.startsWith('property-images/'))).toBe(
      true
    );
    expect(toastMock.success).toHaveBeenCalledWith('Uploaded 2 image(s)');
    expect(toastMock.error).toHaveBeenCalledWith(
      'Couldn\'t upload "broken.jpg": bucket refused'
    );
  });

  it('[UIX-041] titles an uploaded document after its file name', async () => {
    const { client } = storageClient(['too-big.pdf']);
    const { container, set } = renderSection(client);
    const input = container.querySelector<HTMLInputElement>(
      'input[type="file"][multiple]:not([accept="image/*"])'
    )!;

    fireEvent.change(input, {
      target: {
        files: [
          file('Sale Deed 2024.pdf', 'application/pdf'),
          file('too-big.pdf', 'application/pdf'),
        ],
      },
    });

    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    const documents = applied<{ url: string; title: string }[]>(
      set,
      'documents',
      [{ url: '', title: '' }]
    );
    expect(documents).toHaveLength(1);
    expect(documents[0].title).toBe('Sale Deed 2024');
    expect(documents[0].url).toMatch(/^property-documents\/acct-1\/doc-/);
  });

  it('[UIX-033] asks before removing the listing video', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const confirmMock = vi.fn(() => false);
    vi.stubGlobal('confirm', confirmMock);
    const { client } = storageClient([]);
    const { getByTitle } = renderSection(client, vi.fn(), {
      id: 'prop-1',
      video_url: 'property-videos/acct-1/v.mp4',
      video_status: 'ready',
    } as Property);

    fireEvent.click(getByTitle('Remove video'));

    expect(confirmMock).toHaveBeenCalledWith(
      'Remove the listing video? It stops playing in the Showcase.'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
