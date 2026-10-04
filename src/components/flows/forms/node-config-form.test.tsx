// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { FlowEditorProvider, initialBuilderNodes } from '../flow-editor-state';
import { NodeConfigForm } from './node-config-form';
import type { FlowNodeRow, FlowRow } from '@/lib/flows/types';

const createClient = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/client', () => ({ createClient }));
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
  trigger_type: 'manual',
  trigger_config: {},
  entry_node_id: 'media',
} as unknown as FlowRow;

const rows = [
  {
    id: 'media',
    flow_id: 'f1',
    node_key: 'media',
    node_type: 'send_media',
    config: { media_type: 'image' },
    position_x: 0,
    position_y: 0,
    created_at: '2026-10-01T00:00:00Z',
  } as FlowNodeRow,
];

afterEach(() => {
  cleanup();
  createClient.mockReset();
});

describe('SendMediaForm', () => {
  it('uploads nothing for a read-only member', () => {
    const [node] = initialBuilderNodes(rows);
    const { container } = render(
      <FlowEditorProvider initialFlow={flow} initialNodes={rows} readOnly>
        <NodeConfigForm
          node={node}
          allNodes={[node]}
          showAdvanced={false}
          onUpdateConfig={() => {}}
        />
      </FlowEditorProvider>
    );
    const input = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });

    fireEvent.change(input, { target: { files: [file] } });

    expect(createClient).not.toHaveBeenCalled();
  });
});
