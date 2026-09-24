import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import * as Sharing from 'expo-sharing';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AppDialog, useAppDialog } from '@/components/app-dialog';
import { InvoiceEditorSheet } from '@/components/invoice-editor-sheet';
import { BottomSheet, sheetScrollArea } from '@/components/sheet';
import {
  EmptyState,
  FilterChip,
  PrimaryButton,
  TextField,
} from '@/components/ui';
import { apiBase, authHeaders } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import {
  BUNDLE_MAX_DEALS,
  bundleBlocker,
  bundleCandidateLabel,
  bundleCandidates,
  canDeleteDocument,
  categoryLabel,
  defaultBundleName,
  extractionEntries,
  financialsPatch,
  isReadable,
  nextDocumentStatuses,
  sameBuyerIds,
  DEAL_DOCUMENT_CATEGORIES,
  DEAL_DOCUMENT_STATUS_LABELS,
  DEAL_EVENT_LABELS,
  DEAL_MILESTONE_STATUS_LABELS,
  DEAL_SHARE_TTL_CHOICES,
  DEAL_UPDATE_VISIBILITIES,
  DEAL_VISIBILITY_LABELS,
  DEAL_WORKSPACE_TABS,
  INVOICE_STATUS_LABELS,
  SHARE_ACCESS_LABELS,
  STAKEHOLDER_ROLE_LABELS,
  STAKEHOLDER_SIDE_LABELS,
  TDS_STATUS_LABELS,
  UPDATE_CHANNELS,
  UPDATE_CHANNEL_LABELS,
  UPDATE_STAGE_LABELS,
  defaultSideForRole,
  isEligibleRecipient,
  linkState,
  recipientStage,
  shareLinkMessage,
  snapshotItemAllowed,
  type BundleCandidate,
  type DealDocumentCategory,
  type DealDocumentRow,
  type DealDocumentStatus,
  type DealFinancialsRow,
  type DealMilestoneRow,
  type DealMilestoneStatus,
  type DealShareAccessEvent,
  type DealShareLinkRow,
  type DealShareTtlKey,
  type DealSide,
  type DealStakeholderRow,
  type DealTaskRow,
  type DealUpdateRecipientRow,
  type DealUpdateRow,
  type DealUpdateVisibility,
  type DealVisibility,
  type DealWorkspaceTab,
  type InvoiceRow,
  type StakeholderRole,
  type TdsStatus,
  type UpdateChannel,
} from '@/lib/deal-workspace';
import {
  addCustomMilestone,
  addDealNoteWithVisibility,
  addDealStakeholder,
  addDealTask,
  addStandardMilestones,
  createDealGroup,
  createDealShareLink,
  createInvoice,
  deleteDealDocument,
  extractDocument,
  fetchDealDocumentUrl,
  fetchDealDocuments,
  fetchDealEvents,
  fetchDealFinancials,
  fetchDealGroup,
  fetchDealMilestones,
  fetchDealShareAccess,
  fetchDealStakeholders,
  fetchDealTasks,
  fetchDealUpdates,
  fetchInvoices,
  moveDealStage,
  invoiceAction,
  markUpdateRecipientSent,
  previewDealUpdate,
  publishDealUpdate,
  removeDealStakeholder,
  revokeDealShareLink,
  type UpdatePreviewRecipient,
  setDealDocumentVisibility,
  setDealMilestoneVisibility,
  setDealTaskCompleted,
  updateDealDocument,
  updateDealFinancials,
  updateDealMilestone,
  uploadDealDocument,
} from '@/lib/deal-workspace-api';
import { friendlyError } from '@/lib/errors';
import { auditDate, auditDateTime, formatInr } from '@/lib/format';
import {
  dealStatusForStage,
  needsBrokerageCapture,
} from '@/lib/stage-semantics';
import { supabase } from '@/lib/supabase';
import { haptic } from '@/lib/haptics';
import { radius, spacing, useTheme, fonts } from '@/lib/theme';
import type { PipelineStage } from '@/lib/types';

/** `friendlyError` takes the message text, and a rejected fetch can throw
 *  anything — so narrow it once here rather than at every call site. */
function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface DealHead {
  id: string;
  title: string;
  contact_id: string | null;
  property_id: string | null;
  pipeline_id: string;
  stage_id: string;
  value: number | null;
  brokerage_amount: number | null;
  deal_group_id: string | null;
  stage: { name: string } | { name: string }[] | null;
  contact:
    | { name: string | null; second_name: string | null }
    | { name: string | null; second_name: string | null }[]
    | null;
  group: { id: string; name: string } | { id: string; name: string }[] | null;
}

