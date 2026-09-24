import { WORKFLOW_TEMPLATES } from '@/lib/liaisons/workflow-templates';
import type { LiaisonWorkflowStage } from '@/types';

export interface FaqEntry {
  question: string;
  answer: string;
}

export interface PublicTool {
  slug: string;
  path: string;
  name: string;
  summary: string;
  cta: string;
}

export const TOOLS_PATH = '/tools';
export const GUIDANCE_TOOL_PATH = '/tools/guidance-value';
export const PROCESS_GUIDES_PATH = '/tools/property-process';

export const PUBLIC_TOOLS: PublicTool[] = [
  {
    slug: 'guidance-value',
    path: GUIDANCE_TOOL_PATH,
    name: 'Karnataka guidance value finder',
    summary:
      'Look up the government guidance value of a site, flat, house or land in Karnataka by area and road, and estimate the value used for stamp duty.',
    cta: 'Find guidance value',
  },
  {
    slug: 'property-process',
    path: PROCESS_GUIDES_PATH,
    name: 'Property process guides',
    summary:
      'Step-by-step explanations of khata transfer, sale deed registration, encumbrance certificate, TDS and home loan processes, with the authority and indicative time for every stage.',
    cta: 'Browse process guides',
  },
];

export const GUIDANCE_VALUE_FAQ: FaqEntry[] = [
  {
    question: 'What is guidance value in Karnataka?',
    answer:
      'Guidance value is the minimum value per unit of area at which a property can be registered in Karnataka. It is notified by the Department of Stamps and Registration for every locality, road, village and survey number, separately for sites, apartments, commercial and agricultural land. Stamp duty and registration fees are charged on the higher of the guidance value and the agreed sale price.',
  },
  {
    question: 'How is the guidance value of a property calculated?',
    answer:
      'Find the notified rate for the property’s locality or road and property class, convert it to a per sq.ft rate, and multiply by the area. Sites, houses, agricultural and industrial land are valued on the land or site extent; apartments are valued on the built-up area. A construction rate for the building can be added for a house on a site.',
  },
  {
    question: 'Is guidance value the same as market value?',
    answer:
      'No. Guidance value is the floor for registration set by the government; the market value is what a buyer actually pays. In most Bengaluru localities the market price is above the guidance value, so stamp duty is paid on the sale price. When the sale price is below the guidance value, duty is still charged on the guidance value.',
  },
  {
    question: 'How much stamp duty is paid on a property in Karnataka?',
    answer:
      'Stamp duty on most sale deeds in Karnataka is 5% of the higher of the sale price and the guidance value, plus the surcharge and cess that apply in the area, and a registration fee of 1%. Lower slabs apply to low-value properties. Confirm the current rates on Kaveri Online Services before paying.',
  },
  {
    question: 'Where do I find the guidance value of my property?',
    answer:
      'The official source is the Kaveri Online Services portal of the Karnataka Department of Stamps and Registration, which publishes the notification for each sub-registrar office as a PDF. This tool searches those published notifications by locality, road, village and survey number, so you do not have to read the PDF yourself.',
  },
  {
    question: 'Which areas does this guidance value tool cover?',
    answer:
      'It covers every Karnataka district whose notification has been imported, starting with Bengaluru Urban. The coverage list on the page shows which districts are loaded. An area that is not loaded yet can still be checked on Kaveri Online Services.',
  },
  {
    question: 'Can the guidance value be read from my sale deed automatically?',
    answer:
      'Yes. Inside ConvoReal, agents, buyers and owners upload the schedule page of the sale deed as a PDF or photo, and the location, survey number and extent are read out and matched to the notification without typing. The public tool on this page takes the details typed in.',
  },
];

export interface ProcessGuide {
  slug: string;
  key: string;
  title: string;
  description: string;
  stages: LiaisonWorkflowStage[];
  totalDays: number;
  authorities: string[];
  faq: FaqEntry[];
}

export function processSlug(key: string): string {
  return key.replace(/_/g, '-');
}

function totalDays(stages: LiaisonWorkflowStage[]): number {
  return stages.reduce((sum, stage) => sum + (stage.duration_days ?? 0), 0);
}

function authoritiesOf(stages: LiaisonWorkflowStage[]): string[] {
  return [
    ...new Set(
      stages
        .map((stage) => stage.authority?.trim())
        .filter((authority): authority is string => Boolean(authority))
    ),
  ];
}

function dayText(days: number): string {
  return days === 1 ? '1 day' : `${days} days`;
}

function processFaq(title: string, stages: LiaisonWorkflowStage[]): FaqEntry[] {
  const days = totalDays(stages);
  const authorities = authoritiesOf(stages);
  const longest = stages.reduce<LiaisonWorkflowStage | null>(
    (best, stage) =>
      (stage.duration_days ?? 0) > (best?.duration_days ?? 0) ? stage : best,
    null
  );
  const faq: FaqEntry[] = [
    {
      question: `How long does ${title.toLowerCase()} take?`,
      answer: `About ${dayText(days)} across ${stages.length} stages when the documents are in order${
        longest
          ? `; the longest stage is ${longest.name.toLowerCase()} at about ${dayText(longest.duration_days ?? 0)}`
          : ''
      }. Durations are indicative and depend on the office and the file.`,
    },
    {
      question: `What are the stages of ${title.toLowerCase()}?`,
      answer: stages
        .map((stage, index) => `${index + 1}. ${stage.name}`)
        .join('; '),
    },
  ];
  if (authorities.length) {
    faq.push({
      question: `Who handles ${title.toLowerCase()}?`,
      answer: `The file passes through ${authorities.join(', ')}. Each stage on this page names the authority that acts on it.`,
    });
  }
  return faq;
}

export const PROCESS_GUIDES: ProcessGuide[] = WORKFLOW_TEMPLATES.map(
  (template) => ({
    slug: processSlug(template.key),
    key: template.key,
    title: template.service_name,
    description: template.description,
    stages: template.stages,
    totalDays: totalDays(template.stages),
    authorities: authoritiesOf(template.stages),
    faq: processFaq(template.service_name, template.stages),
  })
);

export function findProcessGuide(slug: string): ProcessGuide | null {
  return PROCESS_GUIDES.find((guide) => guide.slug === slug) ?? null;
}

export function publicToolPaths(): string[] {
  return [
    TOOLS_PATH,
    ...PUBLIC_TOOLS.map((tool) => tool.path),
    ...PROCESS_GUIDES.map((guide) => `${PROCESS_GUIDES_PATH}/${guide.slug}`),
  ];
}
