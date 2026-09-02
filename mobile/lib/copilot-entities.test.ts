import { describe, expect, it } from 'vitest';
import {
  activeCopilotEntityQuery,
  insertCopilotEntity,
  type CopilotEntityReference,
} from './copilot-entities';

const contact: CopilotEntityReference = {
  kind: 'contact',
  id: '22222222-2222-4222-8222-222222222222',
  label: 'Mr. Ramanathan',
};

describe('mobile Copilot entity composer', () => {
  it('detects and inserts a selected contact', () => {
    const active = activeCopilotEntityQuery('Open @Ram')!;
    expect(active.symbol).toBe('@');
    expect(insertCopilotEntity('Open @Ram', active, contact)).toBe(
      'Open @Mr. Ramanathan '
    );
  });

  it('keeps a selected token closed', () => {
    expect(
      activeCopilotEntityQuery('Open @Mr. Ramanathan ', [contact])
    ).toBeNull();
  });
});
