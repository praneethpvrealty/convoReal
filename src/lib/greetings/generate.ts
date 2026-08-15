// Prompt construction for agency occasion greetings. The generated
// text becomes body variable {{2}} of the occasion_greeting template,
// so it must survive Meta's parameter rules: single line (no newlines
// or tabs) and short enough that the rendered body stays inside the
// 1024-char budget alongside the contact and agency names.

export const GREETING_TONES = ['warm', 'festive', 'formal'] as const;
export type GreetingTone = (typeof GREETING_TONES)[number];

export const GREETING_MESSAGE_MAX = 600;

export const GREETING_SYSTEM_PROMPT =
  'You are the relationship voice of a real-estate agency writing occasion greetings for its clients over WhatsApp. Write greetings that feel personal and celebratory, never salesy — no property pitches, no calls to action, no links.';

export function buildGreetingPrompt(args: {
  occasionLabel: string;
  agencyName: string;
  tone?: GreetingTone;
  notes?: string;
}): string {
  const tone = GREETING_TONES.includes(args.tone as GreetingTone)
    ? args.tone
    : 'warm';
  const parts = [
    `Write a ${tone} greeting from the real-estate agency "${args.agencyName}" to its clients for the occasion: "${args.occasionLabel}".`,
    'Rules: 2 to 3 sentences, under 350 characters, one single paragraph with no line breaks.',
    'Do not address the client by name and do not sign off with the agency name — both are added around your text automatically.',
    'Do not use placeholders like [Name], and do not wrap the greeting in quotes. Reply with the greeting text only.',
  ];
  if (args.notes?.trim()) {
    parts.push(`Extra guidance from the agency: ${args.notes.trim()}`);
  }
  return parts.join(' ');
}

export function normalizeGreetingText(raw: string): string {
  let text = raw.replace(/\s+/g, ' ').trim();
  const quoted = /^["'“”](.*)["'“”]$/.exec(text);
  if (quoted) text = quoted[1].trim();
  return text.length > GREETING_MESSAGE_MAX
    ? `${text.slice(0, GREETING_MESSAGE_MAX - 1)}…`
    : text;
}

const IMAGE_PROMPTS: { match: RegExp; prompt: string }[] = [
  {
    match: /ganesh/i,
    prompt:
      'A premium artistic greeting card for Ganesh Chaturthi, featuring Lord Ganesha, festive lights, diyas, vibrant colors, gold accents, elegant layout, high resolution, professional digital art, 4k',
  },
  {
    match: /diwali|deepavali/i,
    prompt:
      'A premium elegant greeting card for Diwali, glowing diyas and rangoli, warm golden light, deep blue luxury background, gold accents, festive, high resolution, professional design, 4k',
  },
  {
    match: /new year/i,
    prompt:
      'A premium elegant greeting card for New Year, with glowing gold sparkles, abstract fireworks, dark luxury background, gold ribbon, festive, high resolution, professional design, 4k',
  },
  {
    match: /holi/i,
    prompt:
      'A premium vibrant greeting card for Holi, bursts of colorful gulal powder, joyful celebration, bright festive palette, elegant layout, high resolution, professional design, 4k',
  },
  {
    match: /eid/i,
    prompt:
      'A premium elegant greeting card for Eid, crescent moon and lantern, deep green and gold palette, ornate patterns, serene festive atmosphere, high resolution, professional design, 4k',
  },
  {
    match: /onam/i,
    prompt:
      'A premium artistic greeting card for Onam, pookalam flower carpet, traditional Kerala motifs, warm festive colors, elegant layout, high resolution, professional design, 4k',
  },
  {
    match: /dussehra|vijayadashami/i,
    prompt:
      'A premium artistic greeting card for Dussehra, golden bow and arrow, festive marigold garlands, rich warm colors, elegant layout, high resolution, professional design, 4k',
  },
  {
    match: /raksha|rakhi/i,
    prompt:
      'A premium elegant greeting card for Raksha Bandhan, decorative rakhi thread, warm pastel and gold palette, delicate patterns, high resolution, professional design, 4k',
  },
  {
    match: /sankranti|pongal/i,
    prompt:
      'A premium artistic greeting card for Makar Sankranti and Pongal, colorful kites in a bright sky, harvest motifs, warm festive colors, elegant layout, high resolution, professional design, 4k',
  },
  {
    match: /ugadi|gudi padwa/i,
    prompt:
      'A premium artistic greeting card for Ugadi, mango leaves and spring blossoms, fresh green and gold palette, traditional motifs, elegant layout, high resolution, professional design, 4k',
  },
  {
    match: /christmas|xmas/i,
    prompt:
      'A premium beautiful greeting card for Christmas, featuring a decorated christmas tree, glowing lights, soft snow, warm festive atmosphere, elegant layout, high resolution, professional design, 4k',
  },
];

export function greetingImagePrompt(occasionLabel: string): string {
  const hit = IMAGE_PROMPTS.find((p) => p.match.test(occasionLabel));
  if (hit) return hit.prompt;
  return `A premium artistic festive greeting card for ${occasionLabel}, elegant layout, warm glowing lighting, vibrant colors, high resolution, professional graphic design, 4k`;
}
