/**
 * Collects the keys asked for within one short window and resolves them
 * with a single fetch, so a screen of rows that each need one small
 * lookup costs one request instead of one per row.
 */
export function createBatchLoader<V>(
  fetchMany: (keys: string[]) => Promise<Map<string, V>>,
  windowMs = 16
): (key: string) => Promise<V | null> {
  type Waiter = {
    resolve: (value: V | null) => void;
    reject: (reason: unknown) => void;
  };
  let pending = new Map<string, Waiter[]>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  function flush() {
    const batch = pending;
    pending = new Map();
    timer = null;
    fetchMany([...batch.keys()]).then(
      (found) => {
        for (const [key, waiters] of batch) {
          const value = found.get(key) ?? null;
          for (const w of waiters) w.resolve(value);
        }
      },
      (error) => {
        for (const waiters of batch.values()) {
          for (const w of waiters) w.reject(error);
        }
      }
    );
  }

  return (key) =>
    new Promise<V | null>((resolve, reject) => {
      const waiters = pending.get(key);
      if (waiters) waiters.push({ resolve, reject });
      else pending.set(key, [{ resolve, reject }]);
      timer ??= setTimeout(flush, windowMs);
    });
}
