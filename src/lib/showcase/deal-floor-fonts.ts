import { Instrument_Serif, JetBrains_Mono, Manrope } from 'next/font/google';

const display = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-deal-floor-display',
  display: 'swap',
});

const body = Manrope({
  subsets: ['latin'],
  variable: '--font-deal-floor-body',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-deal-floor-mono',
  display: 'swap',
});

export const dealFloorFontClassName = `${display.variable} ${body.variable} ${mono.variable}`;
