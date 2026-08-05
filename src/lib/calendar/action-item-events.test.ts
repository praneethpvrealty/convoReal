import { describe, it, expect } from 'vitest';
import { coerceActionItemEvents } from './action-item-events';

describe('coerceActionItemEvents', () => {
  it('normalizes a well-formed model response', () => {
    const result = coerceActionItemEvents({
      events: [
        {
          title: 'Lawyer to send sale deed draft',
          event_type: 'document',
          start_time: '2026-08-04T14:00',
          notes: 'Soft copy with 20 lakh advance terms',
        },
        {
          title: 'Lawyer to provide legal report',
          event_type: 'document',
          start_time: '2026-08-04T17:00',
          notes: null,
        },
      ],
      liaison_name: 'Vijayasathi',
      liaison_role: 'lawyer',
    });

    expect(result.events).toHaveLength(2);
    expect(result.events[0].title).toBe('Lawyer to send sale deed draft');
    expect(result.events[0].event_type).toBe('document');
    expect(result.events[0].start_time).toBe('2026-08-04T14:00');
    expect(result.liaison_name).toBe('Vijayasathi');
    expect(result.liaison_role).toBe('lawyer');
  });

  it('returns empty result for garbage input', () => {
    expect(coerceActionItemEvents(null)).toEqual({
      events: [],
      liaison_name: null,
      liaison_role: null,
    });
    expect(coerceActionItemEvents({ events: 'nope' }).events).toEqual([]);
  });

  it('drops title-less events, rejects malformed times, and maps unknown types', () => {
    const result = coerceActionItemEvents({
      events: [
        { title: '', event_type: 'document', start_time: '2026-08-04T14:00' },
        { title: 'Follow up on khata transfer', event_type: 'paperwork', start_time: 'tomorrow' },
        { title: 'Call the registrar', event_type: 'call', start_time: '2026-08-05 11:30' },
      ],
      liaison_name: '  ',
      liaison_role: 42,
    });

    expect(result.events).toHaveLength(2);
    expect(result.events[0].title).toBe('Follow up on khata transfer');
    expect(result.events[0].event_type).toBe('document');
    expect(result.events[0].start_time).toBeNull();
    expect(result.events[1].start_time).toBe('2026-08-05 11:30');
    expect(result.liaison_name).toBeNull();
    expect(result.liaison_role).toBeNull();
  });
});
