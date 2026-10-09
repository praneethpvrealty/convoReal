import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isEngineControlReplyId } from '@/lib/whatsapp/control-reply-ids';
import {
  CONSENT_APPROVE_PREFIX,
  CONSENT_DECLINE_PREFIX,
  OWNER_APPROVE_PREFIX,
  OWNER_REJECT_PREFIX,
} from '@/lib/inventory/location-requests';
import {
  FOLLOWUP_CHECKIN_PREFIX,
  FOLLOWUP_COLD_PREFIX,
  FOLLOWUP_SNOOZE_PREFIX,
} from '@/lib/contacts/follow-up-nudges';
import {
  CLOSING_ADVANCE_PREFIX,
  CLOSING_ASK_PREFIX,
  CLOSING_SNOOZE_PREFIX,
} from '@/lib/journey/closing-nudges';
import { AGENT_MESSAGE_CONTACT_PREFIX } from '@/lib/calendar/agent-reminder-actions';
import {
  DOCUMENT_APPROVE_PREFIX,
  DOCUMENT_REJECT_PREFIX,
} from '@/lib/inventory/document-requests';

describe('isEngineControlReplyId', () => {
  // Regression: tapping Approve on an owner-queue ping was relayed into
  // a lead thread by the reply bridge, and the approval never ran.
  it('claims every owner and consent decision button', () => {
    for (const prefix of [
      OWNER_APPROVE_PREFIX,
      OWNER_REJECT_PREFIX,
      CONSENT_APPROVE_PREFIX,
      CONSENT_DECLINE_PREFIX,
      DOCUMENT_APPROVE_PREFIX,
      DOCUMENT_REJECT_PREFIX,
    ]) {
      expect(
        isEngineControlReplyId(`${prefix}3f2c8a1e-4b6d-4f0a-9c2e-8d7b6a5f4e3d`),
        prefix
      ).toBe(true);
    }
  });

  it('claims every follow-up radar button', () => {
    for (const prefix of [
      FOLLOWUP_CHECKIN_PREFIX,
      FOLLOWUP_SNOOZE_PREFIX,
      FOLLOWUP_COLD_PREFIX,
    ]) {
      expect(
        isEngineControlReplyId(`${prefix}3f2c8a1e-4b6d-4f0a-9c2e-8d7b6a5f4e3d`),
        prefix
      ).toBe(true);
    }
  });

  it('[JRN-022] claims every closing card button', () => {
    for (const prefix of [
      CLOSING_ADVANCE_PREFIX,
      CLOSING_ASK_PREFIX,
      CLOSING_SNOOZE_PREFIX,
    ]) {
      expect(
        isEngineControlReplyId(`${prefix}3f2c8a1e-4b6d-4f0a-9c2e-8d7b6a5f4e3d`),
        prefix
      ).toBe(true);
    }
  });

  // The control dispatch only runs for a registered id, so a card wired
  // into it but missing here never reaches its handler: the approvals,
  // the enquiry card and the closing card each shipped that way. Every
  // button prefix a module exports to the dispatch must be registered.
  it('[JRN-022] claims every prefix the control dispatch imports', () => {
    const root = process.cwd();
    const dispatch = readFileSync(
      join(root, 'src/lib/whatsapp/inbound/chain/steps/control-reply.ts'),
      'utf8'
    );
    const modules = [...dispatch.matchAll(/from '@\/(lib\/[^']+)'/g)].map(
      (m) => `src/${m[1]}.ts`
    );
    const prefixes = modules.flatMap((file) => {
      let source: string;
      try {
        source = readFileSync(join(root, file), 'utf8');
      } catch {
        return [];
      }
      return [...source.matchAll(/export const (\w+_PREFIX) = '([^']+)'/g)].map(
        (m) => ({ name: m[1], value: m[2], file })
      );
    });
    expect(prefixes.length).toBeGreaterThan(10);
    for (const { name, value, file } of prefixes) {
      expect(isEngineControlReplyId(`${value}x`), `${name} in ${file}`).toBe(
        true
      );
    }
  });

  it('claims appointment contact message actions', () => {
    expect(
      isEngineControlReplyId(
        `${AGENT_MESSAGE_CONTACT_PREFIX}appointment-1:contact-1`
      )
    ).toBe(true);
  });

  it('leaves a genuine staff reply to the bridge', () => {
    expect(isEngineControlReplyId('Yes please, call them')).toBe(false);
    expect(isEngineControlReplyId('')).toBe(false);
    expect(isEngineControlReplyId('share_property_yes:abc')).toBe(false);
  });

  it('does not match a prefix appearing mid-string', () => {
    expect(isEngineControlReplyId(`re: ${OWNER_APPROVE_PREFIX}x`)).toBe(false);
  });
});
