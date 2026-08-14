import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { AppDialog, useAppDialog } from '@/components/app-dialog';
import { BottomSheet, sheetScrollArea } from '@/components/sheet';
import {
  EmptyState,
  PrimaryButton,
  SearchBar,
  SectionLabel,
  TextField,
} from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { formatInr } from '@/lib/format';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { useAppConfig } from '@/lib/use-app-config';
import {
  fonts,
  radius,
  spacing,
  useTheme,
  type ThemeColors,
} from '@/lib/theme';
import { usePullRefresh } from '@/lib/use-pull-refresh';
import {
  campaignTotals,
  windowLabel,
  type VoiceCampaign,
  type VoiceCampaignStatus,
} from '@/lib/voice-campaigns';

function statusColor(status: VoiceCampaignStatus, colors: ThemeColors): string {
  switch (status) {
    case 'active':
      return colors.success;
    case 'paused':
      return colors.warning;
    case 'completed':
      return colors.primary;
    default:
      return colors.textMuted;
  }
}

interface PropertyOption {
  id: string;
  title: string;
  price: number | null;
  sublocality: string | null;
  location: string | null;
}

export default function VoiceCampaignsScreen() {
  const { colors } = useTheme();
  const canManage = useAuthStore((s) => s.profile?.account_role) !== 'viewer';
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['voice-campaigns'],
    queryFn: async () =>
      (await apiFetch<{ data: VoiceCampaign[] }>('/api/voice-campaigns')).data,
    // Counts move while a campaign is dialing.
    refetchInterval: (query) =>
      query.state.data?.some((c) => c.status === 'active') ? 15000 : false,
  });
  const pull = usePullRefresh(refetch);

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Voice Campaigns',
          headerRight: () =>
            canManage ? (
              <Pressable
                onPress={() => setCreateOpen(true)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="New voice campaign"
              >
                <Ionicons name="add-circle" size={26} color={colors.primary} />
              </Pressable>
            ) : null,
        }}
      />
      <FlatList
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
        data={data ?? []}
        keyExtractor={(c) => c.id}
        refreshControl={
          <RefreshControl
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={
          <Text style={{ fontSize: 12.5, color: colors.textFaint }}>
            Outbound qualification calls to a listing&apos;s enquirers. The
            voice agent checks budget and requirements; answers land back on the
            contact.
          </Text>
        }
        ListEmptyComponent={
          isLoading ? null : (
            <EmptyState
              icon="call-outline"
              title="No voice campaigns yet"
              subtitle="Tap + to create one from a listing — everyone who enquired about it becomes a recipient, and the agent calls to check their budget."
            />
          )
        }
        renderItem={({ item }) => <CampaignCard campaign={item} />}
      />
      <CreateCampaignSheet
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </View>
  );
}

function CampaignCard({ campaign }: { campaign: VoiceCampaign }) {
  const { colors, fonts: f } = useTheme();
  const totals = campaignTotals(campaign.recipient_counts);
  const property = campaign.script_context.property_title;
  const price = Number(campaign.script_context.asking_price);

  return (
    <Pressable
      onPress={() => router.push(`/(app)/voice-campaign/${campaign.id}`)}
      style={StyleSheet.flatten([
        styles.card,
        { backgroundColor: colors.glass, borderColor: colors.glassBorder },
      ])}
      android_ripple={{ color: colors.border }}
    >
      <View style={styles.cardTop}>
        <Text
          style={[styles.cardTitle, { color: colors.text }]}
          numberOfLines={1}
        >
          {campaign.name}
        </Text>
        <Text
          style={{
            fontSize: 11.5,
            fontFamily: f.bold,
            textTransform: 'uppercase',
            color: statusColor(campaign.status, colors),
          }}
        >
          {campaign.status}
        </Text>
      </View>
      {property ? (
        <Text
          style={{ fontSize: 12.5, color: colors.textMuted }}
          numberOfLines={1}
        >
          {property}
          {Number.isFinite(price) && price > 0 ? ` · ${formatInr(price)}` : ''}
        </Text>
      ) : null}
      <Text style={{ fontSize: 12, color: colors.textFaint }}>
        {windowLabel(
          campaign.call_window_start_hour,
          campaign.call_window_end_hour
        )}{' '}
        · up to {campaign.max_attempts} attempts
      </Text>
      <View style={styles.statsRow}>
        <Stat label="Recipients" value={totals.total} />
        <Stat label="Done" value={totals.done} />
        <Stat label="Reached" value={totals.reached} />
        <Stat label="Queued" value={campaign.recipient_counts.queued ?? 0} />
        <Stat
          label="Opted out"
          value={campaign.recipient_counts.opted_out ?? 0}
          danger={(campaign.recipient_counts.opted_out ?? 0) > 0}
        />
      </View>
    </Pressable>
  );
}

