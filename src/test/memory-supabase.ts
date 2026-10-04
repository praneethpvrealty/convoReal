type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'string' && typeof b === 'string') {
    const at = Date.parse(a);
    const bt = Date.parse(b);
    return /\d{4}-\d{2}-\d{2}T/.test(a) && Number.isFinite(at) && at === bt;
  }
  return false;
}

export function memorySupabase(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    const filters: Filter[] = [];
    let patch: Row | null = null;
    let head = false;
    const rows = () => (tables[table] ??= []);
    const run = (): Row[] => {
      const matched = rows().filter((row) => filters.every((f) => f(row)));
      if (patch) {
        for (const row of matched) Object.assign(row, structuredClone(patch));
      }
      return matched.map((row) => structuredClone(row));
    };
    const builder = {
      select(_columns?: string, options?: { head?: boolean }) {
        if (options?.head) head = true;
        return builder;
      },
      update(values: Row) {
        patch = values;
        return builder;
      },
      eq(column: string, value: unknown) {
        filters.push((row) => same(row[column] ?? null, value));
        return builder;
      },
      neq(column: string, value: unknown) {
        filters.push((row) => !same(row[column] ?? null, value));
        return builder;
      },
      is(column: string, value: unknown) {
        filters.push((row) => (row[column] ?? null) === value);
        return builder;
      },
      in(column: string, values: unknown[]) {
        filters.push((row) => values.includes(row[column]));
        return builder;
      },
      gte(column: string, value: unknown) {
        filters.push((row) => String(row[column]) >= String(value));
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return builder;
      },
      async maybeSingle() {
        return { data: run()[0] ?? null, error: null };
      },
      then<T>(
        resolve: (value: {
          data: Row[] | null;
          count: number;
          error: null;
        }) => T,
        reject?: (reason: unknown) => T
      ) {
        try {
          const data = run();
          return Promise.resolve(
            resolve({
              data: head ? null : data,
              count: data.length,
              error: null,
            })
          );
        } catch (err) {
          return reject ? Promise.resolve(reject(err)) : Promise.reject(err);
        }
      },
    };
    return builder;
  };
  return { from };
}
