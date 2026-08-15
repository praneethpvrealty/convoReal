import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The dispatcher's call context is a contract with the voice provider,
// not an implementation detail: the agent can only echo `campaign_id`
// back in its post-call webhook if the dial passed it, and that echo is
// the only thing that resolves the recipient row
// (webhooks/voice-agent/route.ts). Ship a dial without it and every
// connected call stays 'calling' until the two-hour stale requeue
// redials it — the campaign never completes and the caller is rung
// again after a conversation that already went fine.
//
// The route is a cron handler over live Supabase and Redis with no
// executable test; this guards the one field whose absence is silent.

function dispatcherSource(): string {
  return readFileSync(
    join(process.cwd(), 'src/app/api/cron/voice-campaigns/route.ts'),
    'utf8'
  );
}

describe('voice campaign dispatcher call context', () => {
  it('passes campaign_id so the provider can echo it back', () => {
    const context = dispatcherSource().match(
      /context:\s*\{[\s\S]*?\},\n\s*\}\);/
    );
    expect(context, 'startOutboundCall context object not found').not.toBe(
      null
    );
    expect(context![0]).toContain('campaign_id: campaign.id');
  });

  it('names the contact, so the agent can greet them', () => {
    expect(dispatcherSource()).toContain('contact_name: contact.name');
  });

  // The documented agent prompt opens "You are calling on behalf of
  // {{brand_name}}". Drop the variable and every campaign call opens
  // with a blank where the brokerage should be — a cold caller that
  // cannot say who it is.
  it('names the brokerage the call is made for', () => {
    expect(dispatcherSource()).toContain('brand_name: brandNames.get(');
  });

  it('carries the agent to hand off to', () => {
    const source = dispatcherSource();
    expect(source).toContain('agent_name: agent?.name');
    expect(source).toContain('agent_phone: agent?.phone');
  });
});
