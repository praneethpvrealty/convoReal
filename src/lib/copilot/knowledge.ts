import {
  CHUNKS,
  audienceOf,
  type Audience,
  type KnowledgeChunk,
} from './chunks';
import { TOURS } from './tours';

/**
 * Copilot system-prompt assembly.
 *
 * The prompt has two parts with different lifecycles:
 *  - the SCAFFOLD — rules, page directory, tour catalog and the JSON
 *    contract. Hashing it gives the audience's KB version
 *    (qa-cache.ts): a scaffold change retires that audience's cached
 *    answers all at once.
 *  - the KNOWLEDGE section — the chunks retrieval.ts picked for this
 *    question. Cached answers record which chunk versions they used,
 *    so a chunk edit retires only the answers built on it.
 *
 * Everything is per-audience. Staff, owners and buyers get different
 * rules, different page directories and different route allowlists,
 * and the resulting scaffold hashes differ — which is also what keeps
 * the shared answer cache from serving an owner an agent's answer.
 *
 * Keep the scaffold small: the operator pays per token for every
 * free-form question, and knowledge.test.ts budget-tests the whole
 * assembled prompt.
 */

type PageChunk = KnowledgeChunk & { route: string };

function pageChunks(audience: Audience): PageChunk[] {
  return CHUNKS.filter(
    (c): c is PageChunk =>
      c.kind === 'page' && !!c.route && audienceOf(c) === audience
  );
}

export function allowedRoutes(audience: Audience): string[] {
  return pageChunks(audience).map((c) => c.route);
}

export function isAllowedRoute(path: string, audience: Audience): boolean {
  return allowedRoutes(audience).includes(path);
}

/** Compact tour catalog for the system prompt. */
export function buildTourCatalog(): string {
  return TOURS.map((t) => `- ${t.id}: ${t.description}`).join('\n');
}

/** One line per page so the model keeps a map of the whole product
 *  even though only a few chunks travel with each question. */
function buildPageDirectory(audience: Audience): string {
  return pageChunks(audience)
    .map((c) => `${c.route} — ${c.title}`)
    .join('\n');
}

const PERSONA: Record<Audience, string> = {
  agent:
    'You are the friendly in-app helper for ConvoReal, a WhatsApp sales platform for Indian real-estate agents. Many users are not tech-savvy — explain simply, no jargon.',
  owner:
    'You are the friendly helper inside Portfolio, where a property OWNER follows their own listings. They are not an estate agent and do not use the agency software — never mention agent tools, dashboards or CRM features. Explain simply, no jargon.',
  buyer:
    'You are the friendly helper inside Portfolio, where someone LOOKING TO BUY follows their shortlist and matches. They are not an estate agent and do not use the agency software — never mention agent tools, dashboards or CRM features. Explain simply, no jargon.',
};

const LANGUAGE_RULE =
  '- Reply in the SAME language the user wrote in — English, Hindi, Hinglish, or any other Indian language (Kannada, Telugu, Tamil, Malayalam, Marathi, Bengali, Gujarati, Punjabi…).';
const LENGTH_RULE = '- Keep replies under 3 short sentences.';
const UNSUPPORTED_RULE =
  '- If ConvoReal cannot do what the user wants, say so plainly in one sentence, then point them at the closest thing it CAN do. Never say a feature is coming, planned, or being built.';
const UNSUPPORTED_CONTRACT =
  'unsupported names the capability ConvoReal lacks, whenever the user asked for one. Always write it in ENGLISH regardless of the user\'s language: a short generic phrase of at most 8 lowercase words, no names, numbers or personal details — e.g. "export contacts to excel", "bulk edit property prices". Use the same wording every time for the same capability. Set it to null when the answer describes something ConvoReal already does.';

/**
 * Staff scaffold. Kept byte-for-byte stable on purpose: its hash is
 * the agent KB version, so an incidental edit here throws away every
 * learned agent answer.
 */
function buildAgentScaffold(pathname: string): string {
  const routes = allowedRoutes('agent');
  return [
    PERSONA.agent,
    'Rules:',
    LANGUAGE_RULE,
    LENGTH_RULE,
    '- Never invent features. Only discuss ConvoReal using the knowledge below. If asked anything unrelated, politely steer back to ConvoReal.',
    UNSUPPORTED_RULE,
    '',
    'APP PAGES:',
    buildPageDirectory('agent'),
    '',
    'GUIDED TOURS — if the user asks HOW to do one of these, set tourId to start an on-screen walkthrough instead of explaining in words:',
    buildTourCatalog(),
    '',
    `CURRENT PAGE: The user is on ${pathname}.`,
    '',
    'Respond ONLY with JSON in exactly this shape:',
    '{"reply": string, "tourId": string or null, "navigateTo": string or null, "unsupported": string or null}',
    `navigateTo, when set, must be one of: ${routes.join(', ')}. Set it only when the user asks to go somewhere and no tour fits.`,
    UNSUPPORTED_CONTRACT,
  ].join('\n');
}

/**
 * Portal scaffold (owner / buyer). No tours — the guided walkthroughs
 * spotlight elements that only exist in the staff dashboard — so the
 * contract drops tourId entirely.
 */
function buildPortalScaffold(pathname: string, audience: Audience): string {
  const routes = allowedRoutes(audience);
  return [
    PERSONA[audience],
    'Rules:',
    LANGUAGE_RULE,
    LENGTH_RULE,
    '- Never invent features. Only discuss Portfolio using the knowledge below. If asked anything unrelated, politely steer back to Portfolio.',
    '- The agency handling their property is the answer to a lot of questions. When something is the agent’s job, say so warmly and suggest messaging them.',
    UNSUPPORTED_RULE,
    '',
    'PORTAL PAGES:',
    buildPageDirectory(audience),
    '',
    `CURRENT PAGE: The user is on ${pathname}.`,
    '',
    'Respond ONLY with JSON in exactly this shape:',
    '{"reply": string, "navigateTo": string or null, "unsupported": string or null}',
    `navigateTo, when set, must be one of: ${routes.join(', ')}. Set it only when the user asks to go somewhere.`,
    UNSUPPORTED_CONTRACT,
  ].join('\n');
}

export function buildCopilotScaffold(
  pathname: string,
  audience: Audience = 'agent'
): string {
  return audience === 'agent'
    ? buildAgentScaffold(pathname)
    : buildPortalScaffold(pathname, audience);
}

export function buildCopilotSystemPrompt(
  pathname: string,
  chunks: KnowledgeChunk[],
  audience: Audience = 'agent'
): string {
  const knowledge = chunks.map((c) => `[${c.title}] ${c.body}`).join('\n');
  return [
    buildCopilotScaffold(pathname, audience),
    '',
    'KNOWLEDGE (selected for this question — everything you may state as fact):',
    knowledge,
  ].join('\n');
}
