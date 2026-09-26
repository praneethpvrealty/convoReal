import type { SupabaseClient } from '@supabase/supabase-js';

import { encrypt } from '@/lib/whatsapp/encryption';

import type { GeminiKeyScope } from './gemini-keys';

export const KEY_COLUMNS =
  'id, label, key_hint, scope, priority, enabled, resting_until, last_error, last_error_at, last_used_at, created_at';

export interface ManagedKeyRow {
  id: string;
  label: string;
  key_hint: string;
  scope: GeminiKeyScope;
  priority: number;
  enabled: boolean;
  resting_until: string | null;
  last_error: string | null;
  last_error_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

export interface TopupRow {
  id: string;
  key_id: string;
  amount: number;
  currency: 'USD' | 'INR';
  topped_up_at: string;
  note: string | null;
}

export interface ModelPrice {
  input: number;
  output: number;
}

export interface Pricing {
  models: Record<string, ModelPrice>;
  inrPerUsd: number;
}

export const DEFAULT_PRICING: Pricing = {
  models: {
    'gemini-2.5-flash': { input: 0.3, output: 2.5 },
    'gemini-3.5-flash': { input: 0.3, output: 2.5 },
    'gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
    'gemini-3.1-flash-lite': { input: 0.1, output: 0.4 },
    'gemini-embedding-001': { input: 0.15, output: 0 },
  },
  inrPerUsd: 84,
};

const PRICING_SETTING_KEY = 'ai_pricing';
const LABEL_PATTERN = /^[\w.@+ -]{2,60}$/;
const KEY_PATTERN = /^[\x21-\x7e]{20,300}$/;

export function priceFor(model: string, pricing: Pricing): ModelPrice {
  const exact = pricing.models[model];
  if (exact) return exact;
  const lower = model.toLowerCase();
  if (lower.includes('embedding')) {
    return pricing.models['gemini-embedding-001'] ?? { input: 0, output: 0 };
  }
  if (lower.includes('lite')) {
    return pricing.models['gemini-2.5-flash-lite'] ?? { input: 0, output: 0 };
  }
  return pricing.models['gemini-3.5-flash'] ?? { input: 0, output: 0 };
}

export const BATCH_FEATURES: ReadonlySet<string> = new Set([
  'guidance_value_source_batch',
]);
const BATCH_PRICE_FACTOR = 0.5;

export function estimateCostUsd(
  model: string,
  promptTokens: number,
  responseTokens: number,
  pricing: Pricing,
  feature?: string | null
): number {
  const price = priceFor(model, pricing);
  const cost =
    (promptTokens / 1_000_000) * price.input +
    (responseTokens / 1_000_000) * price.output;
  return feature && BATCH_FEATURES.has(feature)
    ? cost * BATCH_PRICE_FACTOR
    : cost;
}

function sanitisePricing(raw: unknown): Partial<Pricing> {
  if (!raw || typeof raw !== 'object') return {};
  const input = raw as { models?: unknown; inrPerUsd?: unknown };
  const out: Partial<Pricing> = {};
  if (input.models && typeof input.models === 'object') {
    const models: Record<string, ModelPrice> = {};
    for (const [model, value] of Object.entries(
      input.models as Record<string, unknown>
    )) {
      const price = value as { input?: unknown; output?: unknown };
      const inputPrice = Number(price?.input);
      const outputPrice = Number(price?.output);
      if (
        /^[a-z0-9.-]{3,60}$/.test(model) &&
        Number.isFinite(inputPrice) &&
        inputPrice >= 0 &&
        Number.isFinite(outputPrice) &&
        outputPrice >= 0
      ) {
        models[model] = { input: inputPrice, output: outputPrice };
      }
    }
    out.models = models;
  }
  const rate = Number(input.inrPerUsd);
  if (Number.isFinite(rate) && rate > 0) out.inrPerUsd = rate;
  return out;
}

export function mergePricing(raw: unknown): Pricing {
  const override = sanitisePricing(raw);
  return {
    models: { ...DEFAULT_PRICING.models, ...(override.models ?? {}) },
    inrPerUsd: override.inrPerUsd ?? DEFAULT_PRICING.inrPerUsd,
  };
}

export async function loadPricing(db: SupabaseClient): Promise<Pricing> {
  const { data } = await db
    .from('system_settings')
    .select('value')
    .eq('key', PRICING_SETTING_KEY)
    .maybeSingle();
  return mergePricing((data as { value?: unknown } | null)?.value);
}

export async function savePricing(
  db: SupabaseClient,
  raw: unknown
): Promise<Pricing> {
  const pricing = mergePricing(raw);
  const { error } = await db
    .from('system_settings')
    .upsert(
      { key: PRICING_SETTING_KEY, value: pricing },
      { onConflict: 'key' }
    );
  if (error) throw new Error(error.message);
  return pricing;
}

export class KeyInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyInputError';
  }
}

