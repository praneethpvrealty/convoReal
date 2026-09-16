// @vitest-environment happy-dom

import { cleanup, render } from '@testing-library/react';
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
