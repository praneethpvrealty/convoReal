'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ChevronDown,
  Plus,
  Trash2,
  GripVertical,
  MessageSquare,
  FileText,
  Tag,
  TagIcon,
  UserCheck,
  PencilLine,
  Briefcase,
  Hourglass,
  GitBranch,
  Webhook,
  CircleSlash,
  Zap,
  Loader2,
  ArrowDown,
  ArrowUp,
  AlertCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PriceHint } from '@/components/ui/price-hint';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  MemberSelect,
  PipelineSelect,
  StageSelect,
  TagSelect,
  TemplateSelect,
  selectClass,
} from '@/components/automations/builder-pickers';
import {
  ROOT_SCOPE,
  describeIssue,
  hasChildren,
  insertAt,
  mapAtPath,
  moveAt,
  parseIssuePath,
  pathInScope,
  removeAt,
  stepAtPath,
  type ListScope,
  type StepPath,
} from '@/lib/automations/step-tree';
import {
  isTriggerAvailable,
  triggerActivationSentence,
  triggerLabel,
} from '@/lib/automations/trigger-meta';
import {
  validateStepsForActivation,
  validateTriggerForActivation,
  type ValidationIssue,
} from '@/lib/automations/validate';
import type {
  AutomationStepType,
  AutomationTriggerType,
  KeywordMatchTriggerConfig,
} from '@/types';
import { cn } from '@/lib/utils';

// ------------------------------------------------------------
// Types (builder-local — mirror the flattened rows we POST)
// ------------------------------------------------------------

export interface BuilderStep {
  /** Client id; the API assigns real UUIDs server-side. */
  cid: string;
  step_type: AutomationStepType;
  step_config: Record<string, unknown>;
  branches?: { yes: BuilderStep[]; no: BuilderStep[] };
}

export interface BuilderInitial {
  id?: string;
  name: string;
  description: string;
  trigger_type: AutomationTriggerType;
  trigger_config: Record<string, unknown>;
  is_active: boolean;
  steps: BuilderStep[];
}

// ------------------------------------------------------------
// Step metadata — one source of truth for icon + label + border color
// ------------------------------------------------------------

interface StepMeta {
  label: string;
  icon: typeof Zap;
  /** Left-border accent color per spec. */
  border: string;
}

const STEP_META: Record<AutomationStepType, StepMeta> = {
  send_message: {
    label: 'Send Message',
    icon: MessageSquare,
    border: 'border-l-primary',
  },
  send_template: {
    label: 'Send Template',
    icon: FileText,
    border: 'border-l-primary',
  },
  add_tag: { label: 'Add Tag', icon: Tag, border: 'border-l-primary' },
  remove_tag: {
    label: 'Remove Tag',
    icon: TagIcon,
    border: 'border-l-primary',
  },
  assign_conversation: {
    label: 'Assign Conversation',
    icon: UserCheck,
    border: 'border-l-primary',
  },
  update_contact_field: {
    label: 'Update Contact Field',
    icon: PencilLine,
    border: 'border-l-primary',
  },
  create_deal: {
    label: 'Create Deal',
    icon: Briefcase,
    border: 'border-l-primary',
  },
  wait: { label: 'Wait', icon: Hourglass, border: 'border-l-slate-500' },
  condition: {
    label: 'Condition (If/Else)',
    icon: GitBranch,
    border: 'border-l-amber-500',
  },
  send_webhook: {
    label: 'Send Webhook',
    icon: Webhook,
    border: 'border-l-primary',
  },
  close_conversation: {
    label: 'Close Conversation',
    icon: CircleSlash,
    border: 'border-l-primary',
  },
};

const ADDABLE_STEPS: AutomationStepType[] = [
  'send_message',
  'send_template',
  'add_tag',
  'remove_tag',
  'assign_conversation',
  'update_contact_field',
  'create_deal',
  'wait',
  'condition',
  'send_webhook',
  'close_conversation',
];

const TRIGGER_OPTIONS: {
  value: AutomationTriggerType;
  label: string;
  hint: string;
}[] = [
  {
    value: 'new_message_received',
    label: 'New Message Received',
    hint: 'Any incoming message, including a repeat portal email lead. When a Flow answers the message, the Flow takes precedence and this does not run.',
  },
  {
    value: 'first_inbound_message',
    label: 'First Message from Contact',
    hint: 'First time this contact ever messages you (works for manually-added contacts too)',
  },
  {
    value: 'keyword_match',
    label: 'Keyword Match',
    hint: 'Message contains specific keyword(s). When a Flow answers the message, the Flow takes precedence.',
  },
  {
    value: 'new_contact_created',
    label: 'New Contact Created',
    hint: 'When a new contact is created from an incoming WhatsApp message, a portal email lead or a voice call',
  },
];

