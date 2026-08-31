import { describe, it, expect } from 'vitest';
import { classificationAfterSubscribe } from './alerts-subscribe';

describe('classificationAfterSubscribe', () => {
  it('classifies an unlabelled lead as a buyer, so the digest sees them', () => {
    expect(classificationAfterSubscribe(null)).toBe('Buyer');
    expect(classificationAfterSubscribe(undefined)).toBe('Buyer');
    expect(classificationAfterSubscribe('Others')).toBe('Buyer');
  });

  it('makes an owner both rather than stop being an owner', () => {
    expect(classificationAfterSubscribe('Owner')).toBe('Owner & Buyer');
    expect(classificationAfterSubscribe('Seller')).toBe('Owner & Buyer');
  });

  it('leaves an agent or developer as they are — the digest covers both', () => {
    expect(classificationAfterSubscribe('Agent')).toBeNull();
    expect(classificationAfterSubscribe('Developer')).toBeNull();
  });

  it('never overwrites a role that already covers buying', () => {
    expect(classificationAfterSubscribe('Buyer')).toBeNull();
    expect(classificationAfterSubscribe('Owner & Buyer')).toBeNull();
    expect(classificationAfterSubscribe('Agent')).toBeNull();
    expect(classificationAfterSubscribe('Developer')).toBeNull();
  });
});
