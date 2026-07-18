import type { LiaisonWorkflow, LiaisonWorkflowStage } from '@/types';

/** A process explanation, not a Gantt chart — cap the stage count. */
const MAX_STAGES = 20;

export function sanitizeStages(value: unknown): LiaisonWorkflowStage[] {
  if (!Array.isArray(value)) return [];
  const out: LiaisonWorkflowStage[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const { name, authority, duration_days, description } = item as Record<string, unknown>;
    if (typeof name !== 'string' || name.trim().length === 0) continue;
    out.push({
      name: name.trim(),
      authority: typeof authority === 'string' ? authority.trim() || null : null,
      duration_days:
        typeof duration_days === 'number' &&
        Number.isFinite(duration_days) &&
        duration_days > 0
          ? Math.round(duration_days)
          : null,
      description:
        typeof description === 'string' ? description.trim() || null : null,
    });
    if (out.length >= MAX_STAGES) break;
  }
  return out;
}

/** Sum of the stage timelines; null when no stage has one. */
export function totalDurationDays(stages: LiaisonWorkflowStage[]): number | null {
  let total = 0;
  let any = false;
  for (const s of stages) {
    if (s.duration_days !== null && s.duration_days !== undefined) {
      total += s.duration_days;
      any = true;
    }
  }
  return any ? total : null;
}

/**
 * Render a workflow into the WhatsApp message a client receives.
 * WhatsApp formatting: *bold*, _italic_. Kept plain and sequential —
 * the reader is a client, not a case worker.
 */
export function buildWorkflowMessage(
  workflow: Pick<LiaisonWorkflow, 'service_name' | 'description' | 'stages'>,
): string {
  const lines: string[] = [];

  lines.push(`*${workflow.service_name} — how the process works*`);
  if (workflow.description) {
    lines.push('');
    lines.push(workflow.description);
  }

  workflow.stages.forEach((stage, i) => {
    lines.push('');
    const authority = stage.authority ? ` — ${stage.authority}` : '';
    lines.push(`*Step ${i + 1}: ${stage.name}*${authority}`);
    if (stage.duration_days !== null && stage.duration_days !== undefined) {
      lines.push(
        `Approx. ${stage.duration_days} day${stage.duration_days === 1 ? '' : 's'}`,
      );
    }
    if (stage.description) {
      lines.push(stage.description);
    }
  });

  const total = totalDurationDays(workflow.stages);
  if (total !== null) {
    lines.push('');
    lines.push(`*Overall expected timeline: approx. ${total} days*`);
  }

  lines.push('');
  lines.push(
    '_Timelines are indicative — government processing times can vary. We will keep you updated at every stage._',
  );

  return lines.join('\n');
}
