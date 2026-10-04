// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import {
  AutomationBuilder,
  type BuilderInitial,
  type BuilderStep,
} from './automation-builder';

const push = vi.fn();
const replace = vi.fn();
const toastError = vi.fn();

const auth = vi.hoisted(() => ({
  profileLoading: false,
  orgRole: 'org_agent' as string | null,
  isReadOnly: false,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => auth,
}));

vi.mock('sonner', () => ({
  toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn() },
}));

vi.mock('./builder-pickers', () => {
  const Picker = ({
    value,
    onChange,
    label,
  }: {
    value: string;
    onChange: (v: string) => void;
    label: string;
  }) => (
    <input
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
  return {
    selectClass: () => '',
    TagSelect: (p: { value: string; onChange: (v: string) => void }) => (
      <Picker {...p} label="Tag" />
    ),
    MemberSelect: (p: { value: string; onChange: (v: string) => void }) => (
      <Picker {...p} label="Agent" />
    ),
    PipelineSelect: (p: { value: string; onChange: (v: string) => void }) => (
      <Picker {...p} label="Pipeline" />
    ),
    StageSelect: (p: { value: string; onChange: (v: string) => void }) => (
      <Picker {...p} label="Stage" />
    ),
    TemplateSelect: (p: {
      name: string;
      onChange: (v: { template_name: string; language: string }) => void;
    }) => (
      <Picker
        value={p.name}
        onChange={(v) => p.onChange({ template_name: v, language: 'en' })}
        label="Template"
      />
    ),
  };
});

const fetchMock = vi.fn();

beforeEach(() => {
  auth.profileLoading = false;
  auth.orgRole = 'org_agent';
  auth.isReadOnly = false;
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ automation: { id: 'a1' } }),
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  push.mockReset();
  toastError.mockReset();
});

function step(
  cid: string,
  step_type: BuilderStep['step_type'],
  step_config: Record<string, unknown>,
  branches?: BuilderStep['branches']
): BuilderStep {
  return { cid, step_type, step_config, branches };
}

function initial(over: Partial<BuilderInitial> = {}): BuilderInitial {
  return {
    id: 'a1',
    name: 'Greeter',
    description: '',
    trigger_type: 'new_message_received',
    trigger_config: {},
    is_active: false,
    steps: [step('s1', 'send_message', { text: 'hi' })],
    ...over,
  };
}

function sentBody() {
  const [, init] = fetchMock.mock.calls[0];
  return JSON.parse((init as RequestInit).body as string);
}