function Stat({
  label,
  value,
  danger,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  const { colors, fonts: f } = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: 1 }}>
      <Text
        style={{
          fontSize: 15,
          fontFamily: f.extrabold,
          color: danger ? colors.danger : colors.text,
        }}
      >
        {value}
      </Text>
      <Text style={{ fontSize: 10.5, color: colors.textFaint }}>{label}</Text>
    </View>
  );
}

function CreateCampaignSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  const dialog = useAppDialog();
  // Server truth via /api/config; the fallback mirrors
  // AI_FEATURE_COSTS.voice_campaign_call for the first offline run.
  // byo accounts pay their own provider and are charged for
  // orchestration only, so the quoted price follows the account's mode.
  const costs = useAppConfig()?.ai_costs;
  const { data: voiceConfig } = useQuery({
    queryKey: ['voice-config'],
    queryFn: async () =>
      (await apiFetch<{ data: { mode?: string } | null }>('/api/voice-config'))
        .data,
  });
  const callCost =
    voiceConfig?.mode === 'byo'
      ? (costs?.voice_campaign_call_byo ?? 10)
      : (costs?.voice_campaign_call ?? 250);
  const [name, setName] = useState('');
  const [property, setProperty] = useState<PropertyOption | null>(null);
  const [propertyPickerOpen, setPropertyPickerOpen] = useState(false);
  const [agentRef, setAgentRef] = useState('');
  const [startHour, setStartHour] = useState('10');
  const [endHour, setEndHour] = useState('19');
  const [maxAttempts, setMaxAttempts] = useState('3');
  const [seed, setSeed] = useState(true);

  const createMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ data: { seeded: number } }>('/api/voice-campaigns', {
        method: 'POST',
        body: JSON.stringify({
          name,
          property_id: property?.id ?? null,
          agent_ref: agentRef,
          call_window_start_hour: Number(startHour),
          call_window_end_hour: Number(endHour),
          max_attempts: Number(maxAttempts),
          seed_from_property: seed,
        }),
      }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['voice-campaigns'] });
      onClose();
      setName('');
      setProperty(null);
      setAgentRef('');
      dialog.show({
        title: 'Campaign created',
        message:
          created.data.seeded > 0
            ? `${created.data.seeded} recipients were added from the listing's enquiries. Start the campaign when you're ready.`
            : 'Add recipients from the campaign screen, then start it.',
      });
    },
    onError: (err: Error) =>
      dialog.show({ title: 'Could not create campaign', message: err.message }),
  });

  return (
    <BottomSheet visible={visible} onClose={onClose} title="New voice campaign">
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.lg }}
      >
        <TextField
          label="Campaign name"
          value={name}
          onChangeText={setName}
          placeholder="Koramangala 14.7 Cr — qualification"
        />
        <View style={{ gap: spacing.sm }}>
          <SectionLabel text="Property" style={{ color: colors.textMuted }} />
          <Pressable
            onPress={() => setPropertyPickerOpen(true)}
            style={[
              styles.pickerRow,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Select property"
          >
            <Ionicons name="home-outline" size={18} color={colors.textFaint} />
            <Text
              style={{
                flex: 1,
                fontSize: 14.5,
                color: property ? colors.text : colors.textFaint,
              }}
              numberOfLines={1}
            >
              {property
                ? `${property.title}${property.price ? ` · ${formatInr(property.price)}` : ''}`
                : 'Select the listing the calls are about…'}
            </Text>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={colors.textFaint}
            />
          </Pressable>
        </View>
        <TextField
          label="Voice agent id"
          value={agentRef}
          onChangeText={setAgentRef}
          placeholder="agent id from your voice provider"
          autoCapitalize="none"
        />
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <TextField
              label="Calls from (IST)"
              value={startHour}
              onChangeText={setStartHour}
              keyboardType="number-pad"
              placeholder="10"
            />
          </View>
          <View style={{ flex: 1 }}>
            <TextField
              label="Until"
              value={endHour}
              onChangeText={setEndHour}
              keyboardType="number-pad"
              placeholder="19"
            />
          </View>
          <View style={{ flex: 1 }}>
            <TextField
              label="Attempts"
              value={maxAttempts}
              onChangeText={setMaxAttempts}
              keyboardType="number-pad"
              placeholder="3"
            />
          </View>
        </View>
        <View
          style={[
            styles.seedRow,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontSize: 14,
                fontFamily: f.semibold,
                color: colors.text,
              }}
            >
              Seed from enquiries
            </Text>
            <Text style={{ fontSize: 12, color: colors.textFaint }}>
              Add everyone who enquired about this listing.
            </Text>
          </View>
          <Switch
            value={seed}
            onValueChange={setSeed}
            disabled={!property}
            trackColor={{ true: colors.primary }}
          />
        </View>
        <Text
          style={{
            fontSize: 12,
            color: colors.textFaint,
            textAlign: 'center',
          }}
        >
          Costs {callCost} cr per connected call — unanswered attempts are
          refunded automatically.
        </Text>
        <PrimaryButton
          label="Create campaign"
          icon="call-outline"
          disabled={!name.trim()}
          busy={createMutation.isPending}
          onPress={() => createMutation.mutate()}
        />
      </ScrollView>
      <PropertySelectSheet
        visible={propertyPickerOpen}
        onClose={() => setPropertyPickerOpen(false)}
        onSelect={(p) => {
          setProperty(p);
          setPropertyPickerOpen(false);
        }}
      />
      <AppDialog {...dialog.dialogProps} />
    </BottomSheet>
  );
}

