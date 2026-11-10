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
