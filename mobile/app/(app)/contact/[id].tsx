import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Avatar, Banner, Tag } from '@/components/ui';
import { formatInr } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { classificationColors, radius, spacing, useTheme } from '@/lib/theme';
import { CLASSIFICATIONS, type Classification, type Contact } from '@/lib/types';

async function fetchContact(id: string): Promise<Contact | null> {
  const { data, error } = await supabase
    .from('contacts')
    .select(
      'id, phone, secondary_phones, name, name_tag, email, company, classification, ' +
        'avatar_url, min_budget, max_budget, no_budget, areas_of_interest, requirements, lead_temp'
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as Contact | null;
}

export default function ContactDetailScreen() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [editing, setEditing] = useState(false);

  const { data: contact, isLoading } = useQuery({
    queryKey: ['contact', id],
    queryFn: () => fetchContact(id),
    enabled: Boolean(id),
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: contact?.name || contact?.phone || 'Contact',
          headerStyle: { backgroundColor: colors.tabBar },
          headerTintColor: colors.text,
          headerRight: () =>
            contact ? (
              <Pressable onPress={() => setEditing((e) => !e)} hitSlop={8}>
                <Text style={{ color: colors.primary, fontSize: 15.5, fontWeight: '700' }}>
                  {editing ? 'Cancel' : 'Edit'}
                </Text>
              </Pressable>
            ) : null,
        }}
      />
      {isLoading || !contact ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : editing ? (
        <ContactEditor contact={contact} onDone={() => setEditing(false)} />
      ) : (
        <ContactCard contact={contact} />
      )}
    </View>
  );
}

function ContactCard({ contact }: { contact: Contact }) {
  const { colors, dark } = useTheme();
  const name = contact.name || contact.phone;
  const clsColor = contact.classification
    ? classificationColors[contact.classification]?.[dark ? 'dark' : 'light']
    : undefined;

  const budget =
    contact.no_budget
      ? 'No budget constraint'
      : contact.min_budget || contact.max_budget
        ? `${formatInr(contact.min_budget)} – ${formatInr(contact.max_budget)}`
        : null;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.identity}>
        <Avatar name={name} size={72} />
        <Text style={[styles.name, { color: colors.text }]}>{name}</Text>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
          {contact.classification ? (
            <Tag label={contact.classification} color={clsColor} />
          ) : null}
          {contact.name_tag ? <Tag label={contact.name_tag} /> : null}
          {contact.lead_temp ? (
            <Tag
              label={contact.lead_temp}
              color={contact.lead_temp === 'HOT' ? colors.danger : colors.textMuted}
            />
          ) : null}
        </View>
      </View>

      <View style={styles.actions}>
        <ActionButton
          icon="call"
          label="Call"
          onPress={() => Linking.openURL(`tel:${contact.phone}`)}
        />
        <ActionButton
          icon="logo-whatsapp"
          label="WhatsApp"
          onPress={() =>
            Linking.openURL(`https://wa.me/${contact.phone.replace(/\D/g, '')}`)
          }
        />
        <ActionButton icon="chatbubbles" label="Inbox" onPress={() => openConversation(contact.id)} />
      </View>

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <InfoRow icon="call-outline" label="Phone" value={contact.phone} />
        {contact.secondary_phones?.length ? (
          <InfoRow
            icon="call-outline"
            label="Other phones"
            value={contact.secondary_phones.join(', ')}
          />
        ) : null}
        <InfoRow icon="mail-outline" label="Email" value={contact.email || '—'} />
        <InfoRow icon="business-outline" label="Company" value={contact.company || '—'} />
        {budget ? <InfoRow icon="cash-outline" label="Budget" value={budget} /> : null}
        {contact.areas_of_interest?.length ? (
          <InfoRow
            icon="location-outline"
            label="Areas of interest"
            value={contact.areas_of_interest.join(', ')}
          />
        ) : null}
        {contact.requirements ? (
          <InfoRow icon="list-outline" label="Requirements" value={contact.requirements} />
        ) : null}
      </View>

      <Text style={{ fontSize: 12, color: colors.textFaint, textAlign: 'center' }}>
        Budgets, areas, notes and deeper profile fields are edited on the web for now.
      </Text>
    </ScrollView>
  );
}