function PropertySelectSheet({
  visible,
  onClose,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (property: PropertyOption) => void;
}) {
  const { colors, fonts: f } = useTheme();
  const [search, setSearch] = useState('');

  const { data } = useQuery({
    queryKey: ['voice-campaigns', 'property-options'],
    enabled: visible,
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from('properties')
        .select('id, title, price, sublocality, location')
        .order('created_at', { ascending: false })
        .limit(300);
      if (error) throw error;
      return (rows ?? []) as PropertyOption[];
    },
  });

  const filtered = useMemo(() => {
    const query = search.toLowerCase().trim();
    if (!query) return data ?? [];
    return (data ?? []).filter((p) =>
      `${p.title} ${p.sublocality ?? ''} ${p.location ?? ''}`
        .toLowerCase()
        .includes(query)
    );
  }, [data, search]);

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Select property">
      <View style={{ gap: spacing.md, minHeight: 320, flexShrink: 1 }}>
        <SearchBar
          value={search}
          onChangeText={setSearch}
          placeholder="Search by title or locality"
        />
        {!data ? (
          <ActivityIndicator style={{ marginTop: spacing.xl }} />
        ) : filtered.length === 0 ? (
          <Text
            style={{
              marginTop: spacing.xl,
              textAlign: 'center',
              fontSize: 13.5,
              color: colors.textFaint,
            }}
          >
            {search.trim() ? 'No listings match.' : 'No listings yet.'}
          </Text>
        ) : null}
        <ScrollView keyboardShouldPersistTaps="handled" style={sheetScrollArea}>
          {filtered.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => onSelect(p)}
              style={[styles.propertyRow, { borderColor: colors.border }]}
              android_ripple={{ color: colors.border }}
            >
              <Text
                style={{
                  fontSize: 14.5,
                  fontFamily: f.semibold,
                  color: colors.text,
                }}
                numberOfLines={1}
              >
                {p.title}
              </Text>
              <Text
                style={{ fontSize: 12, color: colors.textFaint }}
                numberOfLines={1}
              >
                {[
                  p.sublocality || p.location,
                  p.price ? formatInr(p.price) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 8,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cardTitle: { flex: 1, fontSize: 15.5, fontFamily: fonts.bold },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  seedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  propertyRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
    gap: 2,
  },
});
