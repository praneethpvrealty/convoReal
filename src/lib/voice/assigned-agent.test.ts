import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveAssignedAgent, assignedAgentCache } from './assigned-agent';

const resolveOwner = vi.hoisted(() => vi.fn());
vi.mock('@/lib/inventory/location-requests', () => ({
  resolveOwnerWhatsAppContact: resolveOwner,
}));

/** Minimal stand-in for the one profiles read the resolver makes. */
function admin(fullName: string | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: fullName === null ? null : { full_name: fullName },
          }),
        }),
      }),
    }),
  } as never;
}

beforeEach(() => resolveOwner.mockReset());

describe('resolveAssignedAgent', () => {
  it('pairs the profile name with the WhatsApp-reachable number', async () => {
    resolveOwner.mockResolvedValue({ contactId: 'c1', phone: '919876543210' });
    const agent = await resolveAssignedAgent(admin('Rahul Nair'), 'acc', 'u1');
    expect(agent).toEqual({ name: 'Rahul Nair', phone: '919876543210' });
  });

  it('is null for an unassigned contact, so no lookup is attempted', async () => {
    expect(await resolveAssignedAgent(admin('Rahul'), 'acc', null)).toBe(null);
    expect(resolveOwner).not.toHaveBeenCalled();
  });

  it('still hands off by name when the agent has no reachable number', async () => {
    resolveOwner.mockResolvedValue(null);
    const agent = await resolveAssignedAgent(admin('Rahul Nair'), 'acc', 'u1');
    expect(agent).toEqual({ name: 'Rahul Nair', phone: '' });
  });

  it('still offers a number when the profile has no name', async () => {
    resolveOwner.mockResolvedValue({ contactId: null, phone: '919876543210' });
    const agent = await resolveAssignedAgent(admin(null), 'acc', 'u1');
    expect(agent).toEqual({ name: '', phone: '919876543210' });
  });

  it('is null when there is neither a name nor a number to give', async () => {
    resolveOwner.mockResolvedValue(null);
    expect(await resolveAssignedAgent(admin(null), 'acc', 'u1')).toBe(null);
  });

  it('trims a padded name rather than speaking the padding', async () => {
    resolveOwner.mockResolvedValue({ contactId: null, phone: '91987' });
    const agent = await resolveAssignedAgent(admin('  Rahul  '), 'acc', 'u1');
    expect(agent?.name).toBe('Rahul');
  });
});

describe('assignedAgentCache', () => {
  it('looks a repeated agent up once per run', async () => {
    resolveOwner.mockResolvedValue({ contactId: null, phone: '919876543210' });
    const agentFor = assignedAgentCache(admin('Rahul'), 'acc');
    await agentFor('u1');
    await agentFor('u1');
    await agentFor('u1');
    expect(resolveOwner).toHaveBeenCalledTimes(1);
  });

  it('keeps distinct agents apart', async () => {
    resolveOwner.mockResolvedValue({ contactId: null, phone: '91987' });
    const agentFor = assignedAgentCache(admin('Rahul'), 'acc');
    await agentFor('u1');
    await agentFor('u2');
    expect(resolveOwner).toHaveBeenCalledTimes(2);
  });
});
