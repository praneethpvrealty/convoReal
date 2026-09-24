import { WORKFLOW_TEMPLATES } from '@/lib/liaisons/workflow-templates';
import type { LiaisonWorkflowStage } from '@/types';

export interface FaqEntry {
  question: string;
  answer: string;
}

export type PublicToolIcon =
  'landmark' | 'route' | 'receipt' | 'calculator' | 'percent';

export interface PublicTool {
  slug: string;
  path: string;
  name: string;
  summary: string;
  cta: string;
  icon: PublicToolIcon;
}

export const TOOLS_PATH = '/tools';
export const GUIDANCE_TOOL_PATH = '/tools/guidance-value';
export const PROCESS_GUIDES_PATH = '/tools/property-process';
export const STAMP_DUTY_TOOL_PATH = '/tools/stamp-duty';
export const EMI_TOOL_PATH = '/tools/emi-calculator';
export const RENTAL_YIELD_TOOL_PATH = '/tools/rental-yield';

export const PUBLIC_TOOLS: PublicTool[] = [
  {
    slug: 'guidance-value',
    path: GUIDANCE_TOOL_PATH,
    name: 'Karnataka guidance value finder',
    summary:
      'Look up the government guidance value of a site, flat, house or land in Karnataka by area and road, and estimate the value used for stamp duty.',
    cta: 'Find guidance value',
    icon: 'landmark',
  },
  {
    slug: 'stamp-duty',
    path: STAMP_DUTY_TOOL_PATH,
    name: 'Karnataka stamp duty calculator',
    summary:
      'Work out the stamp duty, surcharge, cess and registration fee on a sale deed in Karnataka from the sale price and guidance value, with the slab and area rates shown.',
    cta: 'Calculate stamp duty',
    icon: 'receipt',
  },
  {
    slug: 'emi-calculator',
    path: EMI_TOOL_PATH,
    name: 'Home loan EMI calculator',
    summary:
      'See the monthly EMI, total interest and year-by-year balance for a home loan from the property price, down payment, interest rate and tenure.',
    cta: 'Calculate EMI',
    icon: 'calculator',
  },
  {
    slug: 'rental-yield',
    path: RENTAL_YIELD_TOOL_PATH,
    name: 'Rental yield calculator',
    summary:
      'Find the gross and net rental yield of a property from its price and monthly rent, after vacancy, maintenance and purchase costs, with the payback period and the rent a target yield needs.',
    cta: 'Calculate rental yield',
    icon: 'percent',
  },
  {
    slug: 'property-process',
    path: PROCESS_GUIDES_PATH,
    name: 'Property process guides',
    summary:
      'Step-by-step explanations of khata transfer, sale deed registration, encumbrance certificate, TDS and home loan processes, with the authority and indicative time for every stage.',
    cta: 'Browse process guides',
    icon: 'route',
  },
];

export const STAMP_DUTY_FAQ: FaqEntry[] = [
  {
    question: 'How much is stamp duty on a property in Karnataka?',
    answer:
      'Stamp duty on a sale deed in Karnataka is 5% of the property value above ₹45 lakh, 3% between ₹21 lakh and ₹45 lakh, and 2% up to ₹20 lakh. The slab rate applies to the whole value, not in steps. A surcharge of 2% of the duty in city and town areas or 3% in gram panchayat areas and a cess of 10% of the duty are added, along with the registration fee.',
  },
  {
    question:
      'Is stamp duty calculated on the sale price or the guidance value?',
    answer:
      'On whichever is higher. The sub-registrar compares the consideration written in the sale deed with the guidance value of the property and charges stamp duty and the registration fee on the greater amount. Enter both in the calculator and it picks the chargeable value for you.',
  },
  {
    question: 'What is the registration fee in Karnataka?',
    answer:
      'The registration fee is charged on the same chargeable value as stamp duty, on top of the duty, surcharge and cess. The calculator shows the rate it uses in the breakdown so the figure can be checked against the receipt on Kaveri Online Services.',
  },
  {
    question: 'Who pays stamp duty on a property purchase?',
    answer:
      'The buyer pays stamp duty, surcharge, cess and the registration fee at the time the sale deed is registered. In Karnataka the amount is paid online through Kaveri Online Services or at the sub-registrar office before the deed is presented for registration.',
  },
  {
    question: 'Does stamp duty differ between Bengaluru and a village?',
    answer:
      'The stamp duty slab is the same across Karnataka. The surcharge on the duty differs: 2% within a city corporation, municipality or town panchayat, and 3% within a gram panchayat. The calculator lets you pick the area so the surcharge matches.',
  },
  {
    question: 'Is there a stamp duty concession for women buyers in Karnataka?',
    answer:
      'No. Unlike some other states, Karnataka charges the same stamp duty whoever the buyer is. Concessions exist only for specific instruments, such as certain affordable housing schemes notified by the government, and they are not applied by this calculator.',
  },
];

