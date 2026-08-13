import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { requestsPropertyPhotos } from './photo-request';
import { looksLikeQuestion, requestsHumanContact } from './lead-question';
import { parseOrdinalReferences } from './shortlist-reference';
import { carriesRequirementSignal } from './buyer-qualification';
import { looksLikeSchedulingText } from '@/lib/calendar/whatsapp-scheduler';
import { isPreferenceFlowRequestText } from '@/lib/whatsapp/preference-flow';

// Whether the photos are sent is a ROUTING decision, and the routing is
// what failed in production: every individual handler behaved
// correctly, and the buyer still got "what kind of property are you
// looking for?" because the wrong one claimed the message first.
//
// processWebhook itself is 3800 lines behind a dozen live integrations
// and has no executable test in this repo — only the source-text guards
// in control-reply-order.test.ts. So the gates are tested here as the
// predicates they actually are: the real message is run through every
// branch condition standing between the qualification ladder and the
// photo reply, in the order the handler asks them.

/** Verbatim from the Adi thread, double space and all. */
const PHOTO_REQUEST = 'Sir can I get images  images';

/** The handler's inline calendar-query test (webhook-handler.ts). Read
 *  off the source rather than retyped, so a widened regex there fails
 *  here instead of silently swallowing a photo request. */
function calendarQueryRegex(): RegExp {
  const source = readFileSync(
    join(process.cwd(), 'src/lib/whatsapp/webhook-handler.ts'),
    'utf8'
  );
  const match = source.match(/const isCalendarQuery = (\/.+\/i)\.test/);
  if (!match) throw new Error('isCalendarQuery regex not found in handler');
  const body = match[1].replace(/^\//, '').replace(/\/i$/, '');
  return new RegExp(body, 'i');
}

describe('a photo request reaches the photo branch', () => {
  it('is not claimed by the qualification ladder', () => {
    // The ladder stands down on a photo request carrying no
    // requirement — the exact combination it answered with the type
    // question in production.
    expect(requestsPropertyPhotos(PHOTO_REQUEST)).toBe(true);
    expect(carriesRequirementSignal(PHOTO_REQUEST)).toBe(false);
  });

  it('is not claimed by the inbound scheduler', () => {
    // It clears the handler's !looksLikeQuestion gate — no "?", and it
    // opens with "Sir" — so it genuinely reaches the scheduler, and
    // only looksLikeSchedulingText keeps it out.
    expect(looksLikeQuestion(PHOTO_REQUEST)).toBe(false);
    expect(looksLikeSchedulingText(PHOTO_REQUEST)).toBe(false);
  });

  it('is not claimed by the calendar, preference-flow or update branches', () => {
    expect(calendarQueryRegex().test(PHOTO_REQUEST)).toBe(false);
    expect(isPreferenceFlowRequestText(PHOTO_REQUEST)).toBe(false);
    expect(/\bupdate\b/i.test(PHOTO_REQUEST)).toBe(false);
  });

  it('satisfies the lead-question branch condition, so the photos go out', () => {
    const entersBranch =
      looksLikeQuestion(PHOTO_REQUEST) ||
      requestsHumanContact(PHOTO_REQUEST) ||
      requestsPropertyPhotos(PHOTO_REQUEST) ||
      parseOrdinalReferences(PHOTO_REQUEST).length > 0;
    expect(entersBranch).toBe(true);
    // And it is the photo arm of that branch, not the Q&A arm.
    expect(requestsHumanContact(PHOTO_REQUEST)).toBe(false);
  });
});

describe('the photo branch does not steal other traffic', () => {
  it('leaves a callback request to the handover arm', () => {
    // "Call me and send the photos" asks for a person. A person
    // answers — photos alone would drop the callback on the floor.
    const text = 'Call me and send the photos';
    expect(requestsPropertyPhotos(text)).toBe(true);
    expect(requestsHumanContact(text)).toBe(true);
    const photoArm =
      requestsPropertyPhotos(text) && !requestsHumanContact(text);
    expect(photoArm).toBe(false);
  });

  it("leaves Sid's requirement to the qualification ladder", () => {
    // Verbatim from the Sid thread — the message the ladder SHOULD own.
    const text =
      'Looking for industrial / commercial lands around the peripherals with high growth potential in the mid and long term';
    expect(requestsPropertyPhotos(text)).toBe(false);
    expect(carriesRequirementSignal(text)).toBe(true);
  });

  it('leaves an agent confirming a manual send alone', () => {
    // The agent's own "Images are here…" comes back through the same
    // predicates on any thread they are mirrored into.
    expect(
      requestsPropertyPhotos(
        'Images are here. Pls let me know if you are still not able to get it'
      )
    ).toBe(false);
  });

  it('keeps a numbered photo request on its shortlist entry', () => {
    // "send photos of 2" must still resolve option 2, not the last
    // share — the branch resolves subjects before it sends anything.
    expect(requestsPropertyPhotos('send photos of option 2')).toBe(true);
    expect(parseOrdinalReferences('send photos of option 2')).toEqual([2]);
  });
});
