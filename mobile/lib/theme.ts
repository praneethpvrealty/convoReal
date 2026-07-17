import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColorScheme } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * ConvoReal design tokens — "warm estate" system from the reference
 * mockups: cream canvas, deep forest-green primary, mint-lime accents,
 * white photo-first cards, airy radii. Components read colors via
 * useTheme(), never from a static palette, so every screen adapts to
 * the system scheme.
 */
export interface ThemeColors {
  primary: string;
  onPrimary: string;
  primarySoft: string;
  /** Mint-lime accent — price pins, live chips, highlights. */
  mint: string;
  mintText: string;
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
  primary: '#1A4D42',
  onPrimary: '#ffffff',
  primarySoft: '#E7F2EC',
  mint: '#D9F3AC',
  mintText: '#1A4D42',
  background: '#FAF6F0',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  border: '#EAE4D9',
  text: '#152220',
  textMuted: '#69766F',
  textFaint: '#9AA49C',
  incomingBubble: '#F1EDE4',
  incomingText: '#152220',
  outgoingBubble: '#1A4D42',
  outgoingText: '#ffffff',
  outgoingMeta: '#BFDCCB',
  danger: '#D5493B',
  dangerSoft: '#FBEBE8',
  success: '#3E9D63',
  successSoft: '#E8F5EC',
  warning: '#B07E1F',
  warningSoft: '#FBF3E0',
  readTick: '#53bdeb',
  tabBar: '#FFFFFF',
};

export const darkColors: ThemeColors = {
  primary: '#4CBB8B',
  onPrimary: '#0C1A15',
  primarySoft: '#1C332B',
  mint: '#2E4A2B',
  mintText: '#BFE99B',
  background: '#0F1513',
  surface: '#171E1B',
  surfaceRaised: '#1D2622',
  border: '#28322D',
  text: '#EDF2EE',
  textMuted: '#94A29A',
  textFaint: '#66736C',
  incomingBubble: '#1E2823',
  incomingText: '#EDF2EE',
  outgoingBubble: '#1F5B49',
  outgoingText: '#ffffff',
  outgoingMeta: '#A9D4BD',
  danger: '#F08A7D',
  dangerSoft: '#3A2320',
  success: '#5FD394',
  successSoft: '#1D3327',
  warning: '#E5B75B',
  warningSoft: '#37301C',
  readTick: '#53bdeb',
  tabBar: '#151C19',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 10, md: 14, lg: 20, xl: 26, full: 999 } as const;

/** Brand gradient — deep forest → emerald (hero cards, CTAs). */
export const brandGradient = ['#1A4D42', '#2E7D5F'] as const;
export const brandGradientDark = ['#1F5B49', '#35946E'] as const;
/** Gradient for the "hot lead" story ring — warm sweep. */
export const hotGradient = ['#E9A23B', '#D5493B', '#B85C9E'] as const;

export function useBrandGradient(): readonly [string, string] {
  const { dark } = useTheme();
  return dark ? brandGradientDark : brandGradient;
}

/**
 * Appearance override. The reference design IS the light cream look,
 * so the app is light-first by default rather than following the
 * system — switchable in More → Appearance.
 */
export type AppearanceMode = 'light' | 'dark' | 'system';

interface AppearanceState {
  mode: AppearanceMode;
  setMode: (mode: AppearanceMode) => void;
}

export const useAppearance = create<AppearanceState>()(
  persist(
    (set) => ({
      mode: 'light',
      setMode: (mode) => set({ mode }),
    }),
    { name: 'appearance', storage: createJSONStorage(() => AsyncStorage) }
  )
);

export function useTheme(): { colors: ThemeColors; dark: boolean } {
  const scheme = useColorScheme();
  const mode = useAppearance((s) => s.mode);
  const dark = mode === 'dark' || (mode === 'system' && scheme === 'dark');
  return { colors: dark ? darkColors : lightColors, dark };
}

/**
 * Brand typeface (Plus Jakarta Sans — the reference's grotesque).
 * Use the family for the WEIGHT you want; don't combine with
 * fontWeight (Android would swap back to the system font).
 */
export const fonts = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
} as const;

/** Classification → chip hue, consistent across Contacts/Inbox. */
export const classificationColors: Record<string, { light: string; dark: string }> = {
  Owner: { light: '#0e7490', dark: '#67e8f9' },
  Seller: { light: '#a16207', dark: '#fde047' },
  Buyer: { light: '#15803d', dark: '#86efac' },
  Agent: { light: '#1A4D42', dark: '#7BD8AE' },
  Developer: { light: '#be185d', dark: '#f9a8d4' },
  'Owner & Buyer': { light: '#0369a1', dark: '#7dd3fc' },
  Others: { light: '#57534e', dark: '#d6d3d1' },
};
