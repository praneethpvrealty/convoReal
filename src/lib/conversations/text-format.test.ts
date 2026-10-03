import { describe, expect, it } from 'vitest';
import {
  conversationPreview,
  parseWhatsAppFormatting,
  plainText,
} from '@/lib/conversations/text-format';

describe('parseWhatsAppFormatting', () => {
  it('renders bold, italic, strikethrough and monospace spans', () => {
    expect(parseWhatsAppFormatting('*Your Property Update*')).toEqual([
      { text: 'Your Property Update', bold: true },
    ]);
    expect(
      parseWhatsAppFormatting('Reply _STOP UPDATES_ or ~START~ to ```code```')
    ).toEqual([
      { text: 'Reply ' },
      { text: 'STOP UPDATES', italic: true },
      { text: ' or ' },
      { text: 'START', strike: true },
      { text: ' to ' },
      { text: 'code', mono: true },
    ]);
  });

  it('nests styles', () => {
    expect(parseWhatsAppFormatting('*bold and _both_*')).toEqual([
      { text: 'bold and ', bold: true },
      { text: 'both', bold: true, italic: true },
    ]);
  });

  it('leaves markers alone inside words, next to spaces, or unpaired', () => {
    expect(parseWhatsAppFormatting('snake_case_name 2*3*4')).toEqual([
      { text: 'snake_case_name 2*3*4' },
    ]);
    expect(parseWhatsAppFormatting('* not bold * and *unclosed')).toEqual([
      { text: '* not bold * and *unclosed' },
    ]);
  });

  it('never spans a line break', () => {
    expect(parseWhatsAppFormatting('*open\nclose*')).toEqual([
      { text: '*open\nclose*' },
    ]);
  });

  it('keeps the plain text intact', () => {
    const text = '*35×80 Commercial Corner Plot* on _Kolar Main Road_.';
    expect(plainText(text)).toBe(
      '35×80 Commercial Corner Plot on Kolar Main Road.'
    );
  });
});

describe('conversationPreview', () => {
  it('skips a bold-only header line, with or without an emoji prefix, and starts at the body', () => {
    const text =
      '📊 *Your Property Update*\n\nHi Adithi, here is the latest buyer activity on your listing.\n\n📈 Summary: 3 new enquiries';
    expect(
      conversationPreview(
        '*Your Property Update*\n\nHi Adithi, here is the latest buyer activity.'
      )
    ).toBe('Hi Adithi, here is the latest buyer activity.');
    expect(conversationPreview(text)).toBe(
      'Hi Adithi, here is the latest buyer activity on your listing. 📈 Summary: 3 new enquiries'
    );
    expect(
      conversationPreview(
        '📣 *Your Inventory Reach Update — 3 Oct*\n\nHi Sreenath, here is the latest buyer activity on your 5 referred listings.'
      )
    ).toBe(
      'Hi Sreenath, here is the latest buyer activity on your 5 referred listings.'
    );
  });

  it('keeps a header-only message, strips markers and collapses whitespace', () => {
    expect(conversationPreview('*Great choice* 👌')).toBe('Great choice 👌');
    expect(conversationPreview('*Only a header*')).toBe('Only a header');
    expect(conversationPreview('Hi Varun,\n\nthis is a   check-in')).toBe(
      'Hi Varun, this is a check-in'
    );
    expect(conversationPreview(null)).toBe('');
  });
});
