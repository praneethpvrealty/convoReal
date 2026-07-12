import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runImageCleanup } from './image-cleanup';
import { DEFAULT_IMAGE_CLEANUP_CONFIG } from './image-cleanup-config';
import { notifyOwnerImageCleanup } from './image-cleanup-notify';

vi.mock('./image-cleanup-notify', () => ({
  notifyOwnerImageCleanup: vi.fn(() => Promise.resolve()),
}));
const mockNotify = vi.mocked(notifyOwnerImageCleanup);

// ── Minimal Supabase mock: an in-memory `properties` array + `logs` array
// that the query builder filters/mutates by reference, so tests assert on
// real end state. ─────────────────────────────────────────────────────────
interface Store {
  properties: Record<string, unknown>[];
  logs: Record<string, unknown>[];
  removed: string[];
}

function makeAdmin(store: Store): SupabaseClient {
  const build = (table: string) => {
    const b: Record<string, unknown> & {
      _eq: Record<string, unknown>;
      _in: Record<string, unknown[]>;
      _lte: Record<string, string>;
      _op: string;
      _patch: Record<string, unknown> | null;
      _row: Record<string, unknown> | null;
      _single: boolean;
      _limit: number | null;
    } = {
      _eq: {},
      _in: {},
      _lte: {},
      _op: 'select',
      _patch: null,
      _row: null,
      _single: false,
      _limit: null,
      select: () => b,
      insert: (row: Record<string, unknown>) => {
        b._op = 'insert';
        b._row = row;
        return b;
      },
      update: (patch: Record<string, unknown>) => {
        b._op = 'update';
        b._patch = patch;
        return b;
      },
      eq: (col: string, val: unknown) => {
        b._eq[col] = val;
        return b;
      },
      in: (col: string, vals: unknown[]) => {
        b._in[col] = vals;
        return b;
      },
      lte: (col: string, val: string) => {
        b._lte[col] = val;
        return b;
      },
      order: () => b,
      limit: (n: number) => {
        b._limit = n;
        return b;
      },
      maybeSingle: () => {
        b._single = true;
        return exec();
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(exec()).then(resolve, reject),
    };

    const matches = (row: Record<string, unknown>) => {
      for (const [c, v] of Object.entries(b._eq)) if (row[c] !== v) return false;
      for (const [c, vals] of Object.entries(b._in))
        if (!vals.includes(row[c])) return false;
      for (const [c, v] of Object.entries(b._lte))
        if (!(typeof row[c] === 'string' && (row[c] as string) <= v)) return false;
      return true;
    };

    const exec = (): Promise<unknown> => {
      const rows = table === 'properties' ? store.properties : store.logs;
      if (b._op === 'insert') {
        store.logs.push({ ...(b._row as object) });
        return Promise.resolve({ data: null, error: null });
      }
      if (b._op === 'update') {
        for (const row of rows)
          if (matches(row)) Object.assign(row, b._patch);
        return Promise.resolve({ error: null });
      }
      let out = rows.filter(matches);
      if (b._limit != null) out = out.slice(0, b._limit);
      if (b._single) {
        const last = out.length ? out[out.length - 1] : null;
        return Promise.resolve({ data: last, error: null });
      }
      return Promise.resolve({ data: out, error: null });
    };

    return b;
  };

  return {
    from: (t: string) => build(t),
    storage: {
      from: () => ({
        remove: (paths: string[]) => {
          store.removed.push(...paths);
          return Promise.resolve({ error: null });
        },
      }),
    },
  } as unknown as SupabaseClient;
}

const DAY = 24 * 60 * 60 * 1000;
const iso = ( msAgo: number) => new Date(Date.now() - msAgo).toISOString();

function prop(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'p1',
    account_id: 'acc1',
    title: 'Test Villa',
    status: 'Sold',
    images: ['https://x.supabase.co/storage/v1/object/public/property-images/acc1/img-1.jpg'],
    images_cleanup_state: 'active',
    images_cleanup_warned_at: null,
    images_dereferenced_at: null,
    status_changed_at: iso(200 * DAY),
    ...over,
  };
}

const cfg = (over: Partial<typeof DEFAULT_IMAGE_CLEANUP_CONFIG> = {}) => ({
  ...DEFAULT_IMAGE_CLEANUP_CONFIG,
  enabled: true,
  dry_run: false,
  ...over,
});

let store: Store;
beforeEach(() => {
  store = { properties: [], logs: [], removed: [] };
  mockNotify.mockClear();
});

