// @vitest-environment happy-dom

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LeadBot } from '@/components/chat/lead-bot';

afterEach(cleanup);

describe('LeadBot', () => {
  it('does not throw when the thread element has no scrollTo method', () => {
    const original = Element.prototype.scrollTo;
    // @ts-expect-error - simulating a browser/webview without Element.scrollTo
    delete Element.prototype.scrollTo;

    try {
      expect(() =>
        render(
          <LeadBot
            variant="inline"
            title="Chat with us"
            messages={[{ id: '1', role: 'bot', text: 'Hi there' }]}
            onChip={vi.fn()}
            onSend={vi.fn()}
          />
        )
      ).not.toThrow();
    } finally {
      Element.prototype.scrollTo = original;
    }
  });
});

describe('[PRP-058] floating launcher yields the bottom edge', () => {
  const props = {
    variant: 'floating' as const,
    title: 'Property assistant',
    launcherLabel: 'Find my property',
    messages: [{ id: '1', role: 'bot' as const, text: 'Hi there' }],
    onChip: vi.fn(),
    onSend: vi.fn(),
  };

  it('renders nothing while hidden and closed, so a listing footer is never covered', () => {
    const { queryByRole } = render(<LeadBot {...props} launcherHidden />);
    expect(queryByRole('button', { name: /find my property/i })).toBeNull();
    expect(document.querySelector('[data-floating-lead-bot]')).toBeNull();
  });

  it('keeps an open chat on screen even while hidden', () => {
    const { getByText } = render(
      <LeadBot {...props} launcherHidden defaultOpen />
    );
    expect(getByText('Property assistant')).toBeTruthy();
  });

  it('shows the launcher again once no longer hidden', () => {
    const { rerender, queryByRole, getByRole } = render(
      <LeadBot {...props} launcherHidden />
    );
    expect(queryByRole('button', { name: /find my property/i })).toBeNull();
    rerender(<LeadBot {...props} launcherHidden={false} />);
    expect(getByRole('button', { name: /find my property/i })).toBeTruthy();
  });
});

describe('[PRP-020] floating launcher shrinks once the page scrolls', () => {
  const props = {
    variant: 'floating' as const,
    title: 'Property assistant',
    launcherLabel: 'Find my property',
    messages: [{ id: '1', role: 'bot' as const, text: 'Hi there' }],
    onChip: vi.fn(),
    onSend: vi.fn(),
  };

  function scrollTo(y: number) {
    Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
    window.dispatchEvent(new Event('scroll'));
  }

  afterEach(() => scrollTo(0));

  it('drops to its icon below the fold and keeps its accessible name', () => {
    const { getByRole } = render(
      <LeadBot {...props} launcherCompactOnScroll />
    );
    const launcher = getByRole('button', { name: /find my property/i });
    expect(launcher.textContent).toContain('Find my property');
    act(() => scrollTo(600));
    const compact = getByRole('button', { name: /find my property/i });
    expect(compact.textContent).toBe('');
    expect(compact.getAttribute('data-compact')).toBe('true');
    act(() => scrollTo(0));
    expect(
      getByRole('button', { name: /find my property/i }).textContent
    ).toContain('Find my property');
  });

  it('keeps its label when not asked to shrink', () => {
    const { getByRole } = render(<LeadBot {...props} />);
    act(() => scrollTo(600));
    expect(
      getByRole('button', { name: /find my property/i }).textContent
    ).toContain('Find my property');
  });
});

describe('[PRP-020] floating launcher moves off controls underneath it', () => {
  const props = {
    variant: 'floating' as const,
    title: 'Property assistant',
    launcherLabel: 'Find my property',
    messages: [{ id: '1', role: 'bot' as const, text: 'Hi there' }],
    onChip: vi.fn(),
    onSend: vi.fn(),
  };

  function rect(top: number, bottom: number) {
    return {
      top,
      bottom,
      left: 300,
      right: 348,
      width: 48,
      height: bottom - top,
      x: 300,
      y: top,
      toJSON: () => ({}),
    } as DOMRect;
  }

  it('lifts above a button that scrolls under it and drops back once clear', () => {
    const control = document.createElement('button');
    document.body.appendChild(control);
    control.getBoundingClientRect = () => rect(720, 768);
    let covered = true;
    const original = document.elementsFromPoint;
    document.elementsFromPoint = (x: number, y: number) =>
      covered && y >= 720 && y <= 768 ? [control] : [];
    const originalFrame = window.requestAnimationFrame;
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    };
    try {
      const { getByRole } = render(
        <LeadBot {...props} launcherDodgesControls />
      );
      const launcher = getByRole('button', { name: /find my property/i });
      const container = document.querySelector<HTMLElement>(
        '[data-floating-lead-bot]'
      );
      const lift = () => container?.getAttribute('data-lift');
      const layout = (element: HTMLElement, values: Record<string, number>) => {
        for (const [key, value] of Object.entries(values)) {
          Object.defineProperty(element, key, {
            value,
            configurable: true,
          });
        }
      };
      if (container) layout(container, { offsetTop: 640, offsetHeight: 108 });
      layout(launcher, { offsetHeight: 48 });
      launcher.getBoundingClientRect = () => {
        const current = Number(lift() ?? 0);
        return rect(700 - current, 748 - current);
      };
      act(() => {
        window.dispatchEvent(new Event('scroll'));
      });
      expect(lift()).toBe('36');
      covered = false;
      act(() => {
        window.dispatchEvent(new Event('scroll'));
      });
      expect(lift()).toBeNull();
    } finally {
      document.elementsFromPoint = original;
      window.requestAnimationFrame = originalFrame;
      control.remove();
    }
  });

  it('does not move when the page has not asked it to dodge', () => {
    render(<LeadBot {...props} />);
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(
      document
        .querySelector('[data-floating-lead-bot]')
        ?.getAttribute('data-lift')
    ).toBeNull();
  });
});
