/**
 * The small pill next to a contact's name showing their `name_tag` —
 * a short internal qualifier (e.g. "Bank DSA") that's never sent in
 * outbound messages, only shown inside the CRM (migration 122).
 * Extracted so every place a contact's name is displayed renders this
 * identically instead of re-copying the same markup.
 */
export function NameTagBadge({ tag }: { tag?: string | null }) {
  if (!tag) return null;
  return (
    <span
      className="inline-flex items-center bg-slate-700/40 border border-slate-600/50 text-slate-300 font-medium px-1.5 py-0.5 rounded text-[10px] select-none"
      title="Name Tag — internal label, not sent in messages"
    >
      {tag}
    </span>
  );
}
