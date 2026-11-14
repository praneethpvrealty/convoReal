/**
 * Collects the keys asked for within one short window and resolves them
 * with a single fetch, so a screen of rows that each need one small
 * lookup costs one request instead of one per row. A window holding more
 * than `maxBatch` keys is split, so a fetch with its own cap never drops one.
 */
export function createBatchLoader<V>(
  fetchMany: (keys: string[]) => Promise<Map<string, V>>,
  {
    windowMs = 16,
    maxBatch = 200,
  }: { windowMs?: number; maxBatch?: number } = {}
): (key: string) => Promise<V | null> {
  type Waiter = {
    resolve: (value: V | null) => void;
    reject: (reason: unknown) => void;
  };
  let pending = new Map<string, Waiter[]>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  function flush() {
    const keys = [...pending.keys()];
    const batch = pending;
    pending = new Map();
    timer = null;
    for (let i = 0; i < keys.length; i += maxBatch) {
      const group = keys.slice(i, i + maxBatch);
      fetchMany(group).then(
        (found) => {
          for (const key of group) {
            const value = found.get(key) ?? null;
            for (const w of batch.get(key) ?? []) w.resolve(value);
          }
        },
        (error) => {
          for (const key of group) {
            for (const w of batch.get(key) ?? []) w.reject(error);
          }
        }
      );
    }
  }

  return (key) =>
    new Promise<V | null>((resolve, reject) => {
      const waiters = pending.get(key);
      if (waiters) waiters.push({ resolve, reject });
      else pending.set(key, [{ resolve, reject }]);
      timer ??= setTimeout(flush, windowMs);
    });
}
