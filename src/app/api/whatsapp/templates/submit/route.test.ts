import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildAnnouncementTemplatePayload } from '@/lib/whatsapp/announcement-template';
import { buildNumberChangeTemplatePayload } from '@/lib/whatsapp/number-change-template';

/**
 * POST /api/whatsapp/templates/submit — the one door to Meta.
 *
 * Meta fixes a template name's category at its first review and
 * refuses a later language under a different one, so a translation
 * has to be sent under whatever Meta already holds for the name.
 */

interface QueuedResponse {
  data?: unknown;
  error?: unknown;
}

let queues: Record<string, QueuedResponse[]>;
let inserts: Array<{ table: string; row: Record<string, unknown> }>;
let filters: Array<{ table: string; op: string; args: unknown[] }>;
let updates: Array<{ table: string; row: Record<string, unknown> }>;
const submitMessageTemplate = vi.fn();
const findMessageTemplate = vi.fn();
const uploadSampleMedia = vi.fn();
const lookup = vi.fn();

vi.mock('node:dns/promises', () => ({
  lookup: (...args: unknown[]) => lookup(...args),
}));

function next(table: string): QueuedResponse {
  return (queues[table] ?? []).shift() ?? { data: null, error: null };
}

function makeDb() {
  return {
    from(table: string) {
      const builder: { [k: string]: (...args: unknown[]) => unknown } = {
        select: () => builder,
        eq: (...args: unknown[]) => {
          filters.push({ table, op: 'eq', args });
          return builder;
        },
        not: (...args: unknown[]) => {
          filters.push({ table, op: 'not', args });
          return builder;
        },
        insert: (row: unknown) => {
          inserts.push({ table, row: row as Record<string, unknown> });
          return builder;
        },
        update: (row: unknown) => {
          updates.push({ table, row: row as Record<string, unknown> });
          return builder;
        },
        single: () => Promise.resolve(next(table)),
        maybeSingle: () => Promise.resolve(next(table)),
        then: (resolve: unknown, reject: unknown) =>
          Promise.resolve(next(table)).then(
            resolve as (v: unknown) => unknown,
            reject as (v: unknown) => unknown
          ),
      };
      return builder;
    },
  };
}

vi.mock('@/lib/auth/account', () => ({
  requireOrgRole: async () => ({
    supabase: makeDb(),
    accountId: 'acc-1',
    userId: 'user-1',
  }),
  toErrorResponse: (err: unknown) =>
    Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    ),
}));

vi.mock('@/lib/whatsapp/meta-api', () => ({
  submitMessageTemplate: (...args: unknown[]) => submitMessageTemplate(...args),
  findMessageTemplate: (...args: unknown[]) => findMessageTemplate(...args),
  uploadSampleMedia: (...args: unknown[]) => uploadSampleMedia(...args),
}));

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: () => 'token',
}));

vi.mock('@/lib/whatsapp/template-showcase-buttons', () => ({
  withAccountShowcaseButtons: async (
    _db: unknown,
    _account: string,
    payload: unknown
  ) => payload,
}));

import { POST } from './route';