export function validateKeyInput(body: unknown): {
  label: string;
  key: string;
  scope: GeminiKeyScope;
  priority: number;
} {
  const input = (body ?? {}) as Record<string, unknown>;
  const label = typeof input.label === 'string' ? input.label.trim() : '';
  const key = typeof input.key === 'string' ? input.key.trim() : '';
  if (!LABEL_PATTERN.test(label)) {
    throw new KeyInputError(
      'Label must be 2–60 characters: letters, digits, space, . _ @ + -'
    );
  }
  if (!KEY_PATTERN.test(key)) {
    throw new KeyInputError('That does not look like a Gemini API key.');
  }
  const scope: GeminiKeyScope = input.scope === 'import' ? 'import' : 'general';
  const priority = Number.isInteger(Number(input.priority))
    ? Math.max(-1000, Math.min(1000, Number(input.priority)))
    : 0;
  return { label, key, scope, priority };
}

const REJECTED_KEY_PATTERNS = [
  /api key not valid/i,
  /api_key_invalid/i,
  /api key expired/i,
  /api key not found/i,
  /permission_denied/i,
  /unauthenticated/i,
];

export function isRejectedKeyMessage(message: string): boolean {
  return REJECTED_KEY_PATTERNS.some((pattern) => pattern.test(message));
}

export function keyHint(key: string): string {
  return `…${key.slice(-4)}`;
}

const BILLING_URL = 'https://console.cloud.google.com/billing';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function billingUrl(label: string): string {
  const account = label.trim();
  return EMAIL_PATTERN.test(account)
    ? `${BILLING_URL}?authuser=${encodeURIComponent(account)}`
    : BILLING_URL;
}

export async function createManagedKey(
  db: SupabaseClient,
  body: unknown,
  userId: string
): Promise<ManagedKeyRow> {
  const input = validateKeyInput(body);
  const { data, error } = await db
    .from('ai_provider_keys')
    .insert({
      provider: 'gemini',
      label: input.label,
      key_ciphertext: encrypt(input.key),
      key_hint: keyHint(input.key),
      scope: input.scope,
      priority: input.priority,
      created_by: userId,
    })
    .select(KEY_COLUMNS)
    .single<ManagedKeyRow>();
  if (error) {
    if (error.code === '23505') {
      throw new KeyInputError('A key with that label already exists.');
    }
    throw new Error(error.message);
  }
  return data;
}

