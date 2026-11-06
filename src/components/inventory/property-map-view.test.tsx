// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableJavaScriptFileLoading": true, "disableCSSFileLoading": true } }

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import type { Property } from '@/types';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.resetModules();
});

function listings(count: number): Property[] {
  return Array.from(
    { length: count },
    (_, i) => ({ id: `p-${i}`, title: `Listing ${i}` }) as Property
  );
}

describe('PropertyMapView', () => {
  it('[UIX-034] offers a retry when the map listings failed to load', async () => {
    const { PropertyMapView } = await import('./property-map-view');
    const onRetry = vi.fn();
    render(
      <PropertyMapView
        properties={[]}
        loading={false}
        loadFailed
        onRetry={onRetry}
        center={null}
        onOpen={vi.fn()}
        currency="INR"
      />
    );

    expect(screen.getByRole('alert').textContent).toContain(
      "Couldn't load the map listings."
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('[UIX-034] keeps the map container mounted behind the load error', async () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY', 'test-key');
    const { PropertyMapView } = await import('./property-map-view');
    const props = {
      properties: [] as Property[],
      loading: false,
      onRetry: vi.fn(),
      center: null,
      onOpen: vi.fn(),
      currency: 'INR',
    };
    const view = render(<PropertyMapView {...props} loadFailed />);
    const container = view.container.querySelector('.absolute.inset-0');
    expect(container).not.toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();

    view.rerender(<PropertyMapView {...props} loadFailed={false} />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(view.container.querySelector('.absolute.inset-0')).toBe(container);
  });

  it('[UIX-035] says the map shows only the first 100 of a larger search', async () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY', 'test-key');
    const { PropertyMapView } = await import('./property-map-view');
    render(
      <PropertyMapView
        properties={listings(100)}
        loading={false}
        total={340}
        center={null}
        onOpen={vi.fn()}
        currency="INR"
      />
    );

    expect(screen.getByRole('status').textContent).toBe(
      'Showing the first 100 of 340 listings — narrow the search to see the rest'
    );
  });

  it('[UIX-035] shows no cap notice when every result is on the map', async () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY', 'test-key');
    const { PropertyMapView } = await import('./property-map-view');
    render(
      <PropertyMapView
        properties={listings(12)}
        loading={false}
        total={12}
        center={null}
        onOpen={vi.fn()}
        currency="INR"
      />
    );

    expect(screen.queryByRole('status')).toBeNull();
  });
});