function brokeragePreview(
  dealValue: number | null,
  type: 'percentage' | 'fixed',
  raw: string
): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return type === 'fixed' ? value : ((dealValue ?? 0) * value) / 100;
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (v === null || v === undefined) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export default function DealWorkspaceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const dealId = typeof id === 'string' ? id : '';
  const { colors } = useTheme();
  const profile = useAuthStore((s) => s.profile);
  const canEdit = Boolean(profile && profile.account_role !== 'viewer');
  const [tab, setTab] = useState<DealWorkspaceTab>('overview');
  const [pickingStage, setPickingStage] = useState(false);
  const [movingStage, setMovingStage] = useState(false);
  const [brokeragePrompt, setBrokeragePrompt] = useState<PipelineStage | null>(
    null
  );
  const [brokerageType, setBrokerageType] = useState<'percentage' | 'fixed'>(
    'percentage'
  );
  const [brokerageValue, setBrokerageValue] = useState('');
  const [bundleOpen, setBundleOpen] = useState(false);
  const queryClient = useQueryClient();
  const headDialog = useAppDialog();

  const { data: head } = useQuery({
    queryKey: ['deal-head', dealId],
    enabled: Boolean(dealId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('deals')
        .select(
          'id, title, contact_id, property_id, pipeline_id, stage_id, value, brokerage_amount, deal_group_id, ' +
            'stage:pipeline_stages(name), contact:contacts(name, second_name), group:deal_groups(id, name)'
        )
        .eq('id', dealId)
        .maybeSingle();
      if (error) throw error;
      return (data as DealHead | null) ?? null;
    },
  });

  const pipelineId = head?.pipeline_id ?? null;
  const { data: stages } = useQuery({
    queryKey: ['pipeline-stages', pipelineId],
    enabled: Boolean(pipelineId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pipeline_stages')
        .select('*')
        .eq('pipeline_id', pipelineId!)
        .order('position');
      if (error) throw error;
      return (data ?? []) as PipelineStage[];
    },
  });

  function pickStage(stage: PipelineStage) {
    setPickingStage(false);
    if (!head || stage.id === head.stage_id) return;
    if (needsBrokerageCapture(head, stage.name)) {
      setBrokerageType('percentage');
      setBrokerageValue('');
      setBrokeragePrompt(stage);
      return;
    }
    void moveToStage(stage);
  }

  async function moveToStage(
    stage: PipelineStage,
    brokerage?: {
      brokerage_type: 'percentage' | 'fixed';
      brokerage_value: number;
    }
  ) {
    if (!head) return;
    setBrokeragePrompt(null);
    setMovingStage(true);
    try {
      await moveDealStage(dealId, {
        status: dealStatusForStage(stage.name),
        target_stage_id: stage.id,
        property_id: head.property_id,
        current_stage_name: stage.name,
        ...brokerage,
      });
      haptic.success();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['deal-head', dealId] }),
        queryClient.invalidateQueries({ queryKey: ['deals'] }),
      ]);
    } catch (err) {
      haptic.warn();
      headDialog.show({
        title: 'Could not move the deal',
        message: friendlyError(errorText(err)),
      });
    } finally {
      setMovingStage(false);
    }
  }

  const stageName = head ? (one(head.stage)?.name ?? '—') : null;
  const headGroup = head ? one(head.group) : null;
  const headContact = head ? one(head.contact) : null;
  const headContactName =
    [headContact?.name, headContact?.second_name].filter(Boolean).join(' ') ||
    null;

  return (
    <>
      <Stack.Screen
        options={{
          title: head?.title ?? 'Transaction',
          headerRight: () => (
            <Pressable
              onPress={() =>
                router.push(`/(app)/guidance-value?dealId=${dealId}`)
              }
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Guidance value"
            >
              <Ionicons name="scale-outline" size={22} color={colors.primary} />
            </Pressable>
          ),
        }}
      />
      <AppDialog {...headDialog.dialogProps} />
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        {head ? (
          canEdit && stages?.length ? (
            <Pressable
              onPress={() => setPickingStage(true)}
              disabled={movingStage}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Move this deal from ${stageName} to another stage`}
              style={styles.stageRow}
            >
              <Text style={[styles.stageLine, { color: colors.textMuted }]}>
                {stageName}
              </Text>
              <Ionicons
                name={movingStage ? 'hourglass-outline' : 'swap-horizontal'}
                size={14}
                color={colors.primary}
              />
              <Text style={[styles.stageMove, { color: colors.primary }]}>
                {movingStage ? 'Moving…' : 'Move stage'}
              </Text>
            </Pressable>
          ) : (
            <Text style={[styles.stageLine, { color: colors.textMuted }]}>
              {stageName}
            </Text>
          )
        ) : null}
        {head && (headGroup || canEdit) ? (
          <Pressable
            onPress={() => setBundleOpen(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={
              headGroup
                ? `Open the bundle ${headGroup.name}`
                : 'Bundle this deal with linked purchases'
            }
            style={styles.bundleRow}
          >
            <Ionicons name="layers-outline" size={14} color={colors.primary} />
            <Text style={[styles.bundleLine, { color: colors.primary }]}>
              {headGroup ? headGroup.name : 'Bundle'}
            </Text>
          </Pressable>
        ) : null}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabs}
        >
          {DEAL_WORKSPACE_TABS.map((item) => (
            <FilterChip
              key={item.id}
              label={item.label}
              active={tab === item.id}
              onPress={() => setTab(item.id)}
            />
          ))}
        </ScrollView>
        {tab === 'overview' && (
          <FinancialsTab dealId={dealId} canEdit={canEdit} />
        )}
        {tab === 'timeline' && (
          <TimelineTab dealId={dealId} canEdit={canEdit} />
        )}
        {tab === 'milestones' && (
          <MilestonesTab dealId={dealId} canEdit={canEdit} />
        )}
        {tab === 'tasks' && (
          <TasksTab
            dealId={dealId}
            canEdit={canEdit}
            contactId={head?.contact_id ?? null}
            propertyId={head?.property_id ?? null}
          />
        )}
        {tab === 'documents' && (
          <DocumentsTab dealId={dealId} canEdit={canEdit} />
        )}
        {tab === 'stakeholders' && (
          <StakeholdersTab
            dealId={dealId}
            dealTitle={head?.title ?? 'this'}
            canEdit={canEdit}
          />
        )}
        {tab === 'updates' && <UpdatesTab dealId={dealId} canEdit={canEdit} />}
        {tab === 'invoices' && <InvoicesTab dealId={dealId} />}
      </View>
      {head ? (
        <BundleSheet
          visible={bundleOpen}
          onClose={() => setBundleOpen(false)}
          deal={{
            id: head.id,
            contact_id: head.contact_id,
            contact_name: headContactName,
            group: headGroup,
          }}
        />
      ) : null}
      <BottomSheet
        visible={pickingStage}
        onClose={() => setPickingStage(false)}
      >
        <Text style={[styles.sheetTitle, { color: colors.text }]}>
          Move to…
        </Text>
        <ScrollView style={sheetScrollArea}>
          {(stages ?? [])
            .filter((s) => s.id !== head?.stage_id)
            .map((s) => (
              <Pressable
                key={s.id}
                style={[styles.stageOption, { borderTopColor: colors.border }]}
                onPress={() => pickStage(s)}
                accessibilityRole="button"
                accessibilityLabel={`Move to ${s.name}`}
              >
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: s.color || colors.primary,
                  }}
                />
                <Text style={[styles.stageOptionLabel, { color: colors.text }]}>
                  {s.name}
                </Text>
              </Pressable>
            ))}
        </ScrollView>
      </BottomSheet>
      <BottomSheet
        visible={brokeragePrompt !== null}
        onClose={() => setBrokeragePrompt(null)}
      >
        <Text style={[styles.sheetTitle, { color: colors.text }]}>
          Enter brokerage details
        </Text>
        <View style={styles.brokerageForm}>
          <Text style={{ fontSize: 13, color: colors.textMuted }}>
            Moving to {brokeragePrompt?.name} starts the closing stretch. Record
            the brokerage rate or amount first, as the pipeline board does.
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <FilterChip
              label="Percentage (%)"
              active={brokerageType === 'percentage'}
              onPress={() => setBrokerageType('percentage')}
            />
            <FilterChip
              label="Fixed amount"
              active={brokerageType === 'fixed'}
              onPress={() => setBrokerageType('fixed')}
            />
          </View>
          <TextField
            label={
              brokerageType === 'percentage'
                ? 'Brokerage (%)'
                : 'Brokerage amount'
            }
            value={brokerageValue}
            onChangeText={setBrokerageValue}
            keyboardType="decimal-pad"
            placeholder={brokerageType === 'percentage' ? '2' : '0'}
          />
          {brokeragePreview(
            head?.value ?? null,
            brokerageType,
            brokerageValue
          ) > 0 ? (
            <Text
              style={{
                fontSize: 12.5,
                fontFamily: fonts.bold,
                color: colors.primary,
              }}
            >
              Calculated brokerage:{' '}
              {formatInr(
                brokeragePreview(
                  head?.value ?? null,
                  brokerageType,
                  brokerageValue
                )
              )}
            </Text>
          ) : null}
          <PrimaryButton
            label="Save and move"
            disabled={
              !(Number(brokerageValue) > 0) ||
              !Number.isFinite(Number(brokerageValue))
            }
            onPress={() =>
              brokeragePrompt &&
              void moveToStage(brokeragePrompt, {
                brokerage_type: brokerageType,
                brokerage_value: Number(brokerageValue),
              })
            }
          />
        </View>
      </BottomSheet>
    </>
  );
}

interface BundleCandidateRow {
  id: string;
  title: string;
  contact_id: string | null;
  deal_group_id: string | null;
  contact:
    | { name: string | null; second_name: string | null }
    | { name: string | null; second_name: string | null }[]
    | null;
  property:
    | { title: string | null; unit_no: string | null }
    | { title: string | null; unit_no: string | null }[]
    | null;
  stage: { name: string } | { name: string }[] | null;
}

function BundleSheet({
  visible,
  onClose,
  deal,
}: {
  visible: boolean;
  onClose: () => void;
  deal: {
    id: string;
    contact_id: string | null;
    contact_name: string | null;
    group: { id: string; name: string } | null;
  };
}) {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const dialog = useAppDialog();
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: candidateRows, isLoading } = useQuery({
    queryKey: ['deal-bundle-candidates', deal.id],
    enabled: visible && !deal.group,
    queryFn: async (): Promise<BundleCandidate[]> => {
      const { data, error } = await supabase
        .from('deals')
        .select(
          'id, title, contact_id, deal_group_id, ' +
            'contact:contacts(name, second_name), ' +
            'property:properties(title, unit_no), ' +
            'stage:pipeline_stages(name)'
        )
        .is('deal_group_id', null)
        .not('status', 'in', '("won","lost")')
        .order('updated_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      const rows = ((data ?? []) as unknown as BundleCandidateRow[]).map(
        (row) => {
          const contact = one(row.contact);
          const property = one(row.property);
          return {
            id: row.id,
            title: row.title,
            contact_id: row.contact_id,
            deal_group_id: row.deal_group_id,
            contact_name:
              [contact?.name, contact?.second_name].filter(Boolean).join(' ') ||
              null,
            property_title: property?.title ?? null,
            property_unit_no: property?.unit_no ?? null,
            stage_name: one(row.stage)?.name ?? null,
          };
        }
      );
      return bundleCandidates(rows, deal);
    },
  });

  const { data: bundle, isLoading: bundleLoading } = useQuery({
    queryKey: ['deal-bundle', deal.group?.id],
    enabled: visible && Boolean(deal.group),
    queryFn: () => fetchDealGroup(deal.group!.id),
  });

  const candidates = candidateRows ?? [];
  if (visible && !deal.group && candidateRows && seededFor !== deal.id) {
    setSeededFor(deal.id);
    setName(defaultBundleName(deal.contact_name));
    setSelected(sameBuyerIds(candidateRows, deal));
  }

  const blocker = bundleBlocker(name, selected.length + 1);

  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function create() {
    if (blocker) return;
    setSaving(true);
    try {
      await createDealGroup({
        name: name.trim(),
        deal_ids: [deal.id, ...selected],
      });
      haptic.success();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['deal-head', deal.id] }),
        queryClient.invalidateQueries({ queryKey: ['deal-events', deal.id] }),
        queryClient.invalidateQueries({ queryKey: ['transaction-index'] }),
        queryClient.invalidateQueries({
          queryKey: ['deal-bundle-candidates'],
        }),
      ]);
      onClose();
    } catch (err) {
      haptic.warn();
      dialog.show({
        title: 'Could not create the bundle',
        message: friendlyError(errorText(err)),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <AppDialog {...dialog.dialogProps} />
      <BottomSheet visible={visible} onClose={onClose}>
        {deal.group ? (
          <>
            <Text style={[styles.sheetTitle, { color: colors.text }]}>
              {deal.group.name}
            </Text>
            {bundleLoading || !bundle ? (
              <Loading />
            ) : (
              <ScrollView style={sheetScrollArea}>
                <Text
                  style={{
                    fontSize: 12.5,
                    color: colors.textMuted,
                    paddingHorizontal: spacing.lg,
                    paddingBottom: spacing.sm,
                  }}
                >
                  {bundle.progress.done}/{bundle.progress.total} milestones
                  across {bundle.deals.length} deals
                </Text>
                {bundle.deals.map((member) => {
                  const contact = one(member.contact);
                  const property = one(member.property);
                  const who = [contact?.name, contact?.second_name]
                    .filter(Boolean)
                    .join(' ');
                  const label = bundleCandidateLabel({
                    title: member.title,
                    property_title: property?.title ?? null,
                    property_unit_no: property?.unit_no ?? null,
                  });
                  const current = member.id === deal.id;
                  return (
                    <Pressable
                      key={member.id}
                      disabled={current}
                      onPress={() => {
                        onClose();
                        router.push(`/(app)/deal/${member.id}`);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${label}`}
                      style={[
                        styles.stageOption,
                        { borderTopColor: colors.border },
                      ]}
                    >
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text
                          style={[
                            styles.stageOptionLabel,
                            { color: colors.text },
                          ]}
                        >
                          {who ? `${who} — ${label}` : label}
                          {current ? ' · this deal' : ''}
                        </Text>
                        <Text style={{ fontSize: 12, color: colors.textMuted }}>
                          {[
                            one(member.stage)?.name,
                            `${member.progress.done}/${member.progress.total} milestones`,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </Text>
                      </View>
                      <Text
                        style={{
                          fontSize: 13,
                          fontFamily: fonts.semibold,
                          color: colors.text,
                        }}
                      >
                        {formatInr(member.value)}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
          </>
        ) : (
          <>
            <Text style={[styles.sheetTitle, { color: colors.text }]}>
              Bundle linked deals
            </Text>
            <View style={styles.brokerageForm}>
              <Text style={{ fontSize: 13, color: colors.textMuted }}>
                One buyer closing several properties together. Each deal keeps
                its own seller, milestones, papers and terms; the bundle shows
                their combined progress.
              </Text>
              <TextField
                label="Bundle name"
                value={name}
                onChangeText={setName}
              />
            </View>
            <ScrollView style={sheetScrollArea}>
              {isLoading ? (
                <Loading />
              ) : candidates.length === 0 ? (
                <Text
                  style={{
                    fontSize: 13,
                    color: colors.textMuted,
                    paddingHorizontal: spacing.lg,
                  }}
                >
                  No other open deal is free to bundle.
                </Text>
              ) : (
                candidates.map((c) => {
                  const checked = selected.includes(c.id);
                  const full =
                    !checked && selected.length + 1 >= BUNDLE_MAX_DEALS;
                  return (
                    <Pressable
                      key={c.id}
                      disabled={full}
                      onPress={() => toggle(c.id)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked }}
                      accessibilityLabel={bundleCandidateLabel(c)}
                      style={[
                        styles.stageOption,
                        {
                          borderTopColor: colors.border,
                          opacity: full ? 0.5 : 1,
                        },
                      ]}
                    >
                      <Ionicons
                        name={checked ? 'checkbox' : 'square-outline'}
                        size={20}
                        color={checked ? colors.primary : colors.textMuted}
                      />
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text
                          style={[
                            styles.stageOptionLabel,
                            { color: colors.text },
                          ]}
                        >
                          {bundleCandidateLabel(c)}
                        </Text>
                        <Text style={{ fontSize: 12, color: colors.textMuted }}>
                          {[c.contact_name, c.stage_name]
                            .filter(Boolean)
                            .join(' · ')}
                        </Text>
                      </View>
                      {deal.contact_id && c.contact_id === deal.contact_id ? (
                        <Text style={{ fontSize: 11, color: colors.textMuted }}>
                          Same buyer
                        </Text>
                      ) : null}
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
            <View style={styles.brokerageForm}>
              {blocker ? (
                <Text style={{ fontSize: 12, color: colors.textMuted }}>
                  {blocker}
                </Text>
              ) : null}
              <PrimaryButton
                label={saving ? 'Creating…' : 'Create bundle'}
                disabled={Boolean(blocker) || saving}
                onPress={() => void create()}
              />
            </View>
          </>
        )}
      </BottomSheet>
    </>
  );
}

const FINANCIAL_FIELDS: {
  key: keyof Omit<DealFinancialsRow, 'token_source' | 'token' | 'tds_status'>;
  label: string;
  kind: 'money' | 'date' | 'text' | 'multiline';
  token?: boolean;
}[] = [
  { key: 'agreed_consideration', label: 'Agreed consideration', kind: 'money' },
  { key: 'registered_consideration', label: 'Registered value', kind: 'money' },
  { key: 'other_component', label: 'Other component', kind: 'money' },
  {
    key: 'brokerage_received_amount',
    label: 'Brokerage received',
    kind: 'money',
  },
  { key: 'token_amount', label: 'Token amount', kind: 'money', token: true },
  {
    key: 'token_received_at',
    label: 'Token received on (YYYY-MM-DD)',
    kind: 'date',
    token: true,
  },
  {
    key: 'token_instrument_ref',
    label: 'Token instrument / UTR',
    kind: 'text',
    token: true,
  },
  { key: 'tds_amount', label: 'TDS amount', kind: 'money' },
  {
    key: 'payment_instrument_refs',
    label: 'Payment instrument references',
    kind: 'multiline',
  },
];

function toDraft(f: DealFinancialsRow): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of FINANCIAL_FIELDS) {
    const v = f[field.key];
    out[field.key] = v === null || v === undefined ? '' : String(v);
  }
  out.tds_status = f.tds_status ?? '';
  return out;
}

function FinancialsTab({
  dealId,
  canEdit,
}: {
  dealId: string;
  canEdit: boolean;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['deal-financials', dealId],
    queryFn: () => fetchDealFinancials(dealId),
    enabled: Boolean(dealId),
  });

  if (isLoading || !data) return <Loading />;

  // Keyed on the server row so a save (which replaces the query data)
  // remounts the form with the fresh values — no effect needed.
  return (
    <FinancialsForm
      key={JSON.stringify(data)}
      dealId={dealId}
      canEdit={canEdit}
      data={data}
    />
  );
}

function FinancialsForm({
  dealId,
  canEdit,
  data,
}: {
  dealId: string;
  canEdit: boolean;
  data: DealFinancialsRow;
}) {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const dialog = useAppDialog();
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    toDraft(data)
  );
  const [saving, setSaving] = useState(false);

  const tokenSafe = data.token_source === 'token_safe';

  async function save() {
    const patch = financialsPatch(toDraft(data), draft, data.token_source);
    if (Object.keys(patch).length === 0) return;
    setSaving(true);
    try {
      const next = await updateDealFinancials(dealId, patch);
      queryClient.setQueryData(['deal-financials', dealId], next);
      await queryClient.invalidateQueries({
        queryKey: ['deal-events', dealId],
      });
      void haptic.success();
    } catch (err) {
      dialog.show({
        title: 'Could not save',
        message: friendlyError(errorText(err)),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView
      contentContainerStyle={styles.list}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.cardMeta, { color: colors.textMuted }]}>
        Internal record-keeping. Nothing here is shared outside your account.
      </Text>
      {tokenSafe ? (
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.cardTitle, { color: colors.text }]}>
            Token — recorded in Token Safe
          </Text>
          <Text style={[styles.cardMeta, { color: colors.textMuted }]}>
            {data.token.amount != null
              ? `${formatInr(data.token.amount)} · ${data.token.received_at ?? ''}`
              : data.token.status
                ? `Escrow ${data.token.status}`
                : 'Not yet'}
            {data.token.reference ? ` · ${data.token.reference}` : ''}
          </Text>
        </View>
      ) : null}
      {FINANCIAL_FIELDS.filter((f) => !(tokenSafe && f.token)).map((field) => (
        <TextField
          key={field.key}
          label={field.label}
          value={draft[field.key] ?? ''}
          editable={canEdit}
          multiline={field.kind === 'multiline'}
          keyboardType={field.kind === 'money' ? 'decimal-pad' : 'default'}
          onChangeText={(text) =>
            setDraft((d) => ({ ...d, [field.key]: text }))
          }
        />
      ))}
      <Text style={[styles.cardMeta, { color: colors.textMuted }]}>TDS</Text>
      <View style={styles.chipRow}>
        {(Object.keys(TDS_STATUS_LABELS) as TdsStatus[]).map((status) => (
          <FilterChip
            key={status}
            label={TDS_STATUS_LABELS[status]}
            active={draft.tds_status === status}
            onPress={() =>
              canEdit &&
              setDraft((d) => ({
                ...d,
                tds_status: d.tds_status === status ? '' : status,
              }))
            }
          />
        ))}
      </View>
      {canEdit ? (
        <PrimaryButton
          label="Save financials"
          onPress={() => void save()}
          busy={saving}
        />
      ) : null}
      <AppDialog {...dialog.dialogProps} />
    </ScrollView>
  );
}

