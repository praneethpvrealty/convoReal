import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { apiFetch } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { radius, spacing, useTheme } from '@/lib/theme';

type Influence =
  | 'tone'
  | 'question_order'
  | 'volunteering'
  | 'collateral'
  | 'handover';

interface Rule {
  id: string;
  directive: string;
  influence: Influence;
  status: 'proposed' | 'active' | 'paused';
  contact_classification: string | null;
  listing_type: string | null;
  language: string | null;
  hit_count: number;
}

const INFLUENCES: { value: Influence; label: string }[] = [
  { value: 'tone', label: 'Tone' },
  { value: 'question_order', label: 'Question order' },
  { value: 'volunteering', label: 'What to share' },
  { value: 'collateral', label: 'Collateral' },
  { value: 'handover', label: 'Handover' },
];
const CONTACTS = [
  '',
  'Buyer',
  'Owner',
  'Seller',
  'Agent',
  'Developer',
  'Owner & Buyer',
  'Others',
];
const LISTINGS = ['', 'Sale', 'Rent', 'JV/JD', 'Built to Suit'];
const LANGUAGES = [
  { value: '', label: 'Any language' },
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi' },
  { value: 'kn', label: 'Kannada' },
  { value: 'ta', label: 'Tamil' },
  { value: 'te', label: 'Telugu' },
  { value: 'ml', label: 'Malayalam' },
  { value: 'mr', label: 'Marathi' },
];

