import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack } from 'expo-router';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AnimatedCounter } from '@/components/motion';
import { formatInr } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useBrandGradient, useTheme , fonts } from '@/lib/theme';

interface Overview {
  openConversations: number;
  unreadConversations: number;
  messagesToday: number;
  contactsTotal: number;
  hotLeads: number;
  openDealsCount: number;
  openDealsValue: number;
  wonDealsCount: number;
  appointmentsToday: number;
  propertiesAvailable: number;
}

async function fetchOverview(): Promise<Overview> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);

  // head:true count queries — the same technique the web dashboard and
  // inventory summary use; RLS scopes everything to the account.
  const [
    openConv,
    unreadConv,
    msgsToday,
    contacts,
    hot,
    openDeals,
    wonDeals,
    apptsToday,
    availableProps,
  ] = await Promise.all([
    supabase
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open')
      .eq('is_archived', false),
    supabase
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .gt('unread_count', 0)
      .eq('is_archived', false),
    supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', startOfToday.toISOString()),
    supabase.from('contacts').select('id', { count: 'exact', head: true }),
    supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('lead_temp', 'HOT'),
    supabase.from('deals').select('value').eq('status', 'open'),
    supabase.from('deals').select('id', { count: 'exact', head: true }).eq('status', 'won'),
    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'scheduled')
      .gte('start_time', startOfToday.toISOString())
      .lt('start_time', endOfToday.toISOString()),
    supabase
      .from('properties')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'Available'),
  ]);

  const openDealRows = (openDeals.data ?? []) as { value: number | null }[];
  return {
    openConversations: openConv.count ?? 0,
    unreadConversations: unreadConv.count ?? 0,
    messagesToday: msgsToday.count ?? 0,
    contactsTotal: contacts.count ?? 0,
    hotLeads: hot.count ?? 0,
    openDealsCount: openDealRows.length,
    openDealsValue: openDealRows.reduce((sum, d) => sum + (d.value ?? 0), 0),
    wonDealsCount: wonDeals.count ?? 0,
    appointmentsToday: apptsToday.count ?? 0,
    propertiesAvailable: availableProps.count ?? 0,
  };
}

export default function DashboardScreen() {
  const { colors } = useTheme();
  const { data, isFetching, refetch } = useQuery({
    queryKey: ['overview'],
    queryFn: fetchOverview,
  });

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.primary} />
      }
    >
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Overview',
          headerStyle: { backgroundColor: colors.tabBar },
          headerTintColor: colors.text,
        }}
      />

      <HeroCard
        value={data?.openDealsValue ?? 0}
        openCount={data?.openDealsCount ?? 0}
        wonCount={data?.wonDealsCount ?? 0}
      />

      <SectionLabel text="Today" />
      <View style={styles.grid}>
        <StatCard
          icon="mail-unread-outline"
          label="Unread chats"
          value={data ? String(data.unreadConversations) : '…'}
          accent
        />
        <StatCard
          icon="chatbox-ellipses-outline"
          label="Messages today"
          value={data ? String(data.messagesToday) : '…'}
        />
        <StatCard
          icon="calendar-outline"
          label="Appointments"
          value={data ? String(data.appointmentsToday) : '…'}
        />
      </View>

      <SectionLabel text="Book of business" />
      <View style={styles.grid}>
        <StatCard
          icon="people-outline"
          label="Contacts"
          value={data ? String(data.contactsTotal) : '…'}
        />
        <StatCard
          icon="flame-outline"
          label="Hot leads"
          value={data ? String(data.hotLeads) : '…'}
          accent
        />
        <StatCard
          icon="home-outline"
          label="Available listings"
          value={data ? String(data.propertiesAvailable) : '…'}
        />
        <StatCard
          icon="chatbubbles-outline"
          label="Open chats"
          value={data ? String(data.openConversations) : '…'}
        />
      </View>

      <Text style={{ fontSize: 12, color: colors.textFaint, textAlign: 'center' }}>
        Response-time analytics and the Pulse visitor feed live on the web dashboard.
      </Text>
    </ScrollView>
  );
}

function HeroCard({
  value,
  openCount,
  wonCount,
}: {
  value: number;
  openCount: number;
  wonCount: number;
}) {
  const gradient = useBrandGradient();
  return (
    <LinearGradient
      colors={gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.hero}
    >
      <Text style={styles.heroLabel}>PIPELINE VALUE</Text>
      <AnimatedCounter value={value} format={formatInr} style={styles.heroValue} />
      <View style={styles.heroRow}>
        <View style={styles.heroPill}>
          <Ionicons name="trending-up" size={13} color="#fff" />
          <Text style={styles.heroPillText}>{openCount} open</Text>
        </View>
        <View style={styles.heroPill}>
          <Ionicons name="trophy" size={13} color="#fff" />
          <Text style={styles.heroPillText}>{wonCount} won</Text>
        </View>
      </View>
    </LinearGradient>
  );
}

function SectionLabel({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <Text
      style={{
        fontSize: 12.5,
        fontFamily: fonts.bold,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
        color: colors.textFaint,
      }}
    >
      {text}
    </Text>
  );
}

function StatCard({
  icon,
  label,
  value,
  accent,
  wide,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
  accent?: boolean;
  wide?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
        wide && { flexBasis: '100%' },
      ]}
    >
      <Ionicons name={icon} size={18} color={accent ? colors.danger : colors.primary} />
      <Text style={{ fontSize: 21, fontFamily: fonts.extrabold, color: colors.text }}>{value}</Text>
      <Text style={{ fontSize: 12, color: colors.textMuted }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  hero: {
    borderRadius: radius.xl,
    padding: spacing.xl,
    gap: 6,
    elevation: 6,
    shadowColor: '#7c3aed',
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  heroLabel: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 11.5,
    fontFamily: fonts.extrabold,
    letterSpacing: 1.2,
  },
  heroValue: { color: '#fff', fontSize: 38, fontFamily: fonts.extrabold, letterSpacing: -1 },
  heroRow: { flexDirection: 'row', gap: spacing.sm, marginTop: 2 },
  heroPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  heroPillText: { color: '#fff', fontSize: 12.5, fontFamily: fonts.bold },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  card: {
    flexGrow: 1,
    flexBasis: '30%',
    gap: 4,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
});
