import { describe, expect, it } from 'vitest';

import {
  inboxMessageHitMap,
  inboxSearchTerm,
  searchSnippet,
} from './inbox-search';

describe('[INB-030] inbox message search', () => {
  it('ignores a query shorter than two characters', () => {
    expect(inboxSearchTerm('  a ')).toBe('');
    expect(inboxSearchTerm(' 3bhk ')).toBe('3bhk');
  });

  it('keeps the newest hit per conversation', () => {
    const map = inboxMessageHitMap([
      {
        conversation_id: 'c1',
        message_id: 'm2',
        content_text: 'newer',
        created_at: '2026-10-05T02:00:00Z',
      },
      {
        conversation_id: 'c1',
        message_id: 'm1',
        content_text: 'older',
        created_at: '2026-10-04T02:00:00Z',
      },
    ]);
    expect(map.size).toBe(1);
    expect(map.get('c1')?.message_id).toBe('m2');
  });

  it('starts the snippet near the match so it survives truncation', () => {
    const text =
      'Hi Praveen, this is a check-in on your property enquiry with Aryavarta Ventures about the Whitefield villa';
    expect(searchSnippet(text, 'whitefield')).toBe(
      '…with Aryavarta Ventures about the Whitefield villa'
    );
    expect(searchSnippet(text, 'praveen')).toBe(text);
    expect(searchSnippet('line one\nline   two', 'two')).toBe(
      'line one line two'
    );
  });
});
