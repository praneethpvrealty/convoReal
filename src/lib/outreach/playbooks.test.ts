import { describe, expect, it } from 'vitest';
import { DISPOSITIONS } from '@/lib/outreach/dispositions';
import {
  buildCheckinAck,
  buildCheckinMessage,
  buildCloseNote,
  buildHandoffMessage,
  resolvePlaybook,
  statedBrief,
  type FollowUpContext,
} from '@/lib/outreach/playbooks';

const ctx = (over: Partial<FollowUpContext> = {}): FollowUpContext => ({
  contactName: 'Gopi Krishnan',
  agentName: 'Rahul Nair',
  budgetText: '₹9 Cr',
  areasText: 'HSR Layout',
  ...over,
});

describe('resolvePlaybook', () => {
  it('covers every disposition for buyer_qualification', () => {
    for (const d of DISPOSITIONS) {
      expect(resolvePlaybook('buyer_qualification', d)).not.toBeNull();
    }
  });

  it('sends matches for the 95% case and for qualified leads', () => {
    expect(
      resolvePlaybook('buyer_qualification', 'budget_mismatch_open')?.action
    ).toBe('matches');
    expect(resolvePlaybook('buyer_qualification', 'qualified')?.action).toBe(
      'matches'
    );
  });

  it('stays silent where silence is the design', () => {
    for (const d of [
      'do_not_call',
      'just_browsing',
      'is_agent_broker',
    ] as const) {
      expect(resolvePlaybook('buyer_qualification', d)?.action).toBe('none');
    }
  });

  it('raises a task, not a message, for a seller surfaced by the call', () => {
    const entry = resolvePlaybook(
      'buyer_qualification',
      'has_property_to_sell'
    );
    expect(entry?.action).toBe('none');
    expect(entry?.task).toContain('owner onboarding');
    expect(entry?.tags).toContain('Owner Lead');
  });

  it('owner_onboarding has no playbook yet — every disposition is null', () => {
    for (const d of DISPOSITIONS) {
      expect(resolvePlaybook('owner_onboarding', d)).toBeNull();
    }
  });
});

describe('message builders', () => {
  it('statedBrief phrases budget and area, and degrades to empty', () => {
    expect(statedBrief(ctx())).toBe('₹9 Cr around HSR Layout');
    expect(statedBrief(ctx({ budgetText: null }))).toBe('around HSR Layout');
    expect(statedBrief(ctx({ budgetText: null, areasText: null }))).toBe('');
  });

  it('close note congratulates a purchase and stays gracious otherwise', () => {
    expect(buildCloseNote('already_bought', ctx())).toContain(
      'Congratulations'
    );
    const closed = buildCloseNote('budget_mismatch_closed', ctx());
    expect(closed).toContain('Gopi');
    expect(closed).not.toContain('Congratulations');
  });

  it('handoff names the agent when there is one', () => {
    expect(buildHandoffMessage(ctx())).toContain('Rahul Nair');
    expect(buildHandoffMessage(ctx({ agentName: null }))).toContain(
      'One of our team'
    );
  });

  it('checkin ack promises quiet; the dated message uses the brief', () => {
    expect(buildCheckinAck(ctx())).toContain("won't crowd you");
    expect(buildCheckinMessage(ctx())).toContain('₹9 Cr around HSR Layout');
    expect(
      buildCheckinMessage(ctx({ budgetText: null, areasText: null }))
    ).toContain('still on the lookout');
  });
});
