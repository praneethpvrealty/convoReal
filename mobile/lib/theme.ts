import { useColorScheme } from 'react-native';

/**
 * ConvoReal design tokens — light + dark. The web app is the brand
 * reference (violet #7c3aed); the mobile app adds full dark-mode
 * support. Components read colors via useTheme(), never from a static
 * palette, so every screen adapts to the system scheme.
 */
export interface ThemeColors {
  primary: string;
  onPrimary: string;
  primarySoft: string;
  background: string;
  surface: string;
  surfaceRaised: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  incomingBubble: string;
  incomingText: string;
  outgoingBubble: string;
  outgoingText: string;
  outgoingMeta: string;
  danger: string;
  dangerSoft: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  readTick: string;
  tabBar: string;
}

export const lightColors: ThemeColors = {
  primary: '#7c3aed',
  onPrimary: '#ffffff',
  primarySoft: '#f1eafd',
  background: '#ffffff',
  surface: '#f6f5fa',
  surfaceRaised: '#ffffff',
  border: '#e7e4f0',
  text: '#17141f',
  textMuted: '#6b6880',
  textFaint: '#9a97ab',
  incomingBubble: '#f2effa',
  incomingText: '#17141f',
  outgoingBubble: '#7c3aed',
  outgoingText: '#ffffff',
  outgoingMeta: '#dcd0f8',
  danger: '#dc2626',
  dangerSoft: '#fdecec',
  success: '#16a34a',
  successSoft: '#e9f7ee',
  warning: '#b45309',
  warningSoft: '#fdf3e3',
  readTick: '#53bdeb',
  tabBar: '#ffffff',
};

export const darkColors: ThemeColors = {
  primary: '#a78bfa',
  onPrimary: '#1c1526',
  primarySoft: '#2c2440',
  background: '#121016',
  surface: '#1c1922',
  surfaceRaised: '#232029',
  border: '#2e2a38',
  text: '#f2f0f7',
  textMuted: '#a29fb3',
  textFaint: '#6f6c80',
  incomingBubble: '#242030',
  incomingText: '#f2f0f7',
  outgoingBubble: '#6d33d8',
  outgoingText: '#ffffff',
  outgoingMeta: '#cdb9f5',
  danger: '#f87171',
  dangerSoft: '#3a2226',
  success: '#4ade80',
  successSoft: '#1e3327',
  warning: '#fbbf24',
  warningSoft: '#38301c',
  readTick: '#53bdeb',
  tabBar: '#17141d',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 22, full: 999 } as const;

/** Brand gradient (violet → fuchsia) — buttons, hero cards, story rings. */
export const brandGradient = ['#7c3aed', '#c026d3'] as const;
export const brandGradientDark = ['#8b5cf6', '#d946ef'] as const;
/** Gradient for the "hot lead" story ring — Instagram-style warm sweep. */
export const hotGradient = ['#f59e0b', '#ef4444', '#d946ef'] as const;

export function useBrandGradient(): readonly [string, string] {
  const dark = useColorScheme() === 'dark';
  return dark ? brandGradientDark : brandGradient;
}

export function useTheme(): { colors: ThemeColors; dark: boolean } {
  const scheme = useColorScheme();
  const dark = scheme === 'dark';
  return { colors: dark ? darkColors : lightColors, dark };
}

/** Classification → chip hue, consistent across Contacts/Inbox. */
export const classificationColors: Record<string, { light: string; dark: string }> = {
  Owner: { light: '#0e7490', dark: '#67e8f9' },
  Seller: { light: '#a16207', dark: '#fde047' },
  Buyer: { light: '#15803d', dark: '#86efac' },
  Agent: { light: '#7c3aed', dark: '#c4b5fd' },
  Developer: { light: '#be185d', dark: '#f9a8d4' },
  'Owner & Buyer': { light: '#0369a1', dark: '#7dd3fc' },
  Others: { light: '#57534e', dark: '#d6d3d1' },
};
