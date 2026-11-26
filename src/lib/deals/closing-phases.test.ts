import { describe, expect, it } from 'vitest';
import { SPEC_DEFAULT_STAGES } from '../pipelines/default-stages';
import {
  closingPhaseOf,
  earlierOpenMilestones,
  groupMilestonesByPhase,
  milestonesBehindStage,
  milestonesSettledByFinancials,
  moneyMissingForMilestones,
  phasesDoneForStage,
  suggestedNextStage,
} from './closing-phases';
import {
  DEAL_MILESTONE_TEMPLATES,
  type DealMilestoneStatus,
} from './milestones';

const stages = SPEC_DEFAULT_STAGES.map((s) => ({ ...s, id: `s${s.position}` }));
const stageNamed = (prefix: string) =>
  stages.find((s) => s.name.startsWith(prefix))!;

function checklist(doneKeys: readonly string[] = []) {
  return DEAL_MILESTONE_TEMPLATES.map((t, position) => ({
    id: t.key,
    template_key: t.key as string | null,
    title: t.title,
    position,
    status: (doneKeys.includes(t.key)
      ? 'completed'
      : 'pending') as DealMilestoneStatus,
  }));
}

const keys = (rows: { id: string }[]) => rows.map((r) => r.id);

describe('[TXW-034] closing phases tie milestones to stages', () => {
  it('places every standard milestone in exactly one phase', () => {
    for (const t of DEAL_MILESTONE_TEMPLATES) {
      expect(closingPhaseOf(t.key)).not.toBeNull();
    }
    expect(closingPhaseOf(null)).toBeNull();
    expect(closingPhaseOf('custom')).toBeNull();
  });

  it('reads how far each default stage says the closing has got', () => {
    expect(stages.map((s) => [s.name, phasesDoneForStage(s)])).toEqual([
      ['Enquiry → Shortlist', 0],
      ['Shortlisted → Visit', 0],
      ["Finalised → Owner's meeting", 0],
      ["Owner's meeting → Negotiation", 0],
      ['Deal confirmed → Due diligence', 1],
      ['Legal done → Agreement/Registration', 2],
      ['Registered → Brokerage', 3],
      ['Brokerage paid / Closed', 5],
      ['Closed Lost', 0],
    ]);
    expect(
      phasesDoneForStage({ name: 'Negotiation/Token', stage_type: 'committed' })
    ).toBe(0);
    expect(
      milestonesBehindStage(checklist(), {
        name: 'Negotiation/Token',
        stage_type: 'committed',
      })
    ).toEqual([]);
  });

  it('flags the milestones a Registered deal skipped, as on the reported deal', () => {
    const rows = checklist([
      'initial_negotiation',
      'commercial_terms_agreed',
      'token_paid',
      'documents_collected',
      'legal_verification',
      'loan_processing',
      'draft_agreement_shared',
      'registration_scheduled',
    ]);
    expect(keys(milestonesBehindStage(rows, stageNamed('Registered')))).toEqual(
      [
        'agreement_executed',
        'conditions_precedent',
        'tds_and_instruments',
        'sale_deed_registered',
      ]
    );
    expect(milestonesBehindStage(rows, stageNamed('Closed Lost'))).toEqual([]);
    expect(milestonesBehindStage(rows, null)).toEqual([]);
  });

  it('never counts a skipped milestone or a custom one as behind', () => {
    const rows = checklist().map((m) =>
      m.id === 'initial_negotiation' ? { ...m, status: 'skipped' as const } : m
    );
    rows.push({
      id: 'custom',
      template_key: null,
      title: 'Society NOC',
      position: 0,
      status: 'pending',
    });
    expect(
      keys(milestonesBehindStage(rows, stageNamed('Deal confirmed')))
    ).toEqual(['commercial_terms_agreed']);
  });

  it('lists the open milestones that ticking one out of order would jump', () => {
    const rows = checklist(['initial_negotiation']);
    const target = rows.find((m) => m.id === 'token_paid')!;
    expect(keys(earlierOpenMilestones(rows, target))).toEqual([
      'commercial_terms_agreed',
    ]);
    expect(earlierOpenMilestones(rows, rows[1])).toEqual([]);
  });

  it('groups the checklist by phase with custom milestones last', () => {
    const rows = checklist(['initial_negotiation']);
    rows.push({
      id: 'custom',
      template_key: null,
      title: 'Society NOC',
      position: 99,
      status: 'pending',
    });
    const groups = groupMilestonesByPhase(rows);
    expect(groups.map((g) => [g.label, g.items.length, g.done])).toEqual([
      ['Negotiation', 2, 1],
      ['Due diligence', 4, 0],
      ['Agreement & registration', 6, 0],
      ['Handover', 1, 0],
      ['Brokerage & close', 2, 0],
      ['Other milestones', 1, 0],
    ]);
  });

  it('offers the next stage only once the current phase is fully done', () => {
    const dd = stageNamed('Deal confirmed');
    const ddKeys = [
      'token_paid',
      'documents_collected',
      'legal_verification',
      'loan_processing',
    ];
    expect(suggestedNextStage(stages, dd, checklist(ddKeys.slice(1)))).toBe(
      null
    );
    const negotiated = ['initial_negotiation', 'commercial_terms_agreed'];
    expect(
      suggestedNextStage(stages, dd, checklist([...negotiated, ...ddKeys]))
        ?.name
    ).toBe('Legal done → Agreement/Registration');
    expect(
      suggestedNextStage(
        stages,
        stageNamed('Enquiry'),
        checklist(['initial_negotiation', 'commercial_terms_agreed'])
      )
    ).toBe(null);
    expect(
      suggestedNextStage(
        stages,
        stageNamed("Owner's meeting"),
        checklist(['initial_negotiation', 'commercial_terms_agreed'])
      )?.name
    ).toBe('Deal confirmed → Due diligence');
    expect(
      suggestedNextStage(stages, stageNamed('Brokerage paid'), checklist())
    ).toBe(null);
    const allButBrokerage = checklist([
      'initial_negotiation',
      'commercial_terms_agreed',
      ...ddKeys,
      'draft_agreement_shared',
      'agreement_executed',
      'conditions_precedent',
      'tds_and_instruments',
      'registration_scheduled',
      'sale_deed_registered',
      'possession_handover',
    ]);
    expect(
      suggestedNextStage(stages, stageNamed('Registered'), allButBrokerage)
    ).toBe(null);
    expect(
      suggestedNextStage(
        stages,
        stageNamed('Registered'),
        allButBrokerage.map((m) => ({ ...m, status: 'completed' as const }))
      )?.name
    ).toBe('Brokerage paid / Closed');
    expect(
      suggestedNextStage(
        stages,
        dd,
        checklist([...negotiated, ...ddKeys]).map((m) =>
          m.id === 'initial_negotiation'
            ? { ...m, status: 'pending' as const }
            : m
        )
      )
    ).toBe(null);
  });

  it('keeps money milestones and the Money tab in step both ways', () => {
    const rows = checklist(['token_paid']);
    expect(
      keys(moneyMissingForMilestones(rows, { token_amount: null }))
    ).toEqual(['token_paid']);
    expect(moneyMissingForMilestones(rows, { token_amount: 500000 })).toEqual(
      []
    );
    expect(
      keys(
        milestonesSettledByFinancials(checklist(), {
          brokerage_received_amount: 816000,
          registered_consideration: null,
        })
      )
    ).toEqual(['brokerage_collected']);
  });
});