function TimelineTab({
  dealId,
  canEdit,
}: {
  dealId: string;
  canEdit: boolean;
}) {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const dialog = useAppDialog();
  const [note, setNote] = useState('');
  const [visibility, setVisibility] = useState<DealVisibility>('internal');
  const [saving, setSaving] = useState(false);

  const { data: events = [], isLoading } = useQuery({
    queryKey: ['deal-events', dealId],
    queryFn: () => fetchDealEvents(dealId),
    enabled: Boolean(dealId),
  });

  async function add() {
    const text = note.trim();
    if (!text) return;
    setSaving(true);
    try {
      await addDealNoteWithVisibility(dealId, text, visibility);
      setNote('');
      await queryClient.invalidateQueries({
        queryKey: ['deal-events', dealId],
      });
      void haptic.success();
    } catch (err) {
      dialog.show({
        title: 'Could not add',
        message: friendlyError(errorText(err)),
      });
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <Loading />;

  return (
    <ScrollView
      contentContainerStyle={styles.list}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.cardMeta, { color: colors.textMuted }]}>
        Every change, in order. Entries cannot be edited or removed.
      </Text>
      {canEdit ? (
        <>
          <TextField
            placeholder="Add an internal note…"
            value={note}
            multiline
            onChangeText={setNote}
          />
          <VisibilityChips value={visibility} onChange={setVisibility} />
          <PrimaryButton
            label="Add note"
            onPress={() => void add()}
            busy={saving}
            disabled={!note.trim()}
          />
        </>
      ) : null}
      {events.length === 0 ? (
        <EmptyState
          icon="time-outline"
          title="Nothing recorded yet"
          subtitle=""
        />
      ) : (
        events.map((ev) => {
          const noteText =
            ev.event_type === 'note_added' &&
            typeof ev.metadata?.note === 'string'
              ? ev.metadata.note
              : null;
          return (
            <View
              key={ev.id}
              style={[
                styles.card,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.cardTitle, { color: colors.text }]}>
                {noteText ?? ev.title}
              </Text>
              <Text style={[styles.cardMeta, { color: colors.textMuted }]}>
                {DEAL_EVENT_LABELS[ev.event_type] ?? ev.event_type}
                {ev.actor_name ? ` · ${ev.actor_name}` : ''} ·{' '}
                {auditDateTime(ev.created_at)}
              </Text>
            </View>
          );
        })
      )}
      <AppDialog {...dialog.dialogProps} />
    </ScrollView>
  );
}