export const RENTAL_YIELD_FAQ: FaqEntry[] = [
  {
    question: 'What is rental yield?',
    answer:
      'Rental yield is the rent a property earns in a year expressed as a percentage of its price. Gross yield divides the full annual rent by the purchase price. Net yield subtracts the months the property sits empty and the yearly costs of owning it, and divides by the price plus the one-time purchase costs, so it is the figure that tells you what the money actually returns.',
  },
  {
    question: 'How is rental yield calculated?',
    answer:
      'Gross yield = monthly rent × 12 ÷ property price. Net yield = (monthly rent × 12 − vacancy loss − yearly costs) ÷ (property price + purchase costs). A ₹1 crore flat renting at ₹30,000 a month has a gross yield of 3.6%; with one vacant month, ₹40,000 of yearly costs and ₹6 lakh of purchase costs, the net yield is about 2.7%.',
  },
  {
    question: 'What is a good rental yield in Bengaluru?',
    answer:
      'Residential property in Bengaluru and most Indian metros typically yields 2% to 4% gross, with newer and outlying localities at the higher end. Commercial property, such as offices, shops and warehouses, typically yields 6% to 9% because tenants take on more of the running costs and sign longer leases. Compare a yield with the alternatives for the same money and with the appreciation you expect, not with a single benchmark.',
  },
  {
    question: 'Which costs should I include in net rental yield?',
    answer:
      'Yearly costs include property tax, society or association maintenance the owner pays, insurance, repairs and any brokerage paid to re-let the property. One-time purchase costs include stamp duty and registration, brokerage on the purchase, and furnishing or interiors needed to let it. Loan interest and income tax on the rent are usually kept out so yields are comparable across buyers.',
  },
  {
    question: 'Is rental yield or capital appreciation more important?',
    answer:
      'They answer different questions. Yield is the cash the property pays while you hold it; appreciation is the gain when you sell. Low-yield, high-appreciation markets suit buyers who can carry the property, and high-yield markets suit buyers who need the income. Total return is the sum of both, so a low yield is acceptable only when the appreciation case is strong.',
  },
  {
    question: 'How much rent should I charge for a target yield?',
    answer:
      'Multiply the property price by the target yield and divide by 12. For a 3% gross yield on a ₹1.2 crore property, the rent needs to be ₹30,000 a month. The table on this page lists the rent needed for common target yields on the price you enter.',
  },
];

