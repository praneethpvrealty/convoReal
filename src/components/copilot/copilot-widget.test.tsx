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
  beforeEach(() => {
    openPanel.mockClear();
    window.localStorage.clear();
  });
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

  it('[CPL-001] drags the launcher to an edge without opening the panel and remembers it', () => {
    render(<CopilotWidget />);
    const launcher = screen.getByRole('button', { name: 'Open the helper' });

    fireEvent.pointerDown(launcher, { button: 0, clientX: 600, clientY: 600 });
    fireEvent.pointerMove(launcher, { clientX: 300, clientY: 400 });
    fireEvent.pointerUp(launcher, { clientX: 300, clientY: 400 });
    fireEvent.click(launcher);

    expect(openPanel).not.toHaveBeenCalled();
    const saved = JSON.parse(
      window.localStorage.getItem('copilot-launcher-placement') ?? 'null'
    );
    expect(saved?.side).toBe('left');
    expect(launcher.style.left).toBe('16px');

    fireEvent.pointerDown(launcher, { button: 0, clientX: 20, clientY: 400 });
    fireEvent.pointerUp(launcher, { clientX: 21, clientY: 400 });
    fireEvent.click(launcher);
    expect(openPanel).toHaveBeenCalledOnce();
  });

  it('[CPL-001] pulls a position saved in a taller window back on screen', () => {
    window.localStorage.setItem(
      'copilot-launcher-placement',
      JSON.stringify({ side: 'right', bottom: 5000 })
    );
    render(<CopilotWidget />);
    const launcher = screen.getByRole('button', { name: 'Open the helper' });

    expect(launcher.style.bottom).toBe(`${window.innerHeight - 80 - 48}px`);
    expect(launcher.style.right).toBe('16px');
  });
});
