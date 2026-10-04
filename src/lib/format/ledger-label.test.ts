import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FEATURE_LABELS, ledgerLabel } from './ledger-label';
import { AI_FEATURE_COSTS, DEN_FEATURE_COSTS } from '@/lib/credits/types';

describe('ledgerLabel [CRD-001]', () => {
  it('names the feature on a refund instead of showing its marker', () => {
    expect(
      ledgerLabel({
        type: 'refund',
        ai_feature: 'image_enhance',
        description: 'refund:4b0c095d-dc98-437e-9ad3-81144f1963fc',
      })
    ).toBe('Refund — Photo enhancement');
  });

  it('names the feature on a charge instead of its key or "<feature> burn"', () => {
    expect(
      ledgerLabel({
        type: 'ai_burn',
        ai_feature: 'chatbot_classify',
        description: 'chatbot_classify burn',
      })
    ).toBe('Chatbot message triage');
    expect(
      ledgerLabel({
        type: 'ai_burn',
        ai_feature: 'conversation_sweep_thread',
        description: 'retry:conversation_sweep_thread:6c1e',
      })
    ).toBe('Daily conversation review');
  });

  it('names the feature on a refund the fallback path wrote as "<feature> refund"', () => {
    expect(
      ledgerLabel({
        type: 'refund',
        ai_feature: 'property_description',
        description: 'property_description refund',
      })
    ).toBe('Refund — Property description');
  });

  it('keeps a description a person wrote', () => {
    expect(
      ledgerLabel({
        type: 'refund',
        ai_feature: 'greetings_generate',
        description:
          'Manual refund for two failed greeting card attempts on 2026-09-14',
      })
    ).toBe('Manual refund for two failed greeting card attempts on 2026-09-14');
    expect(
      ledgerLabel({
        type: 'purchase',
        ai_feature: null,
        description: 'Top-up: 1,000 credits',
      })
    ).toBe('Top-up: 1,000 credits');
  });

  it('falls back to a readable name when the feature or description is missing', () => {
    expect(
      ledgerLabel({ type: 'refund', ai_feature: null, description: 'refund:x' })
    ).toBe('Refund');
    expect(
      ledgerLabel({ type: 'ai_burn', ai_feature: null, description: null })
    ).toBe('AI usage');
    expect(
      ledgerLabel({
        type: 'ai_burn',
        ai_feature: 'brand_new_feature',
        description: 'brand_new_feature burn',
      })
    ).toBe('Brand new feature');
    expect(ledgerLabel({ type: 'subscription_grant' })).toBe(
      'Subscription grant'
    );
  });

  it('labels every billable feature, so none shows its key', () => {
    for (const feature of [
      ...Object.keys(AI_FEATURE_COSTS),
      ...Object.keys(DEN_FEATURE_COSTS),
    ]) {
      expect(FEATURE_LABELS[feature], feature).toBeTruthy();
      expect(FEATURE_LABELS[feature]).not.toContain('_');
    }
  });

  it('is the one label web and mobile both render', () => {
    const web = readFileSync(
      join(process.cwd(), 'src/components/settings/CreditLedger.tsx'),
      'utf8'
    );
    const mobile = readFileSync(
      join(process.cwd(), 'mobile/app/(app)/credits.tsx'),
      'utf8'
    );
    expect(web).toContain("from '@/lib/format/ledger-label'");
    expect(web).toContain('ledgerLabel(tx)');
    expect(mobile).toContain("from '@shared/lib/format/ledger-label'");
    expect(mobile).toContain('ledgerLabel(tx)');
  });
});
