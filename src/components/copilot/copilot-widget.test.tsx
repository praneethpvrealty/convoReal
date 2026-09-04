// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CopilotWidget } from './copilot-widget';

const openPanel = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('./copilot-context', () => ({
  useCopilot: () => ({
    panelOpen: false,
    openPanel,
    tourStatus: 'idle',
    startTour: vi.fn(),
  }),
}));

vi.mock('@/hooks/useCopilotNudges', () => ({
  useCopilotNudges: () => ({
    nudge: null,
    dismiss: vi.fn(),
    accept: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-locale', () => ({
  useT: () => (key: string) =>
    key === 'copilot.assistant' ? 'AI Assistant' : 'Open the helper',
}));

vi.mock('./copilot-panel', () => ({
  CopilotPanel: () => null,
}));

describe('CopilotWidget', () => {
  beforeEach(() => openPanel.mockClear());
  afterEach(cleanup);

  it('renders a labelled launcher above the feedback control', () => {
    render(<CopilotWidget />);

    const launcher = screen.getByRole('button', { name: 'Open the helper' });
    expect(launcher.textContent).toContain('AI Assistant');
    expect(launcher.className).toContain('bottom-40');
    expect(launcher.className).toContain('md:bottom-16');
    expect(launcher.className).toContain('right-4');
    expect(launcher.className).not.toContain('bottom-5');
  });

  it('opens the existing Copilot panel', () => {
    render(<CopilotWidget />);

    fireEvent.click(screen.getByRole('button', { name: 'Open the helper' }));
    expect(openPanel).toHaveBeenCalledOnce();
  });
});