describe('AutomationBuilder', () => {
  it('labels the save button by the Active switch', () => {
    render(<AutomationBuilder initial={initial()} />);
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Active' }));
    expect(
      screen.getByRole('button', { name: 'Save & activate' })
    ).toBeTruthy();
  });

  it('confirms in plain words before activating, then saves', async () => {
    render(<AutomationBuilder initial={initial()} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Active' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save & activate' }));
    expect(
      await screen.findByText(
        'This will run for every incoming message from every contact.'
      )
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody().is_active).toBe(true);
  });

  it('does not re-confirm an automation that is already active', async () => {
    render(<AutomationBuilder initial={initial({ is_active: true })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save & activate' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it('shows activation problems on the step and in a summary', () => {
    render(
      <AutomationBuilder
        initial={initial({
          is_active: true,
          steps: [step('s1', 'add_tag', { tag_id: '' })],
        })}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save & activate' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('Fix 1 issue before activating');
    expect(screen.getByRole('alert').textContent).toContain(
      'Step 1: tag is required'
    );
    fireEvent.click(screen.getByText('Step 1: tag is required'));
    expect(screen.getByText('tag is required')).toBeTruthy();
  });

  it('edits the second step of a Yes branch', async () => {
    render(
      <AutomationBuilder
        initial={initial({
          steps: [
            step(
              'c',
              'condition',
              { subject: 'message_content', value: 'price' },
              {
                yes: [
                  step('y1', 'send_message', { text: 'first' }),
                  step('y2', 'send_message', { text: 'second' }),
                ],
                no: [],
              }
            ),
          ],
        })}
      />
    );
    fireEvent.click(screen.getByText('second'));
    fireEvent.change(screen.getByDisplayValue('second'), {
      target: { value: 'edited' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const yes = sentBody().steps[0].branches.yes;
    expect(yes.map((s: BuilderStep) => s.step_config.text)).toEqual([
      'first',
      'edited',
    ]);
  });

  it('keeps an unavailable trigger visible but not selectable', () => {
    render(
      <AutomationBuilder
        initial={initial({ trigger_type: 'tag_added', trigger_config: {} })}
      />
    );
    fireEvent.click(screen.getByText('Tag Added (not yet available)'));
    const select = screen.getByRole('combobox', {
      name: 'Trigger type',
    }) as HTMLSelectElement;
    const options = Array.from(select.options);
    expect(options.map((o) => o.textContent)).not.toContain('Time-Based');
    const dead = options.find((o) => o.value === 'tag_added');
    expect(dead?.disabled).toBe(true);
    expect(dead?.textContent).toBe('Tag Added (not yet available)');
  });

  it('asks before deleting a condition that has steps inside it', () => {
    render(
      <AutomationBuilder
        initial={initial({
          steps: [
            step(
              'c',
              'condition',
              { subject: 'tag_presence', operand: 't' },
              { yes: [step('y1', 'send_message', { text: 'x' })], no: [] }
            ),
          ],
        })}
      />
    );
    fireEvent.click(screen.getByText('Contact has tag'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    expect(screen.getByText('Delete this condition?')).toBeTruthy();
  });

  it('lets a wait amount be cleared and retyped, clamping on blur', () => {
    render(
      <AutomationBuilder
        initial={initial({
          steps: [step('w', 'wait', { amount: 1, unit: 'hours' })],
        })}
      />
    );
    fireEvent.click(screen.getByText('1 hours'));
    const amount = screen.getByDisplayValue('1');
    fireEvent.change(amount, { target: { value: '' } });
    fireEvent.change(amount, { target: { value: '10' } });
    expect((amount as HTMLInputElement).value).toBe('10');
    fireEvent.change(amount, { target: { value: '0' } });
    fireEvent.blur(amount);
    expect((amount as HTMLInputElement).value).toBe('1');
  });

  it('asks before leaving with unsaved changes', () => {
    render(<AutomationBuilder initial={initial()} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Back to automations' })
    );
    expect(push).toHaveBeenCalledWith('/automations');
    push.mockReset();
    fireEvent.change(screen.getByDisplayValue('Greeter'), {
      target: { value: 'Renamed' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Back to automations' })
    );
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByText('Discard unsaved changes?')).toBeTruthy();
  });
});

describe('AutomationBuilder access', () => {
  const activeAutomation = initial({
    id: 'auto-1',
    name: 'Welcome new leads',
    trigger_type: 'first_inbound_message',
    is_active: true,
    steps: [step('step-1', 'send_message', { text: 'Hello there' })],
  });

  function openStep() {
    fireEvent.click(screen.getByText('Hello there'));
    return screen.getByDisplayValue('Hello there');
  }

  function lockedBy(field: HTMLElement) {
    return field.closest('fieldset')?.disabled ?? false;
  }

  it('lets a member who can write edit, rearrange and save', async () => {
    render(<AutomationBuilder initial={activeAutomation} />);

    expect(screen.queryByRole('status')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Save & activate' })
    ).toBeTruthy();
    expect(
      screen
        .getByPlaceholderText('Untitled automation')
        .hasAttribute('readonly')
    ).toBe(false);
    expect(screen.getAllByLabelText('Add step').length).toBeGreaterThan(0);

    expect(lockedBy(openStep())).toBe(false);
    expect(screen.getByRole('button', { name: /Delete/ })).toBeTruthy();
    expect(screen.getByLabelText('Move up')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save & activate' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/automations/auto-1',
        expect.objectContaining({ method: 'PATCH' })
      )
    );
  });

  it('shows a read-only member the automation without anything they can change', () => {
    auth.isReadOnly = true;
    render(<AutomationBuilder initial={activeAutomation} />);

    expect(screen.getByRole('status').textContent).toContain('read-only');
    expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull();
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
    const view = render(<AutomationBuilder initial={activeAutomation} />);

    expect(screen.getByRole('status').textContent).toContain('Checking');
    expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull();
    expect(screen.queryByLabelText('Add step')).toBeNull();
    expect(lockedBy(openStep())).toBe(true);
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull();

    auth.profileLoading = false;
    auth.orgRole = 'org_agent';
    view.rerender(<AutomationBuilder initial={activeAutomation} />);

    expect(screen.queryByRole('status')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Save & activate' })
    ).toBeTruthy();
    expect(lockedBy(screen.getByDisplayValue('Hello there'))).toBe(false);
  });
});
