import { supabaseAdmin } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/whatsapp/encryption';

export type GeminiKeyScope = 'general' | 'import';
export type GeminiKeyFailure = 'exhausted' | 'rate_limited';

export interface GeminiKey {
  id: string | null;
  label: string;
  key: string;
  scope: GeminiKeyScope;
  restingUntil: number;
  lastError: string | null;
}

const KEY_EXHAUSTED_PATTERNS = [
  /credits are depleted/i,
  /prepayment/i,
  /api key not valid/i,
  /api key expired/i,
  /api_key_invalid/i,
];

const KEY_RATE_LIMITED_PATTERNS = [
  /quota/i,
  /resource[_ ]?exhausted/i,
  /rate limit/i,
  /\b429\b/,
];

export function classifyGeminiKeyFailure(
  message: string
): GeminiKeyFailure | null {
  if (KEY_EXHAUSTED_PATTERNS.some((pattern) => pattern.test(message)))
    return 'exhausted';
  if (KEY_RATE_LIMITED_PATTERNS.some((pattern) => pattern.test(message)))
    return 'rate_limited';
  if (/billing/i.test(message)) return 'exhausted';
  return null;
}

export const KEY_COOLDOWN_MS: Record<GeminiKeyFailure, number> = {
  exhausted: 10 * 60_000,
  rate_limited: 60_000,
};

const POOL_TTL_MS = 60_000;
const LAST_USED_WRITE_INTERVAL_MS = 60_000;

const cooldowns = new Map<string, { until: number; message: string }>();
const lastUsedWrites = new Map<string, number>();
let managedCache: { fetchedAt: number; keys: GeminiKey[] } | null = null;

export const NO_KEY_MESSAGE =
  'GEMINI_API_KEY is not configured. Please add it to your .env.local file.';

export function parseEnvKeys(
  value: string | undefined,
  defaultLabel: (index: number) => string,
  scope: GeminiKeyScope
): GeminiKey[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, index) => {
      const eq = entry.indexOf('=');
      const label = eq > 0 ? entry.slice(0, eq).trim() : '';
      const key = eq > 0 ? entry.slice(eq + 1).trim() : entry;
      return {
        id: null,
        label: label || defaultLabel(index),
        key,
        scope,
        restingUntil: 0,
        lastError: null,
      };
    })
    .filter((entry) => entry.key);
}

function envImportKeys(): GeminiKey[] {
  return parseEnvKeys(
    process.env.GEMINI_IMPORT_API_KEY,
    (i) => `import-${i + 1}`,
    'import'
  );
}

function envGeneralKeys(): GeminiKey[] {
  return [
    ...parseEnvKeys(process.env.GEMINI_API_KEY, () => 'primary', 'general'),
    ...parseEnvKeys(
      process.env.GEMINI_FALLBACK_API_KEYS,
      (i) => `fallback-${i + 1}`,
      'general'
    ),
  ];
}

interface ManagedKeyRow {
  id: string;
  label: string;
  key_ciphertext: string;
  scope: GeminiKeyScope;
  resting_until: string | null;
  last_error: string | null;
}

function restingMs(value: string | null): number {
  return value ? new Date(value).getTime() : 0;
}

async function fetchManagedRows(): Promise<ManagedKeyRow[]> {
  const { data, error } = await supabaseAdmin()
    .from('ai_provider_keys')
    .select('id, label, key_ciphertext, scope, resting_until, last_error')
    .eq('provider', 'gemini')
    .eq('enabled', true)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ManagedKeyRow[];
}

async function loadManagedKeys(): Promise<GeminiKey[]> {
  const cached =
    managedCache && Date.now() - managedCache.fetchedAt < POOL_TTL_MS
      ? managedCache.keys
      : null;
  let rows: ManagedKeyRow[];
  try {
    rows = await fetchManagedRows();
  } catch (err) {
    if (cached) return cached;
    console.warn(
      '[Gemini AI] Managed keys unavailable; using environment keys:',
      err instanceof Error ? err.message : err
    );
    managedCache = { fetchedAt: Date.now(), keys: [] };
    return [];
  }
  const byId = new Map((cached ?? []).map((entry) => [entry.id, entry]));
  const keys: GeminiKey[] = [];
  for (const row of rows) {
    const existing = byId.get(row.id);
    if (existing) {
      existing.label = row.label;
      existing.scope = row.scope === 'import' ? 'import' : 'general';
      existing.restingUntil = restingMs(row.resting_until);
      existing.lastError = row.last_error;
      keys.push(existing);
      continue;
    }
    try {
      keys.push({
        id: row.id,
        label: row.label,
        key: decrypt(row.key_ciphertext),
        scope: row.scope === 'import' ? 'import' : 'general',
        restingUntil: restingMs(row.resting_until),
        lastError: row.last_error,
      });
    } catch (err) {
      console.error(
        `[Gemini AI] Could not decrypt key "${row.label}":`,
        err instanceof Error ? err.message : err
      );
    }
  }
  managedCache = {
    fetchedAt: cached ? managedCache!.fetchedAt : Date.now(),
    keys,
  };
  return keys;
}

