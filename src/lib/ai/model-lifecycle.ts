import { supabaseAdmin } from '@/lib/supabase/admin';

export const MODEL_LIFECYCLE_SETTING = 'ai_model_lifecycle';
const CACHE_TTL_MS = 60_000;

export interface RetiredModel {
  retiredAt: string;
  replacement: string | null;
  message: string;
}

export interface ModelLifecycle {
  retired: Record<string, RetiredModel>;
  checkedAt: string | null;
}

export const EMPTY_MODEL_LIFECYCLE: ModelLifecycle = {
  retired: {},
  checkedAt: null,
};

let cache: { state: ModelLifecycle; fetchedAt: number } | null = null;

export function parseModelLifecycle(raw: unknown): ModelLifecycle {
  if (!raw || typeof raw !== 'object') return EMPTY_MODEL_LIFECYCLE;
  const value = raw as { retired?: unknown; checkedAt?: unknown };
  const retired: Record<string, RetiredModel> = {};
  if (value.retired && typeof value.retired === 'object') {
    for (const [model, entry] of Object.entries(value.retired)) {
      if (!entry || typeof entry !== 'object') continue;
      const row = entry as Partial<RetiredModel>;
      retired[model] = {
        retiredAt: typeof row.retiredAt === 'string' ? row.retiredAt : '',
        replacement:
          typeof row.replacement === 'string' && row.replacement
            ? row.replacement
            : null,
        message: typeof row.message === 'string' ? row.message : '',
      };
    }
  }
  return {
    retired,
    checkedAt: typeof value.checkedAt === 'string' ? value.checkedAt : null,
  };
}

export function applyModelLifecycle(
  chain: string[],
  state: ModelLifecycle
): string[] {
  const live: string[] = [];
  for (const model of chain) {
    let current: string | null = model;
    const visited = new Set<string>();
    while (current && state.retired[current] && !visited.has(current)) {
      visited.add(current);
      current = state.retired[current].replacement;
    }
    if (current && !state.retired[current] && !live.includes(current)) {
      live.push(current);
    }
  }
  return live.length ? live : chain;
}

const SUCCESSOR_PATTERN = /use models\/([\w.-]+)/i;
const NON_TEXT_MODEL = /tts|image|embedding|audio|live/i;

export function successorFromMessage(
  message: string,
  retired: string
): string | null {
  const successor = SUCCESSOR_PATTERN.exec(message)?.[1]?.replace(/\.$/, '');
  if (!successor || successor === retired) return null;
  if (!successor.startsWith('gemini-') || NON_TEXT_MODEL.test(successor)) {
    return null;
  }
  return successor;
}

export function cachedModelLifecycle(): ModelLifecycle {
  return cache?.state ?? EMPTY_MODEL_LIFECYCLE;
}

export async function readModelLifecycle(): Promise<ModelLifecycle> {
  const { data, error } = await supabaseAdmin()
    .from('system_settings')
    .select('value')
    .eq('key', MODEL_LIFECYCLE_SETTING)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return parseModelLifecycle((data as { value?: unknown } | null)?.value);
}

export async function refreshModelLifecycle(
  now = Date.now()
): Promise<ModelLifecycle> {
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache.state;
  let state: ModelLifecycle;
  try {
    state = await readModelLifecycle();
  } catch {
    state = cache?.state ?? EMPTY_MODEL_LIFECYCLE;
  }
  cache = { state, fetchedAt: now };
  return state;
}

export async function saveModelLifecycle(state: ModelLifecycle): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('system_settings')
    .upsert(
      { key: MODEL_LIFECYCLE_SETTING, value: state },
      { onConflict: 'key' }
    );
  if (error) throw new Error(error.message);
  cache = { state, fetchedAt: Date.now() };
}

export function resetModelLifecycleCache(): void {
  cache = null;
}
