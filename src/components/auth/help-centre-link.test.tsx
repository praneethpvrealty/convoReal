// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { HelpCentreLink } from './help-centre-link';

describe('HelpCentreLink [CPL-005]', () => {
  afterEach(cleanup);

  it('links to the public Help Centre in a new tab', () => {
    render(<HelpCentreLink />);
    const link = screen.getByRole('link', { name: 'Help Centre' });
    expect(link.getAttribute('href')).toBe('/help');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(screen.getByText(/Need help\?/)).toBeTruthy();
  });
});
