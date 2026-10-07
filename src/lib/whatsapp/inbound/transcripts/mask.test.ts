import { describe, expect, it } from 'vitest';
import { carriesContactDetails, maskContactDetails } from './mask';

describe('[CNV-006] maskContactDetails', () => {
  it('masks phone numbers however they are punctuated, and emails', () => {
    for (const text of [
      'Call +91 99860 54104 now',
      'Call +91 (99860) 54104 now',
      'Call +91.99860.54104 now',
      'Call (080) 1234 5678 now',
      'Call 9986054104 now',
    ]) {
      expect(maskContactDetails(text), text).toBe('Call [number] now');
      expect(carriesContactDetails(text), text).toBe(true);
    }
    expect(maskContactDetails('Write to sunil@example.com today')).toBe(
      'Write to [email] today'
    );
  });

  it('leaves prices, dates and short references alone', () => {
    for (const text of [
      '₹8.40 Cr · 2,400 Sq.Ft.',
      'Reviewed on 2026-10-07 at 10:14',
      'Plot #20 on 100 feet road',
      'https://x/?property_id=PROP-2ND&v=c-shirish',
    ]) {
      expect(maskContactDetails(text), text).toBe(text);
      expect(carriesContactDetails(text), text).toBe(false);
    }
  });
});