function makeRequest(body: unknown) {
  return new Request('http://test/api/whatsapp/templates/submit', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

const CONFIG = { data: { waba_id: 'waba-1', access_token: 'enc' } };
const REVIEWED = { data: { translation_reviewed_at: '2026-09-22T03:00:00Z' } };

beforeEach(() => {
  queues = {};
  inserts = [];
  filters = [];
  updates = [];
  findMessageTemplate.mockReset();
  findMessageTemplate.mockResolvedValue(null);
  submitMessageTemplate.mockReset();
  submitMessageTemplate.mockResolvedValue({
    id: 'meta-kn',
    status: 'PENDING',
    category: undefined,
  });
  uploadSampleMedia.mockReset();
  uploadSampleMedia.mockResolvedValue('handle-1');
  lookup.mockReset();
  lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  delete process.env.WHATSAPP_TEMPLATES_DRY_RUN;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('POST /api/whatsapp/templates/submit', () => {
  it('[CLG-003] submits a translation under the category Meta already holds for the name', async () => {
    queues['message_templates'] = [
      {
        data: [
          {
            category: 'Marketing',
            meta_template_id: 'meta-en',
            status: 'APPROVED',
          },
        ],
      },
      REVIEWED,
      { data: null },
      { data: { id: 'row-kn', category: 'Marketing' } },
    ];
    queues['whatsapp_config'] = [CONFIG];

    const payload = buildNumberChangeTemplatePayload('kn');
    expect(payload.category).toBe('Utility');

    const res = await POST(makeRequest(payload));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(submitMessageTemplate).toHaveBeenCalledTimes(1);
    expect(submitMessageTemplate.mock.calls[0][0].payload.category).toBe(
      'MARKETING'
    );
    expect(submitMessageTemplate.mock.calls[0][0].payload.language).toBe('kn');
    expect(inserts[0].row).toMatchObject({
      name: 'contact_number_update',
      language: 'kn',
      category: 'Marketing',
      meta_template_id: 'meta-kn',
    });
    expect(body.category_changed).toEqual({
      requested: 'Utility',
      assigned: 'Marketing',
    });
    expect(
      filters.find((f) => f.table === 'message_templates' && f.op === 'not')
        ?.args
    ).toEqual(['meta_template_id', 'is', null]);
  });

  it('[CLG-003] keeps the requested category when no language of the name has reached Meta', async () => {
    queues['message_templates'] = [
      { data: [] },
      REVIEWED,
      { data: null },
      { data: { id: 'row-kn', category: 'Utility' } },
    ];
    queues['whatsapp_config'] = [CONFIG];

    const res = await POST(makeRequest(buildNumberChangeTemplatePayload('kn')));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(submitMessageTemplate.mock.calls[0][0].payload.category).toBe(
      'UTILITY'
    );
    expect(inserts[0].row).toMatchObject({ category: 'Utility' });
    expect(body.category_changed).toBeUndefined();
  });

  it('[CLG-003] reports the category Meta assigned when it re-categorises the submission itself', async () => {
    submitMessageTemplate.mockResolvedValue({
      id: 'meta-en',
      status: 'PENDING',
      category: 'MARKETING',
    });
    queues['message_templates'] = [
      { data: [] },
      { data: null },
      { data: { id: 'row-en', category: 'Marketing' } },
    ];
    queues['whatsapp_config'] = [CONFIG];

    const res = await POST(makeRequest(buildNumberChangeTemplatePayload('en')));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(inserts[0].row).toMatchObject({
      language: 'en_US',
      category: 'Marketing',
    });
    expect(body.category_changed).toEqual({
      requested: 'Utility',
      assigned: 'Marketing',
    });
  });

  it('[CLG-005] adopts the variant Meta already holds when the create is refused as existing', async () => {
    submitMessageTemplate.mockRejectedValue(
      new Error(
        '[Error 100] Invalid parameter: There is already Kannada content for this template. You can create a new template and try again. (Content in this language already exists)'
      )
    );
    findMessageTemplate.mockResolvedValue({
      id: 'meta-kn-existing',
      name: 'contact_number_update',
      language: 'kn',
      status: 'APPROVED',
      category: 'MARKETING',
      components: [
        { type: 'BODY', text: 'ಮೆಟಾ ಹಿಡಿದಿರುವ ಪದಗಳು {{1}}' },
        { type: 'FOOTER', text: 'ನಿಲ್ಲಿಸಲು STOP' },
        {
          type: 'BUTTONS',
          buttons: [{ type: 'QUICK_REPLY', text: 'ಸರಿ' }],
        },
      ],
    });
    queues['message_templates'] = [
      {
        data: [
          {
            category: 'Marketing',
            meta_template_id: 'meta-en',
            status: 'APPROVED',
          },
        ],
      },
      REVIEWED,
      { data: null },
      { data: { id: 'row-kn', status: 'APPROVED' } },
    ];
    queues['whatsapp_config'] = [CONFIG];

    const res = await POST(makeRequest(buildNumberChangeTemplatePayload('kn')));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(findMessageTemplate.mock.calls[0][0]).toMatchObject({
      name: 'contact_number_update',
      language: 'kn',
    });
    expect(inserts[0].row).toMatchObject({
      meta_template_id: 'meta-kn-existing',
      status: 'APPROVED',
      category: 'Marketing',
      submission_error: null,
      body_text: 'ಮೆಟಾ ಹಿಡಿದಿರುವ ಪದಗಳು {{1}}',
      footer_text: 'ನಿಲ್ಲಿಸಲು STOP',
      buttons: [{ type: 'QUICK_REPLY', text: 'ಸರಿ' }],
    });
  });

  it('[CLG-005] writes nothing when the failure lookup itself errors', async () => {
    submitMessageTemplate.mockRejectedValue(
      new Error('[Error 100] Something else')
    );
    queues['message_templates'] = [
      { data: [] },
      REVIEWED,
      { data: null, error: { message: 'duplicate rows' } },
    ];
    queues['whatsapp_config'] = [CONFIG];

    const res = await POST(makeRequest(buildNumberChangeTemplatePayload('kn')));

    expect(res.status).toBe(502);
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it('[CLG-005] a refused submit never drags a Meta-held row back to draft', async () => {
    submitMessageTemplate.mockRejectedValue(
      new Error('[Error 100] Something else')
    );
    queues['message_templates'] = [
      { data: [] },
      REVIEWED,
      {
        data: [
          { id: 'row-kn-teammate', meta_template_id: null },
          { id: 'row-kn', meta_template_id: 'meta-kn' },
        ],
      },
      { data: null },
    ];
    queues['whatsapp_config'] = [CONFIG];

    const res = await POST(makeRequest(buildNumberChangeTemplatePayload('kn')));

    expect(res.status).toBe(502);
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(1);
    expect(updates[0].row).toMatchObject({
      submission_error: '[Error 100] Something else',
    });
    expect(updates[0].row).not.toHaveProperty('status');
    expect(updates[0].row).not.toHaveProperty('meta_template_id');
  });

  it('[CLG-003] refuses to submit when the Meta-held category cannot be confirmed', async () => {
    queues['message_templates'] = [
      { data: null, error: { message: 'connection reset' } },
    ];

    const res = await POST(makeRequest(buildNumberChangeTemplatePayload('kn')));

    expect(res.status).toBe(500);
    expect(submitMessageTemplate).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it('[CLG-003] still refuses an unreviewed translation before touching Meta', async () => {
    queues['message_templates'] = [
      {
        data: [
          {
            category: 'Marketing',
            meta_template_id: 'meta-en',
            status: 'APPROVED',
          },
        ],
      },
      { data: { translation_reviewed_at: null } },
    ];

    const res = await POST(makeRequest(buildNumberChangeTemplatePayload('kn')));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe('TRANSLATION_REVIEW_REQUIRED');
    expect(submitMessageTemplate).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });
});

/**
 * The header sample is fetched by the server and its bytes are uploaded
 * to Meta, so the URL on the payload decides where the server makes a
 * request. Only the app's own storage and its own site may be asked.
 */
describe('POST /api/whatsapp/templates/submit — header sample URL', () => {
  const SUPABASE = 'https://proj.supabase.co';

  function mediaPayload(headerMediaUrl: string) {
    return {
      ...buildAnnouncementTemplatePayload('https://www.convoreal.com'),
      header_media_url: headerMediaUrl,
    };
  }

  function stubFetch() {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'video/mp4' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE);
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://www.convoreal.com');
    queues['message_templates'] = [
      { data: [] },
      { data: null },
      { data: { id: 'row-en', category: 'Marketing' } },
    ];
    queues['whatsapp_config'] = [CONFIG];
  });

  it.each([
    ['the metadata address', 'http://169.254.169.254/latest/meta-data/'],
    ['an internal address', 'https://10.0.0.8/sample.mp4'],
    ['localhost', 'https://localhost:3000/brand/sample.mp4'],
    ['a URL with credentials', 'https://user:pass@www.convoreal.com/a.mp4'],
    ['another site', 'https://images.example.com/sample.mp4'],
    [
      'the storage host outside public objects',
      `${SUPABASE}/rest/v1/contacts?select=*`,
    ],
    ['the own site over plain http', 'http://www.convoreal.com/a.mp4'],
  ])('refuses %s with a 400 and fetches nothing', async (_label, url) => {
    const fetchMock = stubFetch();

    const res = await POST(makeRequest(mediaPayload(url)));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe('HEADER_SAMPLE_URL_NOT_ALLOWED');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(uploadSampleMedia).not.toHaveBeenCalled();
    expect(submitMessageTemplate).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it('refuses an own-site name that resolves inside the network', async () => {
    lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    const fetchMock = stubFetch();

    const res = await POST(
      makeRequest(mediaPayload('https://www.convoreal.com/brand/sample.mp4'))
    );

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a sample that redirects off the app', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(
      makeRequest(mediaPayload('https://www.convoreal.com/brand/sample.mp4'))
    );

    expect(res.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(uploadSampleMedia).not.toHaveBeenCalled();
  });

  it('fetches a sample uploaded to the account storage and submits its handle', async () => {
    const fetchMock = stubFetch();
    const url = `${SUPABASE}/storage/v1/object/public/property-images/acc-1/template-headers/a.mp4`;

    const res = await POST(makeRequest(mediaPayload(url)));

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(url, { redirect: 'manual' });
    expect(uploadSampleMedia).toHaveBeenCalledWith(
      expect.objectContaining({ fileType: 'video/mp4' })
    );
    expect(submitMessageTemplate).toHaveBeenCalledTimes(1);
  });

  it('fetches the built-in sample the deployment serves', async () => {
    const fetchMock = stubFetch();

    const res = await POST(
      makeRequest(buildAnnouncementTemplatePayload('https://www.convoreal.com'))
    );

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.convoreal.com/brand/announcement-sample.mp4',
      { redirect: 'manual' }
    );
  });

  it('re-bases a sample stored under a previous project onto the current storage', async () => {
    const fetchMock = stubFetch();

    const res = await POST(
      makeRequest(
        mediaPayload(
          'https://oldref.supabase.co/storage/v1/object/public/property-images/acc-1/a.mp4'
        )
      )
    );

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      `${SUPABASE}/storage/v1/object/public/property-images/acc-1/a.mp4`,
      { redirect: 'manual' }
    );
  });
});
