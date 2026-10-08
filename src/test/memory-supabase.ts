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

function compare(a: unknown, b: unknown): number {
  const an = Number(a);
  const bn = Number(b);
  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
  return String(a ?? '').localeCompare(String(b ?? ''));
}

function splitClauses(expression: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of expression) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) out.push(current);
  return out;
}

function parseClause(clause: string): Filter {
  const text = clause.trim();
  if (text.startsWith('and(') && text.endsWith(')')) {
    const parts = splitClauses(text.slice(4, -1)).map(parseClause);
    return (row) => parts.every((part) => part(row));
  }
  if (text.startsWith('or(') && text.endsWith(')')) {
    const parts = splitClauses(text.slice(3, -1)).map(parseClause);
    return (row) => parts.some((part) => part(row));
  }
  const [column, operator, ...rest] = text.split('.');
  let value: unknown = rest.join('.');
  if (typeof value === 'string' && /^".*"$/.test(value))
    value = value.slice(1, -1);
  if (value === 'null') value = null;
  switch (operator) {
    case 'eq':
      return (row) => same(row[column] ?? null, value);
    case 'neq':
      return (row) => !same(row[column] ?? null, value);
    case 'is':
      return (row) => (row[column] ?? null) === value;
    case 'lt':
      return (row) => compare(row[column], value) < 0;
    case 'lte':
      return (row) => compare(row[column], value) <= 0;
    case 'gt':
      return (row) => compare(row[column], value) > 0;
    case 'gte':
      return (row) => compare(row[column], value) >= 0;
    default:
      return () => true;
  }
}

let nextId = 1;

export function memorySupabase(
  tables: Record<string, Row[]>,
  rpcs: Record<string, RpcHandler> = {}
) {
  const from = (table: string) => {
    const filters: Filter[] = [];
    let patch: Row | null = null;
    let removing = false;
    let inserted: Row[] | null = null;
    let head = false;
    const orderBy: { column: string; ascending: boolean }[] = [];
    let window: { from: number; to: number } | null = null;
    const rows = () => (tables[table] ??= []);
    const run = (): Row[] => {
      if (inserted) return inserted.map((row) => structuredClone(row));
      const matched = rows().filter((row) => filters.every((f) => f(row)));
      if (patch) {
        for (const row of matched) Object.assign(row, structuredClone(patch));
      }
      if (removing) {
        tables[table] = rows().filter((row) => !matched.includes(row));
      }
      let out = matched.map((row) => structuredClone(row));
      if (orderBy.length) {
        out = [...out].sort((a, b) => {
          for (const { column, ascending } of orderBy) {
            const av = String(a[column] ?? '');
            const bv = String(b[column] ?? '');
            const cmp = ascending ? av.localeCompare(bv) : bv.localeCompare(av);
            if (cmp !== 0) return cmp;
          }
          return 0;
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
      delete() {
        removing = true;
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
        filters.push((row) => compare(row[column], value) > 0);
        return builder;
      },
      lt(column: string, value: unknown) {
        filters.push((row) => compare(row[column], value) < 0);
        return builder;
      },
      lte(column: string, value: unknown) {
        filters.push((row) => compare(row[column], value) <= 0);
        return builder;
      },
      // A PostgREST filter string is parsed for eq/neq/lt/lte/gt/gte/is
      // clauses and and(...) groups; any other operator (an ilike probe)
      // passes every row and the caller's own in-memory check decides,
      // which is what each of them does anyway. `not(col, 'is', value)`
      // is the one negation that is honoured.
      or(expression: string) {
        const clauses = splitClauses(expression).map(parseClause);
        filters.push((row) => clauses.some((clause) => clause(row)));
        return builder;
      },
      not(column?: string, operator?: string, value?: unknown) {
        if (column && operator === 'is') {
          filters.push((row) => (row[column] ?? null) !== (value ?? null));
        }
        return builder;
      },
      order(column: string, options?: { ascending?: boolean }) {
        orderBy.push({ column, ascending: options?.ascending ?? true });
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
