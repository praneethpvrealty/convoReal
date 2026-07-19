# Glass UI Implementation Spec — ConvoReal Mobile

> **Handoff document.** Everything needed to restyle the ConvoReal Expo app
> with the locked design pairing. Self-contained: no conversation context
> required. Values were extracted from the approved interactive mockups and
> verified against the codebase on 2026-07-18.

---

## 1. The locked decision

| Mode | Direction | Mockup section |
|------|-----------|----------------|
| **Light theme** | **Option 7 — "WhatsApp Native on Glass"**: soft daylight aurora, frosted white glass cards, WhatsApp deep-green `#075E54` primary, bright-green `#25D366` accents, Inter | `.t7` in `docs/design/ui-directions.html` |
| **Dark theme** | **Option 4 — "Liquid Glass"**: deep forest aurora, frosted dark glass, lime `#C6F68D` primary, Plus Jakarta Sans ExtraBold display type | `.t4` in same file |

Theme switching stays exactly as it is today: the existing
`useAppearance` store (`light | dark | system`, persisted as `appearance`,
default `light`) in `mobile/lib/theme.ts`, switched in **More → Appearance**.
**Do NOT build a user-facing multi-theme/style picker.** Options 4 and 7 are
simply the new light/dark skins of the single app theme.

### Non-goals

- No new state manager, no NativeWind, no react-native-svg, no icon-library change.
- No changes to the web app (`src/`), only `mobile/`.
- No renaming of existing theme tokens — ~30 screens reference them.
- No functional changes to data fetching, navigation structure, or flows.

---

## 2. Environment facts (verified)

- `mobile/` — Expo `~57.0.6`, React Native `0.86.0`, expo-router `~57`,
  TypeScript. Path alias `@/` maps to the mobile root
  (e.g. `@/lib/theme`, `@/components/ui`).
- Already installed and used: `expo-blur ~57.0.2`, `expo-linear-gradient`,
  `zustand 5`, `@expo/vector-icons` (Ionicons), `expo-status-bar`,
  `react-native-safe-area-context`, `@expo-google-fonts/plus-jakarta-sans`.
- **Only missing dependency: `@expo-google-fonts/inter`.**
- Theme file: `mobile/lib/theme.ts` (185 lines). All screens read colors via
  `useTheme()` — this is why a full reskin is feasible from one file.
- Fonts load in `mobile/app/_layout.tsx` via `useFonts` (Plus Jakarta 400–800).
- Tab bar: `mobile/app/(app)/(tabs)/_layout.tsx` — already a floating glass
  pill with `BlurView`; exports `TAB_BAR_CLEARANCE = 112` (line 12); uses
  `experimentalBlurMethod: 'dimezisBlurView'` on Android (line 72) — reuse
  this exact pattern for every `BlurView`.
- Verify commands: `cd mobile && npm run typecheck` (`tsc --noEmit`),
  `cd mobile && npm run lint`.

### Assets already generated (in this repo, ready to use)

- `mobile/assets/images/aurora-light.png` — 512×640, base `#EAF4EE → #F4F8F5 (46%) → #E6F0F4` (160°), glows: `rgba(37,211,102,.20)` top-right, `rgba(7,94,84,.13)` left, `rgba(83,189,235,.18)` bottom.
- `mobile/assets/images/aurora-dark.png` — 512×640, base `#0A1F16 → #0E2E22 (42%) → #0B2233` (158°), glows: `rgba(198,246,141,.22)` top-right, `rgba(123,227,176,.16)` left, `rgba(46,160,190,.22)` bottom.

These are pre-baked renderings of the mockups' `linear-gradient + 3 radial
glows` backgrounds. RN can't do radial gradients without extra deps, so the
gradients ship as images. Generator script (regenerate/tweak if needed):
`scratch/gen_aurora.py` (pure stdlib Python, `python3 scratch/gen_aurora.py`).

---

## 3. Step 1 — Install the Inter font

```bash
cd mobile && npx expo install @expo-google-fonts/inter
```

In `mobile/app/_layout.tsx`, extend the existing `useFonts` call:

```ts
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';

