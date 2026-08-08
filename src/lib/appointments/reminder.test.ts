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
    then: (resolve: (v: { data: Row[] | null; error: null }) => unknown) => {
      if (mode === 'write') return resolve({ data: null, error: null });
      const rows = (tables[table] || []).filter((row) =>
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
      return resolve({ data: rows, error: null });
    },
  });
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

  it('falls back to the locality for a guarded listing', () => {
    // A plot is guarded by default: the showcase withholds its address,
    // so a reminder to every contact on the appointment cannot leak it.
    expect(reminderLocationText(null, plot)).toBe('Devanahalli, Bangalore');
  });

  it('gives the full address when the listing is not guarded', () => {
    expect(
      reminderLocationText(null, {
        ...plot,
        type: 'Flat/ Apartment',
        location: 'Purva Vantage, HSR Layout',
      })
    ).toBe('Purva Vantage, HSR Layout');
  });

  it('honours an explicit privacy override on a guarded type', () => {
    expect(reminderLocationText(null, { ...plot, location_privacy: 'exact' })).toBe(
      plot.location
    );
  });

  it('promises the address rather than echoing "available on request"', () => {
    // localityLabel's own fallback is showcase copy; in a reminder it
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
