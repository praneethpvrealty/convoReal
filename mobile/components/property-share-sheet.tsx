import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { BottomSheet } from '@/components/sheet';
import { FilterChip, SectionLabel } from '@/components/ui';
import { useAuthStore } from '@/lib/auth-store';
import { ENV } from '@/lib/env';
import { haptic } from '@/lib/haptics';
import {
  buildPropertyShareMessage,
  buildShareTargets,
  type ShareAudience,
  type ShareDetailLevel,
  type ShareTone,
} from '@/lib/share-message';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { Property } from '@/lib/types';

const TONES: { value: ShareTone; label: string }[] = [
  { value: 'professional', label: '💼 Professional' },
  { value: 'casual', label: '👋 Casual' },
  { value: 'friendly', label: '😊 Friendly' },
];

const DETAILS: { value: ShareDetailLevel; label: string }[] = [
  { value: 'quick', label: 'Quick' },
  { value: 'standard', label: 'Standard' },
  { value: 'complete', label: 'Complete' },
];

/**
 * Mobile port of the web share dialog: audience, tone and detail
 * pickers over the same message builder (lib/share-message mirrors
 * the web module 1:1), an editable draft, and channel buttons.
 * "Send from CRM" stays in the conversation thread's template picker.
 */
export function PropertyShareSheet({
  property,
  visible,
  onClose,
}: {
  property: Property;
  visible: boolean;
  onClose: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  const session = useAuthStore((s) => s.session);
  const [audience, setAudience] = useState<ShareAudience>('client');
  const [tone, setTone] = useState<ShareTone>('professional');
  const [detail, setDetail] = useState<ShareDetailLevel>('standard');
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState<'link' | 'message' | null>(null);

  // Client link opens the showcase (inquiry form); co-broker gets the
  // clean view-only page — same URLs the web dialog builds.
  const url = `${ENV.apiBaseUrl}/?property_id=${property.id}${audience === 'agent' ? '&mode=view' : ''}`;

  const firstName = (session?.user.email?.split('@')[0] ?? '').split(/[._-]/)[0];
  const agentName = firstName ? firstName.charAt(0).toUpperCase() + firstName.slice(1) : undefined;
  const agentPhone = session?.user.phone ? `+${session.user.phone.replace(/^\+/, '')}` : undefined;

  const generated = useMemo(
    () =>
      buildPropertyShareMessage({
        property,
        url,
        audience,
        detail,
        tone,
        agentName,
        agentPhone,
      }),
    [property, url, audience, detail, tone, agentName, agentPhone]
  );

  // Picker changes re-draft (discarding edits, same as the web dialog).
  useEffect(() => {
    setMessage(generated);
  }, [generated]);

  const targets = buildShareTargets(message, url, property.title);

  async function copy(kind: 'link' | 'message') {
    haptic.tap();
    await Clipboard.setStringAsync(kind === 'link' ? url : message);
    setCopied(kind);
    setTimeout(() => setCopied(null), 1500);
  }

  const channels = [
    { key: 'whatsapp', icon: 'logo-whatsapp' as const, label: 'WhatsApp', color: colors.success, onPress: () => Linking.openURL(targets.whatsapp) },
    { key: 'telegram', icon: 'paper-plane' as const, label: 'Telegram', color: colors.readTick, onPress: () => Linking.openURL(targets.telegram) },
    { key: 'email', icon: 'mail-outline' as const, label: 'Email', color: colors.primary, onPress: () => Linking.openURL(targets.email) },
    { key: 'sms', icon: 'chatbox-outline' as const, label: 'SMS', color: colors.primary, onPress: () => Linking.openURL(targets.sms) },
    { key: 'copy', icon: (copied === 'message' ? 'checkmark' : 'copy-outline') as 'checkmark' | 'copy-outline', label: copied === 'message' ? 'Copied!' : 'Copy message', color: colors.primary, onPress: () => copy('message') },
    { key: 'more', icon: 'share-social-outline' as const, label: 'More apps…', color: colors.primary, onPress: () => Share.share({ message }) },
  ];

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Share property">
      <ScrollView
        style={{ maxHeight: '100%' }}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: spacing.sm }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <AudienceCard
            title="To Client"
            subtitle="Showcase page with inquiry form"
            active={audience === 'client'}
            onPress={() => setAudience('client')}
          />
          <AudienceCard
            title="To Co-Broker"
            subtitle="Clean page, no inquiry forms"
            active={audience === 'agent'}
            onPress={() => setAudience('agent')}
          />
        </View>

        {audience === 'client' ? (
          <>
            <SectionLabel text="Tone" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {TONES.map((t) => (
                <FilterChip
                  key={t.value}
                  label={t.label}
                  active={tone === t.value}
                  onPress={() => setTone(t.value)}
                />
              ))}
            </View>
          </>
        ) : null}

        <SectionLabel text="How much detail?" />
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {DETAILS.map((d) => (
            <FilterChip
              key={d.value}
              label={d.label}
              active={detail === d.value}
              onPress={() => setDetail(d.value)}
            />
          ))}
        </View>

        <SectionLabel text="Message — tap to edit" />
        <TextInput
          multiline
          value={message}
          onChangeText={setMessage}
          accessibilityLabel="Share message"
          style={[
            styles.draft,
            { backgroundColor: colors.surfaceRaised, borderColor: colors.border, color: colors.text },
          ]}
        />

        <Pressable
          onPress={() => copy('link')}
          accessibilityRole="button"
          accessibilityLabel="Copy link"
          style={[styles.linkRow, { backgroundColor: colors.surfaceSunken }]}
        >
          <Text style={{ flex: 1, fontSize: 12, color: colors.textMuted }} numberOfLines={1}>
            {url}
          </Text>
          <Ionicons
            name={copied === 'link' ? 'checkmark' : 'copy-outline'}
            size={15}
            color={copied === 'link' ? colors.success : colors.primary}
          />
        </Pressable>

        <SectionLabel text="Send via" />
        <View style={styles.channelGrid}>
          {channels.map((c) => (
            <Pressable
              key={c.key}
              onPress={c.onPress}
              accessibilityRole="button"
              accessibilityLabel={c.label}
              style={[styles.channel, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}
            >
              <Ionicons name={c.icon} size={17} color={c.color} />
              <Text style={{ fontSize: 13, fontFamily: f.semibold, color: colors.text }}>
                {c.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={{ fontSize: 11.5, color: colors.textFaint, textAlign: 'center' }}>
          Sending via your CRM WhatsApp number (templates, tracking) lives in the
          conversation thread and on the web share dialog.
        </Text>
      </ScrollView>
    </BottomSheet>
  );
}

function AudienceCard({
  title,
  subtitle,
  active,
  onPress,
}: {
  title: string;
  subtitle: string;
  active: boolean;
  onPress: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ selected: active }}
      style={[
        styles.audience,
        {
          backgroundColor: active ? colors.primarySoft : colors.glass,
          borderColor: active ? colors.primary : colors.glassBorder,
        },
      ]}
    >
      <Text style={{ fontSize: 14, fontFamily: f.bold, color: active ? colors.primary : colors.text }}>
        {title}
      </Text>
      <Text style={{ fontSize: 11.5, color: colors.textMuted }}>{subtitle}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  audience: {
    flex: 1,
    gap: 3,
    borderRadius: radius.md,
    borderWidth: 1.5,
    padding: spacing.md,
  },
  draft: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 13.5,
    lineHeight: 19,
    minHeight: 140,
    maxHeight: 220,
    textAlignVertical: 'top',
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
  },
  channelGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  channel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: 14,
    minHeight: 42,
  },
});
