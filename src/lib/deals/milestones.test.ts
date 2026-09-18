import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEAL_MILESTONE_TEMPLATES,
  milestoneProgress,
  milestoneUpdateData,
  parseMilestonePatch,
  standardMilestoneRows,
} from './milestones';

describe('standardMilestoneRows', () => {
  it('[TXW-003] instantiates the full standard checklist in order', () => {
    const rows = standardMilestoneRows('acc', 'deal');
    expect(rows.map((r) => r.template_key)).toEqual(
      DEAL_MILESTONE_TEMPLATES.map((t) => t.key)
    );
    expect(rows.map((r) => r.position)).toEqual(rows.map((_, i) => i));
    expect(rows[0]).toMatchObject({ account_id: 'acc', deal_id: 'deal' });
  });

  it('[TXW-003] skips templates the deal already has', () => {
    const rows = standardMilestoneRows('acc', 'deal', ['token_paid', null]);
    expect(rows.some((r) => r.template_key === 'token_paid')).toBe(false);
    expect(rows).toHaveLength(DEAL_MILESTONE_TEMPLATES.length - 1);
  });
});

describe('milestoneProgress', () => {
  it('counts completed and skipped as done and names the next open one', () => {
    expect(
      milestoneProgress([
        { status: 'completed', position: 0, title: 'A', target_date: null },
        { status: 'skipped', position: 1, title: 'B', target_date: null },
        { status: 'in_progress', position: 3, title: 'D', target_date: '2026-10-01' },
        { status: 'pending', position: 2, title: 'C', target_date: null },
      ])
    ).toEqual({
      total: 4,
      done: 2,
      next: { title: 'C', target_date: null },
    });
    expect(milestoneProgress([])).toEqual({ total: 0, done: 0, next: null });
  });
});

describe('parseMilestonePatch', () => {
  it('accepts a status change and stamps completed_at only on completion', () => {
    const parsed = parseMilestonePatch({ status: 'completed' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const now = new Date('2026-09-18T10:00:00Z');
    expect(milestoneUpdateData(parsed.value, now)).toEqual({
      status: 'completed',
      completed_at: now.toISOString(),
    });
    const reopened = parseMilestonePatch({ status: 'pending' });
    if (!reopened.ok) throw new Error(reopened.error);
    expect(milestoneUpdateData(reopened.value, now)).toEqual({
      status: 'pending',
      completed_at: null,
    });
  });

  it('rejects unknown statuses, bad dates and empty patches', () => {
    expect(parseMilestonePatch({ status: 'done' })).toEqual({
      ok: false,
      error: 'Unknown milestone status',
    });
    expect(parseMilestonePatch({ target_date: '18/09/2026' })).toEqual({
      ok: false,
      error: 'target_date must be YYYY-MM-DD',
    });
    expect(parseMilestonePatch({})).toEqual({ ok: false, error: 'Nothing to update' });
    expect(parseMilestonePatch({ title: '' })).toEqual({
      ok: false,
      error: 'Title must be 1–120 characters',
    });
  });

  it('clears a target date and owner with null', () => {
    expect(parseMilestonePatch({ target_date: null, owner_id: '' })).toEqual({
      ok: true,
      value: { target_date: null, owner_id: null },
    });
  });
});

describe('[TXW-003] milestones stay separate from pipeline stages', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

  it('the milestone module never reaches a stage', () => {
    const source = read('src/lib/deals/milestones.ts');
    expect(source).not.toMatch(/stage_id|pipeline_stages|stage-semantics/);
  });

  it('the milestone routes never write stage_id or property status', () => {
    for (const p of [
      'src/app/api/deals/[id]/milestones/route.ts',
      'src/app/api/deals/[id]/milestones/[milestoneId]/route.ts',
    ]) {
      const source = read(p);
      expect(source, p).not.toMatch(/stage_id/);
      expect(source, p).not.toMatch(/from\('properties'\)/);
      expect(source, p).not.toMatch(/propertyStatusForPipelineStage/);
    }
  });

  it('the stage-change trigger only records; it never touches milestones', () => {
    const sql = read(
      'supabase/migrations/20260918010100_transaction_workspace_stage_events.sql'
    );
    expect(sql).not.toMatch(/deal_milestones/);
  });
});