const [fontsLoaded] = useFonts({
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
});
```

---

## 4. Step 2 — Replace `mobile/lib/theme.ts` (full file below)

Strategy: keep every existing export and token name so current screens keep
compiling; change the *values*; add three new color tokens (`glass`,
`glassBorder`, `backdrop`), a per-theme type scale (`type`), and per-theme
shadows returned from `useTheme()`.

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColorScheme } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * ConvoReal design tokens — "aurora glass" system.
 * Light = Option 7 (WhatsApp Native on Glass), Dark = Option 4 (Liquid Glass).
 * Components read colors/type via useTheme(), never from a static palette.
 * Screens render over <AuroraBackground/>, so `surface`/`glass` are
 * translucent and MUST stay translucent.
 */
export interface ThemeColors {
  primary: string;
  onPrimary: string;
  primarySoft: string;
  /** Mint-lime accent — price pins, live chips, highlights. */
  mint: string;
  mintText: string;
  /** Solid underlay painted beneath the aurora image. */
  background: string;
  /** Translucent card fill (glass). */
  surface: string;
  surfaceRaised: string;
  /** Frosted-glass fill + hairline border for GlassCard & floating bars. */
  glass: string;
  glassBorder: string;
  /** Modal scrim. */
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
} as const;

/** @deprecated Use `useTheme().shadows` — kept so old screens compile. */
export const shadows = lightShadows;

/** Brand gradient — kept for compat; new glass UI prefers solid tokens. */
export const brandGradient = ['#075E54', '#128C7E'] as const;
export const brandGradientDark = ['#1F5B49', '#2E7D5F'] as const;
/** @deprecated Hot-lead rings are now solid `colors.success` (light) /
 *  lime glow (dark). Kept so old screens compile during migration. */
export const hotGradient = ['#E9A23B', '#D5493B', '#B85C9E'] as const;

export function useBrandGradient(): readonly [string, string] {
  const { dark } = useTheme();
  return dark ? brandGradientDark : brandGradient;
}

/**
 * Appearance override. Light-first by default (the reference design),
 * switchable in More → Appearance.
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
 * Brand typefaces. Light theme = Inter (Option 7), dark = Plus Jakarta Sans
 * (Option 4, ExtraBold display). Use the family for the WEIGHT you want;
 * never combine with fontWeight (Android swaps back to the system font).
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
} as const;

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
  shadows: { card: ThemeShadow; soft: ThemeShadow };
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
```

Also in `mobile/app/_layout.tsx`, make the status bar follow the theme:

```tsx
<StatusBar style={dark ? 'light' : 'dark'} />
```

(get `dark` from `useTheme()`; remove any hardcoded `style=`).

---

## 5. Step 3 — New primitives

Create these files. All a11y props are baked in — the audit found **zero**
accessibility props in the app, so new components must ship them by default.

### 5.1 `mobile/components/aurora-background.tsx`

Rendered once behind everything (see Step 4). Paints the solid underlay +
the aurora image.

```tsx
import { Image, StyleSheet, View } from 'react-native';

import { useTheme } from '@/lib/theme';

export function AuroraBackground() {
  const { colors, dark } = useTheme();
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]}
    >
      <Image
        source={
          dark
            ? require('@/assets/images/aurora-dark.png')
            : require('@/assets/images/aurora-light.png')
        }
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
        fadeDuration={0}
      />
    </View>
  );
}
```

### 5.2 `mobile/components/glass-card.tsx`

The workhorse container. **Important perf rule:** real `BlurView` is only
worth it where content scrolls *behind* the element (tab bar, sticky bottom
bars, chat composer). The aurora background is a static image, so list rows
and cards look identical with just the translucent `glass` fill — use
`blurred={false}` (the default) for anything in a scroll view, and reserve
`blurred` for floating bars. This keeps lists at 60 fps on Android.

