import { describe, it, expect } from 'vitest';
import { renderTextTile, textWidth } from '@/lib/storage/watermark-font';

const litPixels = (tile: { data: Buffer }) => {
  let n = 0;
  for (let i = 3; i < tile.data.length; i += 4) if (tile.data[i] > 0) n++;
  return n;
};

describe('renderTextTile', () => {
  it('draws glyphs without any font engine', () => {
    const tile = renderTextTile('ABC 123', 3);
    expect(tile.width).toBeGreaterThan(textWidth('ABC 123', 3) - 1);
    expect(litPixels(tile)).toBeGreaterThan(200);
  });

  // The whole point of the bitmap font: a character it has never seen
  // must still leave a mark, because a blank stamp is the failure mode
  // this module was written to remove.
  it('never renders a blank stamp for unknown characters', () => {
    expect(litPixels(renderTextTile('अ漢', 3))).toBeGreaterThan(20);
  });

  it('renders the masked-phone bullet as its own glyph', () => {
    const bullets = litPixels(renderTextTile('•••', 3));
    const unknown = litPixels(renderTextTile('अअअ', 3));
    expect(bullets).toBeGreaterThan(0);
    expect(bullets).not.toBe(unknown);
  });

  it('scales with the requested size', () => {
    expect(litPixels(renderTextTile('88', 4))).toBeGreaterThan(
      litPixels(renderTextTile('88', 2))
    );
  });
});
