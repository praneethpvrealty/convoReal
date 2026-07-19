import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColorScheme } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * ConvoReal design tokens — "aurora glass" system
 * (docs/design/GLASS_UI_IMPLEMENTATION_SPEC.md).
 * Light = Option 7 "WhatsApp Native on Glass", dark = Option 4
 * "Liquid Glass". Components read colors/type via useTheme(), never
 * from a static palette. Screens render over <AuroraBackground/>, so
 * `surface`/`glass` are translucent and MUST stay translucent.
 */
export interface ThemeColors {
  primary: string;
  onPrimary: string;
  primarySoft: string;
  /** Mint accent — price pins, live chips, highlights. */
  mint: string;
  mintText: string;
  /** Solid underlay painted beneath the aurora image. */
  background: string;
  /** Translucent card fill (glass). */
  surface: string;
  surfaceRaised: string;
  /** Recessed neutral wells inside cards (spec pills, previews). */
  surfaceSunken: string;
  /** Frosted-glass fill + hairline border for GlassCard & floating bars. */
  glass: string;
  glassBorder: string;
  /** Scrim behind modals and bottom sheets. */
  backdrop: string;
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
  /** @deprecated Same as `tabBar` in the glass system. */
  tabBarGlass: string;
}

/** Light — Option 7 "WhatsApp Native on Glass". */
export const lightColors: ThemeColors = {
  primary: '#075E54',
  onPrimary: '#FFFFFF',
  primarySoft: 'rgba(7,94,84,0.10)',
  mint: 'rgba(37,211,102,0.16)',
  mintText: '#075E54',
  background: '#EAF4EE',
  surface: 'rgba(255,255,255,0.55)',
  surfaceRaised: 'rgba(255,255,255,0.72)',
  surfaceSunken: 'rgba(17,27,33,0.05)',
  glass: 'rgba(255,255,255,0.55)',
  glassBorder: 'rgba(255,255,255,0.9)',
  backdrop: 'rgba(7,30,25,0.35)',
  border: '#E9EDEF',
  text: '#111B21',
  textMuted: '#5D6E66',
  textFaint: '#8AA39A',
  incomingBubble: 'rgba(255,255,255,0.72)',
  incomingText: '#111B21',
  outgoingBubble: '#D9FDD3',
  outgoingText: '#111B21',
  outgoingMeta: '#5D6E66',
  danger: '#D5493B',
  dangerSoft: 'rgba(213,73,59,0.10)',
  success: '#25D366',
  successSoft: 'rgba(37,211,102,0.16)',
  warning: '#B07E1F',
  warningSoft: 'rgba(176,126,31,0.12)',
  readTick: '#53bdeb',
  tabBar: 'rgba(255,255,255,0.6)',
  tabBarGlass: 'rgba(255,255,255,0.6)',
};

/** Dark — Option 4 "Liquid Glass". */
export const darkColors: ThemeColors = {
  primary: '#C6F68D',
  onPrimary: '#10220F',
  primarySoft: 'rgba(198,246,141,0.16)',
  mint: 'rgba(123,227,176,0.14)',
  mintText: '#7BE3B0',
  background: '#0A1F16',
  surface: 'rgba(255,255,255,0.09)',
  surfaceRaised: 'rgba(255,255,255,0.14)',
  surfaceSunken: 'rgba(255,255,255,0.06)',
  glass: 'rgba(255,255,255,0.09)',
  glassBorder: 'rgba(255,255,255,0.16)',
  backdrop: 'rgba(4,12,9,0.55)',
  border: 'rgba(255,255,255,0.16)',
  text: '#F2FBF4',
  textMuted: 'rgba(235,250,240,0.62)',
  textFaint: 'rgba(235,250,240,0.38)',
  incomingBubble: 'rgba(255,255,255,0.09)',
  incomingText: '#F2FBF4',
  outgoingBubble: '#1F5B49',
  outgoingText: '#EAFBF1',
  outgoingMeta: 'rgba(234,251,241,0.6)',
  danger: '#FF7A6B',
  dangerSoft: 'rgba(255,122,107,0.16)',
  success: '#5EE0A0',
  successSoft: 'rgba(94,224,160,0.16)',
  warning: '#FFC24B',
  warningSoft: 'rgba(255,194,75,0.16)',
  readTick: '#53bdeb',
  tabBar: 'rgba(20,40,32,0.45)',
  tabBarGlass: 'rgba(20,40,32,0.45)',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 10, md: 14, lg: 20, xl: 26, full: 999 } as const;

export interface ThemeShadow {
  shadowColor: string;
  shadowOpacity: number;
  shadowRadius: number;
  shadowOffset: { width: number; height: number };
  elevation: number;
}

