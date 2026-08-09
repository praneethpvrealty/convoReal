import { describe, expect, it, vi } from 'vitest';
import { matchProjectByName } from './projects';

/**
 * The rule that turns forwarded floor plans into units of one tower
 * instead of four listings that happen to share a string.
 */

function db(rows: Array<{ id: string }>, capture?: Record<string, unknown>) {
  const filters: Record<string, unknown> = capture ?? {};
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      filters[col] = val;
      return builder;
    },
    maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
  });
  return { from: () => builder } as never;
}

describe('matchProjectByName', () => {
  it('links a forwarded plan to the project the agent already created', async () => {
    expect(
      await matchProjectByName(db([{ id: 'proj-1' }]), 'acc', 'Sattva Exotic'),
    ).toBe('proj-1');
  });

  it('matches on the slug, so casing and spacing do not lose the link', async () => {
    // What arrives over WhatsApp is whatever the sender typed.
    for (const name of ['sattva exotic', 'SATTVA EXOTIC', '  Sattva  Exotic ']) {
      const filters: Record<string, unknown> = {};
      await matchProjectByName(db([{ id: 'proj-1' }], filters), 'acc', name);
      expect(filters.slug, name).toBe('sattva-exotic');
    }
  });

  it('scopes the lookup to the account', async () => {
    const filters: Record<string, unknown> = {};
    await matchProjectByName(db([{ id: 'p' }], filters), 'acc-1', 'Sattva Exotic');
    expect(filters.account_id).toBe('acc-1');
  });

  it('does not invent a project the account never created', async () => {
    // Naming a tower in passing is not a decision to track it, and a
    // project conjured from a typo is worse than no link — the text
    // column carries the name either way.
    expect(await matchProjectByName(db([]), 'acc', 'Some Tower')).toBeNull();
  });

  it('is null for a listing that names no project', async () => {
    for (const name of [null, undefined, '', '   ', '!!!']) {
      expect(await matchProjectByName(db([{ id: 'p' }]), 'acc', name), String(name)).toBeNull();
    }
  });

  it('never costs the listing when the lookup fails', async () => {
    // An unlinked property is a working property; a failed insert is
    // not. So a database error resolves to null rather than throwing
    // into the intake path.
    const failing = {
      from: () => {
        const b: Record<string, unknown> = {};
        Object.assign(b, {
          select: () => b,
          eq: () => b,
          maybeSingle: () =>
            Promise.resolve({ data: null, error: { message: 'boom' } }),
        });
        return b;
      },
    } as never;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await matchProjectByName(failing, 'acc', 'Sattva Exotic')).toBeNull();
  });

  it('survives the client throwing outright', async () => {
    const throwing = {
      from: () => {
        throw new Error('connection lost');
      },
    } as never;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await matchProjectByName(throwing, 'acc', 'Sattva Exotic')).toBeNull();
  });
});