function MilestonesTab({
  dealId,
  canEdit,
}: {
  dealId: string;
  canEdit: boolean;
}) {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const dialog = useAppDialog();
  const [busy, setBusy] = useState<string | null>(null);
  const [title, setTitle] = useState('');

  const { data: milestones = [], isLoading } = useQuery({
    queryKey: ['deal-milestones', dealId],
    queryFn: () => fetchDealMilestones(dealId),
    enabled: Boolean(dealId),
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['deal-milestones', dealId] }),
      queryClient.invalidateQueries({ queryKey: ['deal-events', dealId] }),
    ]);

  async function run(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    try {
      await action();
      await refresh();
      void haptic.success();
    } catch (err) {
      dialog.show({
        title: 'That did not work',
        message: friendlyError(errorText(err)),
      });
    } finally {
      setBusy(null);
    }
  }

  function chooseVisibility(m: DealMilestoneRow) {
    dialog.show({
      title: `Who can see "${m.title}"?`,
      message: 'Stakeholder links show only what their side may see.',
      actions: [
        ...(Object.keys(DEAL_VISIBILITY_LABELS) as DealVisibility[]).map(
          (v) => ({
            label: `${v === m.visibility ? '✓ ' : ''}${DEAL_VISIBILITY_LABELS[v]}`,
            onPress: () => {
              dialog.close();
              void run(m.id, () => setDealMilestoneVisibility(dealId, m.id, v));
            },
          })
        ),
        { label: 'Cancel', variant: 'muted' as const, onPress: dialog.close },
      ],
    });
  }

  function chooseStatus(m: DealMilestoneRow) {
    dialog.show({
      title: m.title,
      message: 'Completing a milestone never moves the pipeline stage.',
      actions: [
        {
          label: `Visibility: ${DEAL_VISIBILITY_LABELS[m.visibility ?? 'internal']}`,
          onPress: () => {
            dialog.close();
            chooseVisibility(m);
          },
        },
        ...(Object.keys(DEAL_MILESTONE_STATUS_LABELS) as DealMilestoneStatus[])
          .filter((s) => s !== m.status)
          .map((s) => ({
            label: DEAL_MILESTONE_STATUS_LABELS[s],
            onPress: () => {
              dialog.close();
              void run(m.id, () =>
                updateDealMilestone(dealId, m.id, { status: s })
              );
            },
          })),
        { label: 'Cancel', variant: 'muted' as const, onPress: dialog.close },
      ],
    });
  }

  if (isLoading) return <Loading />;

  const done = milestones.filter(
    (m) => m.status === 'completed' || m.status === 'skipped'
  ).length;

  return (
    <ScrollView
      contentContainerStyle={styles.list}
      keyboardShouldPersistTaps="handled"
    >
      {milestones.length === 0 ? (
        <>
          <EmptyState
            icon="checkmark-done-outline"
            title="No milestones yet"
            subtitle="Token, legal, agreement, registration, handover — the standard closing checklist."
          />
          {canEdit ? (
            <PrimaryButton
              label="Add the standard checklist"
              busy={busy === 'standard'}
              onPress={() =>
                void run('standard', () => addStandardMilestones(dealId))
              }
            />
          ) : null}
        </>
      ) : (
        <>
          <Text style={[styles.cardMeta, { color: colors.textMuted }]}>
            {done} / {milestones.length} done
          </Text>
          {milestones.map((m) => {
            const isDone = m.status === 'completed' || m.status === 'skipped';
            return (
              <Pressable
                key={m.id}
                disabled={!canEdit || busy === m.id}
                onPress={() => chooseStatus(m)}
                style={[
                  styles.card,
                  styles.row,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    opacity: isDone ? 0.7 : 1,
                  },
                ]}
              >
                <Ionicons
                  name={
                    m.status === 'completed'
                      ? 'checkmark-circle'
                      : m.status === 'skipped'
                        ? 'remove-circle-outline'
                        : m.status === 'in_progress'
                          ? 'ellipse-outline'
                          : 'ellipse-outline'
                  }
                  size={22}
                  color={
                    m.status === 'completed' ? colors.success : colors.textMuted
                  }
                />
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      styles.cardTitle,
                      {
                        color: colors.text,
                        textDecorationLine:
                          m.status === 'completed' ? 'line-through' : 'none',
                      },
                    ]}
                  >
                    {m.title}
                  </Text>
                  <Text style={[styles.cardMeta, { color: colors.textMuted }]}>
                    {DEAL_MILESTONE_STATUS_LABELS[m.status]}
                    {m.target_date ? ` · due ${m.target_date}` : ''}
                    {m.visibility && m.visibility !== 'internal'
                      ? ` · ${DEAL_VISIBILITY_LABELS[m.visibility]}`
                      : ''}
                  </Text>
                </View>
              </Pressable>
            );
          })}
          {canEdit ? (
            <>
              <TextField
                placeholder="Custom milestone…"
                value={title}
                onChangeText={setTitle}
              />
              <PrimaryButton
                label="Add milestone"
                busy={busy === 'custom'}
                disabled={!title.trim()}
                onPress={() =>
                  void run('custom', async () => {
                    await addCustomMilestone(dealId, title.trim(), null);
                    setTitle('');
                  })
                }
              />
            </>
          ) : null}
        </>
      )}
      <AppDialog {...dialog.dialogProps} />
    </ScrollView>
  );
}

function TasksTab({
  dealId,
  canEdit,
  contactId,
  propertyId,
}: {
  dealId: string;
  canEdit: boolean;
  contactId: string | null;
  propertyId: string | null;
}) {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const dialog = useAppDialog();
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<DealTaskRow['priority']>('medium');
  const [busy, setBusy] = useState<string | null>(null);

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['deal-tasks', dealId],
    queryFn: () => fetchDealTasks(dealId),
    enabled: Boolean(dealId),
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['deal-tasks', dealId] });

  async function run(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    try {
      await action();
      await refresh();
      void haptic.success();
    } catch (err) {
      dialog.show({
        title: 'That did not work',
        message: friendlyError(errorText(err)),
      });
    } finally {
      setBusy(null);
    }
  }

  if (isLoading) return <Loading />;

  const ordered = [
    ...tasks.filter((t) => !t.completed),
    ...tasks.filter((t) => t.completed),
  ];

  return (
    <ScrollView
      contentContainerStyle={styles.list}
      keyboardShouldPersistTaps="handled"
    >
      {canEdit ? (
        <>
          <TextField
            placeholder="What needs doing?"
            value={title}
            onChangeText={setTitle}
          />
          <View style={styles.chipRow}>
            {(['low', 'medium', 'high'] as const).map((p) => (
              <FilterChip
                key={p}
                label={p}
                active={priority === p}
                onPress={() => setPriority(p)}
              />
            ))}
          </View>
          <PrimaryButton
            label="Add task"
            busy={busy === 'new'}
            disabled={!title.trim()}
            onPress={() =>
              void run('new', async () => {
                await addDealTask(dealId, {
                  title: title.trim(),
                  priority,
                  dueDate: null,
                  contactId,
                  propertyId,
                });
                setTitle('');
              })
            }
          />
        </>
      ) : null}
      {ordered.length === 0 ? (
        <EmptyState
          icon="list-outline"
          title="No tasks on this deal"
          subtitle=""
        />
      ) : (
        ordered.map((task) => (
          <Pressable
            key={task.id}
            disabled={!canEdit || busy === task.id}
            onPress={() =>
              void run(task.id, () =>
                setDealTaskCompleted(task.id, !task.completed)
              )
            }
            style={[
              styles.card,
              styles.row,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                opacity: task.completed ? 0.6 : 1,
              },
            ]}
          >
            <Ionicons
              name={task.completed ? 'checkmark-circle' : 'ellipse-outline'}
              size={22}
              color={task.completed ? colors.success : colors.textMuted}
            />
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.cardTitle,
                  {
                    color: colors.text,
                    textDecorationLine: task.completed
                      ? 'line-through'
                      : 'none',
                  },
                ]}
              >
                {task.title}
              </Text>
              <Text style={[styles.cardMeta, { color: colors.textMuted }]}>
                {task.priority} priority
                {task.due_date ? ` · due ${auditDate(task.due_date)}` : ''}
              </Text>
            </View>
          </Pressable>
        ))
      )}
      <AppDialog {...dialog.dialogProps} />
    </ScrollView>
  );
}