const lightShadows = {
  card: {
    shadowColor: '#071E19',
    shadowOpacity: 0.06,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  soft: {
    shadowColor: '#071E19',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  /** Glow under gradient hero cards. */
  hero: {
    shadowColor: '#075E54',
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
} as const;

const darkShadows = {
  card: {
    shadowColor: '#000000',
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  soft: {
    shadowColor: '#000000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  hero: {
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
} as const;

/**
 * @deprecated Prefer `useTheme().shadows` (theme-aware). This static
 * export keeps the many `...shadows.card` spreads inside
 * StyleSheet.create compiling; it always carries the LIGHT values.
 */
export const shadows = lightShadows;

/** Brand gradient — kept for hero cards; glass UI prefers solid tokens. */
export const brandGradient = ['#075E54', '#128C7E'] as const;
export const brandGradientDark = ['#1F5B49', '#2E7D5F'] as const;
/** @deprecated Hot-lead rings are now solid `colors.success` (light) /
 *  lime ring + glow (dark) — see Avatar. Kept so old code compiles. */
export const hotGradient = ['#E9A23B', '#D5493B', '#B85C9E'] as const;

export function useBrandGradient(): readonly [string, string] {
  const { dark } = useTheme();
  return dark ? brandGradientDark : brandGradient;
}

/**
 * Text/glass tints for content sitting ON the brand gradient. Static
 * (not per-theme): the gradient is always deep green, so white ink
 * works in both appearances.
 */
export const onGradient = {
  text: '#FFFFFF',
  faint: 'rgba(255,255,255,0.8)',
  glass: 'rgba(255,255,255,0.18)',
} as const;

/**
 * Price-pin palette for map markers. Deliberately NOT theme-driven:
 * pins float on Google's tile palette (which follows the map's own
 * userInterfaceStyle), so the WhatsApp-green pill stays legible in
 * both app appearances.
 */
export const mapPin = {
  bg: '#D9FDD3',
  bgMuted: '#E7E4DB',
  text: '#075E54',
  textMuted: '#3d453f',
  dot: '#25D366',
  dotMuted: '#69766F',
  border: '#FFFFFF',
} as const;

/**
 * Appearance override. Light-first by default (the reference design),
 * switchable in More → Appearance. light/dark/system ONLY — the two
 * glass directions are the skins of this single theme, not a picker.
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

/**
 * Brand typefaces. Light theme = Inter (Option 7), dark = Plus
 * Jakarta Sans (Option 4, ExtraBold display). Use the family for the
 * WEIGHT you want; never combine with fontWeight (Android swaps back
 * to the system font).
 *
 * The static `fonts` export is the DARK (Jakarta) map, kept so
 * StyleSheet.create blocks compile; theme-correct code reads
 * `useTheme().fonts` instead.
 */
export const fonts = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
} as const;

export const fontsLight = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  // Inter ships 400–700 here; the display slot leans on Bold.
  extrabold: 'Inter_700Bold',
} as const;

export type FontMap = Record<keyof typeof fonts, string>;

export interface TypeStyle {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
}

export interface ThemeType {
  display: TypeStyle;
  title: TypeStyle;
  heading: TypeStyle;
  body: TypeStyle;
  bodySmall: TypeStyle;
  caption: TypeStyle;
}

const lightType: ThemeType = {
  display: { fontFamily: fontsLight.bold, fontSize: 28, lineHeight: 34 },
  title: { fontFamily: fontsLight.bold, fontSize: 22, lineHeight: 28 },
  heading: { fontFamily: fontsLight.semibold, fontSize: 17, lineHeight: 22 },
  body: { fontFamily: fontsLight.regular, fontSize: 15, lineHeight: 21 },
  bodySmall: { fontFamily: fontsLight.regular, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: fontsLight.medium, fontSize: 11, lineHeight: 14 },
};

const darkType: ThemeType = {
  display: { fontFamily: fonts.extrabold, fontSize: 28, lineHeight: 34 },
  title: { fontFamily: fonts.extrabold, fontSize: 22, lineHeight: 28 },
  heading: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 22 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21 },
  bodySmall: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 14 },
};

export interface Theme {
  colors: ThemeColors;
  dark: boolean;
  type: ThemeType;
  shadows: { card: ThemeShadow; soft: ThemeShadow; hero: ThemeShadow };
  /** Theme-resolved family map: Inter in light, Jakarta in dark. */
  fonts: FontMap;
}

export function useTheme(): Theme {
  const scheme = useColorScheme();
  const mode = useAppearance((s) => s.mode);
  const dark = mode === 'dark' || (mode === 'system' && scheme === 'dark');
  return {
    colors: dark ? darkColors : lightColors,
    dark,
    type: dark ? darkType : lightType,
    shadows: dark ? darkShadows : lightShadows,
    fonts: dark ? fonts : fontsLight,
  };
}

/** Classification → chip hue, consistent across Contacts/Inbox. */
export const classificationColors: Record<string, { light: string; dark: string }> = {
  Owner: { light: '#0e7490', dark: '#67e8f9' },
  Seller: { light: '#a16207', dark: '#fde047' },
  Buyer: { light: '#15803d', dark: '#86efac' },
  Agent: { light: '#075E54', dark: '#7BE3B0' },
  Developer: { light: '#be185d', dark: '#f9a8d4' },
  'Owner & Buyer': { light: '#0369a1', dark: '#7dd3fc' },
  Others: { light: '#57534e', dark: '#d6d3d1' },
};
