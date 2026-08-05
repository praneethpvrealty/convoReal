interface ConvoRealMarkProps {
  className?: string;
}

/**
 * The ConvoReal mark, inline — a gable roof and a chat bubble sharing
 * one silhouette, with a violet enquiry bar and a gold reply bar. Same
 * geometry and colors as the 32px favicon in `src/app/icon.tsx` and
 * `public/brand/convoreal-mark.svg`; kept inline (not an <img>) so it
 * renders crisply at small sizes without an extra request. Always
 * place it on a solid violet tile — the mark itself is white.
 * See `docs/marketing/brand-guidelines.html` for usage rules.
 */
export function ConvoRealMark({ className }: ConvoRealMarkProps) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <path
        fill="#FFFFFF"
        d="M 34.6 7.2 L 55.2 23.6 Q 57 25.1 57 27.6 L 57 43 Q 57 52 48 52 L 20 52 L 8.6 60.8 Q 7 62 7 59.6 L 7 27.6 Q 7 25.1 8.8 23.6 L 29.4 7.2 Q 32 5 34.6 7.2 Z"
      />
      <path
        fill="#7C3AED"
        d="M 19 27.5 L 39 27.5 A 3.75 3.75 0 0 1 39 35 L 19 35 A 3.75 3.75 0 0 1 19 27.5 Z"
      />
      <path
        fill="#F5C044"
        d="M 27 40 L 45 40 A 3.75 3.75 0 0 1 45 47.5 L 27 47.5 A 3.75 3.75 0 0 1 27 40 Z"
      />
    </svg>
  );
}
