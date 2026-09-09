export interface HelpGuide {
  slug: string;
  title: string;
  summary: string;
  pdfPath: string;
  readTime: string;
  highlights: string[];
}

export const HELP_GUIDES: HelpGuide[] = [
  {
    slug: "getting-started",
    title: "Getting started and daily workflow",
    summary:
      "Set up your workspace and learn the simple daily rhythm for staying on top of deals.",
    pdfPath: "/guides/features/getting-started.pdf",
    readTime: "3 min",
    highlights: [
      "Complete initial setup",
      "Understand the dashboard",
      "Follow a practical daily routine",
    ],
  },
  {
    slug: "property-management",
    title: "Add and manage properties",
    summary:
      "Create useful property records, attach media and keep your inventory ready to share.",
    pdfPath: "/guides/features/property-management.pdf",
    readTime: "2 min",
    highlights: [
      "Create a property",
      "Add photos and documents",
      "Keep listing information current",
    ],
  },
  {
    slug: "whatsapp-property-import",
    title: "Add properties from WhatsApp",
    summary:
      "Forward a property message and let ConvoReal convert it into a structured inventory draft.",
    pdfPath: "/guides/features/whatsapp-property-import.pdf",
    readTime: "1 min",
    highlights: [
      "Forward the message and media",
      "Review extracted information",
      "Confirm the property draft",
    ],
  },
  {
    slug: "contacts-and-matching",
    title: "Contacts, requirements and matching",
    summary:
      "Capture a buyer requirement and find the most relevant properties from your inventory.",
    pdfPath: "/guides/features/contacts-and-matching.pdf",
    readTime: "2 min",
    highlights: [
      "Capture requirements",
      "Review suggested matches",
      "Share a focused shortlist",
    ],
  },
  {
    slug: "visits-and-follow-ups",
    title: "Visits, tasks and follow-ups",
    summary:
      "Schedule property visits, notify participants and record the outcome for the next action.",
    pdfPath: "/guides/features/visits-and-follow-ups.pdf",
    readTime: "2 min",
    highlights: [
      "Create a visit",
      "Notify participants",
      "Record and follow up on the outcome",
    ],
  },
  {
    slug: "team-collaboration",
    title: "Team collaboration and invites",
    summary:
      "Invite consultants, assign the right role and collaborate without losing account control.",
    pdfPath: "/guides/features/team-collaboration.pdf",
    readTime: "2 min",
    highlights: [
      "Invite a consultant",
      "Choose the correct role",
      "Manage team access",
    ],
  },
  {
    slug: "whatsapp-business-waba",
    title: "Connect WhatsApp Business",
    summary:
      "Connect a WhatsApp Business number through Meta and complete the required setup safely.",
    pdfPath: "/guides/features/whatsapp-business-waba.pdf",
    readTime: "2 min",
    highlights: [
      "Choose a connection path",
      "Complete Meta setup",
      "Verify the connection",
    ],
  },
  {
    slug: "agency-showcase-domain",
    title: "Agency showcase and branded domain",
    summary:
      "Publish your inventory under a memorable agency address such as nikhilestates.convoreal.com.",
    pdfPath: "/guides/features/agency-showcase-domain.pdf",
    readTime: "1 min",
    highlights: [
      "Publish selected properties",
      "Claim an agency web address",
      "Share one current catalogue link",
    ],
  },
];

export function findHelpGuide(slug: string) {
  return HELP_GUIDES.find((guide) => guide.slug === slug);
}
