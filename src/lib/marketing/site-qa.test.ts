import { describe, expect, it } from 'vitest';
import { MARKETING_CONFIG } from '@/config/marketing';
import { PUBLIC_TOOLS } from '@/lib/marketing/public-tools';
import { answerFromSiteData, buildSiteContext } from './site-qa';

describe('answerFromSiteData', () => {
  it('answers pricing from the same config the pricing table renders', () => {
    const { answer, intent } = answerFromSiteData('how much does it cost?');
    expect(intent).toBe('pricing');
    for (const plan of MARKETING_CONFIG.pricing) {
      expect(answer).toContain(plan.name);
      expect(answer).toContain(plan.price);
    }
  });

  it('serves a specific FAQ over the generic intent match', () => {
    const domainFaq = MARKETING_CONFIG.faqs.find((f) => /domain/i.test(f.q));
    if (!domainFaq) return;
    const { answer, intent } = answerFromSiteData(
      'can I connect my own custom domain?'
    );
    expect(intent).toBe('faq');
    expect(answer).toBe(domainFaq.a);
  });

  it('explains what the product is', () => {
    const { answer, intent } = answerFromSiteData('what is ConvoReal?');
    expect(intent).toBe('overview');
    expect(answer).toContain(MARKETING_CONFIG.hero.subheadline);
  });

  it('lists features when asked what it does', () => {
    const { answer, intent } = answerFromSiteData(
      'what features are included?'
    );
    expect(intent).toBe('features');
    expect(answer).toContain(MARKETING_CONFIG.features[0].title);
  });

  it('leaves the long tail to the AI path', () => {
    expect(
      answerFromSiteData('do you integrate with Salesforce?').answer
    ).toBeNull();
    expect(answerFromSiteData('').answer).toBeNull();
  });
});

describe('buildSiteContext', () => {
  it('grounds the model in every plan, feature and FAQ', () => {
    const context = buildSiteContext();
    for (const plan of MARKETING_CONFIG.pricing)
      expect(context).toContain(plan.name);
    for (const feature of MARKETING_CONFIG.features)
      expect(context).toContain(feature.title);
    for (const faq of MARKETING_CONFIG.faqs) expect(context).toContain(faq.q);
  });

  it('[PUB-003] tells the model about every free public tool by URL', () => {
    const context = buildSiteContext();
    for (const tool of PUBLIC_TOOLS) {
      expect(context).toContain(tool.name);
      expect(context).toContain(tool.path);
    }
  });
});

describe('free tools on the landing page', () => {
  it('[PUB-003] lists guidance value and liaisons as features with FAQs the bot answers', () => {
    const titles = MARKETING_CONFIG.features.map((f) => f.title);
    expect(titles).toContain('Guidance Value Finder');
    expect(titles).toContain('Liaisons & Process Tracking');

    const guidance = answerFromSiteData(
      'how do I find the guidance value of a property?'
    );
    expect(guidance.intent).toBe('faq');
    expect(guidance.answer).toContain('/tools/guidance-value');

    const liaisons = answerFromSiteData(
      'what are liaisons and process guides?'
    );
    expect(liaisons.intent).toBe('faq');
    expect(liaisons.answer).toContain('/tools/property-process');
  });
});
