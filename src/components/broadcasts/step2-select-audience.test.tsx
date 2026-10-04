// @vitest-environment happy-dom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import type { AudienceConfig } from '@/hooks/useBroadcastSending';
import { Step2SelectAudience } from './step2-select-audience';

vi.mock('@/hooks/useBroadcastSending', () => ({
  useAudienceCount: () => ({
    data: undefined,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => {
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'order', 'eq']) {
        builder[method] = () => builder;
      }
      builder.then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: [], error: null });
      return builder;
    },
  }),
}));

function Harness() {
  const [audience, setAudience] = useState<AudienceConfig | null>(null);
  return (
    <Step2SelectAudience
      audience={audience}
      onUpdate={setAudience}
      onNext={() => {}}
      onBack={() => {}}
    />
  );
}

afterEach(cleanup);

describe('Step2SelectAudience CSV upload', () => {
  it('keeps the pasted numbers when CSV is chosen again after another audience', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /Upload CSV/ }));
    fireEvent.change(screen.getByLabelText('Paste phone numbers'), {
      target: { value: '9876543210,"Patel, Asha"\n9876543211' },
    });
    expect(screen.getByText(/2 valid, 0/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /All Contacts/ }));
    fireEvent.click(screen.getByRole('button', { name: /Upload CSV/ }));

    expect(
      (screen.getByLabelText('Paste phone numbers') as HTMLTextAreaElement)
        .value
    ).toBe('9876543210,"Patel, Asha"\n9876543211');
    expect(screen.getByText(/2 valid, 0/)).toBeTruthy();
  });
});
