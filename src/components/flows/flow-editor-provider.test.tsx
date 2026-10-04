// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import {
  FlowEditorProvider,
  initialBuilderNodes,
  savePayload,
  useFlowEditor,
  type FlowEditorContextValue,
} from './flow-editor-state';
import type { FlowNodeRow, FlowRow } from '@/lib/flows/types';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('sonner', () => ({ toast }));

const flow = {
  id: 'f1',
  account_id: 'acct-1',
  user_id: 'u1',
  name: 'Menu',
  description: null,
  status: 'draft',
  trigger_type: 'manual',
  trigger_config: {},
  entry_node_id: 'start',
} as unknown as FlowRow;

function nodeRow(over: Partial<FlowNodeRow>): FlowNodeRow {
  return {
    id: over.node_key ?? 'n',
    flow_id: 'f1',
    node_key: 'n',
    node_type: 'end',
    config: {},
    position_x: 0,
    position_y: 0,
    created_at: '2026-10-01T00:00:00Z',
    ...over,
  } as FlowNodeRow;
}

const rows = [
  nodeRow({
    node_key: 'start',
    node_type: 'start',
    config: { next_node_key: 'bye' },
  }),
  nodeRow({ node_key: 'bye', node_type: 'end' }),
];

function Probe({
  capture,
}: {
  capture: (value: FlowEditorContextValue) => void;
}) {
  capture(useFlowEditor());
  return null;
}

function mount(readOnly = false) {
  const editor = {} as { current: FlowEditorContextValue };
  render(
    <FlowEditorProvider
      initialFlow={flow}
      initialNodes={rows}
      readOnly={readOnly}
    >
      <Probe capture={(value) => (editor.current = value)} />
    </FlowEditorProvider>
  );
  return editor;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('initialBuilderNodes', () => {
  it('lays out a flow whose nodes all sit at the origin', () => {
    const nodes = initialBuilderNodes(rows);
    expect(nodes.find((n) => n.node_key === 'start')!.position_y).toBeLessThan(
      nodes.find((n) => n.node_key === 'bye')!.position_y!
    );
  });
});

describe('FlowEditorProvider', () => {
  it('starts clean even though the loaded nodes were laid out', () => {
    const editor = mount();
    expect(editor.current.dirty).toBe(false);
    expect(editor.current.canActivate).toBe(true);
  });

  it('[ACC-002] ignores every edit and action for a read-only member', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const editor = mount(true);
    expect(editor.current.readOnly).toBe(true);
    act(() => {
      editor.current.setState((s) => ({ ...s, name: 'Changed' }));
      editor.current.addNode('end');
      editor.current.removeNode('bye');
      editor.current.updateNodePosition('bye', 40, 40);
    });
    expect(editor.current.state.name).toBe('Menu');
    expect(editor.current.state.nodes).toHaveLength(2);
    expect(editor.current.dirty).toBe(false);
    await act(async () => {
      expect(await editor.current.save()).toBe(false);
      await editor.current.setStatus('active');
      await editor.current.deleteFlow();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps edits made while a save is in flight marked unsaved', async () => {
    let finish: (v: unknown) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const editor = mount();
    act(() => editor.current.setState((s) => ({ ...s, name: 'Menu 2' })));
    expect(editor.current.dirty).toBe(true);
    let saved: Promise<boolean> = Promise.resolve(false);
    act(() => {
      saved = editor.current.save();
    });
    act(() => editor.current.setState((s) => ({ ...s, name: 'Menu 3' })));
    await act(async () => {
      finish({ ok: true, json: async () => ({}) });
      expect(await saved).toBe(true);
    });
    expect(editor.current.dirty).toBe(true);
    act(() => editor.current.setState((s) => ({ ...s, name: 'Menu 2' })));
    expect(editor.current.dirty).toBe(false);
  });

  it('does not activate when the save before it fails', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'boom' }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const editor = mount();
    await act(async () => {
      await editor.current.setStatus('active');
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual([
      '/api/flows/f1',
      expect.objectContaining({ method: 'PUT' }),
    ]);
    expect(editor.current.state.status).toBe('draft');
    expect(toast.error).toHaveBeenCalledWith('boom');
  });

  it('says the flow was paused, not saved as a draft', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({}) }))
    );
    const editor = mount();
    await act(async () => {
      await editor.current.setStatus('draft');
    });
    expect(toast.success).toHaveBeenCalledWith('Flow paused.');
    expect(editor.current.dirty).toBe(false);
  });

  it('sends exactly the save payload in the PUT body', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);
    const editor = mount();
    await act(async () => {
      await editor.current.save();
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body))).toEqual(
      JSON.parse(JSON.stringify(savePayload(editor.current.state)))
    );
  });
});