function InvoicesTab({ dealId }: { dealId: string }) {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const dialog = useAppDialog();
  const [busy, setBusy] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['deal-invoices', dealId],
    queryFn: () => fetchInvoices(dealId),
    enabled: Boolean(dealId),
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['deal-invoices', dealId] });

  async function create() {
    setBusy('new');
    try {
      const draft = await createInvoice(dealId);
      await refresh();
      void haptic.success();
      // Straight into the editor: an agent has to be able to correct
      // the prefill before issuing makes it immutable.
      setEditingId(draft.id);
    } catch (err) {
      dialog.show({
        title: 'Could not create',
        message: friendlyError(errorText(err)),
      });
    } finally {
      setBusy(null);
    }
  }

  async function act(
    invoice: InvoiceRow,
    action: 'issue' | 'cancel' | 'mark-paid' | 'send',
    body: Record<string, unknown>,
    successTitle: string
  ) {
    setBusy(invoice.id);
    try {
      await invoiceAction(invoice.id, action, body);
      await refresh();
      void haptic.success();
      dialog.show({ title: successTitle, message: '' });
    } catch (err) {
      dialog.show({
        title: 'That did not work',
        message: friendlyError(errorText(err)),
      });
    } finally {
      setBusy(null);
    }
  }

  /**
   * Download the PDF through the authed route and hand it to the share
   * sheet. The bucket is private, so there is no URL a viewer could open
   * directly — the bearer token has to travel with the request.
   */
  async function sharePdf(invoice: InvoiceRow) {
    setBusy(invoice.id);
    try {
      const file = await File.downloadFileAsync(
        `${apiBase()}/api/invoices/${invoice.id}/pdf?download=1`,
        new File(Paths.cache, `invoice-${invoice.id}.pdf`),
        { headers: await authHeaders(), idempotent: true }
      );
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf' });
      }
    } catch (err) {
      dialog.show({
        title: 'Could not open',
        message: friendlyError(errorText(err)),
      });
    } finally {
      setBusy(null);
    }
  }

  if (isLoading) {
    return <Loading />;
  }

  return (
    <ScrollView contentContainerStyle={styles.list}>
      <Pressable
        onPress={create}
        disabled={busy === 'new'}
        style={[styles.primaryButton, { backgroundColor: colors.primary }]}
      >
        {busy === 'new' ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Ionicons name="add" size={18} color="#fff" />
        )}
        <Text style={styles.primaryButtonText}>New invoice</Text>
      </Pressable>

      {invoices.length === 0 ? (
        <EmptyState
          icon="receipt-outline"
          title="No invoices yet"
          subtitle="A new invoice fills itself in from this deal's value, brokerage rate and property."
        />
      ) : (
        invoices.map((invoice) => (
          <View
            key={invoice.id}
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.cardHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>
                  {invoice.invoice_number ?? 'Draft'}
                </Text>
                <Text style={[styles.cardMeta, { color: colors.textMuted }]}>
                  {INVOICE_STATUS_LABELS[invoice.status]} · {invoice.side} ·{' '}
                  {invoice.share_percent}%
                </Text>
                <Text style={[styles.cardMeta, { color: colors.textMuted }]}>
                  {invoice.bill_to?.name ?? 'No customer name'} ·{' '}
                  {auditDate(invoice.invoice_date)}
                </Text>
              </View>
              <Text style={[styles.amount, { color: colors.text }]}>
                {formatInr(invoice.grand_total)}
              </Text>
            </View>

            <View style={styles.actions}>
              {invoice.status === 'draft' && (
                <>
                  <ActionButton
                    label="Review"
                    icon="create-outline"
                    busy={false}
                    onPress={() => setEditingId(invoice.id)}
                  />
                  <ActionButton
                    label="Issue"
                    icon="checkmark-circle-outline"
                    busy={busy === invoice.id}
                    onPress={() =>
                      act(invoice, 'issue', {}, 'Issued and numbered')
                    }
                  />
                </>
              )}
              {invoice.status !== 'draft' && (
                <ActionButton
                  label="PDF"
                  icon="document-outline"
                  busy={busy === invoice.id}
                  onPress={() => sharePdf(invoice)}
                />
              )}
              {(invoice.status === 'issued' || invoice.status === 'sent') && (
                <>
                  <ActionButton
                    label="WhatsApp"
                    icon="logo-whatsapp"
                    busy={busy === invoice.id}
                    onPress={() =>
                      act(invoice, 'send', { channel: 'whatsapp' }, 'Sent')
                    }
                  />
                  <ActionButton
                    label="Mark paid"
                    icon="wallet-outline"
                    busy={busy === invoice.id}
                    onPress={() => act(invoice, 'mark-paid', {}, 'Marked paid')}
                  />
                </>
              )}
              {invoice.status !== 'draft' && invoice.status !== 'cancelled' && (
                <ActionButton
                  label="Cancel"
                  icon="ban-outline"
                  busy={busy === invoice.id}
                  onPress={() =>
                    dialog.show({
                      title: `Cancel ${invoice.invoice_number}?`,
                      message:
                        'The number stays in your series so the books have no gap.',
                      actions: [
                        {
                          label: 'Keep it',
                          onPress: dialog.close,
                          variant: 'muted',
                        },
                        {
                          label: 'Cancel invoice',
                          variant: 'destructive',
                          onPress: () => {
                            dialog.close();
                            void act(
                              invoice,
                              'cancel',
                              {},
                              'Invoice cancelled'
                            );
                          },
                        },
                      ],
                    })
                  }
                />
              )}
            </View>
          </View>
        ))
      )}
      <InvoiceEditorSheet
        invoiceId={editingId}
        visible={editingId !== null}
        onClose={() => setEditingId(null)}
        onSaved={refresh}
      />
      <AppDialog {...dialog.dialogProps} />
    </ScrollView>
  );
}

