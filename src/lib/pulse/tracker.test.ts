// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createShowcaseTracker } from './tracker';
import { isInternalView, markInternalView } from './internal-view';

const fetchMock = vi.fn(() => Promise.resolve(new Response(null)));

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('markInternalView', () => {
  it('[PRP-052] appends the internal marker to a showcase link', () => {
    expect(markInternalView('https://a.example.com/?property_id=P1')).toBe(
      'https://a.example.com/?property_id=P1&internal=1'
    );
    expect(markInternalView('https://a.example.com/')).toBe(
      'https://a.example.com/?internal=1'
    );
    expect(isInternalView('?property_id=P1&internal=1')).toBe(true);
    expect(isInternalView('?property_id=P1')).toBe(false);
  });
});

describe('createShowcaseTracker', () => {
  it('beacons events for an ordinary visitor', () => {
    window.history.replaceState(null, '', '/?property_id=P1');
    const tracker = createShowcaseTracker('acc-1', null);
    tracker.track('open');
    tracker.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('[PRP-052] sends nothing for a member opening their own listing from the app', () => {
    window.history.replaceState(null, '', '/?property_id=P1&internal=1');
    const tracker = createShowcaseTracker('acc-1', null);
    tracker.track('open');
    tracker.track('view_property', 'P1');
    tracker.flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('[PRP-052] removes the marker from the address bar so a copied link tracks the buyer', () => {
    window.history.replaceState(null, '', '/?property_id=P1&internal=1');
    createShowcaseTracker('acc-1', null);
    expect(window.location.search).toBe('?property_id=P1');
  });

  it('[PRP-052] removes the marker and stays silent when session storage is blocked', () => {
    window.history.replaceState(null, '', '/?property_id=P1&internal=1');
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('blocked');
      });
    const tracker = createShowcaseTracker('acc-1', null);
    setItem.mockRestore();
    tracker.track('open');
    tracker.flush();
    expect(window.location.search).toBe('?property_id=P1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('[PRP-052] keeps the tab internal after the marker leaves the URL', () => {
    window.history.replaceState(null, '', '/?property_id=P1&internal=1');
    createShowcaseTracker('acc-1', null);
    window.history.replaceState(null, '', '/');
    const tracker = createShowcaseTracker('acc-1', null);
    tracker.track('open');
    tracker.flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