export default function BotRulesScreen() {
  const { colors, fonts } = useTheme();
  const role = useAuthStore((state) => state.profile?.account_role);
  const canEdit = role === 'owner' || role === 'admin';
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [directive, setDirective] = useState('');
  const [influence, setInfluence] = useState<Influence>('tone');
  const [contact, setContact] = useState('');
  const [listing, setListing] = useState('');
  const [language, setLanguage] = useState('');

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ data: Rule[] }>('/api/bot-instructions')
      .then((result) => {
        if (!cancelled) setRules(result.data);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          Alert.alert(
            'Could not load bot rules',
            error instanceof Error ? error.message : 'Try again.'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function addRule() {
    if (!directive.trim() || saving) return;
    setSaving(true);
    try {
      const result = await apiFetch<{ data: Rule }>('/api/bot-instructions', {
        method: 'POST',
        body: JSON.stringify({
          directive,
          influence,
          contact_classification: contact || null,
          listing_type: listing || null,
          language: language || null,
        }),
      });
      setRules((current) => [result.data, ...current]);
      setDirective('');
    } catch (error) {
      Alert.alert(
        'Could not save bot rule',
        error instanceof Error ? error.message : 'Try again.'
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggle(rule: Rule, active: boolean) {
    const status = active ? 'active' : 'paused';
    setRules((current) =>
      current.map((item) => (item.id === rule.id ? { ...item, status } : item))
    );
    try {
      await apiFetch(`/api/bot-instructions/${rule.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
    } catch (error) {
      setRules((current) =>
        current.map((item) => (item.id === rule.id ? rule : item))
      );
      Alert.alert(
        'Could not update bot rule',
        error instanceof Error ? error.message : 'Try again.'
      );
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Bot rule book' }} />
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={styles.container}
      >
        <View
          style={[
            styles.card,
            { backgroundColor: colors.glass, borderColor: colors.glassBorder },
          ]}
        >
          <View style={styles.headingRow}>
            <Ionicons name="book-outline" size={20} color={colors.primary} />
            <Text
              style={[
                styles.heading,
                { color: colors.text, fontFamily: fonts.bold },
              ]}
            >
              New rule
            </Text>
          </View>
          <Text style={[styles.hint, { color: colors.textMuted }]}>
            Rules shape replies only. They never start a new message.
          </Text>
          <TextInput
            value={directive}
            onChangeText={setDirective}
            editable={canEdit && !saving}
            maxLength={1000}
            multiline
            placeholder="Ask for the buyer's budget before offering the brochure."
            placeholderTextColor={colors.textFaint}
            style={[
              styles.input,
              {
                color: colors.text,
                borderColor: colors.border,
                backgroundColor: colors.background,
              },
            ]}
          />
          <ChoiceRow
            label="Influence"
            value={influence}
            values={INFLUENCES}
            onChange={(value) => setInfluence(value as Influence)}
          />
          <ChoiceRow
            label="Contact"
            value={contact}
            values={CONTACTS.map((value) => ({
              value,
              label: value || 'Any contact',
            }))}
            onChange={setContact}
          />
          <ChoiceRow
            label="Listing"
            value={listing}
            values={LISTINGS.map((value) => ({
              value,
              label: value || 'Any listing',
            }))}
            onChange={setListing}
          />
          <ChoiceRow
            label="Language"
            value={language}
            values={LANGUAGES}
            onChange={setLanguage}
          />
          <Pressable
            onPress={() => void addRule()}
            disabled={!canEdit || saving || !directive.trim()}
            style={({ pressed }) => [
              styles.button,
              {
                backgroundColor: colors.primary,
                opacity:
                  !canEdit || saving || !directive.trim()
                    ? 0.45
                    : pressed
                      ? 0.75
                      : 1,
              },
            ]}
          >
            {saving && (
              <ActivityIndicator size="small" color={colors.onPrimary} />
            )}
            <Text style={{ color: colors.onPrimary, fontFamily: fonts.bold }}>
              Add active rule
            </Text>
          </Pressable>
          {!canEdit && (
            <Text style={[styles.hint, { color: colors.textMuted }]}>
              An account admin can add or pause rules.
            </Text>
          )}
        </View>

        <Text
          style={[
            styles.sectionTitle,
            { color: colors.textMuted, fontFamily: fonts.bold },
          ]}
        >
          RULES
        </Text>
        {loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : rules.length === 0 ? (
          <Text style={[styles.empty, { color: colors.textMuted }]}>
            No bot rules yet.
          </Text>
        ) : (
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.glass,
                borderColor: colors.glassBorder,
              },
            ]}
          >
            {rules.map((rule, index) => (
              <View
                key={rule.id}
                style={[
                  styles.rule,
                  index > 0 && {
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: colors.border,
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.ruleText, { color: colors.text }]}>
                    {rule.directive}
                  </Text>
                  <Text style={[styles.hint, { color: colors.textMuted }]}>
                    {ruleScope(rule)} · Fired {rule.hit_count.toLocaleString()}{' '}
                    times
                  </Text>
                </View>
                <Switch
                  value={rule.status === 'active'}
                  onValueChange={(value) => void toggle(rule, value)}
                  disabled={!canEdit || rule.status === 'proposed'}
                  trackColor={{ true: colors.primary }}
                />
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </>
  );
}

function ChoiceRow({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: string;
  values: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const { colors, fonts } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text
        style={[
          styles.choiceLabel,
          { color: colors.textMuted, fontFamily: fonts.bold },
        ]}
      >
        {label}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.choices}
      >
        {values.map((item) => {
          const selected = item.value === value;
          return (
            <Pressable
              key={item.value}
              onPress={() => onChange(item.value)}
              style={[
                styles.choice,
                {
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: selected
                    ? colors.primarySoft
                    : 'transparent',
                },
              ]}
            >
              <Text
                style={{
                  color: selected ? colors.primary : colors.textMuted,
                  fontFamily: selected ? fonts.bold : fonts.medium,
                  fontSize: 12,
                }}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function ruleScope(rule: Rule) {
  return (
    [
      rule.contact_classification,
      rule.listing_type,
      LANGUAGES.find((item) => item.value === rule.language)?.label,
    ]
      .filter(Boolean)
      .join(' · ') || 'All conversations'
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: 48 },
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.md,
  },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  heading: { fontSize: 18 },
  hint: { fontSize: 12, lineHeight: 17 },
  input: {
    minHeight: 92,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  button: {
    minHeight: 44,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  sectionTitle: { fontSize: 12, marginTop: spacing.sm },
  empty: { paddingVertical: 32, textAlign: 'center' },
  rule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  ruleText: { fontSize: 14, lineHeight: 20, marginBottom: 4 },
  choiceLabel: { fontSize: 12 },
  choices: { gap: spacing.xs },
  choice: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
});