```tsx
import { BlurView } from 'expo-blur';
import { Platform, StyleSheet, View, type ViewStyle } from 'react-native';

import { radius, useTheme } from '@/lib/theme';

interface GlassCardProps {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  /** Corner radius; defaults to radius.lg (20). */
  r?: number;
  /** Enable a real BlurView — only for floating bars over scrolling content. */
  blurred?: boolean;
  blurIntensity?: number;
}

export function GlassCard({
  children,
  style,
  r = radius.lg,
  blurred = false,
  blurIntensity,
}: GlassCardProps) {
  const { colors, dark, shadows } = useTheme();
  return (
    <View
      style={[
        styles.frame,
        shadows.card,
        {
          borderColor: colors.glassBorder,
          borderRadius: r,
          backgroundColor: colors.glass,
        },
        style,
      ]}
    >
      {blurred ? (
        <BlurView
          intensity={blurIntensity ?? (dark ? 18 : 16)}
          tint={dark ? 'dark' : 'light'}
          experimentalBlurMethod={
            Platform.OS === 'android' ? 'dimezisBlurView' : undefined
          }
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderWidth: 1,
    overflow: 'hidden',
  },
});
```

### 5.3 Primitives to add to `mobile/components/ui.tsx`

`ui.tsx` is the existing shared-primitives file. Add/extend these; each is
small. Signatures and rules:

- **`PrimaryButton`** — `{ label, onPress, icon?, variant?: 'primary'|'danger'|'ghost', disabled?, loading? }`. Height 52, `radius.full`, `backgroundColor: colors.primary`, label `type.heading` in `colors.onPrimary`. `accessibilityRole="button"`, `accessibilityLabel={label}`, `accessibilityState={{ disabled, busy: loading }}`, `disabled` greys via `colors.textFaint`. Press feedback: `Pressable` `android_ripple` + iOS `opacity` press style.
- **`IconButton`** — `{ icon: React.ReactNode, onPress, label: string }` (`label` is **required** and used as `accessibilityLabel`). 44×44 minimum touch area (`hitSlop={8}` if the visual glyph is smaller), `accessibilityRole="button"`. Glass variant: 40×40 visual, `radius.full`, `colors.glass` + `colors.glassBorder`.
- **`TextField`** — `{ label, value, onChangeText, error?, helper?, ...TextInputProps }`. Label `type.caption` uppercase `colors.textMuted`, input min-height 48, `type.body` in `colors.text`, fill `colors.surfaceRaised`, border `colors.border` → focus border `colors.primary`, error border `colors.danger` + error text `type.bodySmall` `colors.danger`. `accessibilityLabel={label}` on the input. `placeholderTextColor={colors.textFaint}`.
- **`SearchBar`** — wraps TextField styling: glass fill, `radius.full`, leading `search` Ionicons glyph in `colors.textFaint`, `returnKeyType="search"`, `accessibilityRole="search"` (iOS) / `accessibilityLabel="Search"`.
- **`SectionLabel`** — uppercase `type.caption`, `letterSpacing: 1.2`, `colors.textFaint`, `marginBottom: spacing.sm`. Replaces every hand-rolled section header.
- **`ListRow`** — min-height 64, avatar 46–48 circle (`colors.surfaceRaised` fill, initials in `type.heading`/`colors.mintText`), title `type.heading` + subtitle `type.bodySmall` `colors.textMuted`, trailing slot (time/badge). Whole row `accessibilityRole="button"`, label = title + subtitle.
- **`BottomSheet`** — shared modal to replace ad-hoc `Modal`s (fixes the missing-`onRequestClose` Android-back bug):

```tsx
import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, spacing, useTheme } from '@/lib/theme';

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

export function BottomSheet({ visible, onClose, title, children }: BottomSheetProps) {
  const { colors, type } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={[styles.root, { backgroundColor: colors.backdrop }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel="Close"
          accessibilityRole="button"
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surfaceRaised,
              borderColor: colors.glassBorder,
              paddingBottom: insets.bottom + spacing.lg,
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.textFaint }]} />
          {title ? (
            <View style={styles.head}>
              <Text style={[type.heading, { color: colors.text }]}>{title}</Text>
              <Pressable
                onPress={onClose}
                hitSlop={8}
                accessibilityLabel="Close"
                accessibilityRole="button"
                style={styles.close}
              >
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </Pressable>
            </View>
          ) : null}
          {children}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    maxHeight: '88%',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: spacing.md,
    opacity: 0.5,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
```

(add the missing `import { Text } from 'react-native';` when pasting)

---

## 6. Step 4 — Mount the aurora background app-wide

In `mobile/app/(app)/_layout.tsx` (the authenticated Stack layout):

