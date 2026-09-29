import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

const tables: Record<string, Row[]> = {
  appointments: [],
  contacts: [],
  message_templates: [],
  appointment_reminder_log: [],
};

let claimSeq = 0;

// The one unique key the code relies on: a recipient is claimed once
// per reminder (migration 127 / 196).
function claimKey(row: Row): string {
  return [row.appointment_id, row.contact_id ?? '', row.liaison_id ?? '', row.reminder_type].join('|');
}

function makeBuilder(table: string) {
  const filters: { op: string; col: string; val: unknown }[] = [];
  let mode: 'select' | 'write' = 'select';
  let pending: { kind: 'insert' | 'update' | 'delete'; row: Row } | null = null;
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  const write = () => {
    if (!pending) return { data: null as Row | null, error: null as { code: string } | null };
    const rows = tables[table] || (tables[table] = []);
    if (pending.kind === 'insert') {
      if (
        table === 'appointment_reminder_log' &&
        rows.some((r) => claimKey(r) === claimKey(pending!.row))
      ) {
        return { data: null, error: { code: '23505' } };
      }
      const row = { id: `claim-${++claimSeq}`, created_at: new Date().toISOString(), ...pending.row };
      rows.push(row);
      return { data: row, error: null };
    }
    const hit = matching();
    if (pending.kind === 'delete') {
      tables[table] = rows.filter((r) => !hit.includes(r));
      return { data: hit[0] ?? null, error: null };
    }
    for (const r of hit) Object.assign(r, pending.row);
    return { data: hit[0] ?? null, error: null };
  };
  Object.assign(builder, {
    select: chain,
    insert: (row: Row) => {
      mode = 'write';
      pending = { kind: 'insert', row };
      return builder;
    },
    update: (row: Row) => {
      mode = 'write';
      pending = { kind: 'update', row };
      return builder;
    },
    delete: () => {
      mode = 'write';
      pending = { kind: 'delete', row: {} };
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
    lt: (col: string, val: unknown) => {
      filters.push({ op: 'lt', col, val });
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
      if (mode === 'write') return write();
      return { data: matching()[0] ?? null, error: null };
    },
    then: (resolve: (v: { data: Row[] | null; error: { code: string } | null }) => unknown) => {
      if (mode === 'write') return resolve({ data: null, error: write().error });
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
        if (op === 'lt') return String(v) < String(val);
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
    reminders_rearmed_at: null,
    property: null,
    account: { name: 'Acme Realty' },
  };
}

function claim(contactId: string, reminderType: string, createdAt: string): Row {
  return {
    id: `claim-${contactId}-${reminderType}`,
    account_id: 'acc',
    appointment_id: 'a-visit',
    contact_id: contactId,
    liaison_id: null,
    reminder_type: reminderType,
    created_at: createdAt,
    wa_message_id: 'wamid.old',
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
  tables.appointment_reminder_log = [];
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

  it('sends a contact once across ticks, holding the claim it sent under', async () => {
    tables.appointments = [appointment('a-visit', 'site_visit', 'c-visit')];
    await checkAndSendAppointmentReminders(NOW);
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledTimes(1);
    const claims = tables.appointment_reminder_log;
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ contact_id: 'c-visit', wa_message_id: 'wamid.1' });

    tables.appointments[0].reminder_morning_sent = false;
    tables.appointments[0].reminder_1h_sent = false;
    await checkAndSendAppointmentReminders(NOW);
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledTimes(1);
  });

  it('[CAL-010] after a re-arm, takes over a claim made before it and sends again — once', async () => {
    tables.appointments = [
      { ...appointment('a-visit', 'site_visit', 'c-visit'), reminders_rearmed_at: '2026-08-01T05:30:00.000Z' },
    ];
    tables.appointment_reminder_log = [
      claim('c-visit', 'morning', '2026-08-01T05:00:00.000Z'),
      claim('c-visit', '1h', '2026-08-01T05:00:00.000Z'),
    ];
    await checkAndSendAppointmentReminders(NOW);
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledTimes(1);
    const renewed = tables.appointment_reminder_log.filter((r) => r.wa_message_id === 'wamid.1');
    expect(renewed).toHaveLength(1);
    expect(String(renewed[0].created_at) > '2026-08-01T05:30:00.000Z').toBe(true);
    expect(tables.appointment_reminder_log).toHaveLength(2);

    tables.appointments[0].reminder_morning_sent = false;
    tables.appointments[0].reminder_1h_sent = false;
    await checkAndSendAppointmentReminders(NOW);
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledTimes(1);
  });

  it('[CAL-010] honours a claim made after the re-arm', async () => {
    tables.appointments = [
      { ...appointment('a-visit', 'site_visit', 'c-visit'), reminders_rearmed_at: '2026-08-01T05:30:00.000Z' },
    ];
    tables.appointment_reminder_log = [
      claim('c-visit', 'morning', '2026-08-01T05:45:00.000Z'),
      claim('c-visit', '1h', '2026-08-01T05:45:00.000Z'),
    ];
    await checkAndSendAppointmentReminders(NOW);
    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
    expect(tables.appointment_reminder_log.every((r) => r.wa_message_id === 'wamid.old')).toBe(true);
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
