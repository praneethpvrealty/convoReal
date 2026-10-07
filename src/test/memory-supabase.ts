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

type RpcHandler = (args: Record<string, unknown>) => unknown;

let nextId = 1;

export function memorySupabase(
  tables: Record<string, Row[]>,
  rpcs: Record<string, RpcHandler> = {}
) {
  const from = (table: string) => {
    const filters: Filter[] = [];
    let patch: Row | null = null;
    let inserted: Row[] | null = null;
    let head = false;
    let orderBy: { column: string; ascending: boolean } | null = null;
    let window: { from: number; to: number } | null = null;
    const rows = () => (tables[table] ??= []);
    const run = (): Row[] => {
      if (inserted) return inserted.map((row) => structuredClone(row));
      const matched = rows().filter((row) => filters.every((f) => f(row)));
      if (patch) {
        for (const row of matched) Object.assign(row, structuredClone(patch));
      }
      let out = matched.map((row) => structuredClone(row));
      if (orderBy) {
        const { column, ascending } = orderBy;
        out = [...out].sort((a, b) => {
          const av = String(a[column] ?? '');
          const bv = String(b[column] ?? '');
          return ascending ? av.localeCompare(bv) : bv.localeCompare(av);
        });
      }
      if (window) out = out.slice(window.from, window.to + 1);
      return out;
    };
    const store = (values: Row | Row[]) => {
      inserted = (Array.isArray(values) ? values : [values]).map((row) => {
        const stored = {
          id: `${table}-${nextId++}`,
          created_at: new Date().toISOString(),
          ...structuredClone(row),
        };
        rows().push(stored);
        return stored;
      });
      return builder;
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
      insert(values: Row | Row[]) {
        return store(values);
      },
      upsert(values: Row | Row[]) {
        return store(values);
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
      gt(column: string, value: unknown) {
        filters.push((row) => Number(row[column]) > Number(value));
        return builder;
      },
      lt(column: string, value: unknown) {
        filters.push((row) => Number(row[column]) < Number(value));
        return builder;
      },
      lte(column: string, value: unknown) {
        filters.push((row) => Number(row[column]) <= Number(value));
        return builder;
      },
      // PostgREST filter strings (ilike probes, nested and/or) are not
      // parsed: every row passes and the caller's own in-memory check
      // decides, which is what each of them does anyway.
      or() {
        return builder;
      },
      not() {
        return builder;
      },
      order(column: string, options?: { ascending?: boolean }) {
        orderBy = { column, ascending: options?.ascending ?? true };
        return builder;
      },
      limit(count: number) {
        window = { from: 0, to: count - 1 };
        return builder;
      },
      range(from: number, to: number) {
        window = { from, to };
        return builder;
      },
      async maybeSingle() {
        return { data: run()[0] ?? null, error: null };
      },
      async single() {
        const row = run()[0] ?? null;
        return row
          ? { data: row, error: null }
          : { data: null, error: { message: 'no rows', code: 'PGRST116' } };
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
  const rpc = async (name: string, args: Record<string, unknown> = {}) => {
    const handler = rpcs[name];
    if (!handler) return { data: null, error: { message: `no rpc ${name}` } };
    return { data: await handler(args), error: null };
  };
  return { from, rpc };
}
