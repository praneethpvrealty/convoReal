import { describe, expect, it } from 'vitest';

import {
  metaHeldCategory,
  withMetaHeldCategory,
} from './template-category-lock';

describe('metaHeldCategory', () => {
  it('[CLG-003] returns null when no variant has reached Meta', () => {
    expect(metaHeldCategory([])).toBeNull();
    expect(
      metaHeldCategory([
        { category: 'Utility', meta_template_id: null, status: 'DRAFT' },
        { category: 'Utility', meta_template_id: null, status: 'DRAFT' },
      ])
    ).toBeNull();
  });

  it('[CLG-003] reports the category Meta assigned to the approved variant', () => {
    expect(
      metaHeldCategory([
        { category: 'Utility', meta_template_id: null, status: 'DRAFT' },
        { category: 'Marketing', meta_template_id: '123', status: 'APPROVED' },
      ])
    ).toBe('Marketing');
  });

  it('[CLG-003] prefers an approved variant over a pending one', () => {
    expect(
      metaHeldCategory([
        { category: 'UTILITY', meta_template_id: '1', status: 'PENDING' },
        { category: 'MARKETING', meta_template_id: '2', status: 'APPROVED' },
      ])
    ).toBe('Marketing');
  });

  it('[CLG-003] falls back to any Meta-held variant and normalises casing', () => {
    expect(
      metaHeldCategory([
        { category: 'UTILITY', meta_template_id: '1', status: 'PENDING' },
      ])
    ).toBe('Utility');
  });
});

describe('withMetaHeldCategory', () => {
  const kannada = {
    name: 'contact_number_update',
    language: 'kn',
    category: 'Utility' as const,
  };

  it('[CLG-003] submits a translation under the category Meta already holds', () => {
    const { payload, heldCategory } = withMetaHeldCategory(kannada, [
      { category: 'Marketing', meta_template_id: '123', status: 'APPROVED' },
    ]);
    expect(heldCategory).toBe('Marketing');
    expect(payload.category).toBe('Marketing');
    expect(payload.name).toBe('contact_number_update');
    expect(payload.language).toBe('kn');
  });

  it('[CLG-003] keeps the requested category for a name new to Meta', () => {
    const { payload, heldCategory } = withMetaHeldCategory(kannada, [
      { category: 'Utility', meta_template_id: null, status: 'DRAFT' },
    ]);
    expect(heldCategory).toBeNull();
    expect(payload).toBe(kannada);
  });

  it('[CLG-003] returns the same payload when the categories already agree', () => {
    const { payload } = withMetaHeldCategory(kannada, [
      { category: 'Utility', meta_template_id: '9', status: 'APPROVED' },
    ]);
    expect(payload).toBe(kannada);
  });
});
