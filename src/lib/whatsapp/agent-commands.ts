// Staff commands typed into a lead's own thread.
//
// The qualification listener reads the BUYER's messages, never the
// agent's — an agent's prose is their own voice, and parsing it would
// let a negotiation counter-offer ("what about 2 cr?") silently
// rewrite the buyer's brief. But an agent who has just heard a number
// on a call has nowhere to put it without leaving the inbox.
//
// So: an explicit, unambiguous command. `SET BUDGET 2CR` is a
// deliberate act, not prose, and it writes the same deterministic
// fields the buyer's own band tap does. The command is intercepted
// before the send — it never reaches WhatsApp, so the lead never sees
// it.

/** Indian shorthand: 2cr, 1.5 crore, 90L, 90 lakhs, 8500000. */
const AMOUNT =
  /(\d+(?:[.,]\d+)?)\s*(cr|crore|crores|l|lac|lacs|lakh|lakhs|k|thousand)?/i;

export interface BudgetCommand {
  kind: 'budget';
  min: number | null;
  max: number | null;
  /** True for "SET BUDGET NONE" — an answer, not a blank. */
  none: boolean;
}

export type AgentCommand = BudgetCommand;

function toRupees(value: string, unit?: string): number | null {
  const n = Number(value.replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  switch ((unit || '').toLowerCase()) {
    case 'cr':
    case 'crore':
    case 'crores':
      return Math.round(n * 10_000_000);
    case 'l':
    case 'lac':
    case 'lacs':
    case 'lakh':
    case 'lakhs':
      return Math.round(n * 100_000);
    case 'k':
    case 'thousand':
      return Math.round(n * 1_000);
    default:
      // A bare number small enough to be shorthand is almost certainly
      // lakhs ("SET BUDGET 90"); a large one is already rupees.
      return n < 1_000 ? Math.round(n * 100_000) : Math.round(n);
  }
}

/**
 * Parses a staff command, or null when the text is ordinary prose the
 * agent means to send to the lead.
 *
 * Accepted: SET BUDGET 2CR · SET BUDGET 1.5CR-2CR · SET BUDGET 90L TO
 * 1.2CR · SET BUDGET UNDER 2CR · SET BUDGET ABOVE 90L · SET BUDGET NONE
 */
export function parseAgentCommand(
  text: string | null | undefined
): AgentCommand | null {
  const cleaned = (text || '').trim();
  if (!cleaned || cleaned.length > 60) return null;

  const head = /^set\s+budget\b\s*(.*)$/i.exec(cleaned);
  if (!head) return null;
  const rest = head[1].trim();
  if (!rest) return null;

  if (/^(none|no budget|any|open)$/i.test(rest)) {
    return { kind: 'budget', min: null, max: null, none: true };
  }

  const bounded = new RegExp(
    `^(?:(under|below|upto|up to|max)\\s+)?${AMOUNT.source}\\s*(?:(?:-|–|to)\\s*${AMOUNT.source})?$`,
    'i'
  ).exec(rest);
  const above = new RegExp(
    `^(?:above|over|min|from)\\s+${AMOUNT.source}$`,
    'i'
  ).exec(rest);

  if (above) {
    const min = toRupees(above[1], above[2]);
    return min ? { kind: 'budget', min, max: null, none: false } : null;
  }
  if (!bounded) return null;

  const first = toRupees(bounded[2], bounded[3]);
  if (!first) return null;
  const second = bounded[4] ? toRupees(bounded[4], bounded[5]) : null;

  if (second) {
    const [min, max] = first <= second ? [first, second] : [second, first];
    return { kind: 'budget', min, max, none: false };
  }
  // A single figure is a ceiling — how buyers and agents both say it.
  return { kind: 'budget', min: null, max: first, none: false };
}

export function formatRupees(n: number): string {
  return n >= 10_000_000
    ? `₹${(n / 10_000_000).toFixed(2).replace(/\.?0+$/, '')} Cr`
    : n >= 100_000
      ? `₹${(n / 100_000).toFixed(2).replace(/\.?0+$/, '')} L`
      : `₹${n.toLocaleString('en-IN')}`;
}

/** The confirmation the agent sees in the thread. */
export function buildBudgetCommandAck(
  command: BudgetCommand,
  contactName: string | null | undefined,
  matchCount: number
): string {
  const who = contactName?.trim() || 'this contact';
  const range = command.none
    ? 'no fixed budget'
    : command.min != null && command.max != null
      ? `${formatRupees(command.min)}–${formatRupees(command.max)}`
      : command.max != null
        ? `up to ${formatRupees(command.max)}`
        : `above ${formatRupees(command.min!)}`;
  const matches =
    matchCount > 0
      ? `${matchCount} live ${matchCount === 1 ? 'listing' : 'listings'} now match.`
      : 'Nothing in live inventory matches yet.';
  return `✅ Budget updated for ${who}: ${range}. ${matches} (Not sent to the contact.)`;
}
