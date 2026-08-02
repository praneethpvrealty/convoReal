import { describe, expect, it } from 'vitest';
import {
  FUNNEL_ENGINE,
  FUNNEL_END,
  FUNNEL_MATCH,
  funnelStep,
  nextStepId,
} from './funnel';
import {
  AGENT_INTENT,
  RENT_INTENT,
  SHOWCASE_AFTER_MATCH,
  SHOWCASE_FUNNEL,
  engineFunnel,
} from './funnels';

const SENTINELS = [FUNNEL_END, FUNNEL_ENGINE, FUNNEL_MATCH];

function step(funnel: typeof SHOWCASE_FUNNEL, id: string) {
  const found = funnelStep(funnel, id);
  if (!found) throw new Error(`missing step ${id}`);
  return found;
}

describe('SHOWCASE_FUNNEL', () => {
  it('sends a professional to the Engine funnel and a buyer onward', () => {
    const intent = step(SHOWCASE_FUNNEL, 'intent');
    expect(nextStepId(intent, AGENT_INTENT, {})).toBe(FUNNEL_ENGINE);
    expect(nextStepId(intent, 'Buying', {})).toBe('category');
    expect(nextStepId(intent, 'Investing', {})).toBe('category');
  });

  it('asks renters for a monthly figure and buyers for a capital one', () => {
    const locality = step(SHOWCASE_FUNNEL, 'locality');
    expect(nextStepId(locality, '', { intent: RENT_INTENT })).toBe(
      'rent_budget'
    );
    expect(nextStepId(locality, '', { intent: 'Buying' })).toBe('budget');
  });

  it('shows matches before asking for contact details', () => {
    expect(nextStepId(step(SHOWCASE_FUNNEL, 'budget'), '', {})).toBe(
      FUNNEL_MATCH
    );
    expect(nextStepId(step(SHOWCASE_FUNNEL, 'rent_budget'), '', {})).toBe(
      FUNNEL_MATCH
    );
    expect(funnelStep(SHOWCASE_FUNNEL, SHOWCASE_AFTER_MATCH)).not.toBeNull();
  });

  it('captures the number last', () => {
    expect(nextStepId(step(SHOWCASE_FUNNEL, 'phone'), '9845012345', {})).toBe(
      FUNNEL_END
    );
  });

  it('lets a visitor skip locality but not the number', () => {
    expect(step(SHOWCASE_FUNNEL, 'locality').optional).toBe(true);
    expect(step(SHOWCASE_FUNNEL, 'phone').optional).toBeUndefined();
  });

  it('stores both budget steps under one key so capture reads one field', () => {
    expect(step(SHOWCASE_FUNNEL, 'budget').key).toBe('budget');
    expect(step(SHOWCASE_FUNNEL, 'rent_budget').key).toBe('budget');
  });
});

describe('engineFunnel', () => {
  it('opens differently on our own site and on a customer portal', () => {
    const website = step(engineFunnel('website'), 'role').ask;
    const showcase = step(engineFunnel('showcase'), 'role').ask;
    expect(website).not.toBe(showcase);
    expect(showcase).toMatch(/ConvoReal/);
  });

  it('qualifies role, team and city before asking for the number', () => {
    const funnel = engineFunnel('website');
    expect(nextStepId(step(funnel, 'role'), 'Broker', {})).toBe('team_size');
    expect(nextStepId(step(funnel, 'team_size'), '2–5', {})).toBe('city');
    expect(nextStepId(step(funnel, 'city'), 'Bangalore', {})).toBe('name');
    expect(nextStepId(step(funnel, 'name'), 'Ravi', {})).toBe('phone');
    expect(nextStepId(step(funnel, 'phone'), '9845012345', {})).toBe(
      FUNNEL_END
    );
  });
});

describe('every funnel', () => {
  it('only points at steps that exist, or at a sentinel', () => {
    for (const funnel of [
      SHOWCASE_FUNNEL,
      engineFunnel('website'),
      engineFunnel('showcase'),
    ]) {
      expect(funnelStep(funnel, funnel.first)).not.toBeNull();
      for (const s of funnel.steps) {
        const targets =
          typeof s.next === 'function'
            ? [
                s.next(AGENT_INTENT, { intent: RENT_INTENT }),
                s.next('anything', { intent: 'Buying' }),
              ]
            : [s.next];
        for (const target of targets) {
          const known =
            Boolean(funnelStep(funnel, target)) || SENTINELS.includes(target);
          expect(known, `${funnel.id}.${s.id} → ${target}`).toBe(true);
        }
      }
    }
  });
});