const CONDITION_SUBJECTS: { value: string; label: string }[] = [
  { value: 'tag_presence', label: 'Contact has tag' },
  { value: 'contact_field', label: 'Contact field equals' },
  { value: 'message_content', label: 'Message contains' },
  { value: 'time_of_day', label: 'Time of day' },
];

const CONTACT_FIELDS: { value: string; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'company', label: 'Company' },
];

function cid(): string {
  return (
    'c_' +
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36))
  );
}

function blankConfig(type: AutomationStepType): Record<string, unknown> {
  switch (type) {
    case 'send_message':
      return { text: '' };
    case 'send_template':
      return { template_name: '', language: 'en_US' };
    case 'add_tag':
    case 'remove_tag':
      return { tag_id: '' };
    case 'assign_conversation':
      return { mode: 'round_robin' };
    case 'update_contact_field':
      return { field: 'name', value: '' };
    case 'create_deal':
      return { pipeline_id: '', stage_id: '', title: '', value: 0 };
    case 'wait':
      return { amount: 1, unit: 'hours' };
    case 'condition':
      return { subject: 'tag_presence', operand: '', value: '' };
    case 'send_webhook':
      return { url: '', headers: {}, body_template: '' };
    case 'close_conversation':
      return {};
    default:
      return {};
  }
}

function snapshot(s: BuilderInitial): string {
  return JSON.stringify({
    name: s.name,
    description: s.description,
    trigger_type: s.trigger_type,
    trigger_config: s.trigger_config,
    is_active: s.is_active,
    steps: toApiSteps(s.steps),
  });
}

function activationIssues(s: BuilderInitial): ValidationIssue[] {
  return [
    ...validateTriggerForActivation(s.trigger_type, s.trigger_config),
    ...validateStepsForActivation(toApiSteps(s.steps)),
  ];
}

type FieldErrors = Record<string, string>;

interface IssueSummaryItem {
  key: string;
  text: string;
  cid: string | null;
}

function resolveIssues(steps: BuilderStep[], issues: ValidationIssue[]) {
  const byCid = new Map<string, FieldErrors>();
  const trigger: FieldErrors = {};
  const summary: IssueSummaryItem[] = issues.map((issue, i) => {
    const parsed = parseIssuePath(issue.path);
    const step = parsed ? stepAtPath(steps, parsed.path) : undefined;
    if (step && parsed) {
      const fields = byCid.get(step.cid) ?? {};
      fields[parsed.field] ??= issue.message;
      byCid.set(step.cid, fields);
    } else if (issue.path.startsWith('trigger.')) {
      trigger[issue.path.slice('trigger.'.length)] ??= issue.message;
    }
    return {
      key: `${issue.path}-${i}`,
      text: describeIssue(issue),
      cid: step?.cid ?? null,
    };
  });
  return { byCid, trigger, summary };
}

function issueCount(n: number): string {
  return `${n} ${n === 1 ? 'issue' : 'issues'}`;
}

// ------------------------------------------------------------
// Main builder component
// ------------------------------------------------------------

