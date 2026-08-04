import { loadFont } from '@remotion/fonts';
import { staticFile } from 'remotion';

for (const weight of ['400', '600', '700', '800']) {
  loadFont({
    family: 'Manrope',
    url: staticFile(`manrope-latin-${weight}-normal.woff2`),
    weight,
  });
}
