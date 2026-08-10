import { CHUNKS, type KnowledgeChunk } from './chunks';
import { TOURS } from './tours';

/**
 * Copilot system-prompt assembly.
 *
 * The prompt has two parts with different lifecycles:
 *  - the SCAFFOLD — rules, page directory, tour catalog and the JSON
 *    contract. Hashing it gives KB_VERSION (qa-cache.ts): a scaffold
 *    change retires every cached answer at once.
 *  - the KNOWLEDGE section — the chunks retrieval.ts picked for this
 *    question. Cached answers record which chunk versions they used,
 *    so a chunk edit retires only the answers built on it.
 *
 * Keep the scaffold small: the operator pays per token for every
 * free-form question, and knowledge.test.ts budget-tests the whole
 * assembled prompt.
 */

const PAGE_CHUNKS = CHUNKS.filter(
  (c): c is KnowledgeChunk & { route: string } => c.kind === 'page' && !!c.route
);

const ROUTE_ALLOWLIST = PAGE_CHUNKS.map((c) => c.route);

export function isAllowedRoute(path: string): boolean {
  return ROUTE_ALLOWLIST.includes(path);
}

/** Compact tour catalog for the system prompt. */
export function buildTourCatalog(): string {
  return TOURS.map((t) => `- ${t.id}: ${t.description}`).join('\n');
}

/** One line per page so the model keeps a map of the whole app even
 *  though only a few chunks travel with each question. */
function buildPageDirectory(): string {
  return PAGE_CHUNKS.map((c) => `${c.route} — ${c.title}`).join('\n');
}

export function buildCopilotScaffold(pathname: string): string {
  return [
    'You are the friendly in-app helper for ConvoReal, a WhatsApp sales platform for Indian real-estate agents. Many users are not tech-savvy — explain simply, no jargon.',
    'Rules:',
    '- Reply in the SAME language the user wrote in — English, Hindi, Hinglish, or any other Indian language (Kannada, Telugu, Tamil, Malayalam, Marathi, Bengali, Gujarati, Punjabi…).',
    '- Keep replies under 3 short sentences.',
    '- Never invent features. Only discuss ConvoReal using the knowledge below. If asked anything unrelated, politely steer back to ConvoReal.',
    '- If ConvoReal cannot do what the user wants, say so plainly in one sentence, then point them at the closest thing it CAN do. Never say a feature is coming, planned, or being built.',
    '',
    'APP PAGES:',
    buildPageDirectory(),
    '',
    'GUIDED TOURS — if the user asks HOW to do one of these, set tourId to start an on-screen walkthrough instead of explaining in words:',
    buildTourCatalog(),
    '',
    `CURRENT PAGE: The user is on ${pathname}.`,
    '',
    'Respond ONLY with JSON in exactly this shape:',
    '{"reply": string, "tourId": string or null, "navigateTo": string or null, "unsupported": string or null}',
    `navigateTo, when set, must be one of: ${ROUTE_ALLOWLIST.join(', ')}. Set it only when the user asks to go somewhere and no tour fits.`,
    'unsupported names the capability ConvoReal lacks, whenever the user asked for one. Always write it in ENGLISH regardless of the user\'s language: a short generic phrase of at most 8 lowercase words, no names, numbers or personal details — e.g. "export contacts to excel", "bulk edit property prices". Use the same wording every time for the same capability. Set it to null when the answer describes something ConvoReal already does.',
  ].join('\n');
}

export function buildCopilotSystemPrompt(
  pathname: string,
  chunks: KnowledgeChunk[]
): string {
  const knowledge = chunks.map((c) => `[${c.title}] ${c.body}`).join('\n');
  return [
    buildCopilotScaffold(pathname),
    '',
    'KNOWLEDGE (selected for this question — everything you may state as fact):',
    knowledge,
  ].join('\n');
}