export function validateKeyPatch(body: unknown): Record<string, unknown> {
  const input = (body ?? {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if (typeof input.label === 'string') {
    const label = input.label.trim();
    if (!LABEL_PATTERN.test(label)) {
      throw new KeyInputError(
        'Label must be 2–60 characters: letters, digits, space, . _ @ + -'
      );
    }
    patch.label = label;
  }
  if (typeof input.enabled === 'boolean') patch.enabled = input.enabled;
  if (input.scope === 'import' || input.scope === 'general') {
    patch.scope = input.scope;
  }
  if (input.priority !== undefined) {
    const priority = Number(input.priority);
    if (!Number.isInteger(priority)) {
      throw new KeyInputError('Priority must be a whole number.');
    }
    patch.priority = Math.max(-1000, Math.min(1000, priority));
  }
  if (input.reset === true) {
    patch.resting_until = null;
    patch.last_error = null;
    patch.last_error_at = null;
  }
  if (!Object.keys(patch).length) {
    throw new KeyInputError('Nothing to update.');
  }
  return patch;
}

export function validateTopup(body: unknown): {
  amount: number;
  currency: 'USD' | 'INR';
  topped_up_at: string;
  note: string | null;
} {
  const input = (body ?? {}) as Record<string, unknown>;
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) {
    throw new KeyInputError('Enter the top-up amount.');
  }
  const currency = input.currency === 'INR' ? 'INR' : 'USD';
  const at =
    typeof input.topped_up_at === 'string' && input.topped_up_at
      ? new Date(input.topped_up_at)
      : new Date();
  if (Number.isNaN(at.getTime()) || at.getTime() > Date.now() + 86_400_000) {
    throw new KeyInputError('Enter a valid top-up date.');
  }
  const note =
    typeof input.note === 'string' && input.note.trim()
      ? input.note.trim().slice(0, 200)
      : null;
  return {
    amount: Math.round(amount * 100) / 100,
    currency,
    topped_up_at: at.toISOString(),
    note,
  };
}

export interface UsageBucket {
  calls: number;
  failures: number;
  promptTokens: number;
  responseTokens: number;
  costUsd: number;
}

export interface DailyUsageRow {
  day: string;
  key_label: string;
  model: string;
  feature: string;
  calls: number;
  failures: number;
  prompt_tokens: number;
  response_tokens: number;
}

export interface KeyDashboardEntry {
  id: string | null;
  label: string;
  hint: string | null;
  scope: GeminiKeyScope | null;
  priority: number | null;
  enabled: boolean;
  managed: boolean;
  status: 'active' | 'resting' | 'disabled' | 'unmanaged';
  resting_until: string | null;
  last_error: string | null;
  last_error_at: string | null;
  last_used_at: string | null;
  today: UsageBucket;
  month: UsageBucket;
  sinceTopup: UsageBucket | null;
  topups: TopupRow[];
  lastTopup: TopupRow | null;
  estimatedRemaining: {
    amount: number;
    currency: 'USD' | 'INR';
    since: string;
    partial: boolean;
  } | null;
}

export interface KeyDashboard {
  keys: KeyDashboardEntry[];
  daily: {
    byKey: Array<Record<string, number | string>>;
    byFeature: Array<Record<string, number | string>>;
    keyLabels: string[];
    features: string[];
  };
  pricing: Pricing;
  envFallback: { primary: boolean; fallbacks: number; import: number };
  days: number;
  usageDays: number;
  loggingEnabled: boolean;
}

export const MAX_USAGE_DAYS = 90;

export function usageWindowDays(
  chartDays: number,
  topups: TopupRow[],
  now: Date = new Date()
): number {
  const today = kolkataDate(now);
  const monthStart = new Date(`${today.slice(0, 8)}01T00:00:00+05:30`);
  let earliest = monthStart.getTime();
  const latestByKey = new Map<string, string>();
  for (const topup of topups) {
    const current = latestByKey.get(topup.key_id);
    if (!current || topup.topped_up_at > current) {
      latestByKey.set(topup.key_id, topup.topped_up_at);
    }
  }
  for (const at of latestByKey.values()) {
    earliest = Math.min(earliest, new Date(at).getTime());
  }
  const needed = Math.ceil((now.getTime() - earliest) / 86_400_000) + 1;
  return Math.min(MAX_USAGE_DAYS, Math.max(chartDays, needed));
}

function emptyBucket(): UsageBucket {
  return {
    calls: 0,
    failures: 0,
    promptTokens: 0,
    responseTokens: 0,
    costUsd: 0,
  };
}

function add(bucket: UsageBucket, row: DailyUsageRow, pricing: Pricing): void {
  bucket.calls += row.calls;
  bucket.failures += row.failures;
  bucket.promptTokens += row.prompt_tokens;
  bucket.responseTokens += row.response_tokens;
  bucket.costUsd += estimateCostUsd(
    row.model,
    row.prompt_tokens,
    row.response_tokens,
    pricing,
    row.feature
  );
}

export function kolkataDate(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

function envCount(value: string | undefined): number {
  return (value ?? '').split(',').filter((v) => v.trim()).length;
}

export function buildKeyDashboard(input: {
  keys: ManagedKeyRow[];
  topups: TopupRow[];
  usage: DailyUsageRow[];
  pricing: Pricing;
  days: number;
  usageDays?: number;
  loggingEnabled?: boolean;
  now?: Date;
}): KeyDashboard {
  const now = input.now ?? new Date();
  const today = kolkataDate(now);
  const monthStart = today.slice(0, 8) + '01';
  const nowMs = now.getTime();
  const usageDays = input.usageDays ?? input.days;
  const windowStart = kolkataDate(
    new Date(nowMs - (usageDays - 1) * 86_400_000)
  );

  const topupsByKey = new Map<string, TopupRow[]>();
  for (const topup of input.topups) {
    const list = topupsByKey.get(topup.key_id) ?? [];
    list.push(topup);
    topupsByKey.set(topup.key_id, list);
  }
  for (const list of topupsByKey.values()) {
    list.sort((a, b) => b.topped_up_at.localeCompare(a.topped_up_at));
  }

  const usageByLabel = new Map<string, DailyUsageRow[]>();
  for (const row of input.usage) {
    const list = usageByLabel.get(row.key_label) ?? [];
    list.push(row);
    usageByLabel.set(row.key_label, list);
  }

  const entries: KeyDashboardEntry[] = [];
  const seenLabels = new Set<string>();

  for (const key of input.keys) {
    seenLabels.add(key.label);
    const rows = usageByLabel.get(key.label) ?? [];
    const todayBucket = emptyBucket();
    const monthBucket = emptyBucket();
    for (const row of rows) {
      if (row.day === today) add(todayBucket, row, input.pricing);
      if (row.day >= monthStart) add(monthBucket, row, input.pricing);
    }
    const topups = topupsByKey.get(key.id) ?? [];
    const lastTopup = topups[0] ?? null;
    let sinceTopup: UsageBucket | null = null;
    let estimatedRemaining: KeyDashboardEntry['estimatedRemaining'] = null;
    if (lastTopup) {
      const topupDay = kolkataDate(new Date(lastTopup.topped_up_at));
      const partial = topupDay < windowStart;
      const since = partial ? windowStart : topupDay;
      sinceTopup = emptyBucket();
      for (const row of rows) {
        if (row.day >= since) add(sinceTopup, row, input.pricing);
      }
      const spent =
        lastTopup.currency === 'INR'
          ? sinceTopup.costUsd * input.pricing.inrPerUsd
          : sinceTopup.costUsd;
      estimatedRemaining = {
        amount: Math.round((lastTopup.amount - spent) * 100) / 100,
        currency: lastTopup.currency,
        since,
        partial,
      };
    }
    const resting =
      key.resting_until && new Date(key.resting_until).getTime() > nowMs;
    entries.push({
      id: key.id,
      label: key.label,
      hint: key.key_hint,
      scope: key.scope,
      priority: key.priority,
      enabled: key.enabled,
      managed: true,
      status: !key.enabled ? 'disabled' : resting ? 'resting' : 'active',
      resting_until: resting ? key.resting_until : null,
      last_error: key.last_error,
      last_error_at: key.last_error_at,
      last_used_at: key.last_used_at,
      today: todayBucket,
      month: monthBucket,
      sinceTopup,
      topups,
      lastTopup,
      estimatedRemaining,
    });
  }

  for (const [label, rows] of usageByLabel) {
    if (seenLabels.has(label)) continue;
    const todayBucket = emptyBucket();
    const monthBucket = emptyBucket();
    for (const row of rows) {
      if (row.day === today) add(todayBucket, row, input.pricing);
      if (row.day >= monthStart) add(monthBucket, row, input.pricing);
    }
    if (!monthBucket.calls) continue;
    entries.push({
      id: null,
      label,
      hint: null,
      scope: null,
      priority: null,
      enabled: true,
      managed: false,
      status: 'unmanaged',
      resting_until: null,
      last_error: null,
      last_error_at: null,
      last_used_at: null,
      today: todayBucket,
      month: monthBucket,
      sinceTopup: null,
      topups: [],
      lastTopup: null,
      estimatedRemaining: null,
    });
  }

  const days: string[] = [];
  for (let i = input.days - 1; i >= 0; i -= 1) {
    days.push(kolkataDate(new Date(nowMs - i * 86_400_000)));
  }
  const keyLabels = [...new Set(input.usage.map((r) => r.key_label))].sort();
  const features = [...new Set(input.usage.map((r) => r.feature))].sort();
  const byKey = days.map((day) => {
    const point: Record<string, number | string> = { day };
    for (const label of keyLabels) point[label] = 0;
    return point;
  });
  const byFeature = days.map((day) => {
    const point: Record<string, number | string> = { day };
    for (const feature of features) point[feature] = 0;
    return point;
  });
  const dayIndex = new Map(days.map((day, i) => [day, i]));
  for (const row of input.usage) {
    const index = dayIndex.get(row.day);
    if (index === undefined) continue;
    const cost = estimateCostUsd(
      row.model,
      row.prompt_tokens,
      row.response_tokens,
      input.pricing,
      row.feature
    );
    byKey[index][row.key_label] =
      Math.round(((byKey[index][row.key_label] as number) + cost) * 10000) /
      10000;
    byFeature[index][row.feature] =
      Math.round(((byFeature[index][row.feature] as number) + cost) * 10000) /
      10000;
  }

  return {
    keys: entries,
    daily: { byKey, byFeature, keyLabels, features },
    pricing: input.pricing,
    envFallback: {
      primary: Boolean(process.env.GEMINI_API_KEY),
      fallbacks: envCount(process.env.GEMINI_FALLBACK_API_KEYS),
      import: envCount(process.env.GEMINI_IMPORT_API_KEY),
    },
    days: input.days,
    usageDays,
    loggingEnabled: input.loggingEnabled ?? true,
  };
}

export async function loadKeyDashboard(
  db: SupabaseClient,
  days: number
): Promise<KeyDashboard> {
  const [keysRes, topupsRes, pricing, loggingRes] = await Promise.all([
    db
      .from('ai_provider_keys')
      .select(KEY_COLUMNS)
      .eq('provider', 'gemini')
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true }),
    db
      .from('ai_key_topups')
      .select('id, key_id, amount, currency, topped_up_at, note')
      .order('topped_up_at', { ascending: false })
      .limit(500),
    loadPricing(db),
    db
      .from('system_settings')
      .select('value')
      .eq('key', 'ai_call_log')
      .maybeSingle(),
  ]);
  if (keysRes.error) throw new Error(keysRes.error.message);
  if (topupsRes.error) throw new Error(topupsRes.error.message);
  const topups = ((topupsRes.data ?? []) as TopupRow[]).map((t) => ({
    ...t,
    amount: Number(t.amount),
  }));
  const usageDays = usageWindowDays(days, topups);
  const usageRes = await db.rpc('ai_key_daily_usage', { p_days: usageDays });
  if (usageRes.error) throw new Error(usageRes.error.message);
  const loggingValue = (loggingRes.data as { value?: unknown } | null)?.value;
  return buildKeyDashboard({
    keys: (keysRes.data ?? []) as ManagedKeyRow[],
    topups,
    usage: ((usageRes.data ?? []) as DailyUsageRow[]).map((r) => ({
      ...r,
      calls: Number(r.calls),
      failures: Number(r.failures),
      prompt_tokens: Number(r.prompt_tokens),
      response_tokens: Number(r.response_tokens),
    })),
    pricing,
    days,
    usageDays,
    loggingEnabled:
      (loggingValue as { enabled?: boolean } | null)?.enabled === true,
  });
}

export async function setCallLogging(
  db: SupabaseClient,
  enabled: boolean
): Promise<void> {
  const { error } = await db
    .from('system_settings')
    .upsert({ key: 'ai_call_log', value: { enabled } }, { onConflict: 'key' });
  if (error) throw new Error(error.message);
}