function dedupe(keys: GeminiKey[]): GeminiKey[] {
  const seen = new Set<string>();
  return keys.filter((entry) => {
    if (seen.has(entry.key)) return false;
    seen.add(entry.key);
    return true;
  });
}

export async function resolveGeminiKeys(opts: {
  scope?: GeminiKeyScope;
  override?: string;
}): Promise<GeminiKey[]> {
  const scope = opts.scope ?? 'general';
  if (opts.override) {
    return dedupe(
      parseEnvKeys(opts.override, (i) => `override-${i + 1}`, scope)
    );
  }
  const managed = await loadManagedKeys();
  if (scope === 'import') {
    const managedImport = managed.filter((entry) => entry.scope === 'import');
    if (managedImport.length) return dedupe(managedImport);
    const envImport = envImportKeys();
    if (envImport.length) return dedupe(envImport);
  }
  const managedGeneral = managed.filter((entry) => entry.scope === 'general');
  if (managedGeneral.length) return dedupe(managedGeneral);
  return dedupe(envGeneralKeys());
}

function restingUntil(entry: GeminiKey): number {
  return Math.max(entry.restingUntil, cooldowns.get(entry.key)?.until ?? 0);
}

export function readyKeys(keys: GeminiKey[], now = Date.now()): GeminiKey[] {
  return keys.filter((entry) => restingUntil(entry) <= now);
}

function soonestRestingMessage(keys: GeminiKey[]): string | null {
  const entries = keys
    .map((entry) => ({
      until: restingUntil(entry),
      message: cooldowns.get(entry.key)?.message ?? entry.lastError,
    }))
    .filter((entry) => entry.until > 0)
    .sort((a, b) => a.until - b.until);
  const first = entries[0];
  if (!first) return null;
  return (
    first.message ??
    `Every Gemini key is resting until ${new Date(first.until).toISOString()}.`
  );
}

function persist(id: string | null, patch: Record<string, unknown>): void {
  if (!id) return;
  void (async () => {
    try {
      await supabaseAdmin().from('ai_provider_keys').update(patch).eq('id', id);
    } catch {
      // Key bookkeeping must never surface into the AI call path.
    }
  })();
}

export function markKeyFailure(
  entry: GeminiKey,
  failure: GeminiKeyFailure,
  message: string
): void {
  const until = Date.now() + KEY_COOLDOWN_MS[failure];
  cooldowns.set(entry.key, { until, message });
  entry.restingUntil = until;
  entry.lastError = message;
  persist(entry.id, {
    resting_until: new Date(until).toISOString(),
    last_error: message.slice(0, 500),
    last_error_at: new Date().toISOString(),
  });
  if (failure === 'exhausted') {
    void import('./key-alerts')
      .then((alerts) => alerts.alertKeyExhausted(entry, message))
      .catch(() => undefined);
  }
}

export function markKeySuccess(entry: GeminiKey): void {
  cooldowns.delete(entry.key);
  entry.restingUntil = 0;
  if (!entry.id) return;
  const last = lastUsedWrites.get(entry.id) ?? 0;
  if (Date.now() - last < LAST_USED_WRITE_INTERVAL_MS) return;
  lastUsedWrites.set(entry.id, Date.now());
  persist(entry.id, {
    last_used_at: new Date().toISOString(),
    resting_until: null,
  });
}

export function resetGeminiKeyState(): void {
  cooldowns.clear();
  lastUsedWrites.clear();
  managedCache = null;
}

export async function withGeminiKeys<T>(
  opts: { scope?: GeminiKeyScope; override?: string },
  call: (entry: GeminiKey) => Promise<T>
): Promise<T> {
  const pool = await resolveGeminiKeys(opts);
  if (!pool.length) throw new Error(NO_KEY_MESSAGE);
  const keys = readyKeys(pool);
  if (!keys.length) {
    const reason = soonestRestingMessage(pool);
    void import('./key-alerts')
      .then((alerts) =>
        alerts.alertAllKeysResting(
          pool.map((entry) => entry.label),
          reason
        )
      )
      .catch(() => undefined);
    throw new Error(reason ?? NO_KEY_MESSAGE);
  }
  let lastError: unknown;
  for (const [index, entry] of keys.entries()) {
    try {
      const result = await call(entry);
      markKeySuccess(entry);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failure = classifyGeminiKeyFailure(message);
      if (!failure) throw err;
      markKeyFailure(entry, failure, message);
      lastError = err;
      if (index < keys.length - 1) {
        console.warn(
          `[Gemini AI] Key "${entry.label}" unavailable (${failure}); trying the next key.`
        );
      }
    }
  }
  throw lastError;
}