function DocumentsTab({
  dealId,
  canEdit,
}: {
  dealId: string;
  canEdit: boolean;
}) {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const dialog = useAppDialog();
  const [category, setCategory] = useState<DealDocumentCategory>('identity');
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expiryFor, setExpiryFor] = useState<string | null>(null);
  const [expiryText, setExpiryText] = useState('');

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['deal-documents', dealId],
    queryFn: () => fetchDealDocuments(dealId),
    enabled: Boolean(dealId),
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['deal-documents', dealId] }),
      queryClient.invalidateQueries({ queryKey: ['deal-events', dealId] }),
    ]);

  async function patch(
    doc: DealDocumentRow,
    body: {
      status?: DealDocumentStatus;
      expires_at?: string | null;
      superseded_by?: string;
    }
  ) {
    setBusy(doc.id);
    try {
      await updateDealDocument(dealId, doc.id, body);
      await refresh();
      setExpiryFor(null);
      void haptic.success();
    } catch (err) {
      dialog.show({
        title: 'Could not update',
        message: friendlyError(errorText(err)),
      });
    } finally {
      setBusy(null);
    }
  }

  function chooseStatus(doc: DealDocumentRow) {
    const options = nextDocumentStatuses(doc.status);
    if (options.length === 0) return;
    dialog.show({
      title: doc.title,
      message: 'Status only moves forward.',
      actions: [
        ...options.map((status) => ({
          label: DEAL_DOCUMENT_STATUS_LABELS[status],
          onPress: () => {
            dialog.close();
            void patch(doc, { status });
          },
        })),
        { label: 'Cancel', variant: 'muted' as const, onPress: dialog.close },
      ],
    });
  }

  function chooseDocVisibility(doc: DealDocumentRow) {
    dialog.show({
      title: `Who can open "${doc.title}"?`,
      message:
        'Photos carry the viewer\u2019s name as a watermark when opened through a link.',
      actions: [
        ...(Object.keys(DEAL_VISIBILITY_LABELS) as DealVisibility[]).map(
          (v) => ({
            label: `${v === doc.visibility ? '✓ ' : ''}${DEAL_VISIBILITY_LABELS[v]}`,
            onPress: () => {
              dialog.close();
              setBusy(doc.id);
              void setDealDocumentVisibility(dealId, doc.id, v)
                .then(refresh)
                .catch((err) =>
                  dialog.show({
                    title: 'Could not update',
                    message: friendlyError(errorText(err)),
                  })
                )
                .finally(() => setBusy(null));
            },
          })
        ),
        { label: 'Cancel', variant: 'muted' as const, onPress: dialog.close },
      ],
    });
  }

  function chooseReplacement(doc: DealDocumentRow) {
    const candidates = documents.filter(
      (d) => d.id !== doc.id && !d.superseded_by
    );
    if (candidates.length === 0) {
      dialog.show({ title: 'Upload the newer version first', message: '' });
      return;
    }
    dialog.show({
      title: `Supersede "${doc.title}"`,
      message:
        'Pick the document that replaces it. This one stays in the folder, marked.',
      actions: [
        ...candidates.map((d) => ({
          label: d.title,
          onPress: () => {
            dialog.close();
            void patch(doc, { superseded_by: d.id });
          },
        })),
        { label: 'Cancel', variant: 'muted' as const, onPress: dialog.close },
      ],
    });
  }

  async function pickAndUpload() {
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*'],
      copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets?.[0]) return;

    const asset = picked.assets[0];
    setBusy('upload');
    try {
      await uploadDealDocument(
        dealId,
        {
          uri: asset.uri,
          name: asset.name || 'document',
          mimeType: asset.mimeType || 'application/octet-stream',
        },
        category
      );
      await refresh();
      void haptic.success();
    } catch (err) {
      dialog.show({
        title: 'Upload failed',
        message: friendlyError(errorText(err)),
      });
    } finally {
      setBusy(null);
    }
  }

  async function openDocument(doc: DealDocumentRow) {
    setBusy(`open:${doc.id}`);
    try {
      await Linking.openURL(await fetchDealDocumentUrl(dealId, doc.id));
    } catch (err) {
      dialog.show({
        title: 'Could not open it',
        message: friendlyError(errorText(err)),
      });
    } finally {
      setBusy(null);
    }
  }

  async function read(doc: DealDocumentRow) {
    setBusy(doc.id);
    try {
      await extractDocument(dealId, doc.id);
      await refresh();
      setExpanded(doc.id);
      void haptic.success();
    } catch (err) {
      dialog.show({
        title: 'Could not read',
        message: friendlyError(errorText(err)),
      });
    } finally {
      setBusy(null);
    }
  }

  async function remove(doc: DealDocumentRow) {
    setBusy(doc.id);
    try {
      await deleteDealDocument(dealId, doc.id);
      await refresh();
    } catch (err) {
      dialog.show({
        title: 'Could not delete',
        message: friendlyError(errorText(err)),
      });
    } finally {
      setBusy(null);
    }
  }

  if (isLoading) return <Loading />;

  return (
    <ScrollView contentContainerStyle={styles.list}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {DEAL_DOCUMENT_CATEGORIES.map((option) => (
          <FilterChip
            key={option.value}
            label={option.label}
            active={category === option.value}
            onPress={() => setCategory(option.value)}
          />
        ))}
      </ScrollView>

      {canEdit && (
        <Pressable
          onPress={pickAndUpload}
          disabled={busy === 'upload'}
          style={[styles.primaryButton, { backgroundColor: colors.primary }]}
        >
          {busy === 'upload' ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
          )}
          <Text style={styles.primaryButtonText}>Upload document</Text>
        </Pressable>
      )}

      {documents.length === 0 ? (
        <EmptyState
          icon="folder-open-outline"
          title="Nothing filed yet"
          subtitle="Aadhaars, agreement drafts and old sale deeds. Stored privately."
        />
      ) : (
        documents.map((doc) => {
          const entries = extractionEntries(doc.extracted);
          return (
            <View
              key={doc.id}
              style={[
                styles.card,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.cardTitle, { color: colors.text }]}>
                {doc.title}
              </Text>
              <Text style={[styles.cardMeta, { color: colors.textMuted }]}>
                {categoryLabel(doc.category)}
                {doc.size_bytes
                  ? ` · ${Math.max(1, Math.round(doc.size_bytes / 1024))} KB`
                  : ''}
              </Text>
              {(doc.status || doc.superseded_by || doc.expires_at) && (
                <Text
                  style={[
                    styles.cardMeta,
                    {
                      color: doc.superseded_by
                        ? colors.warning
                        : colors.textMuted,
                    },
                  ]}
                >
                  {doc.status
                    ? DEAL_DOCUMENT_STATUS_LABELS[doc.status]
                    : 'Unlabelled'}
                  {doc.superseded_by ? ' · Superseded' : ''}
                  {doc.expires_at ? ` · Expires ${doc.expires_at}` : ''}
                </Text>
              )}

              <View style={styles.actions}>
                <ActionButton
                  label="Open"
                  icon="open-outline"
                  busy={busy === `open:${doc.id}`}
                  onPress={() => openDocument(doc)}
                />
                {canEdit &&
                  !doc.superseded_by &&
                  nextDocumentStatuses(doc.status).length > 0 && (
                    <ActionButton
                      label="Status"
                      icon="flag-outline"
                      busy={busy === doc.id}
                      onPress={() => chooseStatus(doc)}
                    />
                  )}
                {canEdit && !doc.superseded_by && (
                  <ActionButton
                    label="Visibility"
                    icon="eye-outline"
                    busy={busy === doc.id}
                    onPress={() => chooseDocVisibility(doc)}
                  />
                )}
                {canEdit && !doc.superseded_by && (
                  <ActionButton
                    label="Expiry"
                    icon="calendar-outline"
                    busy={busy === doc.id}
                    onPress={() => {
                      setExpiryFor(expiryFor === doc.id ? null : doc.id);
                      setExpiryText(doc.expires_at ?? '');
                    }}
                  />
                )}
                {canEdit && !doc.superseded_by && documents.length > 1 && (
                  <ActionButton
                    label="Supersede"
                    icon="swap-horizontal-outline"
                    busy={busy === doc.id}
                    onPress={() => chooseReplacement(doc)}
                  />
                )}
                {canEdit && isReadable(doc.mime_type) && (
                  <ActionButton
                    label={doc.extracted ? 'Read again' : 'Read with AI'}
                    icon="sparkles-outline"
                    busy={busy === doc.id}
                    onPress={() => read(doc)}
                  />
                )}
                {entries.length > 0 && (
                  <ActionButton
                    label={expanded === doc.id ? 'Hide' : 'Show read-out'}
                    icon="list-outline"
                    busy={false}
                    onPress={() =>
                      setExpanded(expanded === doc.id ? null : doc.id)
                    }
                  />
                )}
                {canEdit && canDeleteDocument(doc) && (
                  <ActionButton
                    label="Delete"
                    icon="trash-outline"
                    busy={busy === doc.id}
                    onPress={() =>
                      dialog.show({
                        title: `Delete "${doc.title}"?`,
                        message: 'This cannot be undone.',
                        actions: [
                          {
                            label: 'Keep',
                            onPress: dialog.close,
                            variant: 'muted',
                          },
                          {
                            label: 'Delete',
                            variant: 'destructive',
                            onPress: () => {
                              dialog.close();
                              void remove(doc);
                            },
                          },
                        ],
                      })
                    }
                  />
                )}
              </View>

              {expiryFor === doc.id && (
                <View style={styles.extraction}>
                  <TextInput
                    value={expiryText}
                    onChangeText={setExpiryText}
                    placeholder="YYYY-MM-DD (blank to clear)"
                    placeholderTextColor={colors.textFaint}
                    style={[
                      styles.expiryInput,
                      { color: colors.text, borderColor: colors.border },
                    ]}
                  />
                  <PrimaryButton
                    label="Save expiry"
                    busy={busy === doc.id}
                    onPress={() =>
                      void patch(doc, { expires_at: expiryText.trim() || null })
                    }
                  />
                </View>
              )}

              {doc.extraction_status === 'failed' && (
                <Text style={[styles.cardMeta, { color: colors.danger }]}>
                  Could not read this one. Your credits were refunded.
                </Text>
              )}

              {expanded === doc.id && entries.length > 0 && (
                <View style={styles.extraction}>
                  <Text style={[styles.warning, { color: colors.warning }]}>
                    Check every value against the document before using it.
                  </Text>
                  {entries.map((entry) => (
                    <View key={entry.key} style={styles.extractionRow}>
                      <Text
                        style={[
                          styles.extractionLabel,
                          { color: colors.textMuted },
                        ]}
                      >
                        {entry.label}
                      </Text>
                      <Text
                        style={[styles.extractionValue, { color: colors.text }]}
                      >
                        {entry.value}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          );
        })
      )}
      <AppDialog {...dialog.dialogProps} />
    </ScrollView>
  );
}

function VisibilityChips({
  value,
  onChange,
}: {
  value: DealVisibility;
  onChange: (v: DealVisibility) => void;
}) {
  return (
    <View style={styles.chipRow}>
      {(Object.keys(DEAL_VISIBILITY_LABELS) as DealVisibility[]).map((v) => (
        <FilterChip
          key={v}
          label={DEAL_VISIBILITY_LABELS[v]}
          active={value === v}
          onPress={() => onChange(v)}
        />
      ))}
    </View>
  );
}

function StakeholdersTab({
  dealId,
  dealTitle,
  canEdit,
}: {
  dealId: string;
  dealTitle: string;
  canEdit: boolean;
}) {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const dialog = useAppDialog();
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StakeholderRole>('buyer');
  const [side, setSide] = useState<DealSide>('buyer');
  const [linkFor, setLinkFor] = useState<string | null>(null);
  const [ttl, setTtl] = useState<DealShareTtlKey>('7d');
  const [otp, setOtp] = useState(false);

  const { data: stakeholders = [], isLoading } = useQuery({
    queryKey: ['deal-stakeholders', dealId],
    queryFn: () => fetchDealStakeholders(dealId),
    enabled: Boolean(dealId),
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['deal-stakeholders', dealId],
      }),
      queryClient.invalidateQueries({ queryKey: ['deal-events', dealId] }),
    ]);

  async function run(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    try {
      await action();
      await refresh();
      void haptic.success();
    } catch (err) {
      dialog.show({
        title: 'That did not work',
        message: friendlyError(errorText(err)),
      });
    } finally {
      setBusy(null);
    }
  }

  async function showAccessLog(link: DealShareLinkRow) {
    setBusy(`log:${link.id}`);
    try {
      const rows = await fetchDealShareAccess(dealId, link.id);
      dialog.show({
        title: `Link ${link.token_prefix}…`,
        message:
          rows.length === 0
            ? 'No opens yet.'
            : rows
                .map(
                  (row) =>
                    `${auditDateTime(row.created_at)} · ${
                      SHARE_ACCESS_LABELS[row.event as DealShareAccessEvent] ??
                      row.event
                    }`
                )
                .join('\n'),
      });
    } catch (err) {
      dialog.show({
        title: 'Could not load the access log',
        message: friendlyError(errorText(err)),
      });
    } finally {
      setBusy(null);
    }
  }

  async function mintAndShare(s: DealStakeholderRow) {
    setBusy(`link:${s.id}`);
    try {
      const link = await createDealShareLink(dealId, {
        stakeholderId: s.id,
        ttl,
        otpRequired: otp,
      });
      await refresh();
      setLinkFor(null);
      void haptic.success();
      const message = shareLinkMessage(s.name, dealTitle, link.url);
      dialog.show({
        title: 'Link created',
        message: 'Copy it now — it will not be shown again.',
        actions: [
          {
            label: 'Copy link',
            onPress: async () => {
              dialog.close();
              await Clipboard.setStringAsync(link.url);
            },
          },
          {
            label: 'Share…',
            onPress: async () => {
              dialog.close();
              await Share.share({ message });
            },
          },
          { label: 'Done', variant: 'muted' as const, onPress: dialog.close },
        ],
      });
    } catch (err) {
      dialog.show({
        title: 'Could not create the link',
        message: friendlyError(errorText(err)),
      });
    } finally {
      setBusy(null);
    }
  }

  if (isLoading) return <Loading />;

  return (
    <ScrollView
      contentContainerStyle={styles.list}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.cardMeta, { color: colors.textMuted }]}>
        Everyone on this transaction, by side. A buyer- or seller-side person
        can be given a private link that shows only what their side may see.
        Nobody gets a login.
      </Text>

      {canEdit ? (
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <TextField label="Name" value={name} onChangeText={setName} />
          <Text style={[styles.cardMeta, { color: colors.textMuted }]}>
            Role
          </Text>
          <View style={styles.chipRow}>
            {(Object.keys(STAKEHOLDER_ROLE_LABELS) as StakeholderRole[]).map(
              (r) => (
                <FilterChip
                  key={r}
                  label={STAKEHOLDER_ROLE_LABELS[r]}
                  active={role === r}
                  onPress={() => {
                    setRole(r);
                    setSide(defaultSideForRole(r));
                  }}
                />
              )
            )}
          </View>
          <Text style={[styles.cardMeta, { color: colors.textMuted }]}>
            Side
          </Text>
          <View style={styles.chipRow}>
            {(Object.keys(STAKEHOLDER_SIDE_LABELS) as DealSide[]).map((sd) => (
              <FilterChip
                key={sd}
                label={STAKEHOLDER_SIDE_LABELS[sd]}
                active={side === sd}
                onPress={() => setSide(sd)}
              />
            ))}
          </View>
          <TextField
            label="WhatsApp number"
            keyboardType="phone-pad"
            value={phone}
            onChangeText={setPhone}
          />
          <TextField
            label="Email (needed for a code-protected link)"
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
          />
          <PrimaryButton
            label="Add stakeholder"
            busy={busy === 'new'}
            disabled={!name.trim()}
            onPress={() =>
              void run('new', async () => {
                await addDealStakeholder(dealId, {
                  name: name.trim(),
                  role,
                  side,
                  phone: phone.trim() || null,
                  email: email.trim() || null,
                });
                setName('');
                setPhone('');
                setEmail('');
              })
            }
          />
        </View>
      ) : null}

      {stakeholders.length === 0 ? (
        <EmptyState
          icon="people-outline"
          title="No stakeholders yet"
          subtitle=""
        />
      ) : (
        stakeholders.map((s) => (
          <View
            key={s.id}
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.cardTitle, { color: colors.text }]}>
              {s.name}
            </Text>
            <Text style={[styles.cardMeta, { color: colors.textMuted }]}>
              {STAKEHOLDER_ROLE_LABELS[s.role]} ·{' '}
              {STAKEHOLDER_SIDE_LABELS[s.side]}
              {s.phone ? ` · +${s.phone}` : ''}
              {s.email ? ` · ${s.email}` : ''}
            </Text>
            <View style={styles.actions}>
              {canEdit && s.side !== 'internal' ? (
                <ActionButton
                  label="Share link"
                  icon="link-outline"
                  busy={busy === `link:${s.id}`}
                  onPress={() => setLinkFor(linkFor === s.id ? null : s.id)}
                />
              ) : null}
              {canEdit ? (
                <ActionButton
                  label="Remove"
                  icon="trash-outline"
                  busy={busy === s.id}
                  onPress={() =>
                    dialog.show({
                      title: `Remove ${s.name}?`,
                      message: 'Their links stop working immediately.',
                      actions: [
                        {
                          label: 'Keep',
                          variant: 'muted' as const,
                          onPress: dialog.close,
                        },
                        {
                          label: 'Remove',
                          variant: 'destructive' as const,
                          onPress: () => {
                            dialog.close();
                            void run(s.id, () =>
                              removeDealStakeholder(dealId, s.id)
                            );
                          },
                        },
                      ],
                    })
                  }
                />
              ) : null}
            </View>

            {linkFor === s.id ? (
              <View style={styles.extraction}>
                <Text style={[styles.cardMeta, { color: colors.textMuted }]}>
                  Expires in
                </Text>
                <View style={styles.chipRow}>
                  {DEAL_SHARE_TTL_CHOICES.map((c) => (
                    <FilterChip
                      key={c.key}
                      label={c.label}
                      active={ttl === c.key}
                      onPress={() => setTtl(c.key)}
                    />
                  ))}
                </View>
                <View style={styles.row}>
                  <Switch
                    value={otp}
                    onValueChange={setOtp}
                    disabled={!s.email}
                  />
                  <Text
                    style={[
                      styles.cardMeta,
                      { color: colors.textMuted, flex: 1 },
                    ]}
                  >
                    Require a one-time code
                    {!s.email ? ' (add an email first)' : ''}
                  </Text>
                </View>
                <PrimaryButton
                  label="Create link"
                  busy={busy === `link:${s.id}`}
                  onPress={() => void mintAndShare(s)}
                />
              </View>
            ) : null}

            {(s.links ?? []).map((link: DealShareLinkRow) => {
              const state = linkState(link);
              return (
                <View key={link.id} style={styles.row}>
                  <Text
                    style={[
                      styles.cardMeta,
                      {
                        color:
                          state === 'active'
                            ? colors.success
                            : colors.textFaint,
                        flex: 1,
                      },
                    ]}
                  >
                    {state} · {link.token_prefix}… · {link.view_count} open
                    {link.view_count === 1 ? '' : 's'}
                    {link.otp_required ? ' · code' : ''}
                  </Text>
                  <ActionButton
                    label="Log"
                    icon="eye-outline"
                    busy={busy === `log:${link.id}`}
                    onPress={() => void showAccessLog(link)}
                  />
                  {canEdit && state === 'active' ? (
                    <ActionButton
                      label="Revoke"
                      icon="ban-outline"
                      busy={busy === link.id}
                      onPress={() =>
                        void run(link.id, () =>
                          revokeDealShareLink(dealId, link.id)
                        )
                      }
                    />
                  ) : null}
                </View>
              );
            })}
          </View>
        ))
      )}
      <AppDialog {...dialog.dialogProps} />
    </ScrollView>
  );
}

