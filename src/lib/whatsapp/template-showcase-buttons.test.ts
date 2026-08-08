import { describe, expect, it } from 'vitest';
import { withShowcaseOrigin } from './template-showcase-buttons';

const APP = ['https://www.convoreal.com'];
const SHOWCASE = 'https://aryavartaventures.convoreal.com';

describe('withShowcaseOrigin', () => {
  it('moves the real approved button onto the brokerage subdomain', () => {
    // Exactly what property_enquiry_response carries today.
    expect(
      withShowcaseOrigin('https://www.convoreal.com/{{1}}', SHOWCASE, APP)
    ).toBe('https://aryavartaventures.convoreal.com/{{1}}');
  });

  it('keeps the placeholder so the send can still fill it', () => {
    // The button parameter arrives as "?property_id=…&v=…", so the
    // placeholder has to survive in place or the link resolves to
    // nothing.
    const out = withShowcaseOrigin('https://www.convoreal.com/{{2}}', SHOWCASE, APP);
    expect(out).toContain('{{2}}');
    expect(out.startsWith(SHOWCASE)).toBe(true);
  });

  it('never leaves a query on the base — that would break the suffix', () => {
    const out = withShowcaseOrigin('https://www.convoreal.com/{{1}}', SHOWCASE, APP);
    expect(out).not.toContain('?');
  });

  it('leaves the URL alone when the account has no subdomain', () => {
    expect(
      withShowcaseOrigin(
        'https://www.convoreal.com/{{1}}',
        'https://www.convoreal.com',
        APP
      )
    ).toBe('https://www.convoreal.com/{{1}}');
  });

  it('does not redirect a link that was never ours', () => {
    // A template deliberately pointing at a portal, a RERA page or a
    // partner site is not ours to move.
    for (const url of [
      'https://magicbricks.com/{{1}}',
      'https://rera.karnataka.gov.in/projectDetails',
      'https://wa.me/919999999999',
    ]) {
      expect(withShowcaseOrigin(url, SHOWCASE, APP), url).toBe(url);
    }
  });

  it('preserves a real path rather than flattening it to the root', () => {
    expect(
      withShowcaseOrigin('https://www.convoreal.com/property/{{1}}', SHOWCASE, APP)
    ).toBe('https://aryavartaventures.convoreal.com/property/{{1}}');
  });

  it('matches any configured app origin, not just the first', () => {
    expect(
      withShowcaseOrigin('https://app.convoreal.com/{{1}}', SHOWCASE, [
        'https://www.convoreal.com',
        'https://app.convoreal.com',
      ])
    ).toBe('https://aryavartaventures.convoreal.com/{{1}}');
  });

  it('returns an unparseable url untouched rather than guessing', () => {
    expect(withShowcaseOrigin('not a url {{1}}', SHOWCASE, APP)).toBe(
      'not a url {{1}}'
    );
  });

  it('survives a malformed configured origin', () => {
    expect(
      withShowcaseOrigin('https://www.convoreal.com/{{1}}', SHOWCASE, [
        'nonsense',
        'https://www.convoreal.com',
      ])
    ).toBe('https://aryavartaventures.convoreal.com/{{1}}');
  });

  it('tolerates a trailing slash on the showcase origin', () => {
    expect(
      withShowcaseOrigin('https://www.convoreal.com/{{1}}', `${SHOWCASE}/`, APP)
    ).toBe('https://aryavartaventures.convoreal.com/{{1}}');
  });
});
