// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FlowEditorProvider } from './flow-editor-state';
import { FlowBuilder } from './flow-builder';
import type { FlowNodeRow, FlowRow } from '@/lib/flows/types';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const flow = {
  id: 'f1',
  account_id: 'acct-1',
  user_id: 'u1',
  name: 'Menu',
  description: null,
  status: 'draft',
  trigger_type: 'keyword',
  trigger_config: { keywords: ['hi'] },
  entry_node_id: 'start',
} as unknown as FlowRow;

const rows = [
  {
    id: 'start',
    flow_id: 'f1',
    node_key: 'start',
    node_type: 'start',
    config: { next_node_key: 'greet' },
    position_x: 0,
    position_y: 0,
    created_at: '2026-10-01T00:00:00Z',
  },
  {
    id: 'greet',
    flow_id: 'f1',
    node_key: 'greet',
    node_type: 'send_message',
    config: { text: 'Hello there' },
    position_x: 0,
    position_y: 0,
    created_at: '2026-10-01T00:00:00Z',
  },
] as FlowNodeRow[];

function mount(readOnly: boolean) {
  return render(
    <FlowEditorProvider
      initialFlow={flow}
      initialNodes={rows}
      readOnly={readOnly}
    >
      <FlowBuilder />
    </FlowEditorProvider>
  );
}

function isDisabled(el: Element | null) {
  if (!el) throw new Error('element not found');
  return (
    (el as HTMLInputElement).disabled === true ||
    el.closest('fieldset[disabled]') !== null
  );
}

afterEach(cleanup);

describe('FlowBuilder', () => {
  it('[ACC-002] lets a read-only member open and close every node but change nothing', () => {
    mount(true);

    const toggle = screen.getByRole('button', { name: /greet/ });
    expect(isDisabled(toggle)).toBe(false);
    expect(isDisabled(screen.getByDisplayValue('Hello there'))).toBe(true);
    fireEvent.click(toggle);
    expect(screen.queryByDisplayValue('Hello there')).toBeNull();
    fireEvent.click(toggle);
    expect(isDisabled(screen.getByDisplayValue('Hello there'))).toBe(true);

    expect(
      isDisabled(screen.getAllByRole('button', { name: /show advanced/i })[0])
    ).toBe(false);
    expect(isDisabled(screen.getByDisplayValue('hi'))).toBe(true);
    expect(screen.queryByRole('button', { name: /add node/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /remove node/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /set as entry/i })).toBeNull();
  });

  it('keeps every control enabled for a member who can make changes', () => {
    mount(false);

    expect(isDisabled(screen.getByDisplayValue('Hello there'))).toBe(false);
    expect(isDisabled(screen.getByDisplayValue('hi'))).toBe(false);
    expect(
      screen.getAllByRole('button', { name: /remove node/i }).length
    ).toBeGreaterThan(0);
  });
});
