import localFont from 'next/font/local';

const display = localFont({
  src: [
    {
      path: './fonts/instrument-serif-latin.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: './fonts/instrument-serif-italic-latin.woff2',
      weight: '400',
      style: 'italic',
    },
  ],
  variable: '--font-deal-floor-display',
  display: 'swap',
});

const body = localFont({
  src: './fonts/manrope-latin.woff2',
  weight: '200 800',
  variable: '--font-deal-floor-body',
  display: 'swap',
});

const mono = localFont({
  src: './fonts/jetbrains-mono-latin.woff2',
  weight: '100 800',
  variable: '--font-deal-floor-mono',
  display: 'swap',
});

export const dealFloorFontClassName = `${display.variable} ${body.variable} ${mono.variable}`;
