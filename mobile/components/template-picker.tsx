import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ConvoRealLoader } from '@/components/loader';
import { BottomSheet } from '@/components/sheet';
import { Banner, PrimaryButton, TextField } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme , fonts } from '@/lib/theme';
import type { MessageTemplate } from '@/lib/types';

/** Highest {{n}} placeholder in a template body. */
function variableCount(body: string): number {
  let max = 0;
  for (const m of body.matchAll(/\{\{(\d+)\}\}/g)) {
    max = Math.max(max, Number(m[1]));
  }
  return max;
}

function renderBody(body: string, values: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, n) => values[Number(n) - 1] || `{{${n}}}`);
}

/**
 * Approved-template picker + variable form — the way to message
 * customers outside WhatsApp's 24-hour service window. Mirrors the
 * web picker's source query (message_templates, status APPROVED).
 * v1 supports text-only headers; media-header templates stay on web.
 */
export function TemplatePicker({
  visible,
  onClose,
  onSend,
  sending,
}: {
  visible: boolean;
  onClose: () => void;
  onSend: (template: MessageTemplate, bodyParams: string[], renderedText: string) => void;
  sending: boolean;
}) {
  const { colors, fonts: f } = useTheme();
  const [selected, setSelected] = useState<MessageTemplate | null>(null);
  const [values, setValues] = useState<string[]>([]);

  const { data: templates, isLoading } = useQuery({
    queryKey: ['message-templates'],
    enabled: visible,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('message_templates')
        .select('id, name, language, category, header_type, header_content, body_text, footer_text, status')
        .eq('status', 'APPROVED')
        .order('created_at', { ascending: false });
      if (error) throw error;
      // Media-header templates need upload handles — not supported in v1.
      return ((data ?? []) as MessageTemplate[]).filter(
        (t) => !t.header_type || t.header_type === 'text'
      );
    },
  });

  const varCount = useMemo(
    () => (selected ? variableCount(selected.body_text) : 0),
    [selected]
  );
  const allFilled = values.slice(0, varCount).filter((v) => v.trim()).length === varCount;
  const preview = selected ? renderBody(selected.body_text, values) : '';

  function reset() {
    setSelected(null);
    setValues([]);
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={() => {
        reset();
        onClose();
      }}
    >
          <View style={styles.sheetHeader}>
            {selected ? (
              <Pressable
                onPress={reset}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Back to template list"
              >
                <Ionicons name="arrow-back" size={20} color={colors.text} />
              </Pressable>
            ) : (
              <View style={{ width: 20 }} />
            )}
            <Text style={{ fontSize: 16, fontFamily: f.bold, color: colors.text }}>
              {selected ? selected.name : 'Send a template'}
            </Text>
            <Pressable
              onPress={() => {
                reset();
                onClose();
              }}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>

          <Text style={{ fontSize: 12.5, color: colors.textMuted, paddingHorizontal: spacing.lg }}>
            Templates are the only messages WhatsApp accepts outside the 24-hour service window.
          </Text>

          {isLoading ? (
            <ConvoRealLoader style={{ alignSelf: 'center', paddingVertical: 32 }} />
          ) : !selected ? (
            <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ paddingVertical: spacing.sm }}>
              {(templates ?? []).length === 0 ? (
                <View style={{ padding: spacing.lg }}>
                  <Banner
                    kind="info"
                    text="No approved text templates. Create and submit templates from the web app's WhatsApp settings."
                  />
                </View>
              ) : (
                (templates ?? []).map((t) => (
                  <Pressable
                    key={t.id}
                    style={[styles.templateRow, { borderTopColor: colors.border }]}
                    onPress={() => {
                      setSelected(t);
                      setValues(Array(variableCount(t.body_text)).fill(''));
                    }}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ fontSize: 14.5, fontFamily: f.bold, color: colors.text }}>
                        {t.name}
                      </Text>
                      <Text style={{ fontSize: 12.5, color: colors.textMuted }} numberOfLines={2}>
                        {t.body_text}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
                  </Pressable>
                ))
              )}
            </ScrollView>
          ) : (
            <ScrollView
              style={{ maxHeight: 420 }}
              contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
              keyboardShouldPersistTaps="handled"
            >
              {Array.from({ length: varCount }, (_, i) => (
                <TextField
                  key={i}
                  placeholder={`Value for {{${i + 1}}}`}
                  value={values[i] ?? ''}
                  onChangeText={(v) =>
                    setValues((prev) => {
                      const next = [...prev];
                      next[i] = v;
                      return next;
                    })
                  }
                />
              ))}

              <View style={[styles.preview, { backgroundColor: colors.surfaceSunken }]}>
                {selected.header_type === 'text' && selected.header_content ? (
                  <Text style={{ fontSize: 14, fontFamily: f.bold, color: colors.incomingText }}>
                    {selected.header_content}
                  </Text>
                ) : null}
                <Text style={{ fontSize: 14, lineHeight: 20, color: colors.incomingText }}>
                  {preview}
                </Text>
                {selected.footer_text ? (
                  <Text style={{ fontSize: 11.5, color: colors.textMuted }}>
                    {selected.footer_text}
                  </Text>
                ) : null}
              </View>

              <PrimaryButton
                label="Send template"
                busy={sending}
                disabled={!allFilled}
                onPress={() => onSend(selected, values.slice(0, varCount), preview)}
              />
            </ScrollView>
          )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    paddingBottom: spacing.sm,
  },
  templateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 13,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  preview: { borderRadius: radius.md, padding: spacing.md, gap: 6 },
});
