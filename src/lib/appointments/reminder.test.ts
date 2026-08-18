import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

const tables: Record<string, Row[]> = {
  appointments: [],
  contacts: [],
  message_templates: [],
};

function makeBuilder(table: string) {
  const filters: { op: string; col: string; val: unknown }[] = [];
  let mode: 'select' | 'write' = 'select';
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  Object.assign(builder, {
    select: chain,
    insert: () => {
      mode = 'write';
      return builder;
    },
    update: () => {
      mode = 'write';
      return builder;
    },
    delete: () => {
      mode = 'write';
      return builder;
    },
    or: chain,
    eq: (col: string, val: unknown) => {
      filters.push({ op: 'eq', col, val });
      return builder;
    },
    neq: (col: string, val: unknown) => {
      filters.push({ op: 'neq', col, val });
      return builder;
    },
    gt: (col: string, val: unknown) => {
      filters.push({ op: 'gt', col, val });
      return builder;
    },
    lte: (col: string, val: unknown) => {
      filters.push({ op: 'lte', col, val });
      return builder;
    },
    in: (col: string, val: unknown[]) => {
      filters.push({ op: 'in', col, val });
      return builder;
    },
    // Chainable no-ops: the fixtures are tiny and unordered, so these
    // only need to exist for the real client's call shape to work.
    order: chain,
    limit: chain,
    maybeSingle: async () => {
      if (mode === 'write') return { data: null, error: null };
      return { data: matching()[0] ?? null, error: null };
    },
    then: (resolve: (v: { data: Row[] | null; error: null }) => unknown) => {
      if (mode === 'write') return resolve({ data: null, error: null });
      return resolve({ data: matching(), error: null });
    },
  });

  function matching(): Row[] {
    return (tables[table] || []).filter((row) =>
      filters.every(({ op, col, val }) => {
        const v = row[col];
        if (op === 'eq') return v === val;
        if (op === 'neq') return v !== val;
        if (op === 'gt') return String(v) > String(val);
        if (op === 'lte') return String(v) <= String(val);
        if (op === 'in') return (val as unknown[]).includes(v);
        return true;
      })
    );
  }
  return builder;
}

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ from: (table: string) => makeBuilder(table) }),
}));

const sendWhatsAppMessageAndPersist = vi.fn();
vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: (...args: unknown[]) =>
    sendWhatsAppMessageAndPersist(...args),
}));

import {
  checkAndSendAppointmentReminders,
  reminderLocationText,
  LOCATION_TO_FOLLOW,
} from './reminder';

const NOW = new Date('2026-08-01T06:00:00Z');
const START = new Date('2026-08-01T06:30:00Z').toISOString();

function appointment(id: string, eventType: string, contactId: string): Row {
  return {
    id,
    account_id: 'acc',
    user_id: 'user',
    title: 'Discuss the villa',
    start_time: START,
    location: 'JP Nagar',
    agenda: null,
    event_type: eventType,
    contact_id: contactId,
    contact_ids: [contactId],
    status: 'scheduled',
    reminder_morning_sent: false,
    reminder_1h_sent: false,
    property: null,
    account: { name: 'Acme Realty' },
  };
}

beforeEach(() => {
  sendWhatsAppMessageAndPersist.mockReset();
  sendWhatsAppMessageAndPersist.mockResolvedValue({
    success: true,
    whatsappMessageId: 'wamid.1',
  });
  tables.appointments = [];
  tables.contacts = [
    { id: 'c-call', name: 'Ravi', phone: '+919876543210' },
    { id: 'c-visit', name: 'Meera', phone: '+919876543211' },
  ];
  tables.message_templates = [];
});

describe('checkAndSendAppointmentReminders', () => {
  it('skips client reminders for call events', async () => {
    tables.appointments = [appointment('a-call', 'call', 'c-call')];
    await checkAndSendAppointmentReminders(NOW);
    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
  });

  it('still reminds contacts on non-call events', async () => {
    tables.appointments = [
      appointment('a-call', 'call', 'c-call'),
      appointment('a-visit', 'site_visit', 'c-visit'),
    ];
    await checkAndSendAppointmentReminders(NOW);
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppMessageAndPersist.mock.calls[0][0]).toMatchObject({
      contactId: 'c-visit',
      templateName: 'property_visit_reminder',
    });
  });

  it('holds client reminders during quiet hours', async () => {
    const quietNow = new Date('2026-08-01T17:00:00Z');
    tables.appointments = [
      {
        ...appointment('a-visit', 'site_visit', 'c-visit'),
        start_time: '2026-08-01T17:30:00Z',
      },
    ];

    await checkAndSendAppointmentReminders(quietNow);

    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
  });

  it('releases a held client reminder when quiet hours end', async () => {
    const quietEnd = new Date('2026-08-02T02:30:00Z');
    tables.appointments = [
      {
        ...appointment('a-visit', 'site_visit', 'c-visit'),
        start_time: '2026-08-01T17:30:00Z',
      },
    ];

    await checkAndSendAppointmentReminders(quietEnd);

    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledTimes(1);
  });
});

describe('reminderLocationText', () => {
  const plot = {
    type: 'Residential Plot',
    location: 'Oval Reef Layout, Poojanahalli Village, Devanahalli',
    sublocality: 'Devanahalli',
    city: 'Bangalore',
    state: 'Karnataka',
  };

  it('never sends the old placeholder to a client', () => {
    // "Location: Scheduled Location" reads like a variable nobody
    // filled in, because it was one.
    expect(reminderLocationText(null, null)).not.toMatch(/scheduled location/i);
    expect(reminderLocationText('', undefined)).toBe(LOCATION_TO_FOLLOW);
  });

  it("prefers the agent's own meeting point", () => {
    expect(
      reminderLocationText('Site office gate, opposite the water tank', plot)
    ).toBe('Site office gate, opposite the water tank');
  });

  it('gives a booked visitor the full address, guard or not', () => {
    // A plot is guarded everywhere else: the showcase withholds its
    // address so a rival cannot reach the owner direct. Someone with a
    // confirmed visit is not that — we picked them, we picked the date,
    // and we are taking them to the gate.
    expect(reminderLocationText(null, plot)).toBe(plot.location);
  });

  it('gives the full address for an unguarded listing too', () => {
    expect(
      reminderLocationText(null, {
        ...plot,
        type: 'Flat/ Apartment',
        location: 'Purva Vantage, HSR Layout',
      })
    ).toBe('Purva Vantage, HSR Layout');
  });

  it('falls back to the locality when the listing has no street address', () => {
    expect(reminderLocationText(null, { ...plot, location: null })).toBe(
      'Devanahalli, Bangalore'
    );
  });

  it('promises the address rather than echoing "available on request"', () => {
    // localityLabel's own last resort is showcase copy; in a reminder it
    // answers a question the client did not ask.
    expect(
      reminderLocationText(null, {
        type: 'Residential Plot',
        sublocality: null,
        city: null,
        state: null,
      })
    ).toBe(LOCATION_TO_FOLLOW);
  });

  it('trims whitespace-only input rather than sending a blank', () => {
    expect(reminderLocationText('   ', null)).toBe(LOCATION_TO_FOLLOW);
  });
});
