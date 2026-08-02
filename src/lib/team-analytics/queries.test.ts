import { describe, expect, it } from 'vitest';
import {
  formatResponseSeconds,
  summarizeTeamAnalytics,
  type TeamAnalyticsRow,
} from './queries';

function row(overrides: Partial<TeamAnalyticsRow>): TeamAnalyticsRow {
  return {
    user_id: 'u1',
    full_name: 'Agent',
    org_role: 'org_agent',
    team_id: null,
    team_name: null,
    messages_sent: 0,
    open_conversations: 0,
    conversations_closed: 0,
    deals_won: 0,
    deals_won_value: 0,
    response_samples: 0,
    median_response_seconds: null,
    avg_response_seconds: null,
    ...overrides,
  };
}

describe('summarizeTeamAnalytics', () => {
  it('totals per-agent counters', () => {
    const summary = summarizeTeamAnalytics([
      row({
        user_id: 'a',
        messages_sent: 40,
        open_conversations: 3,
        conversations_closed: 5,
        deals_won: 2,
        deals_won_value: 150000,
      }),
      row({
        user_id: 'b',
        messages_sent: 10,
        open_conversations: 1,
        conversations_closed: 2,
        deals_won: 1,
        deals_won_value: 50000,
      }),
    ]);

    expect(summary.agents).toBe(2);
    expect(summary.messagesSent).toBe(50);
    expect(summary.openConversations).toBe(4);
    expect(summary.conversationsClosed).toBe(7);
    expect(summary.dealsWon).toBe(3);
    expect(summary.dealsWonValue).toBe(200000);
  });

  it('weights the team average response time by sample count', () => {
    const summary = summarizeTeamAnalytics([
      row({ user_id: 'a', response_samples: 3, avg_response_seconds: 60 }),
      row({ user_id: 'b', response_samples: 1, avg_response_seconds: 300 }),
      row({ user_id: 'c', response_samples: 0, avg_response_seconds: null }),
    ]);

    expect(summary.responseSamples).toBe(4);
    expect(summary.avgResponseSeconds).toBe((3 * 60 + 1 * 300) / 4);
  });

  it('returns a null average with no samples', () => {
    const summary = summarizeTeamAnalytics([row({ user_id: 'a' })]);
    expect(summary.avgResponseSeconds).toBeNull();
    expect(summarizeTeamAnalytics([]).agents).toBe(0);
  });
});

describe('formatResponseSeconds', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatResponseSeconds(null)).toBe('—');
    expect(formatResponseSeconds(42)).toBe('42s');
    expect(formatResponseSeconds(90)).toBe('1.5m');
    expect(formatResponseSeconds(5400)).toBe('1.5h');
  });
});
