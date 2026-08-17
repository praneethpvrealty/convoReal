import { describe, expect, it } from 'vitest';

import { loadEligibleRadarContacts } from './manual-contacts';

function stubDb(rows: unknown[]) {
  const calls: { method: string; args: unknown[] }[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'not', 'or', 'order', 'limit']) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(resolve({ data: rows, error: null }));
  return {
    db: { from: () => builder } as never,
    calls,
  };
}

describe('loadEligibleRadarContacts', () => {
  it('applies tenant, live-requirement and consent gates to ID validation', async () => {
    const { db, calls } = stubDb([
      {
        id: 'contact-1',
        name: 'Anand',
        second_name: null,
        name_tag: null,
        phone: '+919880080211',
        classification: 'Buyer',
      },
    ]);

    const result = await loadEligibleRadarContacts(db, 'account-1', {
      ids: ['contact-1'],
      limit: 1,
    });

    expect(result).toHaveLength(1);
    expect(calls).toContainEqual({
      method: 'eq',
      args: ['account_id', 'account-1'],
    });
    expect(calls).toContainEqual({ method: 'eq', args: ['status', 'active'] });
    expect(calls).toContainEqual({
      method: 'or',
      args: ['requirement_active.is.null,requirement_active.eq.true'],
    });
    expect(calls).toContainEqual({
      method: 'or',
      args: ['buyer_alerts_consent.is.null,buyer_alerts_consent.neq.declined'],
    });
    expect(calls).toContainEqual({ method: 'in', args: ['id', ['contact-1']] });
  });

  it('drops malformed projections even if the database client returns them', async () => {
    const { db } = stubDb([
      { id: 'blank-phone', phone: '', classification: 'Buyer' },
      { id: 'wrong-role', phone: '+919999999999', classification: 'Owner' },
    ]);

    await expect(loadEligibleRadarContacts(db, 'account-1')).resolves.toEqual(
      []
    );
  });
});
