import { loadFont } from '@remotion/fonts';
import { MANROPE } from './fontData';

for (const [weight, b64] of Object.entries(MANROPE)) {
  loadFont({
    family: 'Manrope',
    url: `data:font/woff2;base64,${b64}`,
    format: 'woff2',
    weight,
  });
}
