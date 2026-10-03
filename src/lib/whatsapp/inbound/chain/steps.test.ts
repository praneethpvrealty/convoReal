import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  inboundStepFiles,
  inboundStepOrder,
  inboundStepSource,
} from './test-source';

const EXPECTED_ORDER = [
  'controlReply',
  'enquiryDropoffReason',
  'enquiryReviewReply',
  'bridgedAgentReply',
  'autoHeat',
  'inventorySelection',
  'specificPropertyInterest',
  'deliberateEnquiry',
  'leadPing',
  'broadcastReplyFlag',
  'reminderButton',
  'preferenceFormReply',
  'ownerDigestCommand',
  'timelineTemplateTap',
  'purchaseProgressTap',
  'listingFeedbackTap',
  'stillConsideringTap',
  'closeEnquiryTap',
  'buyerAlertsCommand',
  'buyerMatchesCommand',
  'templateQuickReply',
  'listingVerification',
  'requirementReply',
  'ownerChatbot',
  'leadConversation',
  'sharedContacts',
  'calendarQuery',
  'updateSessionInput',
  'listingFeedbackList',
  'requirementTweak',
  'onboardingRungTap',
  'preferenceFlowRequest',
  'updateIntent',
  'interactiveReplyDispatch',
  'ownerListings',
  'agentHandling',
  'flowDispatch',
  'agentInventoryRequest',
  'ownerInbound',
  'leadQuestion',
  'automations',
];

describe('[INB-016] the inbound chain is an ordered list of steps', () => {
  it('runs the steps in the order the chain always had', () => {
    expect(inboundStepOrder()).toEqual(EXPECTED_ORDER);
  });

  it('lists every step file exactly once', () => {
    const files = readdirSync(
      join(process.cwd(), 'src/lib/whatsapp/inbound/chain/steps')
    )
      .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
      .map((f) => `src/lib/whatsapp/inbound/chain/steps/${f}`)
      .sort();
    expect([...inboundStepFiles()].sort()).toEqual(files);
  });

  it('every step reports handled or continue and nothing else', () => {
    for (const file of inboundStepFiles()) {
      const step = file.slice(file.lastIndexOf('/') + 1, -3);
      const source = inboundStepSource(step);
      expect(source, step).toContain('): Promise<StepResult> {');
      expect(source, step).toMatch(/return 'continue';\n}\n$/);
      expect(source, step).not.toMatch(/\breturn;/);
    }
  });

  it('the shared state a step produces is read from the context, never recomputed', () => {
    for (const [producer, fields] of [
      ['owner-listings', ['ownedListings', 'isPropertyOwnerSender']],
      ['agent-handling', ['agentHandling']],
      ['flow-dispatch', ['inboundText', 'tappedHumanRequest', 'flowConsumed']],
    ] as const) {
      const source = inboundStepSource(producer);
      for (const field of fields) {
        expect(source, `${producer} sets ${field}`).toContain(
          `ctx.${field} = ${field};`
        );
      }
    }
    for (const consumer of ['owner-inbound', 'lead-question', 'automations']) {
      expect(inboundStepSource(consumer)).toMatch(/\bflowConsumed\b/);
      expect(inboundStepSource(consumer)).not.toContain(
        'dispatchInboundToFlows('
      );
    }
  });
});
