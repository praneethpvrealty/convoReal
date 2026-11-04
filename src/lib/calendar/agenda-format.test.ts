import { describe, expect, it } from 'vitest';

import { agendaItemTitle, callablePhone, contactLine } from './agenda-format';

describe('[CAL-017] agenda contact formatting', () => {
  it('turns a stored phone into a dialable international number', () => {
    expect(callablePhone('919845012345')).toBe('+919845012345');
    expect(callablePhone('98450 12345')).toBe('+919845012345');
    expect(callablePhone('09845012345')).toBe('+919845012345');
    expect(callablePhone('+1 (415) 555-0100')).toBe('+14155550100');
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

  it('shows the name and a tappable phone', () => {
    expect(contactLine({ name: 'Pavan', phone: '9845012345' })).toBe(
      '👤 Pavan · 📞 +919845012345'
    );
    expect(contactLine({ name: 'Pavan', phone: null })).toBe('👤 Pavan');
    expect(contactLine(null)).toBeNull();
  });
});
