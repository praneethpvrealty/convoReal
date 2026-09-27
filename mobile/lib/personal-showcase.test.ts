import { describe, expect, it } from 'vitest';

import {
  FOLLOW_COMPANY,
  PERSONAL_SHOWCASE_DESIGNS,
  SHOWCASE_STYLES,
  followsCompanyDesign,
  personalShowcaseChanged,
  pickPersonalDesign,
  resolveShowcasePresentation,
  setPersonalThreeDimensional,
  toPersonalShowcase,
} from './personal-showcase';

describe('personal showcase design [PRP-021]', () => {
  it('follows the company design while the agent has not chosen one', () => {
    const personal = toPersonalShowcase({
      showcase_style: null,
      showcase_3d_enabled: null,
    });
    expect(followsCompanyDesign(personal)).toBe(true);
    expect(
      resolveShowcasePresentation(
        { showcase_style: 'deal-floor', showcase_3d_enabled: false },
        {
          showcase_style: personal.style,
          showcase_3d_enabled: personal.threeDimensional,
        }
      )
    ).toEqual({ style: 'deal-floor', threeDimensional: false });
  });

  it('pins the agent to their own design once they pick one', () => {
    const picked = pickPersonalDesign(FOLLOW_COMPANY, 'editorial', false);
    expect(picked).toEqual({ style: 'editorial', threeDimensional: false });
    expect(followsCompanyDesign(picked)).toBe(false);
    expect(personalShowcaseChanged(FOLLOW_COMPANY, picked)).toBe(true);
  });

  it('turns 3D off for the agency designs, which have no 3D mode', () => {
    expect(
      pickPersonalDesign(
        { style: 'gallery', threeDimensional: true },
        'deal-floor',
        true
      )
    ).toEqual({ style: 'deal-floor', threeDimensional: false });
  });

  it('keeps the effective design when only 3D is toggled', () => {
    expect(
      setPersonalThreeDimensional(FOLLOW_COMPANY, false, 'gallery')
    ).toEqual({ style: 'gallery', threeDimensional: false });
  });

  it('can return an agent with their own design to the company design', () => {
    const own = toPersonalShowcase({
      showcase_style: 'editorial',
      showcase_3d_enabled: true,
    });
    expect(personalShowcaseChanged(own, FOLLOW_COMPANY)).toBe(true);
    expect(personalShowcaseChanged(own, { ...own })).toBe(false);
  });

  it('offers every showcase design exactly once', () => {
    expect(
      PERSONAL_SHOWCASE_DESIGNS.map((design) => design.value).sort()
    ).toEqual([...SHOWCASE_STYLES].sort());
  });
});
