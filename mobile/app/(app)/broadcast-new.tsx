import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  Banner,
  EmptyState,
  FilterChip,
  PrimaryButton,
  SectionLabel,
  TextField,
} from '@/components/ui';
import { apiFetch, ApiError } from '@/lib/api';
import {
  buildAudience,
  CONTACT_FIELDS,
  defaultVariableMappings,
  mappingsComplete,
  previewBody,
  templateVariableKeys,
  type VariableMapping,
} from '@/lib/broadcast-compose';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { MessageTemplate, Tag } from '@/lib/types';

/**
 * Compose and send a broadcast from the phone.
 *
 * The server does everything that matters — POST /api/broadcasts
 * resolves the audience, writes the recipient rows, enforces the
 * per-user rate limit and sends — so this screen only assembles the
 * payload that route already accepts from the web wizard.
 *
 * Audience is All or by tag, which is what a phone can sensibly offer;
 * CSV upload and custom-field filters stay on the web wizard.
 */
export default function NewBroadcastScreen() {
  const { colors, fonts: f } = useTheme();
  const [name, setName] = useState('');
  const [template, setTemplate] = useState<MessageTemplate | null>(null);
  const [audienceType, setAudienceType] = useState<'all' | 'tags'>('all');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [excludeTagIds, setExcludeTagIds] = useState<string[]>([]);
  const [variables, setVariables] = useState<Record<string, VariableMapping>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only APPROVED templates can be sent via Meta — anything else would
  // be rejected at the API, so they are not offered here.
  const { data: templates, isLoading: loadingTemplates } = useQuery({
    queryKey: ['broadcast-templates'],
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from('message_templates')
        .select('id, name, language, category, body_text, footer_text, status')
        .eq('status', 'APPROVED')
        .order('name');
      if (err) throw err;
      return (data ?? []) as MessageTemplate[];
    },
  });

  const { data: tags } = useQuery({
    queryKey: ['tags'],
    queryFn: async () => {
      const { data, error: err } = await supabase.from('tags').select('id, name, color').order('name');
      if (err) throw err;
      return (data ?? []) as Tag[];
    },
  });

  // A sample contact so the preview shows a real name rather than a
  // placeholder — the agent should see what a recipient will see.
  const { data: sample } = useQuery({
    queryKey: ['broadcast-sample-contact'],
    queryFn: async () => {
      const { data } = await supabase
        .from('contacts')
        .select('name, phone, email, company')
        .limit(1)
        .maybeSingle();
      return (data ?? {}) as Record<string, string | null>;
    },
  });

  // Recipient count, so nobody sends to a list of unknown size. Mirrors
  // the server's resolution for the two audiences offered here; the
  // server recounts on send, so this is a guide, not the contract.
  const { data: recipientCount, isFetching: counting } = useQuery({
    queryKey: ['broadcast-audience-count', audienceType, tagIds, excludeTagIds],
    enabled: audienceType === 'all' || tagIds.length > 0,
    queryFn: async () => {
      let includedIds: string[] | null = null;
      if (audienceType === 'tags') {
        const { data } = await supabase
          .from('contact_tags')
          .select('contact_id')
          .in('tag_id', tagIds);
        includedIds = [...new Set((data ?? []).map((r: { contact_id: string }) => r.contact_id))];
        if (includedIds.length === 0) return 0;
      }
      let excludedIds: string[] = [];
      if (excludeTagIds.length > 0) {
        const { data } = await supabase
          .from('contact_tags')
          .select('contact_id')
          .in('tag_id', excludeTagIds);
        excludedIds = [...new Set((data ?? []).map((r: { contact_id: string }) => r.contact_id))];
      }
      let query = supabase.from('contacts').select('id', { count: 'exact', head: true });
      if (includedIds) query = query.in('id', includedIds);
      const { count } = await query;
      if (!count) return 0;
      if (excludedIds.length === 0) return count;
      // Exclusions overlap the included set, so subtract only the ones
      // that are actually in it rather than the raw excluded total.
      let overlapQuery = supabase.from('contacts').select('id', { count: 'exact', head: true }).in('id', excludedIds);
      if (includedIds) overlapQuery = overlapQuery.in('id', includedIds);
      const { count: overlap } = await overlapQuery;
      return Math.max(0, count - (overlap ?? 0));
    },
  });

  const variableKeys = useMemo(
    () => templateVariableKeys(template?.body_text),
    [template?.body_text]
  );

  function pickTemplate(next: MessageTemplate) {
    haptic.tap();
    setTemplate(next);
    setVariables(defaultVariableMappings(templateVariableKeys(next.body_text)));
    if (!name.trim()) setName(next.name.replace(/_/g, ' '));
  }

  function toggle(list: string[], setList: (next: string[]) => void, id: string) {
    haptic.tap();
    setList(list.includes(id) ? list.filter((t) => t !== id) : [...list, id]);
  }

  const ready =
    Boolean(template) &&
    name.trim().length > 0 &&
    (audienceType === 'all' || tagIds.length > 0) &&
    mappingsComplete(variableKeys, variables) &&
    (recipientCount ?? 0) > 0;

  async function send() {
    if (!template || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await apiFetch<{ broadcastId: string }>('/api/broadcasts', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          template,
          audience: buildAudience(audienceType, tagIds, excludeTagIds),
          variables,
        }),
      });
      haptic.success();
      queryClient.invalidateQueries({ queryKey: ['broadcasts'] });
      // Straight to the campaign so its delivery counts are watched as
      // they land, rather than back to a list that says "sending".
      router.replace(`/(app)/broadcast/${res.broadcastId}`);
    } catch (err) {
      haptic.warn();
      setSending(false);
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not start this broadcast. Check your connection and try again.'
      );
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ headerShown: true, title: 'New broadcast' }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xl }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {error ? <Banner kind="error" text={error} /> : null}

          <View style={{ gap: spacing.sm }}>
            <SectionLabel text="Template" style={{ color: colors.textMuted }} />
            {loadingTemplates ? (
              <ActivityIndicator color={colors.primary} />
            ) : (templates ?? []).length === 0 ? (
              <EmptyState
                icon="document-text-outline"
                title="No approved templates"
                subtitle="WhatsApp only sends broadcasts from templates Meta has approved. Submit one from the web app, then come back once it is approved."
              />
            ) : (
              <View style={{ gap: spacing.sm }}>
                {(templates ?? []).map((t) => {
                  const active = template?.id === t.id;
                  return (
                    <Pressable
                      key={t.id}
                      onPress={() => pickTemplate(t)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={t.name}
                      style={[
                        styles.card,
                        {
                          backgroundColor: active ? colors.primarySoft : colors.glass,
                          borderColor: active ? colors.primary : colors.glassBorder,
                        },
                      ]}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                        <Ionicons
                          name={active ? 'radio-button-on' : 'radio-button-off'}
                          size={17}
                          color={active ? colors.primary : colors.textFaint}
                        />
                        <Text style={{ flex: 1, fontSize: 14, fontFamily: f.semibold, color: colors.text }}>
                          {t.name.replace(/_/g, ' ')}
                        </Text>
                        <Text style={{ fontSize: 11, color: colors.textFaint }}>{t.language}</Text>
                      </View>
                      <Text style={{ fontSize: 12.5, lineHeight: 18, color: colors.textMuted }}>
                        {t.body_text}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>

          {template ? (
            <>
              <TextField
                label="Campaign name"
                value={name}
                onChangeText={setName}
                placeholder="What is this campaign called?"
              />

              <View style={{ gap: spacing.sm }}>
                <SectionLabel text="Who receives it" style={{ color: colors.textMuted }} />
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <FilterChip
                    label="All contacts"
                    active={audienceType === 'all'}
                    onPress={() => {
                      haptic.tap();
                      setAudienceType('all');
                    }}
                  />
                  <FilterChip
                    label="By tag"
                    active={audienceType === 'tags'}
                    onPress={() => {
                      haptic.tap();
                      setAudienceType('tags');
                    }}
                  />
                </View>

                {audienceType === 'tags' ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                    {(tags ?? []).map((tag) => (
                      <FilterChip
                        key={tag.id}
                        label={tag.name}
                        active={tagIds.includes(tag.id)}
                        onPress={() => toggle(tagIds, setTagIds, tag.id)}
                      />
                    ))}
                  </View>
                ) : null}

                <SectionLabel text="Skip anyone tagged" style={{ color: colors.textMuted }} />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                  {(tags ?? []).map((tag) => (
                    <FilterChip
                      key={tag.id}
                      label={tag.name}
                      active={excludeTagIds.includes(tag.id)}
                      onPress={() => toggle(excludeTagIds, setExcludeTagIds, tag.id)}
                    />
                  ))}
                </View>

                <View style={[styles.count, { backgroundColor: colors.surfaceSunken }]}>
                  <Ionicons name="people-outline" size={16} color={colors.primary} />
                  <Text style={{ fontSize: 13, color: colors.text }}>
                    {counting
                      ? 'Counting recipients…'
                      : audienceType === 'tags' && tagIds.length === 0
                        ? 'Pick at least one tag'
                        : `${recipientCount ?? 0} recipient${(recipientCount ?? 0) === 1 ? '' : 's'}`}
                  </Text>
                </View>
              </View>

              {variableKeys.length > 0 ? (
                <View style={{ gap: spacing.sm }}>
                  <SectionLabel text="Fill in the blanks" style={{ color: colors.textMuted }} />
                  {variableKeys.map((key) => {
                    const mapping = variables[key];
                    return (
                      <View key={key} style={{ gap: 6 }}>
                        <Text style={{ fontSize: 12, fontFamily: f.bold, color: colors.textMuted }}>
                          {`{{${key}}}`}
                        </Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                          {CONTACT_FIELDS.map((field) => (
                            <FilterChip
                              key={field.value}
                              label={field.label}
                              active={mapping?.type === 'field' && mapping.value === field.value}
                              onPress={() => {
                                haptic.tap();
                                setVariables((prev) => ({
                                  ...prev,
                                  [key]: { type: 'field', value: field.value },
                                }));
                              }}
                            />
                          ))}
                          <FilterChip
                            label="Fixed text"
                            active={mapping?.type === 'static'}
                            onPress={() => {
                              haptic.tap();
                              setVariables((prev) => ({
                                ...prev,
                                [key]: { type: 'static', value: '' },
                              }));
                            }}
                          />
                        </View>
                        {mapping?.type === 'static' ? (
                          <TextField
                            value={mapping.value}
                            onChangeText={(next) =>
                              setVariables((prev) => ({
                                ...prev,
                                [key]: { type: 'static', value: next },
                              }))
                            }
                            placeholder="Text sent to everyone"
                          />
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              ) : null}

              <View style={{ gap: spacing.sm }}>
                <SectionLabel text="Preview" style={{ color: colors.textMuted }} />
                <View style={[styles.preview, { backgroundColor: colors.primarySoft }]}>
                  <Text style={{ fontSize: 14, lineHeight: 20, color: colors.text }}>
                    {previewBody(template.body_text, variables, sample ?? {})}
                  </Text>
                  {template.footer_text ? (
                    <Text style={{ fontSize: 11.5, color: colors.textFaint }}>
                      {template.footer_text}
                    </Text>
                  ) : null}
                </View>
                <Text style={{ fontSize: 11.5, color: colors.textFaint }}>
                  Shown with a sample contact. Each recipient gets their own values.
                </Text>
              </View>

              <PrimaryButton
                label={
                  sending
                    ? 'Starting…'
                    : `Send to ${recipientCount ?? 0} contact${(recipientCount ?? 0) === 1 ? '' : 's'}`
                }
                onPress={send}
                disabled={!ready || sending}
                busy={sending}
              />
              <Text style={{ fontSize: 11.5, color: colors.textFaint, textAlign: 'center' }}>
                Sending starts immediately and cannot be undone.
              </Text>
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
  },
  count: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  preview: {
    gap: 6,
    borderRadius: radius.md,
    padding: spacing.md,
  },
});
