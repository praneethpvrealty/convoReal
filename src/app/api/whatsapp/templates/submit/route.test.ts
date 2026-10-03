import { beforeEach, describe, expect, it, vi } from 'vitest';

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
const fetchMock = vi.fn();

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
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';
  process.env.NEXT_PUBLIC_SITE_URL = 'https://www.convoreal.com';
  delete process.env.NEXT_PUBLIC_APP_URL;
  delete process.env.WHATSAPP_TEMPLATES_DRY_RUN;
});

function mediaPayload(headerMediaUrl: string, extra: object = {}) {
  return {
    name: 'photo_update',
    category: 'Marketing',
    language: 'en_US',
    header_type: 'image',
    header_media_url: headerMediaUrl,
    body_text: 'A new photo is ready for you.',
    ...extra,
  };
}

function sampleResponse() {
  return new Response(new Uint8Array([1, 2, 3]), {
    status: 200,
    headers: { 'content-type': 'image/png' },
  });
}

function queueSuccessfulSubmit() {
  queues['message_templates'] = [
    { data: [] },
    { data: null },
    { data: { id: 'row-media' } },
  ];
  queues['whatsapp_config'] = [CONFIG];
}

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

  it('fetches a header sample from this project storage and never follows redirects itself', async () => {
    queueSuccessfulSubmit();
    fetchMock.mockResolvedValue(sampleResponse());
    const url =
      'https://proj.supabase.co/storage/v1/object/public/property-images/acc-1/template-headers/a.png';

    const res = await POST(makeRequest(mediaPayload(url)));

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(url, { redirect: 'manual' });
    expect(uploadSampleMedia.mock.calls[0][0]).toMatchObject({
      fileType: 'image/png',
    });
    expect(inserts[0].row).toMatchObject({
      header_media_url: url,
      header_handle: 'handle-1',
    });
  });

  it('fetches an engine-template sample from the app brand assets', async () => {
    queueSuccessfulSubmit();
    fetchMock.mockResolvedValue(sampleResponse());

    const res = await POST(
      makeRequest(
        mediaPayload('https://www.convoreal.com/brand/app-icon-1024.png')
      )
    );

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.convoreal.com/brand/app-icon-1024.png',
      { redirect: 'manual' }
    );
  });

  it.each([
    ['an arbitrary host', 'https://evil.example/a.png'],
    ['the cloud metadata address', 'http://169.254.169.254/latest/meta-data/'],
    ['loopback', 'https://127.0.0.1/storage/v1/object/public/a.png'],
    [
      'plain http on the storage host',
      'http://proj.supabase.co/storage/v1/object/public/b/a.png',
    ],
    [
      'another port on the storage host',
      'https://proj.supabase.co:8443/storage/v1/object/public/b/a.png',
    ],
    [
      'a non-public path on the storage host',
      'https://proj.supabase.co/rest/v1/contacts',
    ],
    [
      'a path that climbs out of public storage',
      'https://proj.supabase.co/storage/v1/object/public/../../../auth/v1/admin/users',
    ],
    [
      'an API route on the app host',
      'https://www.convoreal.com/api/cron/owner-digest',
    ],
    [
      'a lookalike host',
      'https://proj.supabase.co.evil.example/storage/v1/object/public/a.png',
    ],
    [
      'an allowed host in the userinfo',
      'https://proj.supabase.co@evil.example/storage/v1/object/public/a.png',
    ],
  ])(
    'refuses a header sample on %s without fetching it',
    async (_label, url) => {
      queueSuccessfulSubmit();

      const res = await POST(makeRequest(mediaPayload(url)));
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.code).toBe('HEADER_SAMPLE_URL_NOT_ALLOWED');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(uploadSampleMedia).not.toHaveBeenCalled();
      expect(submitMessageTemplate).not.toHaveBeenCalled();
      expect(inserts).toHaveLength(0);
    }
  );

  it('refuses a disallowed header sample in dry-run mode too', async () => {
    process.env.WHATSAPP_TEMPLATES_DRY_RUN = 'true';
    queueSuccessfulSubmit();

    const res = await POST(
      makeRequest(mediaPayload('https://evil.example/a.png'))
    );

    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });

  it('refuses a header sample that redirects to another host', async () => {
    queueSuccessfulSubmit();
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      })
    );

    const res = await POST(
      makeRequest(
        mediaPayload(
          'https://proj.supabase.co/storage/v1/object/public/b/a.png'
        )
      )
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe('HEADER_SAMPLE_URL_NOT_ALLOWED');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(uploadSampleMedia).not.toHaveBeenCalled();
    expect(submitMessageTemplate).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it('follows a redirect between allowed app hosts', async () => {
    queueSuccessfulSubmit();
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, {
          status: 308,
          headers: {
            location: 'https://www.convoreal.com/brand/app-icon-1024.png',
          },
        })
      )
      .mockResolvedValueOnce(sampleResponse());

    const res = await POST(
      makeRequest(mediaPayload('https://convoreal.com/brand/app-icon-1024.png'))
    );

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://www.convoreal.com/brand/app-icon-1024.png'
    );
  });

  it('does not fetch at all when the payload already carries an upload handle', async () => {
    queueSuccessfulSubmit();

    const res = await POST(
      makeRequest(
        mediaPayload('https://evil.example/a.png', { header_handle: 'h-1' })
      )
    );

    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