function UpdatesTab({ dealId, canEdit }: { dealId: string; canEdit: boolean }) {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const dialog = useAppDialog();
  const [composing, setComposing] = useState<DealUpdateRow | null | false>(
    false
  );
  const [handoffs, setHandoffs] = useState<DealUpdateRecipientRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const { data: updates = [], isLoading } = useQuery({
    queryKey: ['deal-updates', dealId],
    queryFn: () => fetchDealUpdates(dealId),
    enabled: Boolean(dealId),
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['deal-updates', dealId] }),
      queryClient.invalidateQueries({ queryKey: ['deal-events', dealId] }),
      queryClient.invalidateQueries({
        queryKey: ['deal-stakeholders', dealId],
      }),
    ]);

  async function markSent(r: DealUpdateRecipientRow) {
    setBusy(r.id);
    try {
      await markUpdateRecipientSent(dealId, r.update_id, r.id);
      setHandoffs((rows) => rows.filter((x) => x.id !== r.id));
      await refresh();
      void haptic.success();
    } catch (err) {
      dialog.show({
        title: 'Could not record',
        message: friendlyError(errorText(err)),
      });
    } finally {
      setBusy(null);
    }
  }

  async function handOver(r: DealUpdateRecipientRow) {
    const message = r.notice ?? r.url ?? '';
    dialog.show({
      title: r.stakeholder?.name ?? 'Recipient',
      message: 'Hand the link over now — it will not be shown again.',
      actions: [
        {
          label: 'Copy message',
          onPress: async () => {
            dialog.close();
            await Clipboard.setStringAsync(message);
          },
        },
        {
          label: 'Share…',
          onPress: async () => {
            dialog.close();
            await Share.share({ message });
          },
        },
        {
          label: 'Mark as sent',
          onPress: () => {
            dialog.close();
            void markSent(r);
          },
        },
        { label: 'Later', variant: 'muted' as const, onPress: dialog.close },
      ],
    });
  }

  if (isLoading) return <Loading />;

  if (composing !== false) {
    return (
      <UpdateComposer
        dealId={dealId}
        supersedes={composing}
        onCancel={() => setComposing(false)}
        onPublished={async (recipients) => {
          setComposing(false);
          setHandoffs(
            recipients.filter((r) => r.url && r.status === 'pending')
          );
          await refresh();
        }}
      />
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.list}>
      <Text style={[styles.cardMeta, { color: colors.textMuted }]}>
        What each side has been told, frozen when it was published. A correction
        is a new update that names the one it replaces.
      </Text>
      {canEdit ? (
        <PrimaryButton
          label="Compose update"
          onPress={() => setComposing(null)}
        />
      ) : null}

      {handoffs.length > 0 ? (
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.warning },
          ]}
        >
          <Text style={[styles.cardTitle, { color: colors.text }]}>
            Hand these over now
          </Text>
          <Text style={[styles.cardMeta, { color: colors.textMuted }]}>
            The links will not be shown again.
          </Text>
          {handoffs.map((r) => (
            <View key={r.id} style={styles.actions}>
              <ActionButton
                label={r.stakeholder?.name ?? 'Recipient'}
                icon="share-outline"
                busy={busy === r.id}
                onPress={() => void handOver(r)}
              />
            </View>
          ))}
        </View>
      ) : null}

      {updates.length === 0 ? (
        <EmptyState
          icon="megaphone-outline"
          title="Nothing published yet"
          subtitle="Compose an update from the milestones a side may see."
        />
      ) : (
        updates.map((u) => {
          const superseded = updates.some(
            (x) => x.supersedes_update_id === u.id
          );
          return (
            <View
              key={u.id}
              style={[
                styles.card,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  opacity: superseded ? 0.7 : 1,
                },
              ]}
            >
              <Text style={[styles.cardTitle, { color: colors.text }]}>
                {u.supersedes_update_id ? 'Correction: ' : ''}
                {u.headline}
              </Text>
              <Text style={[styles.cardMeta, { color: colors.textMuted }]}>
                {DEAL_VISIBILITY_LABELS[u.visibility]} ·{' '}
                {auditDateTime(u.created_at)}
                {u.published_by_name ? ` · ${u.published_by_name}` : ''}
                {superseded ? ' · corrected by a later update' : ''}
              </Text>
              {u.body ? (
                <Text style={[styles.extractionValue, { color: colors.text }]}>
                  {u.body}
                </Text>
              ) : null}
              {u.snapshot.milestones.map((m) => (
                <Text
                  key={m.id}
                  style={[styles.cardMeta, { color: colors.textMuted }]}
                >
                  {m.status === 'completed'
                    ? '✅'
                    : m.status === 'in_progress'
                      ? '🔄'
                      : '⬜'}{' '}
                  {m.title}
                </Text>
              ))}
              {u.recipients.map((r) => {
                const stage = recipientStage(r);
                return (
                  <View key={r.id} style={styles.row}>
                    <Text
                      style={[
                        styles.cardMeta,
                        {
                          flex: 1,
                          color:
                            stage === 'acknowledged'
                              ? colors.success
                              : stage === 'failed'
                                ? colors.danger
                                : colors.textMuted,
                        },
                      ]}
                    >
                      {r.stakeholder?.name ?? 'Recipient'} ·{' '}
                      {UPDATE_STAGE_LABELS[stage]} ·{' '}
                      {UPDATE_CHANNEL_LABELS[r.channel]}
                      {r.failed_reason ? ` — ${r.failed_reason}` : ''}
                    </Text>
                    {canEdit &&
                    stage === 'pending' &&
                    (r.delivery_mode === 'handoff' ||
                      r.delivery_mode === 'portal') ? (
                      <ActionButton
                        label="Mark sent"
                        icon="checkmark-outline"
                        busy={busy === r.id}
                        onPress={() => void markSent(r)}
                      />
                    ) : null}
                  </View>
                );
              })}
              {canEdit && !superseded ? (
                <View style={styles.actions}>
                  <ActionButton
                    label="Correct"
                    icon="arrow-undo-outline"
                    busy={false}
                    onPress={() => setComposing(u)}
                  />
                </View>
              ) : null}
            </View>
          );
        })
      )}
      <AppDialog {...dialog.dialogProps} />
    </ScrollView>
  );
}

