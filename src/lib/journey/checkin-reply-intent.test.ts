import { describe, expect, it } from 'vitest';
import {
  asksToCloseEnquiry,
  readCheckinEnding,
  readsAsStillConsidering,
  reportsListingSold,
} from './checkin-reply-intent';

describe('[JRN-023] reading a typed answer to the check-in', () => {
  it.each([
    'You said its already sold',
    'You said it’s already sold',
    "It's sold",
    'The plot is sold',
    'This was sold last week',
    'Heard it has been sold',
    'Already sold na',
    'Sold out',
    'This property is no longer available',
    'It got sold',
    'Your agent told me it is already booked',
    'The plot is gone',
    'Plot already sold',
  ])('reads %j as the listing being gone', (text) => {
    expect(reportsListingSold(text)).toBe(true);
    expect(readCheckinEnding(text)).toBe('sold');
  });

  it.each([
    'It is not sold yet, right',
    'It is not already sold',
    "It hasn't actually been sold",
    "It hasn't been sold",
    'I already booked a site visit',
    'Already booked the slot for Saturday',
    "I've already gone to see it",
    "I've already gone through the documents and am still considering",
    "I've already taken it to my lawyer",
    "It's booked for Saturday",
    'I sold my old flat to fund this',
    'Still interested',
    'Not interested',
  ])('does not read %j as the listing being gone', (text) => {
    expect(reportsListingSold(text)).toBe(false);
  });

  it.each([
    'Please close my enquiry',
    'Can you close my enquiry?',
    'Close the inquiry',
    'No more updates please',
    'Stop sending messages',
    'Not looking anymore',
    'I am no longer looking',
    'Bought elsewhere',
    'We already bought a flat in Whitefield',
    'Already purchased another property',
  ])('reads %j as asking to close the enquiry', (text) => {
    expect(asksToCloseEnquiry(text)).toBe(true);
    expect(readCheckinEnding(text)).toBe('close');
  });

  it.each([
    'We will close it soon',
    'No updates from my side yet',
    'Already finalised the loan',
    'Still looking at options',
    'Already booked a site visit',
  ])('does not read %j as asking to close the enquiry', (text) => {
    expect(asksToCloseEnquiry(text)).toBe(false);
  });

  it.each([
    'Yes',
    'Yes still interested',
    'Ok',
    'Still considering',
    'Discussing with family',
    'Will let you know',
    "I'll get back next week",
    'Travelling, need some time',
    'Not yet decided',
    '👍',
    'Thanks',
  ])('reads %j as still considering', (text) => {
    expect(readsAsStillConsidering(text)).toBe(true);
  });

  it.each([
    'No',
    'Why did you send this?',
    'Who is this',
    'Wrong number',
    'Price is too much compared to the other one',
  ])('leaves %j for a person to answer', (text) => {
    expect(readsAsStillConsidering(text)).toBe(false);
    expect(readCheckinEnding(text)).toBeNull();
  });
});
