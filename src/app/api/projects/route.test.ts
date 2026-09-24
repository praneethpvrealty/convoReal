import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireRole, generateJson, supabaseAdmin, insert, existingByName } = vi.hoisted(() => ({
  requireRole: vi.fn(),
  generateJson: vi.fn(),
  supabaseAdmin: vi.fn(),
  insert: vi.fn(),
  existingByName: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole,
  toErrorResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
vi.mock('@/lib/ai/gemini', () => ({ generateJson }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin }));

import { GET } from './route';

const MODEL_ANSWER = {
  name: 'Lakeview Meadows',
  promoter_name: 'Some Builder',
  project_type: 'Villa',
  sublocality: 'Hoskote',
  city: 'Bangalore',
  state: 'Karnataka',
  address: 'Old Madras Road',
  rera_registration_number: 'PRM/KA/RERA/1251/446/PR/180517/001713',
};

describe('GET /api/projects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRole.mockResolvedValue({
      supabase: {
        from: () => ({
          select: () => ({ or: () => ({ limit: async () => ({ data: [], error: null }) }) }),
        }),
      },
    });
    existingByName.mockResolvedValue({ data: null });
    insert.mockResolvedValue({ error: null });
    supabaseAdmin.mockReturnValue({
      from: () => ({
        select: () => ({ ilike: () => ({ limit: () => ({ maybeSingle: existingByName }) }) }),
        insert,
      }),
    });
  });

  it('never persists a RERA number the model supplied', async () => {
    generateJson.mockResolvedValue(JSON.stringify(MODEL_ANSWER));

    const res = await GET(new Request('https://app.test/api/projects?search=Lakeview'));

    expect(generateJson).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ feature: 'project_lookup' }),
    );
    expect(generateJson.mock.calls[0][0]).not.toMatch(/rera/i);
    expect(insert).toHaveBeenCalledTimes(1);
    const row = insert.mock.calls[0][0];
    expect(row.rera_registration_number).toBeNull();
    expect(row.source).toBe('ai');
    expect(JSON.stringify(row)).not.toContain('PRM/KA/RERA');

    const body = await res.json();
    expect(body[0]).toMatchObject({ name: 'Lakeview Meadows', source: 'ai' });
    expect(JSON.stringify(body)).not.toContain('PRM/KA/RERA');
  });

  it('reuses an existing row instead of inserting a duplicate', async () => {
    generateJson.mockResolvedValue(JSON.stringify(MODEL_ANSWER));
    existingByName.mockResolvedValue({
      data: {
        name: 'Lakeview Meadows',
        sublocality: 'Hoskote',
        city: 'Bangalore',
        state: 'Karnataka',
        address: '',
        project_type: 'Villa',
        source: 'curated',
      },
    });

    const res = await GET(new Request('https://app.test/api/projects?search=Lakeview'));

    expect(insert).not.toHaveBeenCalled();
    expect((await res.json())[0]).toMatchObject({ source: 'curated' });
  });

  it('stores nothing when the model does not recognise the project', async () => {
    generateJson.mockResolvedValue('null');

    const res = await GET(new Request('https://app.test/api/projects?search=Nowhere%20Towers'));

    expect(insert).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it('falls back to the static list when no Gemini key is available', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    generateJson.mockRejectedValue(new Error('No Gemini API key configured'));

    const res = await GET(new Request('https://app.test/api/projects?search=Prestige'));

    expect(insert).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    warn.mockRestore();
  });
});