export const EMI_FAQ: FaqEntry[] = [
  {
    question: 'How is a home loan EMI calculated?',
    answer:
      'EMI is the fixed monthly amount that repays the loan with interest over the tenure. It is computed as P × r × (1 + r)^n ÷ ((1 + r)^n − 1), where P is the loan amount, r is the monthly interest rate (annual rate divided by 12) and n is the number of monthly instalments. Early instalments are mostly interest; later ones are mostly principal.',
  },
  {
    question: 'How much home loan can I get on a property?',
    answer:
      'Lenders typically finance up to 90% of the property value for loans up to ₹30 lakh, 80% between ₹30 lakh and ₹75 lakh, and 75% above ₹75 lakh, subject to your income and repayment capacity. Stamp duty and registration are usually not financed, so keep them in the down payment.',
  },
  {
    question: 'Does a longer tenure reduce the EMI?',
    answer:
      'Yes. Spreading the same loan over more years lowers each instalment but raises the total interest paid. The year-by-year table in the calculator shows how much interest a longer tenure adds so the trade-off is visible.',
  },
  {
    question: 'What happens to the EMI when interest rates change?',
    answer:
      'On a floating-rate loan the lender usually keeps the EMI the same and changes the tenure when rates move, or revises the EMI if the tenure cannot stretch further. Re-run the calculator with the new rate to see the instalment that would clear the loan in the original tenure.',
  },
  {
    question: 'Can I prepay a home loan?',
    answer:
      'Floating-rate home loans to individuals carry no prepayment penalty in India. A part-prepayment goes straight to principal, which shortens the tenure or lowers the EMI. Fixed-rate loans may carry a charge, so check the sanction letter.',
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
      'Stamp duty on most sale deeds in Karnataka is 5% of the higher of the sale price and the guidance value, plus the surcharge and cess that apply in the area, and a registration fee of 2%. Lower slabs apply to low-value properties. Confirm the current rates on Kaveri Online Services before paying.',
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
  totalDays: number | null;
  datedDays: number;
  undatedStages: string[];
  authorities: string[];
  faq: FaqEntry[];
}

export interface ProcessDuration {
  totalDays: number | null;
  datedDays: number;
  undatedStages: string[];
}

export function processSlug(key: string): string {
  return key.replace(/_/g, '-');
}

export function processDuration(
  stages: LiaisonWorkflowStage[]
): ProcessDuration {
  const datedDays = stages.reduce(
    (sum, stage) => sum + (stage.duration_days ?? 0),
    0
  );
  const undatedStages = stages
    .filter((stage) => stage.duration_days === null)
    .map((stage) => stage.name);
  return {
    totalDays: undatedStages.length ? null : datedDays,
    datedDays,
    undatedStages,
  };
}

export function durationText(duration: ProcessDuration): string {
  return duration.totalDays === null
    ? `at least ${dayText(duration.datedDays)}`
    : `about ${dayText(duration.totalDays)}`;
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
  const duration = processDuration(stages);
  const authorities = authoritiesOf(stages);
  const longest = stages.reduce<LiaisonWorkflowStage | null>(
    (best, stage) =>
      (stage.duration_days ?? 0) > (best?.duration_days ?? 0) ? stage : best,
    null
  );
  const faq: FaqEntry[] = [
    {
      question: `How long does ${title.toLowerCase()} take?`,
      answer: `${durationText(duration)[0].toUpperCase()}${durationText(duration).slice(1)} across ${stages.length} stages when the documents are in order${
        longest
          ? `; the longest dated stage is ${longest.name.toLowerCase()} at about ${dayText(longest.duration_days ?? 0)}`
          : ''
      }${
        duration.undatedStages.length
          ? `. ${duration.undatedStages.join(' and ')} ${duration.undatedStages.length === 1 ? 'has' : 'have'} no fixed duration, so the total depends on when that stage can happen`
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
    ...processDuration(template.stages),
    authorities: authoritiesOf(template.stages),
    faq: processFaq(template.service_name, template.stages),
  })
);

export function findProcessGuide(slug: string): ProcessGuide | null {
  return PROCESS_GUIDES.find((guide) => guide.slug === slug) ?? null;
}

export function findPublicTool(slug: string): PublicTool | null {
  return PUBLIC_TOOLS.find((tool) => tool.slug === slug) ?? null;
}

export function publicToolPaths(): string[] {
  return [
    TOOLS_PATH,
    ...PUBLIC_TOOLS.map((tool) => tool.path),
    ...PROCESS_GUIDES.map((guide) => `${PROCESS_GUIDES_PATH}/${guide.slug}`),
  ];
}
