import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

const tables: Record<string, Row[]> = {
  appointments: [],
  contacts: [],
  message_templates: [],
  appointment_reminder_log: [],
  conversations: [],
};

let claimSeq = 0;
const hooks: { beforeClaim?: () => void; onAppointmentRead?: () => void } = {};

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
      if (table === 'appointment_reminder_log') hooks.beforeClaim?.();
      if (
        table === 'appointment_reminder_log' &&
        rows.some((r) => claimKey(r) === claimKey(pending!.row))
      ) {
        return { data: null, error: { code: '23505' } };
      }
      const row = { id: `claim-${++claimSeq}`, created_at: new Date().toISOString(), ...pending.row };
      rows.push(row);
      return { data: { ...row }, error: null };
    }
    const hit = matching();
    if (pending.kind === 'delete') {
      tables[table] = rows.filter((r) => !hit.includes(r));
      return { data: hit[0] ? { ...hit[0] } : null, error: null };
    }
    for (const r of hit) Object.assign(r, pending.row);
    return { data: hit[0] ? { ...hit[0] } : null, error: null };
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
    is: (col: string, val: unknown) => {
      filters.push({ op: 'is', col, val });
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
    // Reads hand out copies, as the real client does: a sweep holds
    // the row as it read it, not a live view of the table.
    maybeSingle: async () => {
      if (mode === 'write') return write();
      if (table === 'appointments') hooks.onAppointmentRead?.();
      const hit = matching()[0];
      return { data: hit ? { ...hit } : null, error: null };
    },
    then: (resolve: (v: { data: Row[] | null; error: { code: string } | null }) => unknown) => {
      if (mode === 'write') return resolve({ data: null, error: write().error });
      return resolve({ data: matching().map((r) => ({ ...r })), error: null });
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
        if (op === 'is') return val === null ? v == null : v === val;
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

const enqueueReminderAudioJob = vi.fn();
vi.mock('@/lib/voice/reminder-audio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/voice/reminder-audio')>()),
  enqueueReminderAudioJob: (...args: unknown[]) => enqueueReminderAudioJob(...args),
}));
vi.mock('@/lib/voice/config', () => ({
  getVoiceConfig: async () => ({ reminder_audio_enabled: true }),
}));

