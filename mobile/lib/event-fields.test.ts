import { describe, it, expect } from 'vitest';

import { EVENT_TYPE_FIELDS, eventTypeFields } from './event-fields';

describe('eventTypeFields', () => {
  it('gives meetings and calls minutes, not an outcome', () => {
    expect(eventTypeFields('meeting').map((f) => f.key)).toEqual(['agenda', 'minutes']);
    expect(eventTypeFields('call').map((f) => f.key)).toEqual(['agenda', 'minutes']);
  });

  it('gives follow-ups an outcome rather than minutes', () => {
    expect(eventTypeFields('follow_up').map((f) => f.key)).toEqual(['agenda', 'outcome']);
  });

  it('gives a site visit only the outcome — nothing to plan or minute', () => {
    expect(eventTypeFields('site_visit').map((f) => f.key)).toEqual(['outcome']);
  });

  it('falls back to the generic set for an unknown or missing type', () => {
    expect(eventTypeFields(null).map((f) => f.key)).toEqual(['agenda', 'minutes']);
    expect(eventTypeFields('nonsense').map((f) => f.key)).toEqual(['agenda', 'minutes']);
  });

  it('marks every field as pre- or post-event so the UI can label it', () => {
    for (const fields of Object.values(EVENT_TYPE_FIELDS)) {
      for (const field of fields) {
        expect(['pre', 'post']).toContain(field.phase);
        expect(field.label.length).toBeGreaterThan(0);
        expect(field.placeholder.length).toBeGreaterThan(0);
      }
    }
    // agenda is always the pre-event field; minutes/outcome always post.
    for (const fields of Object.values(EVENT_TYPE_FIELDS)) {
      for (const field of fields) {
        expect(field.phase).toBe(field.key === 'agenda' ? 'pre' : 'post');
      }
    }
  });
});
