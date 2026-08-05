# ConvoReal brand assets

Source files for the ConvoReal identity. See `docs/marketing/brand-guidelines.html`
for usage rules, palette values and application examples.

| File | Use |
|---|---|
| `convoreal-mark.svg` | The mark on its own — app bars, avatars, favicons above 32px, social profile images |
| `convoreal-mark-mono.svg` | Single-colour mark. Inherits `currentColor` — use in stamps, watermarks, embroidery, faxable documents |
| `convoreal-logo-horizontal.svg` | Primary lockup for light backgrounds — site header, letterhead, invoices |
| `convoreal-logo-horizontal-dark.svg` | Primary lockup for dark backgrounds — the product UI, decks, video end cards |
| `convoreal-logo-stacked.svg` | Square-ish spaces — packaging, event backdrops, print ads |
| `convoreal-app-icon.svg` | Full-bleed tile for iOS / Android / PWA icons. Never round the corners yourself; the platform masks it |
| `convoreal-favicon.svg` | Pre-tightened mark on a violet tile for 16–32px browser tabs |
| `app-icon-{1024,512,192,180}.png` | Store and manifest exports of the tile |
| `favicon-{32,16}.png` | Raster fallbacks for older browsers |

The lockups embed Manrope (OFL) as a data URI so they render standalone. When
handing artwork to a printer or a vector tool, convert the wordmark to outlines
first.

Regenerate the PNG exports from the SVGs rather than upscaling them.
