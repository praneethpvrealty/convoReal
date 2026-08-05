// ============================================================
// Call recording/transcript analysis — turns a phone-call
// recording (or a pasted transcript) logged against a contact
// into a structured summary plus a client-ready WhatsApp update
// draft the agent reviews before sending.
//
// The Gemini call transcribes + analyzes in one pass (same
// pattern as calendar/event-parse). Everything after the model
// call is deterministic and unit-testable: coerceCallAnalysis()
// normalizes whatever JSON the model returned.
// ============================================================

import { generateJsonFromParts, type GeminiPart } from '@/lib/ai/gemini';

export interface CallAnalysisResult {
  /** Verbatim English transcript when the input was audio; null for text input. */
  transcript: string | null;
  summary: string | null;
  key_points: string[];
  action_items: string[];
  /** WhatsApp-ready update message addressed to the client, for agent review. */
  update_draft: string | null;
}

export function coerceCallAnalysis(raw: unknown): CallAnalysisResult {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
  const strList = (v: unknown): string[] =>
    Array.isArray(v)
      ? v
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean)
      : [];

  return {
    transcript: str(obj.transcript),
    summary: str(obj.summary),
    key_points: strList(obj.key_points),
    action_items: strList(obj.action_items),
    update_draft: str(obj.update_draft),
  };
}

function buildSystemPrompt(contactName: string | null, context: string | null): string {
  return (
    'You are the assistant inside a sales platform used by Indian real-estate agents. ' +
    'The agent records or transcribes phone calls made on behalf of a client — often with a third party ' +
    'such as a lawyer, surveyor, registrar, banker, or another agent (Hindi, Kannada, Telugu, Tamil, or English — often mixed). ' +
    'Your job: analyze the call and draft a WhatsApp status update the agent can forward to their client after review.\n\n' +
    (contactName ? `The client to be updated is: ${contactName}.\n` : '') +
    (context ? `Context provided by the agent: ${context}\n` : '') +
    '\nReturn JSON with exactly these keys:\n' +
    '{\n' +
    '  "transcript": when the input is audio, the verbatim transcript translated to English, labelling speakers where possible ("Agent:", "Lawyer:", or names actually used on the call); null for text input,\n' +
    '  "summary": 2-4 sentence factual summary of what was discussed and where things stand,\n' +
    '  "key_points": array of short bullet strings covering every substantive point made on the call (statuses, dates, amounts, documents, blockers),\n' +
    '  "action_items": array of short bullet strings — who is doing what next, with any stated deadline,\n' +
    '  "update_draft": a WhatsApp message from the agent to the client relaying the outcome of this call. Warm but professional, greet the client by name when known, first person ("I spoke with..."), plain text without markdown, under 120 words. State only facts from the call — never invent statuses, dates, or amounts, and never give legal advice of your own\n' +
    '}\n\n' +
    'Rules: base everything strictly on the call content. If the recording is inaudible or clearly not a call, ' +
    'return nulls and empty arrays rather than guessing. Respond with ONLY the JSON object.'
  );
}

export interface CallAnalysisInput {
  transcriptText?: string;
  audio?: { base64: string; mimeType: string };
  contactName?: string | null;
  context?: string | null;
}

export async function analyzeCall(input: CallAnalysisInput): Promise<CallAnalysisResult> {
  const parts: GeminiPart[] = [];
  if (input.audio) {
    const mimeType = input.audio.mimeType.split(';')[0].trim() || 'audio/mpeg';
    parts.push({ inlineData: { mimeType, data: input.audio.base64 } });
    parts.push({ text: 'Analyze this call recording.' });
  }
  if (input.transcriptText) {
    parts.push({ text: `Analyze this call transcript:\n\n${input.transcriptText}` });
  }
  if (parts.length === 0) {
    throw new Error('analyzeCall requires a transcript or audio');
  }

  const raw = await generateJsonFromParts(
    parts,
    buildSystemPrompt(input.contactName || null, input.context || null),
    { feature: input.audio ? 'call_recording_analysis' : 'call_analysis' }
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    parsed = match ? JSON.parse(match[0]) : {};
  }
  return coerceCallAnalysis(parsed);
}
