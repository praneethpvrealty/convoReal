// @vitest-environment happy-dom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReplyQuote } from './reply-quote';

describe('ReplyQuote [INB-027]', () => {
  it('renders the quoted digest header in bold without its asterisks', () => {
    const { container } = render(
      <ReplyQuote
        authorLabel="You"
        preview={
          '📊 *Your Property Update*\n\nHi Yusuf, buyers liked *35x80 Corner Plot* and _2 others_.'
        }
      />
    );
    const bold = [...container.querySelectorAll('strong')].map(
      (el) => el.textContent
    );
    expect(bold).toEqual(['Your Property Update', '35x80 Corner Plot']);
    expect(container.querySelector('em')?.textContent).toBe('2 others');
    expect(container.textContent).not.toContain('*');
    expect(container.textContent).not.toContain('_2 others_');
  });

  it('leaves the composer chip dismissable', () => {
    const { getByLabelText } = render(
      <ReplyQuote authorLabel="Asha" preview="*Hello*" onDismiss={() => {}} />
    );
    expect(getByLabelText('Cancel reply')).toBeTruthy();
  });
});