export function AutomationBuilder({ initial }: { initial: BuilderInitial }) {
  const router = useRouter();
  const isEditing = !!initial.id;
  const [state, setState] = useState<BuilderInitial>(initial);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [baseline, setBaseline] = useState(() => snapshot(initial));
  const [savedActive, setSavedActive] = useState(initial.is_active);
  const [showIssues, setShowIssues] = useState(false);
  const [confirmActivate, setConfirmActivate] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<StepPath | null>(null);

  const dirty = useMemo(() => snapshot(state) !== baseline, [state, baseline]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const issues = useMemo(
    () =>
      resolveIssues(
        state.steps,
        showIssues && state.is_active ? activationIssues(state) : []
      ),
    [state, showIssues]
  );

  function patchTop<K extends keyof BuilderInitial>(
    key: K,
    value: BuilderInitial[K]
  ) {
    setState((s) => ({ ...s, [key]: value }));
  }

  // --- Step tree mutations (immutable) ---

  function updateStep(
    path: StepPath,
    updater: (s: BuilderStep) => BuilderStep
  ) {
    setState((s) => ({ ...s, steps: mapAtPath(s.steps, path, updater) }));
  }

  function addStepAt(
    scope: ListScope,
    index: number,
    type: AutomationStepType
  ) {
    const node: BuilderStep = {
      cid: cid(),
      step_type: type,
      step_config: blankConfig(type),
      branches: type === 'condition' ? { yes: [], no: [] } : undefined,
    };
    setState((s) => ({ ...s, steps: insertAt(s.steps, scope, index, node) }));
    setExpandedId(node.cid);
  }

  function deleteStepAt(path: StepPath, step: BuilderStep) {
    if (step.step_type === 'condition' && hasChildren(step)) {
      setPendingDelete(path);
      return;
    }
    setState((s) => ({ ...s, steps: removeAt(s.steps, path) }));
  }

  function confirmDelete() {
    const path = pendingDelete;
    setPendingDelete(null);
    if (path) setState((s) => ({ ...s, steps: removeAt(s.steps, path) }));
  }

  function moveStepAt(path: StepPath, direction: -1 | 1) {
    setState((s) => ({ ...s, steps: moveAt(s.steps, path, direction) }));
  }

  function requestSave() {
    if (state.is_active) {
      const found = activationIssues(state);
      if (found.length > 0) {
        setShowIssues(true);
        toast.error(`Fix ${issueCount(found.length)} before activating`);
        return;
      }
      if (!savedActive) {
        setConfirmActivate(true);
        return;
      }
    }
    void save();
  }

  async function save() {
    setConfirmActivate(false);
    setSaving(true);
    const sent = state;
    try {
      const payload = {
        name: sent.name || 'Untitled automation',
        description: sent.description || null,
        trigger_type: sent.trigger_type,
        trigger_config: sent.trigger_config,
        is_active: sent.is_active,
        steps: toApiSteps(sent.steps),
      };

      const res = isEditing
        ? await fetch(`/api/automations/${initial.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch(`/api/automations`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const serverIssues: ValidationIssue[] = Array.isArray(body?.issues)
          ? body.issues
          : [];
        if (serverIssues.length > 0) {
          setShowIssues(true);
          toast.error(
            `Fix ${issueCount(serverIssues.length)} before activating`
          );
        } else {
          toast.error(body?.error ?? 'Save failed');
        }
        return;
      }
      setBaseline(snapshot(sent));
      setSavedActive(sent.is_active);
      setShowIssues(false);
      toast.success(isEditing ? 'Automation saved' : 'Automation created');
      if (!isEditing && body?.automation?.id) {
        router.replace(`/automations/${body.automation.id}/edit`);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-slate-950">
      {/* Top bar. At sub-sm widths the "Active" label is hidden and the
          switch moves to the right of the save button, so the name input
          gets maximum width. */}
      <header className="flex flex-shrink-0 items-center gap-2 border-b border-slate-800 bg-slate-900/80 px-3 py-3 sm:gap-3 sm:px-4">
        <button
          type="button"
          onClick={() =>
            dirty ? setConfirmLeave(true) : router.push('/automations')
          }
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
          aria-label="Back to automations"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <input
          value={state.name}
          onChange={(e) => patchTop('name', e.target.value)}
          placeholder="Untitled automation"
          className="min-w-0 flex-1 rounded-md bg-transparent px-2 py-1 text-sm font-semibold text-white placeholder:text-slate-500 focus:bg-slate-800 focus:outline-none sm:text-base"
        />
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span className="hidden sm:inline">Active</span>
          <Switch
            checked={state.is_active}
            onCheckedChange={(v) => patchTop('is_active', !!v)}
            aria-label="Active"
          />
        </div>
        <Button
          onClick={requestSave}
          disabled={saving}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {state.is_active ? 'Save & activate' : 'Save draft'}
        </Button>
      </header>

      {/* Canvas */}
      <div className="relative flex-1 overflow-y-auto">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle,#1e293b_1px,transparent_1px)] [background-size:20px_20px]" />
        <div className="relative mx-auto flex max-w-2xl flex-col items-center gap-0 px-4 py-10">
          {issues.summary.length > 0 && (
            <IssueSummary
              items={issues.summary}
              onPick={(id) => setExpandedId(id)}
            />
          )}
          <TriggerCard
            type={state.trigger_type}
            config={state.trigger_config}
            errors={issues.trigger}
            onTypeChange={(t) => patchTop('trigger_type', t)}
            onConfigChange={(c) => patchTop('trigger_config', c)}
          />
          <StepList
            steps={state.steps}
            scope={ROOT_SCOPE}
            expandedId={expandedId}
            setExpandedId={setExpandedId}
            issuesByCid={issues.byCid}
            updateStep={updateStep}
            addStepAt={addStepAt}
            deleteStepAt={deleteStepAt}
            moveStepAt={moveStepAt}
          />
        </div>
      </div>

      <Dialog
        open={confirmActivate}
        onOpenChange={(o) => !o && setConfirmActivate(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Turn on “{state.name || 'Untitled automation'}”?
            </DialogTitle>
            <DialogDescription>
              {triggerActivationSentence(
                state.trigger_type,
                state.trigger_config
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmActivate(false)}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmLeave}
        onOpenChange={(o) => !o && setConfirmLeave(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>
              Your edits to this automation have not been saved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmLeave(false)}>
              Keep editing
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmLeave(false);
                router.push('/automations');
              }}
            >
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(o) => !o && setPendingDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this condition?</DialogTitle>
            <DialogDescription>
              Every step inside its Yes and No branches will be deleted too.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function IssueSummary({
  items,
  onPick,
}: {
  items: IssueSummaryItem[];
  onPick: (cid: string) => void;
}) {
  return (
    <div
      role="alert"
      className="z-10 mb-6 w-full max-w-[400px] rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm"
    >
      <div className="mb-2 flex items-center gap-2 font-medium text-red-300">
        <AlertCircle className="h-4 w-4" />
        Fix {issueCount(items.length)} before activating
      </div>
      <ul className="space-y-1 text-xs text-red-200">
        {items.map((item) => (
          <li key={item.key}>
            {item.cid ? (
              <button
                type="button"
                onClick={() => item.cid && onPick(item.cid)}
                className="text-left underline-offset-2 hover:underline"
              >
                {item.text}
              </button>
            ) : (
              item.text
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------
// Trigger card
// ------------------------------------------------------------

function TriggerCard({
  type,
  config,
  errors,
  onTypeChange,
  onConfigChange,
}: {
  type: AutomationTriggerType;
  config: Record<string, unknown>;
  errors: FieldErrors;
  onTypeChange: (t: AutomationTriggerType) => void;
  onConfigChange: (c: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const hasErrors = Object.keys(errors).length > 0;
  const expanded = open || hasErrors;
  const available = isTriggerAvailable(type);
  const option = TRIGGER_OPTIONS.find((o) => o.value === type);
  return (
    // Card width: full on mobile, fixed 320px on sm+. The canvas wrapper
    // (max-w-2xl + px-4) keeps this tidy on tablet/desktop.
    <div className="z-10 w-full max-w-[320px] sm:w-80">
      <div
        className={cn(
          'rounded-lg border border-l-4 border-slate-800 border-l-blue-500 bg-slate-900 shadow-lg',
          hasErrors && 'border-red-500/70 border-l-red-500'
        )}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-500/10 text-blue-400">
            <Zap className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] tracking-wide text-blue-300 uppercase">
              Trigger
            </div>
            <div className="truncate text-sm font-medium text-white">
              {option?.label ?? triggerLabel(type)}
            </div>
          </div>
          <ChevronDown
            className={cn(
              'h-4 w-4 text-slate-400 transition-transform',
              expanded && 'rotate-180'
            )}
          />
        </button>
        {expanded && (
          <div className="space-y-3 border-t border-slate-800 px-4 py-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">
                Trigger type
              </label>
              <select
                value={type}
                onChange={(e) =>
                  onTypeChange(e.target.value as AutomationTriggerType)
                }
                aria-label="Trigger type"
                className="focus:border-primary w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-white focus:outline-none"
              >
                {!available && (
                  <option value={type} disabled>
                    {triggerLabel(type)}
                  </option>
                )}
                {TRIGGER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-slate-500">
                {option?.hint ?? triggerActivationSentence(type)}
              </p>
              {errors.type && (
                <p className="mt-1 text-[11px] text-red-400">{errors.type}</p>
              )}
            </div>
            {type === 'keyword_match' && (
              <KeywordMatchConfig
                config={config as unknown as KeywordMatchTriggerConfig}
                errors={errors}
                onChange={onConfigChange}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function KeywordMatchConfig({
  config,
  errors,
  onChange,
}: {
  config: KeywordMatchTriggerConfig;
  errors: FieldErrors;
  onChange: (c: Record<string, unknown>) => void;
}) {
  const keywords = config?.keywords ?? [];
  return (
    <div className="space-y-2">
      <FieldBlock label="Keywords (comma-separated)" error={errors.keywords}>
        <Input
          value={keywords.join(', ')}
          onChange={(e) =>
            onChange({
              ...config,
              keywords: e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          aria-invalid={!!errors.keywords || undefined}
          className="bg-slate-800 text-white"
        />
      </FieldBlock>
      <FieldBlock label="Match type" error={errors.match_type}>
        <select
          value={config?.match_type ?? 'contains'}
          onChange={(e) =>
            onChange({
              ...config,
              match_type: e.target.value as 'exact' | 'contains',
            })
          }
          className={selectClass(!!errors.match_type)}
        >
          <option value="contains">Contains</option>
          <option value="exact">Exact</option>
        </select>
      </FieldBlock>
    </div>
  );
}

// ------------------------------------------------------------
// Step list + card + connectors
// ------------------------------------------------------------

interface StepListProps {
  steps: BuilderStep[];
  scope: ListScope;
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
  issuesByCid: Map<string, FieldErrors>;
  updateStep: (
    path: StepPath,
    updater: (s: BuilderStep) => BuilderStep
  ) => void;
  addStepAt: (
    scope: ListScope,
    index: number,
    type: AutomationStepType
  ) => void;
  deleteStepAt: (path: StepPath, step: BuilderStep) => void;
  moveStepAt: (path: StepPath, direction: -1 | 1) => void;
}

function StepList(props: StepListProps) {
  const { steps, scope, ...rest } = props;
  return (
    <div className="flex flex-col items-center">
      <AddButton onPick={(t) => props.addStepAt(scope, 0, t)} />
      {steps.map((step, idx) => (
        <StepRenderer
          key={step.cid}
          step={step}
          index={idx}
          total={steps.length}
          scope={scope}
          {...rest}
        />
      ))}
    </div>
  );
}

function StepRenderer({
  step,
  index,
  total,
  scope,
  ...props
}: {
  step: BuilderStep;
  index: number;
  total: number;
  scope: ListScope;
} & Omit<StepListProps, 'steps' | 'scope'>) {
  const path = pathInScope(scope, index);
  const meta = STEP_META[step.step_type];
  const Icon = meta.icon;
  const expanded = props.expandedId === step.cid;
  const isCondition = step.step_type === 'condition';
  const errors = props.issuesByCid.get(step.cid);
  const errorCount = errors ? Object.keys(errors).length : 0;
  // Card widths on mobile fill the full canvas column (max-w-2xl px-4
  // still keeps them reasonable). On sm+ the original fixed widths
  // come back so the flow visual stays recognisable.
  const width = isCondition
    ? 'w-full max-w-[400px] sm:w-[400px]'
    : 'w-full max-w-[320px] sm:w-80';

  return (
    <>
      <div className={cn('z-10 flex flex-col', width)}>
        <div
          className={cn(
            'rounded-lg border border-l-4 border-slate-800 bg-slate-900 shadow-lg',
            meta.border,
            errorCount > 0 && 'border-red-500/70 border-l-red-500'
          )}
        >
          <button
            type="button"
            onClick={() => props.setExpandedId(expanded ? null : step.cid)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left"
          >
            <GripVertical
              className="h-4 w-4 flex-shrink-0 text-slate-600"
              aria-hidden
            />
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-800 text-slate-300">
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] tracking-wide text-slate-400 uppercase">
                {isCondition
                  ? 'Condition'
                  : step.step_type === 'wait'
                    ? 'Wait'
                    : 'Action'}
              </div>
              <div className="truncate text-sm font-medium text-white">
                {meta.label}
              </div>
              {errorCount > 0 ? (
                <div className="truncate text-[11px] text-red-400">
                  {issueCount(errorCount)} to fix
                </div>
              ) : (
                <div className="truncate text-[11px] text-slate-500">
                  {previewFor(step)}
                </div>
              )}
            </div>
            <ChevronDown
              className={cn(
                'h-4 w-4 text-slate-400 transition-transform',
                expanded && 'rotate-180'
              )}
            />
          </button>
          {expanded && (
            <div className="border-t border-slate-800 px-4 py-3">
              <StepEditor
                step={step}
                errors={errors ?? {}}
                onChange={(next) => props.updateStep(path, () => next)}
              />
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-800 pt-3">
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={index === 0}
                    aria-label="Move up"
                    onClick={() => props.moveStepAt(path, -1)}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={index === total - 1}
                    aria-label="Move down"
                    onClick={() => props.moveStepAt(path, 1)}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                  onClick={() => props.deleteStepAt(path, step)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </Button>
              </div>
            </div>
          )}
        </div>

        {isCondition && (
          <ConditionBranches step={step} path={path} {...props} />
        )}
      </div>

      <AddButton onPick={(t) => props.addStepAt(scope, index + 1, t)} />
    </>
  );
}

function ConditionBranches({
  step,
  path,
  ...props
}: {
  step: BuilderStep;
  path: StepPath;
} & Omit<StepListProps, 'steps' | 'scope'>) {
  const yes = step.branches?.yes ?? [];
  const no = step.branches?.no ?? [];
  return (
    // Stack Yes/No vertically on mobile — two columns at 375px would
    // cram each branch to ~170px which is too narrow for the nested
    // cards. Two-column grid returns on sm+.
    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <BranchColumn label="Yes" color="text-primary">
        <StepList
          {...props}
          steps={yes}
          scope={{ parent: path, branch: 'yes' }}
        />
      </BranchColumn>
      <BranchColumn label="No" color="text-rose-400">
        <StepList
          {...props}
          steps={no}
          scope={{ parent: path, branch: 'no' }}
        />
      </BranchColumn>
    </div>
  );
}

function BranchColumn({
  label,
  color,
  children,
}: {
  label: string;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center">
      <div className={cn('mb-2 text-[11px] font-semibold uppercase', color)}>
        {label}
      </div>
      {children}
    </div>
  );
}

function AddButton({ onPick }: { onPick: (t: AutomationStepType) => void }) {
  return (
    <div className="relative flex flex-col items-center">
      <div className="h-4 w-[2px] bg-slate-700" aria-hidden />
      <DropdownMenu>
        <DropdownMenuTrigger
          className="hover:border-primary hover:bg-primary/10 hover:text-primary data-[popup-open]:border-primary data-[popup-open]:bg-primary/20 data-[popup-open]:text-primary flex h-8 w-8 items-center justify-center rounded-full border-2 border-dashed border-slate-700 bg-slate-950 text-slate-400 transition-colors"
          aria-label="Add step"
        >
          <Plus className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-80 min-w-56 overflow-y-auto border-slate-700 bg-slate-900"
        >
          {ADDABLE_STEPS.map((t) => {
            const Icon = STEP_META[t].icon;
            return (
              <DropdownMenuItem key={t} onClick={() => onPick(t)}>
                <Icon className="h-4 w-4" />
                {STEP_META[t].label}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="h-4 w-[2px] bg-slate-700" aria-hidden />
    </div>
  );
}

// ------------------------------------------------------------
// Per-step config editor
// ------------------------------------------------------------

function StepEditor({
  step,
  errors,
  onChange,
}: {
  step: BuilderStep;
  errors: FieldErrors;
  onChange: (s: BuilderStep) => void;
}) {
  const cfg = step.step_config;
  const set = (patch: Record<string, unknown>) =>
    onChange({ ...step, step_config: { ...cfg, ...patch } });
  const str = (key: string) => (cfg[key] as string) ?? '';
  const invalid = (key: string) => (errors[key] ? true : undefined);

  switch (step.step_type) {
    case 'send_message':
      return (
        <FieldBlock label="Message text" error={errors.text}>
          <Textarea
            value={str('text')}
            onChange={(e) => set({ text: e.target.value })}
            placeholder="Hi! Thanks for reaching out…"
            aria-invalid={invalid('text')}
            className="min-h-24 bg-slate-800 text-white"
          />
        </FieldBlock>
      );
    case 'send_template':
      return (
        <FieldBlock label="Template" error={errors.template_name}>
          <TemplateSelect
            name={str('template_name')}
            language={str('language')}
            onChange={set}
            invalid={invalid('template_name')}
          />
        </FieldBlock>
      );
    case 'add_tag':
    case 'remove_tag':
      return (
        <FieldBlock label="Tag" error={errors.tag_id}>
          <TagSelect
            value={str('tag_id')}
            onChange={(v) => set({ tag_id: v })}
            invalid={invalid('tag_id')}
          />
        </FieldBlock>
      );
    case 'assign_conversation':
      return (
        <>
          <FieldBlock label="Mode">
            <select
              value={(cfg.mode as string) ?? 'round_robin'}
              onChange={(e) => set({ mode: e.target.value })}
              className={selectClass()}
            >
              <option value="round_robin">Round-robin</option>
              <option value="specific">Specific agent</option>
            </select>
          </FieldBlock>
          {cfg.mode === 'specific' && (
            <FieldBlock label="Agent" error={errors.agent_id}>
              <MemberSelect
                value={str('agent_id')}
                onChange={(v) => set({ agent_id: v })}
                invalid={invalid('agent_id')}
              />
            </FieldBlock>
          )}
        </>
      );
    case 'update_contact_field':
      return (
        <>
          <FieldBlock label="Field" error={errors.field}>
            <select
              value={(cfg.field as string) ?? 'name'}
              onChange={(e) => set({ field: e.target.value })}
              className={selectClass(invalid('field'))}
            >
              <option value="name">Name</option>
              <option value="email">Email</option>
              <option value="company">Company</option>
            </select>
          </FieldBlock>
          <FieldBlock label="Value" error={errors.value}>
            <Input
              value={str('value')}
              onChange={(e) => set({ value: e.target.value })}
              aria-invalid={invalid('value')}
              className="bg-slate-800 text-white"
            />
          </FieldBlock>
        </>
      );
    case 'create_deal':
      return (
        <>
          <FieldBlock label="Pipeline" error={errors.pipeline_id}>
            <PipelineSelect
              value={str('pipeline_id')}
              onChange={(v) => set({ pipeline_id: v, stage_id: '' })}
              invalid={invalid('pipeline_id')}
            />
          </FieldBlock>
          <FieldBlock label="Stage" error={errors.stage_id}>
            <StageSelect
              pipelineId={str('pipeline_id')}
              value={str('stage_id')}
              onChange={(v) => set({ stage_id: v })}
              invalid={invalid('stage_id')}
            />
          </FieldBlock>
          <FieldBlock label="Title" error={errors.title}>
            <Input
              value={str('title')}
              onChange={(e) => set({ title: e.target.value })}
              aria-invalid={invalid('title')}
              className="bg-slate-800 text-white"
            />
          </FieldBlock>
          <FieldBlock label="Value">
            <Input
              type="number"
              value={(cfg.value as number) ?? 0}
              onChange={(e) => set({ value: Number(e.target.value) })}
              className="bg-slate-800 text-white"
            />
            <PriceHint value={(cfg.value as number) ?? 0} />
          </FieldBlock>
        </>
      );
    case 'wait':
      return (
        <div className="grid grid-cols-2 gap-2">
          <FieldBlock label="Amount" error={errors.amount}>
            <WaitAmountInput
              amount={cfg.amount}
              onCommit={(amount) => set({ amount })}
              invalid={invalid('amount')}
            />
          </FieldBlock>
          <FieldBlock label="Unit" error={errors.unit}>
            <select
              value={(cfg.unit as string) ?? 'hours'}
              onChange={(e) => set({ unit: e.target.value })}
              className={selectClass(invalid('unit'))}
            >
              <option value="minutes">Minutes</option>
              <option value="hours">Hours</option>
              <option value="days">Days</option>
            </select>
          </FieldBlock>
        </div>
      );
    case 'condition':
      return (
        <ConditionEditor
          subject={(cfg.subject as string) ?? 'tag_presence'}
          operand={str('operand')}
          value={str('value')}
          errors={errors}
          set={set}
        />
      );
    case 'send_webhook':
      return (
        <>
          <FieldBlock label="URL" error={errors.url}>
            <Input
              value={str('url')}
              onChange={(e) => set({ url: e.target.value })}
              aria-invalid={invalid('url')}
              className="bg-slate-800 text-white"
            />
          </FieldBlock>
          <FieldBlock label="Body template (JSON)">
            <Textarea
              value={str('body_template')}
              onChange={(e) => set({ body_template: e.target.value })}
              className="min-h-20 bg-slate-800 font-mono text-xs text-white"
            />
          </FieldBlock>
        </>
      );
    case 'close_conversation':
      return (
        <p className="text-xs text-slate-400">
          Sets the conversation status to &quot;closed&quot;. No configuration
          needed.
        </p>
      );
    default:
      return null;
  }
}

function ConditionEditor({
  subject,
  operand,
  value,
  errors,
  set,
}: {
  subject: string;
  operand: string;
  value: string;
  errors: FieldErrors;
  set: (patch: Record<string, unknown>) => void;
}) {
  const [from = '', to = ''] = operand.split('-');
  return (
    <>
      <FieldBlock label="Check" error={errors.subject}>
        <select
          value={subject}
          onChange={(e) =>
            set({ subject: e.target.value, operand: '', value: '' })
          }
          className={selectClass(!!errors.subject)}
        >
          {CONDITION_SUBJECTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </FieldBlock>
      {subject === 'tag_presence' && (
        <FieldBlock label="Tag" error={errors.operand}>
          <TagSelect
            value={operand}
            onChange={(v) => set({ operand: v })}
            invalid={!!errors.operand}
          />
        </FieldBlock>
      )}
      {subject === 'contact_field' && (
        <div className="grid grid-cols-2 gap-2">
          <FieldBlock label="Field" error={errors.operand}>
            <select
              value={operand}
              onChange={(e) => set({ operand: e.target.value })}
              className={selectClass(!!errors.operand)}
            >
              <option value="">Pick a field…</option>
              {operand && !CONTACT_FIELDS.some((f) => f.value === operand) && (
                <option value={operand}>{operand}</option>
              )}
              {CONTACT_FIELDS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </FieldBlock>
          <FieldBlock label="equals">
            <Input
              value={value}
              onChange={(e) => set({ value: e.target.value })}
              className="bg-slate-800 text-white"
            />
          </FieldBlock>
        </div>
      )}
      {subject === 'message_content' && (
        <FieldBlock label="Message contains" error={errors.value}>
          <Input
            value={value}
            onChange={(e) => set({ value: e.target.value })}
            placeholder="e.g. price"
            aria-invalid={errors.value ? true : undefined}
            className="bg-slate-800 text-white"
          />
        </FieldBlock>
      )}
      {subject === 'time_of_day' && (
        <FieldBlock label="Between … and …" error={errors.operand}>
          <div className="flex items-center gap-2">
            <Input
              type="time"
              aria-label="From"
              value={from}
              onChange={(e) => set({ operand: `${e.target.value}-${to}` })}
              className="bg-slate-800 text-white"
            />
            <span className="text-xs text-slate-400">and</span>
            <Input
              type="time"
              aria-label="To"
              value={to}
              onChange={(e) => set({ operand: `${from}-${e.target.value}` })}
              className="bg-slate-800 text-white"
            />
          </div>
        </FieldBlock>
      )}
    </>
  );
}

function WaitAmountInput({
  amount,
  onCommit,
  invalid,
}: {
  amount: unknown;
  onCommit: (amount: number) => void;
  invalid?: boolean;
}) {
  const [text, setText] = useState(
    typeof amount === 'number' ? String(amount) : '1'
  );
  return (
    <Input
      type="number"
      min={1}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value !== '' && Number.isFinite(n) && n >= 1) onCommit(n);
      }}
      onBlur={() => {
        const n = Math.max(1, Number(text) || 1);
        setText(String(n));
        onCommit(n);
      }}
      aria-invalid={invalid}
      className="bg-slate-800 text-white"
    />
  );
}

function FieldBlock({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2 last:mb-0">
      <label className="mb-1 block text-xs font-medium text-slate-400">
        {label}
      </label>
      {children}
      {error && <p className="mt-1 text-[11px] text-red-400">{error}</p>}
    </div>
  );
}

function previewFor(step: BuilderStep): string {
  switch (step.step_type) {
    case 'send_message':
      return (step.step_config.text as string) || 'no text yet';
    case 'send_template':
      return (step.step_config.template_name as string) || 'pick a template';
    case 'wait':
      return `${step.step_config.amount ?? '?'} ${step.step_config.unit ?? ''}`;
    case 'condition':
      return (
        CONDITION_SUBJECTS.find((s) => s.value === step.step_config.subject)
          ?.label ?? 'pick a check'
      );
    case 'send_webhook':
      return (step.step_config.url as string) || 'no url';
    default:
      return '';
  }
}

// ------------------------------------------------------------
// Serialize builder tree → API payload (flattened shape)
// ------------------------------------------------------------

interface ApiStep {
  step_type: string;
  step_config: Record<string, unknown>;
  branches?: { yes?: ApiStep[]; no?: ApiStep[] };
}

export function toApiSteps(steps: BuilderStep[]): ApiStep[] {
  return steps.map((s) => ({
    step_type: s.step_type,
    step_config: s.step_config,
    branches: s.branches
      ? { yes: toApiSteps(s.branches.yes), no: toApiSteps(s.branches.no) }
      : undefined,
  }));
}

/**
 * Convert server-returned step tree (from loadStepsTree) into the
 * builder-local shape with client ids.
 */
export interface ServerStepNode {
  id: string;
  step_type: string;
  step_config: Record<string, unknown>;
  branches: { yes: ServerStepNode[]; no: ServerStepNode[] };
}

export function fromServerSteps(nodes: ServerStepNode[]): BuilderStep[] {
  return nodes.map((n) => ({
    cid: cid(),
    step_type: n.step_type as AutomationStepType,
    step_config: n.step_config ?? {},
    branches:
      n.step_type === 'condition'
        ? {
            yes: fromServerSteps(n.branches?.yes ?? []),
            no: fromServerSteps(n.branches?.no ?? []),
          }
        : undefined,
  }));
}
