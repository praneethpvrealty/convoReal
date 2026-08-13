import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  routeLeadMessage,
  standsDownFromQualification,
  LEAD_ROUTE_EXPLANATIONS,
} from './lead-routing';

// The router is the one place that says which handler owns a lead's
// message. It exists because that decision used to be written twice —
// once in the ladder, once nowhere at all in the dev simulator — and
// the simulator went on showing agents a reply production had stopped
// sending.

describe('routeLeadMessage', () => {
  it('sends a photo request to the photos, not the ladder', () => {
    expect(routeLeadMessage('Sir can I get images  images')).toBe(
      'photo_request'
    );
  });

  it('sends a callback request to a person', () => {
    expect(routeLeadMessage('please call me')).toBe('callback_handover');
  });

  it('sends a numbered listing to the listing Q&A', () => {
    expect(routeLeadMessage('option 2')).toBe('shortlist_reference');
  });

  it('keeps a stated requirement with the ladder', () => {
    expect(
      routeLeadMessage(
        'Looking for industrial / commercial lands around the peripherals with high growth potential'
      )
    ).toBe('qualification');
  });

  it('treats an empty message as the ladder, which then declines it', () => {
    expect(routeLeadMessage('')).toBe('qualification');
    expect(routeLeadMessage(null)).toBe('qualification');
    expect(routeLeadMessage(undefined)).toBe('qualification');
  });
});

describe('routeLeadMessage — precedence', () => {
  it('lets a callback beat photos: a person brings the photos with them', () => {
    expect(routeLeadMessage('Call me and send the photos')).toBe(
      'callback_handover'
    );
  });

  it('lets photos beat a bare listing number', () => {
    // The subject resolver reads the ordinal separately, so routing
    // this to the photos loses nothing and answers what was asked.
    expect(routeLeadMessage('send photos of option 2')).toBe('photo_request');
  });

  it('keeps a requirement with the ladder even when photos are asked for', () => {
    // The requirement is the part only the ladder can file; the photos
    // follow from the shortlist it replies with.
    expect(
      routeLeadMessage('Looking for a villa in Whitefield, send photos')
    ).toBe('qualification');
  });
});

describe('standsDownFromQualification', () => {
  it.each([
    ['Sir can I get images  images', true],
    ['please call me', true],
    ['option 2', true],
    ['Land , 1.5 to 2cr', false],
    ['Devanahalli', false],
  ])('%s → %s', (text, expected) => {
    expect(standsDownFromQualification(text)).toBe(expected);
  });
});

describe('every route is explained for the simulator', () => {
  it.each([
    'callback_handover',
    'photo_request',
    'shortlist_reference',
    'qualification',
  ] as const)('%s', (route) => {
    expect(LEAD_ROUTE_EXPLANATIONS[route]).toBeTruthy();
  });
});

// The ladder and the webhook's photo arm are the live consumers. If
// either stops going through the router — or the webhook's photo
// condition drifts from what the router models — the simulator starts
// lying again, silently, which is the whole defect this fixes.
describe('the live handlers still route through here', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

  it('the qualification ladder stands down via the router', () => {
    const source = read('src/lib/ai/buyer-qualification.ts');
    expect(source).toContain('standsDownFromQualification(text)');
    // The inlined guards it replaced must not creep back alongside it.
    expect(source).not.toContain('requestsPropertyPhotos(text)');
    expect(source).not.toContain('parseOrdinalReferences(text).length > 0');
  });

  it("the webhook's photo arm matches the route the router assigns", () => {
    const source = read('src/lib/whatsapp/webhook-handler.ts');
    expect(source).toContain(
      'requestsPropertyPhotos(inboundText) && !requestsHumanContact(inboundText)'
    );
  });

  it('the simulator routes before it runs the ladder', () => {
    const source = read('src/app/api/dev/simulate-chatbot/route.ts');
    const routed = source.indexOf('const route = routeLeadMessage(text)');
    const ladder = source.indexOf('buildQualificationReply(');
    expect(routed).toBeGreaterThan(-1);
    expect(ladder).toBeGreaterThan(routed);
  });
});
