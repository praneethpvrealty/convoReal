import { describe, expect, it, vi, beforeEach } from 'vitest';

const extractContactPreferences = vi.fn();
const burnCredits = vi.fn().mockResolvedValue({ success: true, deficit: 0, balanceAfter: 100 });

vi.mock('@/lib/ai/preference-extraction', async (orig) => ({
  ...(await orig<typeof import('@/lib/ai/preference-extraction')>()),
  extractContactPreferences: (...a: unknown[]) => extractContactPreferences(...a),
}));
vi.mock('@/lib/credits/burn', () => ({ burnCredits: (...a: unknown[]) => burnCredits(...a) }));

const { syncContactPreferences } = await import('./preference-sync');
const { EMPTY_PREFERENCES } = await import('@/lib/ai/preference-extraction');

function dbReturning(contact: Record<string, unknown> | null, updateError: unknown = null) {
  const update = vi.fn().mockReturnValue({
    eq: () => ({ eq: () => Promise.resolve({ error: updateError }) }),
  });
  return {
    update,
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: contact }) }) }) }),
      update,
    }),
  };
}

describe('syncContactPreferences', () => {
  beforeEach(() => {
    extractContactPreferences.mockReset();
    extractContactPreferences.mockResolvedValue({ ...EMPTY_PREFERENCES, budget_max: 4_500_000 });
  });

  it('extracts and persists when the requirement text is new', async () => {
    const db = dbReturning({ id: 'c1', requirements: 'Budget 35 to 45k, Rt Nagar', pref_source_hash: null, contact_notes: [] });
    const r = await syncContactPreferences(db as never, 'acc', 'c1');
    expect(r.status).toBe('updated');
    expect(extractContactPreferences).toHaveBeenCalledOnce();
    expect(db.update).toHaveBeenCalled();
  });

  it('keeps a stated buy-or-rent intent the extraction has nothing to say about', async () => {
    // The agent picked it on the contact form, or the lead tapped the
    // ladder's list. A later message that never mentions renting must
    // not blank it.
    const db = dbReturning({
      id: 'c1',
      requirements: 'Budget 35 to 45k, Rt Nagar',
      pref_source_hash: null,
      pref_listing_types: ['Rent'],
      contact_notes: [],
    });
    await syncContactPreferences(db as never, 'acc', 'c1');
    expect(db.update.mock.calls[0][0]).toMatchObject({
      pref_listing_types: ['Rent'],
    });
  });

  it('lets the extraction correct a stated intent when the text does say so', async () => {
    extractContactPreferences.mockResolvedValue({
      ...EMPTY_PREFERENCES,
      listing_types: ['Sale'],
    });
    const db = dbReturning({
      id: 'c1',
      requirements: 'Actually we want to purchase now',
      pref_source_hash: null,
      pref_listing_types: ['Rent'],
      contact_notes: [],
    });
    await syncContactPreferences(db as never, 'acc', 'c1');
    expect(db.update.mock.calls[0][0]).toMatchObject({
      pref_listing_types: ['Sale'],
    });
  });

  it('skips the AI call when the source text has not changed', async () => {
    const { buildPreferenceSourceText, preferenceSourceHash } = await import('@/lib/ai/preference-extraction');
    const requirements = 'Budget 35 to 45k, Rt Nagar';
    const hash = preferenceSourceHash(buildPreferenceSourceText(requirements, []));
    const db = dbReturning({ id: 'c1', requirements, pref_source_hash: hash, contact_notes: [] });
    const r = await syncContactPreferences(db as never, 'acc', 'c1');
    expect(r.status).toBe('unchanged');
    expect(extractContactPreferences).not.toHaveBeenCalled();
  });

  it('does nothing for a contact who has said nothing yet', async () => {
    const db = dbReturning({ id: 'c1', requirements: '   ', pref_source_hash: null, contact_notes: [] });
    expect((await syncContactPreferences(db as never, 'acc', 'c1')).status).toBe('nothing-to-extract');
    expect(extractContactPreferences).not.toHaveBeenCalled();
  });

  it('swallows an extraction failure — the inbound message is already handled', async () => {
    extractContactPreferences.mockRejectedValue(new Error('gemini down'));
    const db = dbReturning({ id: 'c1', requirements: 'Budget 35 to 45k', pref_source_hash: null, contact_notes: [] });
    expect((await syncContactPreferences(db as never, 'acc', 'c1')).status).toBe('failed');
  });

  it('still extracts when the credit burn fails', async () => {
    burnCredits.mockRejectedValueOnce(new Error('billing down'));
    const db = dbReturning({ id: 'c1', requirements: 'Budget 35 to 45k', pref_source_hash: null, contact_notes: [] });
    expect((await syncContactPreferences(db as never, 'acc', 'c1')).status).toBe('updated');
  });
});
