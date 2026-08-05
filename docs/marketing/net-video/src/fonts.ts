import { MANROPE } from './fontData';

export function injectFonts() {
  if (typeof document === 'undefined' || document.getElementById('manrope-faces')) return;
  const style = document.createElement('style');
  style.id = 'manrope-faces';
  style.textContent = Object.entries(MANROPE)
    .map(
      ([w, b64]) =>
        `@font-face{font-family:Manrope;font-weight:${w};font-style:normal;src:url(data:font/woff2;base64,${b64}) format('woff2');}`
    )
    .join('\n');
  document.head.appendChild(style);
}
