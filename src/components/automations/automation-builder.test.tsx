// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AutomationBuilder, type BuilderInitial } from './automation-builder';

const auth = vi.hoisted(() => ({
  profileLoading: false,
  orgRole: 'org_agent' as string | null,
  isReadOnly: false,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => auth,
}));

const initial: BuilderInitial = {
  id: 'auto-1',
  name: 'Welcome new leads',
  description: '',
  trigger_type: 'first_inbound_message',
  trigger_config: {},
  is_active: true,
  steps: [
    {
      cid: 'step-1',
      step_type: 'send_message',
      step_config: { text: 'Hello there' },
    },
  ],
};

const fetchMock = vi.fn();

beforeEach(() => {
  auth.profileLoading = false;
  auth.orgRole = 'org_agent';
  auth.isReadOnly = false;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function openStep() {
  fireEvent.click(screen.getByText('Hello there'));
  return screen.getByDisplayValue('Hello there');
}

function lockedBy(field: HTMLElement) {
  return field.closest('fieldset')?.disabled ?? false;
}

describe('AutomationBuilder', () => {
  it('lets a member who can write edit, rearrange and save', () => {
    render(<AutomationBuilder initial={initial} />);

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(
      screen
        .getByPlaceholderText('Untitled automation')
        .hasAttribute('readonly')
    ).toBe(false);
    expect(screen.getAllByLabelText('Add step').length).toBeGreaterThan(0);

    expect(lockedBy(openStep())).toBe(false);
    expect(screen.getByRole('button', { name: /Delete/ })).toBeTruthy();
    expect(screen.getByLabelText('Move up')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/automations/auto-1',
      expect.objectContaining({ method: 'PATCH' })
    );
  });

  it('shows a read-only member the automation without anything they can change', () => {
    auth.isReadOnly = true;
    render(<AutomationBuilder initial={initial} />);

    expect(screen.getByRole('status').textContent).toContain('read-only');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(
      screen
        .getByPlaceholderText('Untitled automation')
        .hasAttribute('readonly')
    ).toBe(true);
    const active = screen.getByRole('switch', { name: 'Active' });
    expect(active.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(active);
    expect(active.getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByLabelText('Add step')).toBeNull();

    expect(lockedBy(openStep())).toBe(true);
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull();
    expect(screen.queryByLabelText('Move up')).toBeNull();
    expect(screen.queryByLabelText('Move down')).toBeNull();

    fireEvent.click(screen.getByText('Trigger'));
    expect(lockedBy(screen.getByRole('combobox'))).toBe(true);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stays locked until the member's access is known", () => {
    auth.profileLoading = true;
    auth.orgRole = null;
    const view = render(<AutomationBuilder initial={initial} />);

    expect(screen.getByRole('status').textContent).toContain('Checking');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByLabelText('Add step')).toBeNull();
    expect(lockedBy(openStep())).toBe(true);
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull();

    auth.profileLoading = false;
    auth.orgRole = 'org_agent';
    view.rerender(<AutomationBuilder initial={initial} />);

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(lockedBy(screen.getByDisplayValue('Hello there'))).toBe(false);
  });
});
