'use client';

import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import type { AccountMember } from '@/types';

interface PickerOption {
  value: string;
  label: string;
}

interface PickerSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: PickerOption[];
  loading: boolean;
  placeholder: string;
  emptyLabel: string;
  missingLabel: string;
  invalid?: boolean;
  disabled?: boolean;
  ariaLabel: string;
}

export function selectClass(invalid?: boolean): string {
  return cn(
    'w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-white focus:outline-none disabled:opacity-60',
    invalid && 'border-red-500'
  );
}

function PickerSelect({
  value,
  onChange,
  options,
  loading,
  placeholder,
  emptyLabel,
  missingLabel,
  invalid,
  disabled,
  ariaLabel,
}: PickerSelectProps) {
  const missing =
    !loading && value !== '' && !options.some((o) => o.value === value);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled || loading}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      className={selectClass(invalid)}
    >
      <option value="">
        {loading ? 'Loading…' : options.length === 0 ? emptyLabel : placeholder}
      </option>
      {missing && <option value={value}>{missingLabel}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function useAccountTags() {
  const { accountId } = useAuth();
  return useQuery({
    queryKey: ['automation-builder', 'tags', accountId],
    enabled: !!accountId,
    queryFn: async () => {
      const { data, error } = await createClient()
        .from('tags')
        .select('id, name')
        .eq('account_id', accountId as string)
        .order('name');
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });
}

function useAccountMembers() {
  return useQuery({
    queryKey: ['automation-builder', 'members'],
    queryFn: async () => {
      const res = await fetch('/api/account/members', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load members');
      const body = (await res.json()) as { members?: AccountMember[] };
      return body.members ?? [];
    },
  });
}

interface PipelineWithStages {
  id: string;
  name: string;
  pipeline_stages: { id: string; name: string; position: number }[] | null;
}

function useAccountPipelines() {
  const { accountId } = useAuth();
  return useQuery({
    queryKey: ['automation-builder', 'pipelines', accountId],
    enabled: !!accountId,
    queryFn: async () => {
      const { data, error } = await createClient()
        .from('pipelines')
        .select('id, name, pipeline_stages(id, name, position)')
        .eq('account_id', accountId as string)
        .order('created_at');
      if (error) throw error;
      return (data ?? []) as PipelineWithStages[];
    },
  });
}

function useApprovedTemplates() {
  const { accountId } = useAuth();
  return useQuery({
    queryKey: ['automation-builder', 'templates', accountId],
    enabled: !!accountId,
    queryFn: async () => {
      const { data, error } = await createClient()
        .from('message_templates')
        .select('id, name, language')
        .eq('account_id', accountId as string)
        .eq('status', 'APPROVED')
        .order('name');
      if (error) throw error;
      return (data ?? []) as {
        id: string;
        name: string;
        language: string | null;
      }[];
    },
  });
}

interface ValuePickerProps {
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
}

export function TagSelect({ value, onChange, invalid }: ValuePickerProps) {
  const { data, isLoading } = useAccountTags();
  return (
    <PickerSelect
      value={value}
      onChange={onChange}
      options={(data ?? []).map((t) => ({ value: t.id, label: t.name }))}
      loading={isLoading}
      placeholder="Pick a tag…"
      emptyLabel="No tags yet — add one in Settings"
      missingLabel="Deleted tag"
      invalid={invalid}
      ariaLabel="Tag"
    />
  );
}

export function MemberSelect({ value, onChange, invalid }: ValuePickerProps) {
  const { data, isLoading } = useAccountMembers();
  return (
    <PickerSelect
      value={value}
      onChange={onChange}
      options={(data ?? []).map((m) => ({
        value: m.user_id,
        label: m.full_name || m.email || 'Unnamed member',
      }))}
      loading={isLoading}
      placeholder="Pick a team member…"
      emptyLabel="No team members found"
      missingLabel="Former team member"
      invalid={invalid}
      ariaLabel="Agent"
    />
  );
}

export function PipelineSelect({ value, onChange, invalid }: ValuePickerProps) {
  const { data, isLoading } = useAccountPipelines();
  return (
    <PickerSelect
      value={value}
      onChange={onChange}
      options={(data ?? []).map((p) => ({ value: p.id, label: p.name }))}
      loading={isLoading}
      placeholder="Pick a pipeline…"
      emptyLabel="No pipelines yet — create one in Deals"
      missingLabel="Deleted pipeline"
      invalid={invalid}
      ariaLabel="Pipeline"
    />
  );
}

export function StageSelect({
  pipelineId,
  value,
  onChange,
  invalid,
}: ValuePickerProps & { pipelineId: string }) {
  const { data, isLoading } = useAccountPipelines();
  const stages = [
    ...((data ?? []).find((p) => p.id === pipelineId)?.pipeline_stages ?? []),
  ].sort((a, b) => a.position - b.position);
  return (
    <PickerSelect
      value={value}
      onChange={onChange}
      options={stages.map((s) => ({ value: s.id, label: s.name }))}
      loading={isLoading}
      placeholder="Pick a stage…"
      emptyLabel={
        pipelineId ? 'This pipeline has no stages' : 'Pick a pipeline first'
      }
      missingLabel="Deleted stage"
      invalid={invalid}
      disabled={!pipelineId}
      ariaLabel="Stage"
    />
  );
}

export function TemplateSelect({
  name,
  language,
  onChange,
  invalid,
}: {
  name: string;
  language: string;
  onChange: (patch: { template_name: string; language: string }) => void;
  invalid?: boolean;
}) {
  const { data, isLoading } = useApprovedTemplates();
  const key = (n: string, l: string) => `${n}|${l}`;
  const templates = data ?? [];
  return (
    <PickerSelect
      value={name ? key(name, language) : ''}
      onChange={(v) => {
        const picked = templates.find(
          (t) => key(t.name, t.language ?? '') === v
        );
        onChange(
          picked
            ? { template_name: picked.name, language: picked.language ?? '' }
            : { template_name: '', language }
        );
      }}
      options={templates.map((t) => ({
        value: key(t.name, t.language ?? ''),
        label: t.language ? `${t.name} (${t.language})` : t.name,
      }))}
      loading={isLoading}
      placeholder="Pick an approved template…"
      emptyLabel="No approved templates — submit one in Settings"
      missingLabel={`${name} (${language || 'no language'}) — not approved`}
      invalid={invalid}
      ariaLabel="Template"
    />
  );
}