1. Render `<AuroraBackground />` as the first child behind the `Stack`.
2. Set `contentStyle: { backgroundColor: 'transparent' }` in the Stack's
   `screenOptions` so every screen shows the aurora through it.
3. While here: the audit found **13 screen files that re-declare header
   options already defined in this layout's `screenOptions`** — delete those
   per-screen `Stack.Screen options` duplicates (find them with
   `grep -rn "Stack.Screen" mobile/app` and drop any that only restate
   `headerTintColor`/`headerStyle`/`headerTitleStyle`).

Do the same in the auth layout (login / verify-phone stack).

---

## 7. Step 5 — Tab bar retoken (`mobile/app/(app)/(tabs)/_layout.tsx`)

Keep the existing floating pill + `BlurView` structure exactly; only change
values:

- Pill background → `colors.tabBar`, 1px border → `colors.glassBorder`.
- Active tab: **dark** → pill `rgba(255,255,255,0.92)` with icon `#0E2E22`;
  **light** → pill `colors.primarySoft` with icon `colors.primary`.
- Inactive icon → `colors.textFaint`.
- Keep `TAB_BAR_CLEARANCE = 112` and fix `mobile/app/(app)/(tabs)/more.tsx`
  (≈ line 220) to use it instead of the hardcoded `paddingBottom: 120`.

---

## 8. Step 6–8 — Screen restyle playbook

Apply in this order; each screen follows the same rules.

**Global rules**

1. Screen root: no solid `backgroundColor` — aurora shows through.
2. Any `backgroundColor: colors.surface` card/list-row/chip → `<GlassCard>`
   (or `colors.glass` fill + `colors.glassBorder` hairline + `radius.lg`,
   `blurred={false}` inside scroll views).
3. All typography → `type.*` slots; remove stray `fontSize`/`fontWeight`
   literals. Remember: never set `fontWeight` together with a custom
   `fontFamily`.
4. Unread/badge accents → `colors.success` (light: `#25D366`, dark: `#5EE0A0`);
   unread timestamp in dark may use `colors.primary` (lime) per mockup.
5. Hot-lead story rings in Inbox: **delete the `hotGradient` sweep** —
   light: 2.5px solid ring `colors.success`; dark: 1.5px ring
   `rgba(198,246,141,0.55)` + glow `shadowColor: '#C6F68D', shadowOpacity: 0.22, shadowRadius: 9`.
6. Floating bottom bars / chat composer: `GlassCard blurred` +
   `colors.tabBar`-style fill.

**Screens**

- `(tabs)/index.tsx` (Inbox) — glass list rows (radius 20 dark / 18 light →
  just use `radius.lg`), glass search pill, hot-lead rings per rule 5,
  unread badges `colors.success` with `colors.onPrimary` text in light and
  `#10220F` in dark (use `dark ? '#10220F' : '#FFFFFF'`).
- `(tabs)/properties.tsx` — property cards on glass; price `type.title`
  `colors.primary`; filter chips: glass, active chip = `colors.primary` fill +
  `colors.onPrimary` label.
- `conversation/[id].tsx` — bubbles use existing
  `incoming*/outgoing*` tokens (already correct values in the new palette);
  composer becomes a floating glass bar (`GlassCard blurred`, `radius.full`);
  remove hardcoded `#ffd7d7` (deleted-media tint, ≈ line 295) →
  `colors.dangerSoft`; **replace `keyboardVerticalOffset: 90`
  (≈ line 122) with `useHeaderHeight()`** from
  `@react-navigation/elements`.
- `property/[id].tsx` — hero image `radius.lg`, 1px `colors.glassBorder`;
  spec tiles / owner card / stamps → glass; price `colors.primary`; sticky
  bottom bar = `GlassCard blurred`; remove hardcoded `#7c3aed`
  (≈ line 252) → `colors.primary`.
- `login.tsx`, `verify-phone.tsx` — center `GlassCard` on the aurora;
  OTP boxes (`components/otp-input.tsx`): `colors.surfaceRaised` fill,
  active digit border `colors.primary`.
- `deals.tsx`, `calendar.tsx`, `template-picker.tsx` — replace their
  hand-rolled `Modal`s with `BottomSheet` (this also fixes the missing
  `onRequestClose` at `deals.tsx` ≈ line 211).
