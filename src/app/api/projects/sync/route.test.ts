import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireRole, generateJson, supabaseAdmin, insert } = vi.hoisted(() => ({
  requireRole: vi.fn(),
  generateJson: vi.fn(),
  supabaseAdmin: vi.fn(),
  insert: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole,
  toErrorResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
vi.mock('@/lib/ai/gemini', () => ({ generateJson }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin }));

import { POST } from './route';

describe('POST /api/projects/sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRole.mockResolvedValue({});
    insert.mockResolvedValue({ error: null });
    supabaseAdmin.mockReturnValue({
      from: () => ({
        select: async () => ({ data: [{ name: 'Swiss Town' }], error: null }),
        insert,
      }),
    });
  });

  it('writes no fabricated or model-generated RERA numbers', async () => {
    generateJson.mockResolvedValue(
      JSON.stringify([
        {
          name: 'Outskirts Greens',
          promoter_name: 'Builder',
          project_type: 'Residential Land/ Plot',
          sublocality: 'Bidadi',
          rera_registration_number: 'PRM/KA/RERA/1251/310/PR/260616/123456',
        },
      ]),
    );

    const res = await POST();

    expect(res.status).toBe(200);
    expect(generateJson).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ feature: 'project_sync' }),
    );
    const rows = insert.mock.calls.flatMap((call) => call[0]);
    expect(rows.length).toBeGreaterThan(1);
    expect(JSON.stringify(rows)).not.toContain('PRM/KA/RERA');
    expect(rows.find((r: { name: string }) => r.name === 'Swiss Town')).toBeUndefined();
    expect(rows.find((r: { name: string }) => r.name === 'Outskirts Greens')).toMatchObject({
      source: 'ai',
      rera_registration_number: null,
    });
    expect(rows.every((r: { source: string }) => r.source === 'curated' || r.source === 'ai')).toBe(true);
  });
});
