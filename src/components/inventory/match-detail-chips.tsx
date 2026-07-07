'use client';

import { Badge } from '@/components/ui/badge';
import type { MatchDetails } from '@/lib/matching';

/**
 * Honest per-dimension chips for a property↔contact match. A chip is
 * green/colored only when the contact's *stated* preference genuinely
 * matches; missing data renders as a muted "not on file" chip instead
 * of masquerading as a match.
 */
export function MatchDetailChips({ details }: { details: MatchDetails }) {
  const base = 'text-[8px] px-1.5 py-0 font-medium border';
  const muted = `${base} bg-slate-850 text-slate-500 border-slate-800`;

  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {details.type === 'match' && (
        <Badge className={`${base} bg-indigo-550/5 text-indigo-400 border-indigo-500/10`}>Type match</Badge>
      )}
      {details.type === 'partial' && (
        <Badge className={`${base} bg-indigo-550/5 text-indigo-400/80 border-indigo-500/10`}>Category match</Badge>
      )}
      {details.type === 'unknown' && <Badge className={muted}>No type preference</Badge>}

      {details.location === 'match' && (
        <Badge className={`${base} bg-sky-550/5 text-sky-450 border-sky-500/10`}>Location match</Badge>
      )}
      {details.location === 'partial' && (
        <Badge className={`${base} bg-sky-550/5 text-sky-450/80 border-sky-500/10`}>Same city</Badge>
      )}
      {details.location === 'unknown' && <Badge className={muted}>No location preference</Badge>}

      {details.budget === 'match' && (
        <Badge className={`${base} bg-emerald-550/5 text-emerald-450 border-emerald-500/10`}>Budget fit</Badge>
      )}
      {details.budget === 'partial' && (
        <Badge className={`${base} bg-amber-500/5 text-amber-400 border-amber-500/10`}>Budget flexible</Badge>
      )}
      {details.budget === 'unknown' && <Badge className={muted}>No budget on file</Badge>}

      {details.bhk === 'match' && (
        <Badge className={`${base} bg-emerald-550/5 text-emerald-450 border-emerald-500/10`}>BHK fit</Badge>
      )}
      {details.bhk === 'mismatch' && (
        <Badge className={`${base} bg-red-500/5 text-red-400 border-red-500/10`}>BHK differs</Badge>
      )}

      {details.roi === 'match' && (
        <Badge className={`${base} bg-emerald-550/5 text-emerald-450 border-emerald-500/10`}>ROI met</Badge>
      )}
    </div>
  );
}