function previewLine(r: UpdatePreviewRecipient): string {
  const head = [
    r.name,
    UPDATE_CHANNEL_LABELS[r.channel],
    r.mode ? r.mode.replace('_', ' ') : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const warnings = [
    r.reason ? `⚠️ ${r.reason}` : null,
    r.needs_email ? '⚠️ Needs an email for the one-time code.' : null,
  ].filter(Boolean);
  const body =
    r.mode === 'template'
      ? 'Their window is closed: the Purchase progress template goes with the headline as the current step, and the private link follows when they tap a reply.'
      : r.text;
  return [head, ...warnings, '', body].join('\n');
}

function UpdateComposer({
  dealId,
  supersedes,
  onCancel,
  onPublished,
}: {
  dealId: string;
  supersedes: DealUpdateRow | null;
  onCancel: () => void;
  onPublished: (recipients: DealUpdateRecipientRow[]) => Promise<void>;
}) {
  const { colors } = useTheme();
  const dialog = useAppDialog();
  const [headline, setHeadline] = useState(
    supersedes ? `Correction to: ${supersedes.headline}`.slice(0, 120) : ''
  );
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<DealUpdateVisibility>(
    supersedes?.visibility ?? 'buyer_side'
  );
  const [milestoneIds, setMilestoneIds] = useState<string[]>([]);
  const [eventIds, setEventIds] = useState<string[]>([]);
  const [recipients, setRecipients] = useState<Record<string, UpdateChannel>>(
    {}
  );
  const [ttl, setTtl] = useState<DealShareTtlKey>('7d');
  const [otp, setOtp] = useState(false);
  const [busy, setBusy] = useState<'preview' | 'publish' | null>(null);

  const { data: milestones = [] } = useQuery({
    queryKey: ['deal-milestones', dealId],
    queryFn: () => fetchDealMilestones(dealId),
    enabled: Boolean(dealId),
  });
  const { data: events = [] } = useQuery({
    queryKey: ['deal-events', dealId],
    queryFn: () => fetchDealEvents(dealId),
    enabled: Boolean(dealId),
  });
  const { data: stakeholders = [] } = useQuery({
    queryKey: ['deal-stakeholders', dealId],
    queryFn: () => fetchDealStakeholders(dealId),
    enabled: Boolean(dealId),
  });

  const quotable = milestones.filter((m) =>
    snapshotItemAllowed(visibility, m.visibility)
  );
  const quotableEvents = events
    .filter((e) => snapshotItemAllowed(visibility, e.visibility))
    .filter((e) => e.event_type !== 'update_published')
    .slice(0, 30);
  const eligible = stakeholders.filter((s) =>
    isEligibleRecipient(s, visibility)
  );

  const payload = () => ({
    headline: headline.trim(),
    body: body.trim() || null,
    visibility,
    milestone_ids: milestoneIds.filter((id) =>
      quotable.some((m) => m.id === id)
    ),
    event_ids: eventIds.filter((id) => quotableEvents.some((e) => e.id === id)),
    supersedes_update_id: supersedes?.id ?? null,
    recipients: Object.entries(recipients)
      .filter(([id]) => eligible.some((s) => s.id === id))
      .map(([stakeholder_id, channel]) => ({ stakeholder_id, channel })),
    ttl,
    otp_required: otp,
  });

  async function preview() {
    setBusy('preview');
    try {
      const rows = await previewDealUpdate(dealId, payload());
      dialog.show({
        title: 'Preview',
        message:
          rows.length === 0
            ? 'No recipients selected — the update will only appear on existing links.'
            : rows.map(previewLine).join('\n\n————\n\n'),
      });
    } catch (err) {
      dialog.show({
        title: 'Could not preview',
        message: friendlyError(errorText(err)),
      });
    } finally {
      setBusy(null);
    }
  }

  async function publish() {
    setBusy('publish');
    try {
      const result = await publishDealUpdate(dealId, payload());
      void haptic.success();
      await onPublished(result.recipients ?? []);
    } catch (err) {
      dialog.show({
        title: 'Could not publish',
        message: friendlyError(errorText(err)),
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <ScrollView
      contentContainerStyle={styles.list}
      keyboardShouldPersistTaps="handled"
    >
      <View
        style={[
          styles.card,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <TextField
          label="Headline"
          value={headline}
          maxLength={120}
          onChangeText={setHeadline}
        />
        <TextField
          label="Message (optional)"
          value={body}
          multiline
          maxLength={1500}
          onChangeText={setBody}
        />
        <Text style={[styles.cardMeta, { color: colors.textMuted }]}>
          Audience
        </Text>
        <View style={styles.chipRow}>
          {DEAL_UPDATE_VISIBILITIES.map((v) => (
            <FilterChip
              key={v}
              label={DEAL_VISIBILITY_LABELS[v]}
              active={visibility === v}
              onPress={() => setVisibility(v)}
            />
          ))}
        </View>
        <Text style={[styles.cardMeta, { color: colors.textMuted }]}>
          Milestones to quote (only ones this audience may already see)
        </Text>
        <View style={styles.chipRow}>
          {quotable.map((m) => (
            <FilterChip
              key={m.id}
              label={m.title}
              active={milestoneIds.includes(m.id)}
              onPress={() =>
                setMilestoneIds((ids) =>
                  ids.includes(m.id)
                    ? ids.filter((x) => x !== m.id)
                    : [...ids, m.id]
                )
              }
            />
          ))}
          {quotable.length === 0 ? (
            <Text style={[styles.cardMeta, { color: colors.textFaint }]}>
              No milestone is visible to this audience yet.
            </Text>
          ) : null}
        </View>
        {quotableEvents.length > 0 ? (
          <>
            <Text style={[styles.cardMeta, { color: colors.textMuted }]}>
              Timeline entries to quote
            </Text>
            <View style={styles.chipRow}>
              {quotableEvents.map((e) => (
                <FilterChip
                  key={e.id}
                  label={e.title}
                  active={eventIds.includes(e.id)}
                  onPress={() =>
                    setEventIds((ids) =>
                      ids.includes(e.id)
                        ? ids.filter((x) => x !== e.id)
                        : [...ids, e.id]
                    )
                  }
                />
              ))}
            </View>
          </>
        ) : null}
        <Text style={[styles.cardMeta, { color: colors.textMuted }]}>
          Recipients. The business number sends free-form inside their 24-hour
          window and the Purchase progress template to a buyer outside it. Your
          own phone is a handoff the app never sends.
        </Text>
        {eligible.map((s) => (
          <View key={s.id} style={styles.extractionRow}>
            <View style={styles.row}>
              <Switch
                value={s.id in recipients}
                onValueChange={(on) =>
                  setRecipients((r) => {
                    const next = { ...r };
                    if (on)
                      next[s.id] = s.phone ? 'engine_whatsapp' : 'portal_only';
                    else delete next[s.id];
                    return next;
                  })
                }
              />
              <Text style={[styles.cardTitle, { color: colors.text, flex: 1 }]}>
                {s.name}
              </Text>
            </View>
            {s.id in recipients ? (
              <View style={styles.chipRow}>
                {UPDATE_CHANNELS.filter(
                  (c) => c === 'portal_only' || Boolean(s.phone)
                ).map((c) => (
                  <FilterChip
                    key={c}
                    label={UPDATE_CHANNEL_LABELS[c]}
                    active={recipients[s.id] === c}
                    onPress={() => setRecipients((r) => ({ ...r, [s.id]: c }))}
                  />
                ))}
              </View>
            ) : null}
          </View>
        ))}
        {eligible.length === 0 ? (
          <Text style={[styles.cardMeta, { color: colors.textFaint }]}>
            Add a stakeholder on this side first.
          </Text>
        ) : null}
        <Text style={[styles.cardMeta, { color: colors.textMuted }]}>
          Links expire in
        </Text>
        <View style={styles.chipRow}>
          {DEAL_SHARE_TTL_CHOICES.map((c) => (
            <FilterChip
              key={c.key}
              label={c.label}
              active={ttl === c.key}
              onPress={() => setTtl(c.key)}
            />
          ))}
        </View>
        <View style={styles.row}>
          <Switch value={otp} onValueChange={setOtp} />
          <Text style={[styles.cardMeta, { color: colors.textMuted, flex: 1 }]}>
            Require a one-time code on these links (needs an email for each
            recipient)
          </Text>
        </View>
        <View style={styles.actions}>
          <ActionButton
            label="Cancel"
            icon="close-outline"
            busy={false}
            onPress={onCancel}
          />
          <ActionButton
            label="Preview"
            icon="eye-outline"
            busy={busy === 'preview'}
            onPress={() => void preview()}
          />
        </View>
        <PrimaryButton
          label="Publish"
          busy={busy === 'publish'}
          disabled={!headline.trim()}
          onPress={() => void publish()}
        />
      </View>
      <AppDialog {...dialog.dialogProps} />
    </ScrollView>
  );
}

function ActionButton({
  label,
  icon,
  busy,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  busy: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={[styles.actionButton, { borderColor: colors.border }]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.textMuted} />
      ) : (
        <Ionicons name={icon} size={15} color={colors.textMuted} />
      )}
      <Text style={[styles.actionLabel, { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

function Loading() {
  const { colors } = useTheme();
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  stageLine: {
    fontFamily: fonts.medium,
    fontSize: 12,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  stageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingRight: spacing.lg,
  },
  stageMove: { fontFamily: fonts.bold, fontSize: 12, paddingTop: spacing.md },
  bundleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  bundleLine: { fontFamily: fonts.bold, fontSize: 12 },
  sheetTitle: {
    fontSize: 15.5,
    fontFamily: fonts.bold,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  stageOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 15,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  stageOptionLabel: { fontSize: 15, fontFamily: fonts.semibold },
  brokerageForm: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  tabs: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  expiryInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontFamily: fonts.regular,
    fontSize: 14,
  },
  list: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  chipRow: { gap: spacing.sm, paddingBottom: spacing.sm },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
  },
  primaryButtonText: {
    color: '#fff',
    fontFamily: fonts.semibold,
    fontSize: 15,
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    gap: spacing.xs,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  cardTitle: { fontFamily: fonts.semibold, fontSize: 15 },
  cardMeta: { fontFamily: fonts.regular, fontSize: 12, marginTop: 2 },
  amount: { fontFamily: fonts.bold, fontSize: 16 },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  actionLabel: { fontFamily: fonts.medium, fontSize: 12 },
  extraction: { marginTop: spacing.sm, gap: spacing.sm },
  warning: { fontFamily: fonts.medium, fontSize: 11 },
  extractionRow: { gap: 2 },
  extractionLabel: {
    fontFamily: fonts.medium,
    fontSize: 10,
    textTransform: 'uppercase',
  },
  extractionValue: { fontFamily: fonts.regular, fontSize: 13 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