- `properties-map.tsx` — replace hardcoded pin hex colors with
  `colors.mint` / `colors.success` / `colors.primary`.
- `components/motion.tsx` — remove `#7c3aed` confetti color (≈ line 116);
  use `[colors.primary, colors.success, colors.warning]`.
- Sweep for the last hardcodes found in the audit:
  `grep -rn "shadowColor: '#1A4D42'" mobile` (4 hits → `useTheme().shadows`),
  `grep -rn "rgba(0,0,0,0.45)" mobile` (3 modal scrims → `colors.backdrop`).

**Form screens (lead/property entry)** — the audit's form-UX fixes to fold in:

- Migrate inputs to the shared `TextField` (label above, 48px min height,
  error/helper text built in).
- `appointment-new.tsx` contact search has **no debounce** — add 250–300 ms
  (copy the debounce already used in contacts/properties search).
- **iOS date-picker bug** (`appointment-new.tsx` ≈ lines 174–178,
  `calendar.tsx` ≈ lines 463–471): the picker auto-closes on iOS the moment
  it opens because one `onChange` path hides it unconditionally. Platform-
  split it: Android keeps `display="default"` + auto-close on `set`;
  iOS uses `display="spinner"` inside a small container with a **Done**
  button that closes it.

---

## 9. Step 9 — Accessibility pass (audit found zero props app-wide)

- Every tappable icon-only control gets `accessibilityRole="button"` +
  human `accessibilityLabel` (the new `IconButton` enforces this — migrate
  bare `Pressable` icon buttons onto it).
- Touch targets ≥ 44×44 pt (`hitSlop={8}` where the visual is smaller).
- List rows: `accessibilityRole="button"`, label = name + preview.
- Decorative-only images/aurora: `accessibilityElementsHidden` /
  `importantForAccessibility="no-hide-descendants"` is unnecessary —
  `pointerEvents="none"` + no label is enough.
- Spot-check one screen (Inbox) with VoiceOver (iOS) and TalkBack (Android).

---

## 10. Step 10 — Verification

```bash
cd mobile
npm run typecheck   # must pass
npm run lint        # must pass
npm start           # manual pass
```

Manual matrix (both OS × both themes): Inbox, Properties, Property detail,
Conversation (keyboard open/closed), Deals + its modal, Calendar + date
picker (verify the iOS fix), Login/OTP, More → Appearance switching
light/dark/system live without restart.

---

## 11. Visual source of truth

`docs/design/ui-directions.html` — open in a browser; compare against
**Option 4** (dark) and **Option 7** (light) sections. The `.t4` and `.t7`
CSS blocks at the top of that file contain the same token values as this
spec; if a detail is unspecified here (e.g. an exact padding in a mockup),
the mockup wins.

### Key mockup values quick reference

| Element | Light (Opt 7) | Dark (Opt 4) |
|---|---|---|
| Primary / accent | `#075E54` / `#25D366` | `#C6F68D` (on-dark text `#10220F`) |
| Text / muted / faint | `#111B21` / `#5D6E66` / `#8AA39A` | `#F2FBF4` / `rgba(235,250,240,.62)` / `.38` |
| Glass fill / border | `rgba(255,255,255,.55)` / `.9` | `rgba(255,255,255,.09)` / `.16` |
| Tab bar | `rgba(255,255,255,.6)` | `rgba(20,40,32,.45)` |
| Active tab | green tint pill | white `.92` pill, `#0E2E22` icon |
| List row radius | 18 | 22 (→ use `radius.lg` = 20 for both) |
| Hot ring | 2.5px `#25D366` | 1.5px lime `.55` + lime glow |
| Outgoing bubble | `#D9FDD3` | `#1F5B49` |
| Typeface | Inter 400–700 | Plus Jakarta Sans 400–800 |
| Hero radius | 20 | 24 (→ `radius.lg` for both) |

### Do / Don't

- **Do** keep glass fills translucent — they only read as glass over the aurora.
- **Do** use `blurred` BlurViews sparingly (floating bars only).
- **Don't** add per-screen background colors that would cover the aurora.
- **Don't** reintroduce hex literals in screens — extend the token set instead.
- **Don't** combine `fontFamily` with `fontWeight`.
- **Don't** ship a style picker — light/dark/system only.
