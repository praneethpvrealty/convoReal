import { describe, expect, it } from 'vitest';

import {
  buildPortfolioAccessParams,
  buildPortfolioAccessTemplatePayload,
  PORTFOLIO_ACCESS_TEMPLATE_NAME,
  portfolioAccessButtonSuffix,
} from './portfolio-access-template';
import { validateTemplatePayload } from './template-validators';

describe('portfolio access template', () => {
  it('[CTM-011] is a valid Utility template whose one button opens the sign-in path', () => {
    const payload = buildPortfolioAccessTemplatePayload(
      'https://www.convoreal.com/'
    );

    expect(() => validateTemplatePayload(payload)).not.toThrow();
    expect(payload.name).toBe(PORTFOLIO_ACCESS_TEMPLATE_NAME);
    expect(payload.category).toBe('Utility');
    expect(payload.buttons).toEqual([
      {
        type: 'URL',
        text: 'Sign in to Portfolio',
        url: 'https://www.convoreal.com/{{1}}',
        example: 'buyer/login',
      },
    ]);
  });

  it('[CTM-011] reads as an account notice with no promotional wording', () => {
    const payload = buildPortfolioAccessTemplatePayload('https://x.test');
    const rendered = [
      payload.body_text,
      ...(payload.buttons ?? []).map((button) => button.text),
    ]
      .join(' ')
      .toLowerCase();

    expect(rendered).toContain('account notice');
    expect(rendered).toContain('one-time code');
    expect(rendered).not.toMatch(
      /deal|offer|discount|exclusive|subscribe|stop|listing|new!/
    );
  });

  it('[CTM-011] fills the button with the buyer or owner sign-in path', () => {
    expect(
      portfolioAccessButtonSuffix('https://www.convoreal.com/buyer/login')
    ).toBe('buyer/login');
    expect(
      portfolioAccessButtonSuffix('https://www.convoreal.com/den/login')
    ).toBe('den/login');
  });

  it('builds safe name and brokerage parameters', () => {
    expect(
      buildPortfolioAccessParams('Lakshmi Narayan', 'Aryavarta Ventures')
    ).toEqual(['Lakshmi', 'Aryavarta Ventures']);
    expect(buildPortfolioAccessParams('Housing Lead', null)[0]).toBe('there');
  });
});
