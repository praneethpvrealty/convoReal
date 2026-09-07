import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openCopilotDesktopWeb } from './copilot-links';

const { openBrowserAsync } = vi.hoisted(() => ({ openBrowserAsync: vi.fn() }));

vi.mock('expo-web-browser', () => ({ openBrowserAsync }));

describe('openCopilotDesktopWeb', () => {
  beforeEach(() => openBrowserAsync.mockReset().mockResolvedValue({ type: 'opened' }));

  it('opens a desktop-only route in an external browser surface', async () => {
    await openCopilotDesktopWeb('https://www.convoreal.com/settings');

    expect(openBrowserAsync).toHaveBeenCalledWith(
      'https://www.convoreal.com/settings'
    );
  });

  it('uses the dashboard origin when the answer has no route', async () => {
    await openCopilotDesktopWeb();

    expect(openBrowserAsync).toHaveBeenCalledWith('https://www.convoreal.com');
  });
});
