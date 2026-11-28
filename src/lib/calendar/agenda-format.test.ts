import { describe, expect, it } from 'vitest';

import {
  agendaItemTitle,
  callablePhone,
  contactLine,
  overdueText,
} from './agenda-format';

describe('[CAL-017] agenda contact formatting', () => {
  it('turns a stored phone into a dialable international number', () => {
    expect(callablePhone('919845012345')).toBe('+919845012345');
    expect(callablePhone('98450 12345')).toBe('+919845012345');
    expect(callablePhone('09845012345')).toBe('+919845012345');
    expect(callablePhone('+1 (415) 555-0100')).toBe('+14155550100');
    expect(callablePhone('+65 8123 4567')).toBe('+6581234567');
    expect(callablePhone('0065 8123 4567')).toBe('+6581234567');
    expect(callablePhone('123')).toBeNull();
    expect(callablePhone(null)).toBeNull();
  });

  it('drops the @mention once the contact is shown on its own line', () => {
    const contact = { name: 'Gouri Shankar', phone: '919845012345' };
    expect(
      agendaItemTitle('New Buyer Requirements - @Gouri Shankar', contact)
    ).toBe('New Buyer Requirements');
    expect(agendaItemTitle('Follow up with Kusumaraju', contact)).toBe(
      'Follow up with Kusumaraju'
    );
    expect(agendaItemTitle('New Buyer Requirements - @Gouri', null)).toBe(
      'New Buyer Requirements - @Gouri'
    );
  });

  it('drops only a trailing property label from the title', () => {
    const property = { id: 'p1', title: 'HSR Plot', property_code: 'PROP-1' };
    expect(
      agendaItemTitle('Follow up with Anil — HSR Plot (PROP-1)', null, property)
    ).toBe('Follow up with Anil');
    expect(
      agendaItemTitle('Follow up with Anil — HSR Plot', null, property)
    ).toBe('Follow up with Anil');
    expect(
      agendaItemTitle(
        'Documents — HSR Plot: collect the signed sale deed',
        null,
        property
      )
    ).toBe('Documents — HSR Plot: collect the signed sale deed');
    expect(agendaItemTitle('HSR Plot (PROP-1)', null, property)).toBe(
      'HSR Plot (PROP-1)'
    );
  });

  it('counts overdue days from the start of the IST day, whatever the timestamp format', () => {
    const dayStart = '2026-11-27T18:30:00.000Z';
    expect(overdueText('2026-07-02T06:00:00+00:00', dayStart)).toBe(
      'Due 2 Jul · 149 days overdue'
    );
    expect(overdueText('2026-11-27T18:29:59+00:00', dayStart)).toBe(
      'Due 27 Nov · 1 day overdue'
    );
    expect(overdueText('2026-11-27T18:30:00+00:00', dayStart)).toBeNull();
    expect(overdueText('2026-11-28T06:00:00.000Z', dayStart)).toBeNull();
    expect(overdueText(null, dayStart)).toBeNull();
    expect(overdueText('2026-07-02T06:00:00+00:00', null)).toBeNull();
  });

  it('shows the name and a tappable phone', () => {
    expect(contactLine({ name: 'Pavan', phone: '9845012345' })).toBe(
      '👤 Pavan · 📞 +919845012345'
    );
    expect(contactLine({ name: 'Pavan', phone: null })).toBe('👤 Pavan');
    expect(contactLine(null)).toBeNull();
  });
});