async function openConversation(contactId: string) {
  const { data } = await supabase
    .from('conversations')
    .select('id')
    .eq('contact_id', contactId)
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data?.id) {
    router.push(`/(app)/conversation/${data.id}`);
  }
}

function ContactEditor({ contact, onDone }: { contact: Contact; onDone: () => void }) {
  const { colors, dark } = useTheme();
  const [name, setName] = useState(contact.name ?? '');
  const [nameTag, setNameTag] = useState(contact.name_tag ?? '');
  const [email, setEmail] = useState(contact.email ?? '');
  const [company, setCompany] = useState(contact.company ?? '');
  const [requirements, setRequirements] = useState(contact.requirements ?? '');
  const [classification, setClassification] = useState<Classification | undefined>(
    contact.classification
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    const { error: updateError } = await supabase
      .from('contacts')
      .update({
        name: name.trim() || null,
        name_tag: nameTag.trim() || null,
        email: email.trim() || null,
        company: company.trim() || null,
        requirements: requirements.trim() || null,
        classification: classification ?? null,
      })
      .eq('id', contact.id);
    setSaving(false);
    if (updateError) {
      haptic.warn();
      setError(updateError.message);
      return;
    }
    haptic.success();
    queryClient.invalidateQueries({ queryKey: ['contact', contact.id] });
    queryClient.invalidateQueries({ queryKey: ['contacts'] });
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
    onDone();
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {error ? <Banner kind="error" text={error} /> : null}

        <EditField label="Name" value={name} onChangeText={setName} placeholder="Full name" />
        <EditField
          label="Name Tag"
          value={nameTag}
          onChangeText={setNameTag}
          placeholder='Short qualifier, e.g. "Bank DSA"'
        />
        <EditField
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="email@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <EditField label="Company" value={company} onChangeText={setCompany} placeholder="Company" />
        <EditField
          label="Requirements"
          value={requirements}
          onChangeText={setRequirements}
          placeholder="What are they looking for?"
          multiline
        />

        <View style={{ gap: spacing.sm }}>
          <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>Classification</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {CLASSIFICATIONS.map((c) => {
              const active = classification === c;
              const hue = classificationColors[c]?.[dark ? 'dark' : 'light'];
              return (
                <Pressable
                  key={c}
                  onPress={() => setClassification(active ? undefined : c)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 7,
                    borderRadius: radius.full,
                    backgroundColor: active ? colors.primarySoft : colors.surface,
                    borderWidth: active ? 1.5 : StyleSheet.hairlineWidth,
                    borderColor: active ? colors.primary : colors.border,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 13,
                      fontWeight: '600',
                      color: active ? colors.primary : (hue ?? colors.textMuted),
                    }}
                  >
                    {c}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Pressable
          style={[styles.saveButton, { backgroundColor: colors.primary, opacity: saving ? 0.6 : 1 }]}
          disabled={saving}
          onPress={save}
        >
          {saving ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <Text style={{ color: colors.onPrimary, fontSize: 16, fontWeight: '700' }}>
              Save changes
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function EditField({
  label,
  ...props
}: { label: string } & React.ComponentProps<typeof TextInput>) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>{label}</Text>
      <TextInput
        style={[
          styles.input,
          { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
          props.multiline && { minHeight: 84, textAlignVertical: 'top' },
        ]}
        placeholderTextColor={colors.textFaint}
        {...props}
      />
    </View>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.actionButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <Ionicons name={icon} size={20} color={colors.primary} />
      <Text style={{ fontSize: 12.5, fontWeight: '600', color: colors.text }}>{label}</Text>
    </Pressable>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.infoRow, { borderTopColor: colors.border }]}>
      <Ionicons name={icon} size={17} color={colors.textMuted} style={{ marginTop: 2 }} />
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ fontSize: 12, color: colors.textFaint }}>{label}</Text>
        <Text style={{ fontSize: 14.5, fontWeight: '500', color: colors.text }}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.lg },
  identity: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  name: { fontSize: 22, fontWeight: '800', textAlign: 'center' },
  actions: { flexDirection: 'row', gap: spacing.md, justifyContent: 'center' },
  actionButton: {
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
    width: 92,
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  fieldLabel: { fontSize: 12.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
  },
  saveButton: {
    borderRadius: radius.md,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
});
