import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Tabs } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { haptic } from '@/lib/haptics';
import { useTheme } from '@/lib/theme';

/** Bottom padding tab screens should give their scroll content so the
 *  floating pill tab bar never covers the last row. */
export const TAB_BAR_CLEARANCE = 112;

function TabIcon({
  focused,
  name,
  outline,
}: {
  focused: boolean;
  name: keyof typeof Ionicons.glyphMap;
  outline: keyof typeof Ionicons.glyphMap;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.iconWrap,
        focused && { backgroundColor: colors.primary },
      ]}
    >
      <Ionicons
        name={focused ? name : outline}
        size={21}
        color={focused ? colors.onPrimary : colors.textFaint}
      />
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
        tabBarShowLabel: false,
        // Floating pill: absolute so content scrolls beneath the blur.
        tabBarStyle: {
          position: 'absolute',
          left: 18,
          right: 18,
          bottom: Math.max(insets.bottom, 12),
          height: 66,
          borderRadius: 33,
          borderTopWidth: 0,
          paddingTop: 10,
          overflow: 'hidden',
          backgroundColor: dark ? 'rgba(21,28,25,0.78)' : 'rgba(255,255,255,0.78)',
          elevation: 10,
          shadowColor: '#1A4D42',
          shadowOpacity: 0.18,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 },
        },
        tabBarBackground: () => (
          <BlurView
            intensity={40}
            tint={dark ? 'dark' : 'light'}
            experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
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
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
