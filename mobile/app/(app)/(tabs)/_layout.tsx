import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Tabs } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { haptic } from '@/lib/haptics';
import { fonts, useTheme } from '@/lib/theme';

/** Bottom padding tab screens should give their scroll content so the
 *  floating pill tab bar never covers the last row. */
export const TAB_BAR_CLEARANCE = 124;

function TabIcon({
  focused,
  name,
  outline,
}: {
  focused: boolean;
  name: keyof typeof Ionicons.glyphMap;
  outline: keyof typeof Ionicons.glyphMap;
}) {
  const { colors, dark } = useTheme();
  // Spec: dark = near-white pill with deep-forest icon; light =
  // soft green tint pill with WhatsApp-green icon.
  const activePill = dark ? 'rgba(255,255,255,0.92)' : colors.primarySoft;
  const activeIcon = dark ? '#0E2E22' : colors.primary;

  // The active pill springs in behind the icon and the icon lifts a
  // touch — a small premium beat instead of an instant fill swap.
  const p = useSharedValue(focused ? 1 : 0);
  useEffect(() => {
    p.value = withSpring(focused ? 1 : 0, { damping: 15, stiffness: 220 });
  }, [focused, p]);

  const pillStyle = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ scale: 0.7 + p.value * 0.3 }],
  }));
  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: withTiming(focused ? -1 : 0, { duration: 160 }) }],
  }));

  return (
    <View style={styles.iconWrap}>
      <Animated.View
        style={[styles.pill, { backgroundColor: activePill }, pillStyle]}
      />
      <Animated.View style={iconStyle}>
        <Ionicons
          name={focused ? name : outline}
          size={21}
          color={focused ? activeIcon : colors.textFaint}
        />
      </Animated.View>
    </View>
  );
}

export default function TabsLayout() {
  const { colors, dark } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenListeners={{ tabPress: () => haptic.tap() }}
      screenOptions={{
        headerShown: false,
        // Labels make the bar self-explanatory; the active one picks up
        // the brand colour while the pill highlights its icon.
        tabBarShowLabel: true,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarLabelStyle: {
          fontSize: 10.5,
          fontFamily: fonts.semibold,
          letterSpacing: -0.1,
          marginTop: 3,
        },
        tabBarIconStyle: { marginTop: 4 },
        // Floating pill: absolute so content scrolls beneath the blur.
        sceneStyle: { backgroundColor: 'transparent' },
        tabBarStyle: {
          position: 'absolute',
          left: 18,
          right: 18,
          bottom: Math.max(insets.bottom, 12),
          height: 74,
          borderRadius: 28,
          borderTopWidth: 0,
          borderWidth: 1,
          borderColor: colors.glassBorder,
          paddingTop: 10,
          paddingBottom: 8,
          overflow: 'hidden',
          backgroundColor: colors.tabBar,
          elevation: 10,
          shadowColor: dark ? '#000000' : '#075E54',
          shadowOpacity: 0.18,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 },
        },
        tabBarBackground: () => (
          <BlurView
            intensity={40}
            tint={dark ? 'dark' : 'light'}
            blurMethod="none"
            style={StyleSheet.absoluteFill}
          />
        ),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Inbox',
          tabBarIcon: ({ focused }) => (
            <TabIcon focused={focused} name="chatbubbles" outline="chatbubbles-outline" />
          ),
        }}
      />
      <Tabs.Screen
        name="contacts"
        options={{
          title: 'Contacts',
          tabBarIcon: ({ focused }) => (
            <TabIcon focused={focused} name="people" outline="people-outline" />
          ),
        }}
      />
      <Tabs.Screen
        name="properties"
        options={{
          title: 'Properties',
          tabBarIcon: ({ focused }) => (
            <TabIcon focused={focused} name="home" outline="home-outline" />
          ),
        }}
      />
      <Tabs.Screen
        name="deals"
        options={{
          title: 'Deals',
          tabBarIcon: ({ focused }) => (
            <TabIcon focused={focused} name="trending-up" outline="trending-up-outline" />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'More',
          tabBarIcon: ({ focused }) => (
            <TabIcon
              focused={focused}
              name="ellipsis-horizontal-circle"
              outline="ellipsis-horizontal-circle-outline"
            />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    width: 48,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 16,
  },
});