describe('runImageCleanup — warn phase', () => {
  it('warns a long-dormant terminal property and notifies once', async () => {
    store.properties = [prop()];
    const summary = await runImageCleanup(makeAdmin(store), cfg());
    expect(summary.warned).toBe(1);
    expect(summary.accountsNotified).toBe(1);
    expect(store.properties[0].images_cleanup_state).toBe('warned');
    expect(store.properties[0].images_cleanup_warned_at).toBeTruthy();
    expect(store.logs.some((l) => l.phase === 'warn')).toBe(true);
    expect(mockNotify).toHaveBeenCalledTimes(1);
  });

  it('does not warn an Available (non-terminal) property', async () => {
    store.properties = [prop({ status: 'Available' })];
    const summary = await runImageCleanup(makeAdmin(store), cfg());
    expect(summary.warned).toBe(0);
    expect(store.properties[0].images_cleanup_state).toBe('active');
  });

  it('does not warn a terminal property that is not yet dormant', async () => {
    store.properties = [prop({ status_changed_at: iso(10 * DAY) })];
    const summary = await runImageCleanup(makeAdmin(store), cfg());
    expect(summary.warned).toBe(0);
  });

  it('dry-run reports candidates but mutates nothing and sends nothing', async () => {
    store.properties = [prop()];
    const summary = await runImageCleanup(makeAdmin(store), cfg({ dry_run: true }));
    expect(summary.warned).toBe(1);
    expect(store.properties[0].images_cleanup_state).toBe('active');
    expect(store.logs).toHaveLength(0);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('respects max_per_run', async () => {
    store.properties = [prop({ id: 'a' }), prop({ id: 'b' })];
    const summary = await runImageCleanup(makeAdmin(store), cfg({ max_per_run: 1 }));
    expect(summary.warned).toBe(1);
    expect(store.properties.filter((p) => p.images_cleanup_state === 'warned')).toHaveLength(1);
  });
});

describe('runImageCleanup — escape reset', () => {
  it('resets a warned property whose owner re-activated it', async () => {
    store.properties = [
      prop({ images_cleanup_state: 'warned', images_cleanup_warned_at: iso(40 * DAY), status: 'Available' }),
    ];
    const summary = await runImageCleanup(makeAdmin(store), cfg());
    expect(summary.reset).toBe(1);
    expect(summary.dereferenced).toBe(0);
    expect(store.properties[0].images_cleanup_state).toBe('active');
    expect(store.properties[0].images_cleanup_warned_at).toBeNull();
  });
});

describe('runImageCleanup — dereference phase', () => {
  it('clears images after grace, snapshots them, and keeps the blobs', async () => {
    store.properties = [
      prop({ images_cleanup_state: 'warned', images_cleanup_warned_at: iso(40 * DAY) }),
    ];
    const summary = await runImageCleanup(makeAdmin(store), cfg({ grace_days: 30 }));
    expect(summary.dereferenced).toBe(1);
    expect(store.properties[0].images_cleanup_state).toBe('dereferenced');
    expect(store.properties[0].images).toEqual([]);
    expect(store.removed).toHaveLength(0); // blobs kept
    const snap = store.logs.find((l) => l.phase === 'dereference');
    expect((snap?.snapshot as { images: string[] }).images).toHaveLength(1);
  });

  it('does not dereference before the grace period elapses', async () => {
    store.properties = [
      prop({ images_cleanup_state: 'warned', images_cleanup_warned_at: iso(5 * DAY) }),
    ];
    const summary = await runImageCleanup(makeAdmin(store), cfg({ grace_days: 30 }));
    expect(summary.dereferenced).toBe(0);
    expect(store.properties[0].images_cleanup_state).toBe('warned');
  });
});

describe('runImageCleanup — purge phase (opt-in)', () => {
  const dereferenced = () => [
    prop({
      id: 'p1',
      images: [],
      images_cleanup_state: 'dereferenced',
      images_dereferenced_at: iso(200 * DAY),
    }),
  ];
  const snapshotLog = () => ({
    account_id: 'acc1',
    property_id: 'p1',
    phase: 'dereference',
    snapshot: {
      images: ['https://x.supabase.co/storage/v1/object/public/property-images/acc1/img-1.jpg'],
    },
  });

  it('does NOT purge when hard_delete_enabled is false', async () => {
    store.properties = dereferenced();
    store.logs = [snapshotLog()];
    const summary = await runImageCleanup(makeAdmin(store), cfg({ hard_delete_enabled: false }));
    expect(summary.purged).toBe(0);
    expect(store.removed).toHaveLength(0);
    expect(store.properties[0].images_cleanup_state).toBe('dereferenced');
  });

  it('purges blobs from the snapshot when enabled and past retention', async () => {
    store.properties = dereferenced();
    store.logs = [snapshotLog()];
    const summary = await runImageCleanup(
      makeAdmin(store),
      cfg({ hard_delete_enabled: true, final_retention_days: 180 }),
    );
    expect(summary.purged).toBe(1);
    expect(store.removed).toEqual(['acc1/img-1.jpg']);
    expect(store.properties[0].images_cleanup_state).toBe('purged');
  });
});

describe('runImageCleanup — idempotency', () => {
  it('a second run makes no further changes to a just-warned property', async () => {
    store.properties = [prop()];
    const admin = makeAdmin(store);
    await runImageCleanup(admin, cfg());
    const warnLogs1 = store.logs.filter((l) => l.phase === 'warn').length;
    const summary2 = await runImageCleanup(admin, cfg({ grace_days: 30 }));
    expect(summary2.warned).toBe(0);
    expect(summary2.dereferenced).toBe(0); // still within grace
    expect(store.logs.filter((l) => l.phase === 'warn').length).toBe(warnLogs1);
  });
});
