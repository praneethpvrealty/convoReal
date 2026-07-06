import { describe, it, expect } from 'vitest';
import { resolveBillingFromPhone } from './currency';

describe('resolveBillingFromPhone', () => {
  it('routes Indian numbers to INR/razorpay', () => {
    expect(resolveBillingFromPhone('+919876543210')).toEqual({ currency: 'INR', gateway: 'razorpay' });
  });

  it('handles phone numbers without a leading +', () => {
    expect(resolveBillingFromPhone('919876543210')).toEqual({ currency: 'INR', gateway: 'razorpay' });
  });

  it('routes UAE numbers to AED/stripe without being shadowed by a shorter prefix', () => {
    expect(resolveBillingFromPhone('+971501234567')).toEqual({ currency: 'AED', gateway: 'stripe' });
  });

  it('routes US/Canada numbers to USD/stripe', () => {
    expect(resolveBillingFromPhone('+14155552671')).toEqual({ currency: 'USD', gateway: 'stripe' });
  });

  it('routes UK numbers to GBP/stripe', () => {
    expect(resolveBillingFromPhone('+447911123456')).toEqual({ currency: 'GBP', gateway: 'stripe' });
  });

  it('routes recognized EU country codes to EUR/stripe', () => {
    expect(resolveBillingFromPhone('+491512345678')).toEqual({ currency: 'EUR', gateway: 'stripe' });
  });

  it('defaults to INR/razorpay for unrecognized or missing phone numbers (India-first product)', () => {
    expect(resolveBillingFromPhone('+998901234567')).toEqual({ currency: 'INR', gateway: 'razorpay' });
    expect(resolveBillingFromPhone(null)).toEqual({ currency: 'INR', gateway: 'razorpay' });
    expect(resolveBillingFromPhone(undefined)).toEqual({ currency: 'INR', gateway: 'razorpay' });
  });
});
