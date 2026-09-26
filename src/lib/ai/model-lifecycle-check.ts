import { configuredModels } from '@/lib/ai/gemini';
import {
  isRetiredModelMessage,
  readyKeys,
  resolveGeminiKeys,
  type GeminiKey,
} from '@/lib/ai/gemini-keys';
import {
  readModelLifecycle,
  saveModelLifecycle,
  successorFromMessage,
  type ModelLifecycle,
  type RetiredModel,
} from '@/lib/ai/model-lifecycle';

export type ProbeStatus = 'ok' | 'retired' | 'inconclusive';

export interface ProbeResult {
  status: ProbeStatus;
  message: string;
}

export interface ModelLifecycleReport {
  checkedAt: string;
  probed: Record<string, ProbeStatus>;
  retired: Array<{ model: string; replacement: string | null }>;
  restored: string[];
  skipped?: string;
}

export async function probeModel(
  apiKey: string,
  model: string
): Promise<ProbeResult> {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Reply with the single word OK.' }] }],
          generationConfig: { maxOutputTokens: 5 },
        }),
      }
    );
    if (response.ok) return { status: 'ok', message: '' };
    const body = await response.json().catch(() => ({}));
    const message: string =
      body?.error?.message || `Gemini API returned ${response.status}`;
    return {
      status: isRetiredModelMessage(message) ? 'retired' : 'inconclusive',
      message,
    };
  } catch (err) {
    return {
      status: 'inconclusive',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function verdict(keys: GeminiKey[], model: string): Promise<ProbeResult> {
  let retired: ProbeResult | null = null;
  let last: ProbeResult = { status: 'inconclusive', message: '' };
  for (const key of keys) {
    const result = await probeModel(key.key, model);
    if (result.status === 'ok') return result;
    if (result.status === 'retired') retired ??= result;
    last = result;
  }
  return retired ?? last;
}

async function checkKeys(): Promise<GeminiKey[]> {
  const pool = [
    ...(await resolveGeminiKeys({ scope: 'general' })),
    ...(await resolveGeminiKeys({ scope: 'import' })),
  ];
  const seen = new Set<string>();
  return readyKeys(pool).filter((entry) => {
    if (seen.has(entry.key)) return false;
    seen.add(entry.key);
    return true;
  });
}

export async function checkModelLifecycle(
  now = new Date()
): Promise<ModelLifecycleReport> {
  const checkedAt = now.toISOString();
  const report: ModelLifecycleReport = {
    checkedAt,
    probed: {},
    retired: [],
    restored: [],
  };
  const keys = await checkKeys();
  if (!keys.length) return { ...report, skipped: 'No ready Gemini key' };

  const previous = await readModelLifecycle();
  const next: ModelLifecycle = { retired: {}, checkedAt };
  const queue = [
    ...configuredModels(),
    ...Object.values(previous.retired)
      .map((entry) => entry.replacement)
      .filter((model): model is string => Boolean(model)),
  ];
  const results = new Map<string, ProbeResult>();
  const probe = async (model: string) => {
    const cached = results.get(model);
    if (cached) return cached;
    const result = await verdict(keys, model);
    results.set(model, result);
    report.probed[model] = result.status;
    return result;
  };

  const handled = new Set<string>();
  for (let i = 0; i < queue.length; i++) {
    const model = queue[i];
    if (handled.has(model)) continue;
    handled.add(model);
    const result = await probe(model);
    const before = previous.retired[model];
    if (result.status === 'inconclusive') {
      if (before) next.retired[model] = before;
      continue;
    }
    if (result.status === 'ok') {
      if (before) report.restored.push(model);
      continue;
    }
    let replacement = successorFromMessage(result.message, model);
    if (replacement) {
      const successor = await probe(replacement);
      if (successor.status === 'retired') queue.push(replacement);
      else if (successor.status !== 'ok') replacement = null;
    }
    const entry: RetiredModel = {
      retiredAt: before?.retiredAt || checkedAt,
      replacement: replacement ?? before?.replacement ?? null,
      message: result.message.slice(0, 300),
    };
    next.retired[model] = entry;
    if (!before || before.replacement !== entry.replacement) {
      report.retired.push({ model, replacement: entry.replacement });
    }
  }

  await saveModelLifecycle(next);
  if (report.retired.length || report.restored.length) {
    const { alertModelLifecycle } = await import('./key-alerts');
    await alertModelLifecycle(report.retired, report.restored);
  }
  return report;
}