import {
  buildReminderTemplateContent,
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

function claim(
  contactId: string,
  reminderType: string,
  createdAt: string,
  rearmedAt: string | null = null,
  sentAt: string | null = createdAt
): Row {
  return {
    id: `claim-${contactId}-${reminderType}`,
    account_id: 'acc',
    appointment_id: 'a-visit',
    contact_id: contactId,
    liaison_id: null,
    reminder_type: reminderType,
    created_at: createdAt,
    rearmed_at: rearmedAt,
    sent_at: sentAt,
    wa_message_id: 'wamid.old',
    prior_wa_message_ids: ['wamid.older'],
  };
}

const REARMED_AT = '2026-08-01T05:30:00.000Z';

beforeEach(() => {
  enqueueReminderAudioJob.mockReset();
  enqueueReminderAudioJob.mockResolvedValue(true);
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
  tables.conversations = [];
  hooks.beforeClaim = undefined;
  hooks.onAppointmentRead = undefined;
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
    expect(typeof claims[0].sent_at).toBe('string');

    tables.appointments[0].reminder_morning_sent = false;
    tables.appointments[0].reminder_1h_sent = false;
    await checkAndSendAppointmentReminders(NOW);
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledTimes(1);
  });

  it('[CAL-010] after a re-arm, takes over a claim from the earlier generation and sends again — once', async () => {
    tables.appointments = [
      { ...appointment('a-visit', 'site_visit', 'c-visit'), reminders_rearmed_at: REARMED_AT },
    ];
    tables.appointment_reminder_log = [
      claim('c-visit', 'morning', '2026-08-01T05:00:00.000Z'),
      claim('c-visit', '1h', '2026-08-01T05:00:00.000Z'),
    ];
    await checkAndSendAppointmentReminders(NOW);
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledTimes(1);
    const renewed = tables.appointment_reminder_log.filter((r) => r.wa_message_id === 'wamid.1');
    expect(renewed).toHaveLength(1);
    expect(renewed[0]).toMatchObject({ rearmed_at: REARMED_AT, prior_wa_message_ids: [] });
    expect(String(renewed[0].created_at) > REARMED_AT).toBe(true);
    expect(tables.appointment_reminder_log).toHaveLength(2);

    tables.appointments[0].reminder_morning_sent = false;
    tables.appointments[0].reminder_1h_sent = false;
    await checkAndSendAppointmentReminders(NOW);
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledTimes(1);
  });

  it('[CAL-010] a re-arm landing mid-sweep releases the claim and leaves the flags for the next sweep', async () => {
    tables.appointments = [appointment('a-visit', 'site_visit', 'c-visit')];
    hooks.beforeClaim = () => {
      tables.appointments[0].reminders_rearmed_at = new Date().toISOString();
      tables.appointments[0].start_time = '2026-08-01T07:30:00Z';
    };
    await checkAndSendAppointmentReminders(NOW);
    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
    expect(tables.appointment_reminder_log).toHaveLength(0);
    expect(tables.appointments[0]).toMatchObject({
      reminder_morning_sent: false,
      reminder_1h_sent: false,
    });

    hooks.beforeClaim = undefined;
    await checkAndSendAppointmentReminders(new Date('2026-08-01T07:00:00Z'));
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledTimes(1);
    expect(tables.appointments[0].reminder_1h_sent).toBe(true);
  });

  it('[CAL-010] a stale sweep letting go never takes a renewed claim with it', async () => {
    tables.appointments = [appointment('a-visit', 'site_visit', 'c-visit')];
    hooks.onAppointmentRead = () => {
      if (tables.appointment_reminder_log.length === 0) return;
      hooks.onAppointmentRead = undefined;
      const rearmedAt = new Date().toISOString();
      tables.appointments[0].reminders_rearmed_at = rearmedAt;
      for (const row of tables.appointment_reminder_log) {
        row.created_at = new Date(Date.parse(rearmedAt) + 1).toISOString();
        row.wa_message_id = 'wamid.fresh';
      }
    };
    await checkAndSendAppointmentReminders(NOW);
    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
    expect(tables.appointment_reminder_log).toHaveLength(1);
    expect(tables.appointment_reminder_log[0].wa_message_id).toBe('wamid.fresh');
    expect(tables.appointments[0].reminder_1h_sent).toBe(false);
  });

  it('[CAL-010] a claim a stale sweep made after the re-arm is taken over, not counted as coverage', async () => {
    tables.appointments = [
      { ...appointment('a-visit', 'site_visit', 'c-visit'), reminders_rearmed_at: REARMED_AT },
    ];
    tables.appointment_reminder_log = [
      claim('c-visit', 'morning', '2026-08-01T05:45:00.000Z'),
      claim('c-visit', '1h', '2026-08-01T05:45:00.000Z'),
    ];
    await checkAndSendAppointmentReminders(NOW);
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledTimes(1);
    expect(
      tables.appointment_reminder_log.filter((r) => r.rearmed_at === REARMED_AT)
    ).toHaveLength(1);
  });

  it('[CAL-010] a sweep from an earlier generation never takes over a current claim', async () => {
    tables.appointments = [appointment('a-visit', 'site_visit', 'c-visit')];
    tables.appointment_reminder_log = [
      claim('c-visit', 'morning', '2026-08-01T05:45:00.000Z', REARMED_AT),
      claim('c-visit', '1h', '2026-08-01T05:45:00.000Z', REARMED_AT),
    ];
    hooks.onAppointmentRead = () => {
      tables.appointments[0].reminders_rearmed_at = REARMED_AT;
    };
    await checkAndSendAppointmentReminders(NOW);
    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
    expect(tables.appointment_reminder_log).toHaveLength(2);
    expect(
      tables.appointment_reminder_log.every(
        (r) => r.rearmed_at === REARMED_AT && r.wa_message_id === 'wamid.old'
      )
    ).toBe(true);
    expect(tables.appointments[0]).toMatchObject({
      reminder_morning_sent: false,
      reminder_1h_sent: false,
    });
  });

  it('[CAL-010] retries a claim of the current generation whose send was never confirmed, after the grace period', async () => {
    tables.appointments = [appointment('a-visit', 'site_visit', 'c-visit')];
    const longAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    tables.appointment_reminder_log = [
      claim('c-visit', 'morning', longAgo, null, null),
      claim('c-visit', '1h', longAgo, null, null),
    ];
    await checkAndSendAppointmentReminders(NOW);
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledTimes(1);
    const retried = tables.appointment_reminder_log.filter((r) => typeof r.sent_at === 'string');
    expect(retried).toHaveLength(1);
    expect(retried[0].prior_wa_message_ids).toEqual(['wamid.older']);
  });

  it('[CAL-010] leaves a fresh unconfirmed claim to its owner', async () => {
    tables.appointments = [appointment('a-visit', 'site_visit', 'c-visit')];
    const justNow = new Date(Date.now() - 60 * 1000).toISOString();
    tables.appointment_reminder_log = [
      claim('c-visit', 'morning', justNow, null, null),
      claim('c-visit', '1h', justNow, null, null),
    ];
    await checkAndSendAppointmentReminders(NOW);
    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
  });

  it('[CAL-010] honours a claim from the current generation', async () => {
    tables.appointments = [
      { ...appointment('a-visit', 'site_visit', 'c-visit'), reminders_rearmed_at: REARMED_AT },
    ];
    tables.appointment_reminder_log = [
      claim('c-visit', 'morning', '2026-08-01T05:45:00.000Z', REARMED_AT),
      claim('c-visit', '1h', '2026-08-01T05:45:00.000Z', REARMED_AT),
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

describe('reminder wording', () => {
  const linkedProperty = {
    id: 'p-1',
    title: '50x70 Commercial Land in 6th Block, Koramangala',
    type: 'Commercial Land',
    location: null,
    sublocality: 'Koramangala',
    city: 'Bangalore',
    state: 'Karnataka',
  };

  it("[CAL-013] names a meeting by the agent's title, not the linked property's", async () => {
    tables.appointments = [
      {
        ...appointment('a-meet', 'meeting', 'c-visit'),
        title: 'Sub registrar visit',
        property: linkedProperty,
      },
    ];
    await checkAndSendAppointmentReminders(NOW);
    const sent = sendWhatsAppMessageAndPersist.mock.calls[0][0];
    expect(sent.templateParams[1]).toBe('Sub registrar visit');
    expect(sent.text).toContain('"Sub registrar visit"');
  });

  it('[CAL-013] still names a site visit by its property', async () => {
    tables.appointments = [
      { ...appointment('a-visit', 'site_visit', 'c-visit'), property: linkedProperty },
    ];
    await checkAndSendAppointmentReminders(NOW);
    expect(sendWhatsAppMessageAndPersist.mock.calls[0][0].templateParams[1]).toBe(
      linkedProperty.title
    );
  });

  it('[CAL-013] does not ask a client who already confirmed to confirm again', async () => {
    tables.appointments = [
      {
        ...appointment('a-meet', 'meeting', 'c-visit'),
        client_confirmed_at: '2026-08-01T03:21:00Z',
      },
    ];
    tables.conversations = [
      { account_id: 'acc', contact_id: 'c-visit', last_customer_message_at: new Date().toISOString() },
    ];
    await checkAndSendAppointmentReminders(NOW);
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledTimes(1);
    const sent = sendWhatsAppMessageAndPersist.mock.calls[0][0];
    expect(sent.kind).toBe('text');
    expect(sent.text).toContain('Thanks for confirming');
    expect(sent.text).not.toMatch(/tap a button/i);
    expect(tables.appointment_reminder_log[0]).toMatchObject({ wa_message_id: 'wamid.1' });
  });

  it('[CAL-013] thanks a confirmed client in text even when they prefer audio notes', async () => {
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    tables.contacts = [
      {
        id: 'c-visit',
        name: 'Meera',
        phone: '+919876543211',
        preferred_update_channel: 'whatsapp_audio',
      },
    ];
    tables.appointments = [
      {
        ...appointment('a-meet', 'meeting', 'c-visit'),
        client_confirmed_at: '2026-08-01T03:21:00Z',
      },
    ];
    tables.conversations = [
      { account_id: 'acc', contact_id: 'c-visit', last_customer_message_at: new Date().toISOString() },
    ];
    try {
      await checkAndSendAppointmentReminders(NOW);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(enqueueReminderAudioJob).not.toHaveBeenCalled();
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppMessageAndPersist.mock.calls[0][0]).toMatchObject({ kind: 'text' });
    expect(sendWhatsAppMessageAndPersist.mock.calls[0][0].text).toContain('Thanks for confirming');
  });

  it('[CAL-013] falls back to the template for a confirmed client outside the 24-hour window', async () => {
    tables.appointments = [
      {
        ...appointment('a-meet', 'meeting', 'c-visit'),
        client_confirmed_at: '2026-07-30T03:21:00Z',
      },
    ];
    tables.conversations = [
      { account_id: 'acc', contact_id: 'c-visit', last_customer_message_at: '2026-07-30T03:21:00Z' },
    ];
    await checkAndSendAppointmentReminders(NOW);
    expect(sendWhatsAppMessageAndPersist.mock.calls[0][0]).toMatchObject({
      kind: 'template',
      templateName: 'appointment_reminder',
    });
  });

  it('[CAL-013] keeps asking every recipient when only the appointment, not each contact, is confirmed', async () => {
    tables.appointments = [
      {
        ...appointment('a-meet', 'meeting', 'c-visit'),
        contact_ids: ['c-visit', 'c-call'],
        client_confirmed_at: '2026-08-01T03:21:00Z',
      },
    ];
    tables.conversations = [
      { account_id: 'acc', contact_id: 'c-visit', last_customer_message_at: new Date().toISOString() },
    ];
    await checkAndSendAppointmentReminders(NOW);
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledTimes(2);
    for (const [args] of sendWhatsAppMessageAndPersist.mock.calls) {
      expect(args.kind).toBe('template');
    }
  });

  it('[CAL-013] does not thank a contact for a confirmation another recipient may have made', async () => {
    tables.contacts.push({ id: 'c-nophone', name: 'Kiran', phone: null });
    tables.appointments = [
      {
        ...appointment('a-meet', 'meeting', 'c-visit'),
        contact_ids: ['c-visit', 'c-nophone'],
        client_confirmed_at: '2026-08-01T03:21:00Z',
      },
    ];
    tables.conversations = [
      { account_id: 'acc', contact_id: 'c-visit', last_customer_message_at: new Date().toISOString() },
    ];
    await checkAndSendAppointmentReminders(NOW);
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppMessageAndPersist.mock.calls[0][0].kind).toBe('template');
  });

  it('[CAL-013] does not double the full stop after an agenda that ends in one', () => {
    const { bodyText, templateParams } = buildReminderTemplateContent({
      clientName: 'Yusuf',
      accountName: 'Acme Realty',
      title: 'Sub registrar visit',
      formattedTime: '30/09/2026, 12:00 pm',
      locationText: 'Koramangala',
      agenda: 'To find out the official SR value of the property.',
      isSiteVisit: false,
    });
    expect(templateParams[4]).toBe('To find out the official SR value of the property');
    expect(bodyText).toContain('of the property. Please tap');
    expect(bodyText).not.toContain('..');
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
