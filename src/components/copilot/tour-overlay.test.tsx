// @vitest-environment jsdom

// ============================================================
// Guards the pointer-events contract of the tour spotlight.
//
// The overlay root spans the viewport, so it also covers the cutout.
// When it was left clickable, every click on a highlighted target hit
// the overlay instead: the capture listener saw no [data-tour]
// ancestor, the step never advanced, and the Link never navigated —
// every click-target step in every tour was a dead end.
//
// WHAT THIS CANNOT DO: jsdom has no layout or hit-testing, so it
// cannot dispatch a click at a coordinate and prove which element
// receives it. These assert the property that decides that outcome,
// read through a real stylesheet via getComputedStyle rather than by
// matching class strings — so they still hold if the utility classes
// are renamed. A true hit-test needs a browser.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';

const advance = vi.fn();
const endTour = vi.fn();

let targetEl: HTMLElement | null = null;

vi.mock('./copilot-context', () => ({
  useCopilot: () => ({
    activeTour: {
      id: 'pulse',
      steps: [
        {
          target: 'nav-dashboard',
          title: 'Open the Dashboard',
          body: 'Click **Dashboard** in the menu.',
          advanceOn: 'click-target',
        },
        { target: 'x', title: 'Second', body: 'Second step.', advanceOn: 'next' },
      ],
    },
    stepIndex: 0,
    tourStatus: 'showing',
    targetEl,
    advance,
    endTour,
  }),
}));

const { TourOverlay } = await import('./tour-overlay');

/** Minimal stand-in for the two utilities the overlay relies on, so
 *  getComputedStyle reports the property the browser would apply. */
function installPointerEventUtilities() {
  const style = document.createElement('style');
  style.textContent =
    '.pointer-events-none{pointer-events:none}.pointer-events-auto{pointer-events:auto}';
  document.head.appendChild(style);
  return style;
}

function pointerEventsOf(el: Element | null): string {
  return el ? getComputedStyle(el).pointerEvents : '';
}

/** Renders and waits for the first measure — the overlay returns null
 *  until the rAF in its rect-tracking effect has run. */
async function renderOverlay() {
  const view = render(<TourOverlay />);
  await screen.findByRole('dialog');
  return view.container.firstElementChild!;
}

describe('TourOverlay pointer-events contract', () => {
  let style: HTMLStyleElement;

  beforeEach(() => {
    style = installPointerEventUtilities();
    const target = document.createElement('a');
    target.setAttribute('data-tour', 'nav-dashboard');
    target.textContent = 'Dashboard';
    document.body.appendChild(target);
    targetEl = target;
  });

  afterEach(() => {
    cleanup();
    style.remove();
    targetEl?.remove();
    targetEl = null;
  });

  it('does not let the full-viewport root swallow clicks', async () => {
    const root = await renderOverlay();

    // The regression: root covers the cutout, so anything other than
    // "none" here puts it between the user and the highlighted button.
    expect(pointerEventsOf(root)).toBe('none');
  });

  it('keeps the blockers live so clicks outside the target are still swallowed', async () => {
    const root = await renderOverlay();
    // Four rects fence the cutout: above, below, left, right.
    const blockers = Array.from(root.children).filter((el) =>
      el.classList.contains('pointer-events-auto') && el.tagName === 'DIV' && !el.id
    );

    expect(blockers).toHaveLength(4);
    for (const blocker of blockers) {
      expect(pointerEventsOf(blocker)).toBe('auto');
    }
  });

  it('keeps the tooltip card live so its buttons work', async () => {
    await renderOverlay();
    const card = document.getElementById('copilot-tour-card');

    expect(card).not.toBeNull();
    expect(pointerEventsOf(card)).toBe('auto');
    expect(screen.getByText('Open the Dashboard')).toBeTruthy();
  });

  it('leaves the cutout inert so the hole is really a hole', async () => {
    const root = await renderOverlay();
    const cutout = Array.from(root.children).find((el) =>
      el.className.includes('ring-primary')
    );

    expect(cutout).toBeTruthy();
    expect(pointerEventsOf(cutout!)).toBe('none');
  });

  it('asks the user to tap rather than offering a Next button on a click step', async () => {
    await renderOverlay();

    // A click-target step that rendered "Next" would let the user skip
    // past the very interaction the step exists to teach.
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
    expect(screen.getByText(/Tap the highlighted button/)).toBeTruthy();
  });
});
