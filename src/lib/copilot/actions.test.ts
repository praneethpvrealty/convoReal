import { describe, expect, it } from 'vitest';
import {
  buildCopilotActionProposal,
  readCopilotActionExecutionRequest,
  resolveCopilotAction,
} from './actions';

const event = {
  kind: 'event' as const,
  id: '11111111-1111-4111-8111-111111111111',
  label: 'JP Nagar property visit',
};
const property = {
  kind: 'property' as const,
  id: '22222222-2222-4222-8222-222222222222',
  label: 'JP Nagar Plot',
};
const secondProperty = {
  kind: 'property' as const,
  id: '44444444-4444-4444-8444-444444444444',
  label: 'Indiranagar Flat',
};
const contact = {
  kind: 'contact' as const,
  id: '55555555-5555-4555-8555-555555555555',
  label: 'Alice',
};
const actionId = '33333333-3333-4333-8333-333333333333';

describe('Copilot actions', () => {
  it('proposes completion only for one explicitly selected event', () => {
    const resolution = resolveCopilotAction(
      'Mark &JP Nagar property visit completed',
      [event]
    );
    expect(resolution).toMatchObject({
      kind: 'proposal',
      type: 'complete_event',
      entity: event,
    });
    if (!resolution || resolution.kind !== 'proposal') return;
    expect(buildCopilotActionProposal(resolution, actionId)).toMatchObject({
      id: actionId,
      type: 'complete_event',
      confirmLabel: 'Mark completed',
    });
  });

  it('recognizes a polite direct completion request', () => {
    expect(
      resolveCopilotAction(
        'Could you please complete &JP Nagar property visit?',
        [event]
      )
    ).toMatchObject({ kind: 'proposal', type: 'complete_event' });
  });

  it('hands a selected property to the share flow without sending', () => {
    const resolution = resolveCopilotAction('Open/share #JP Nagar Plot', [
      property,
    ]);
    expect(resolution?.kind).toBe('proposal');
    if (!resolution || resolution.kind !== 'proposal') return;
    const proposal = buildCopilotActionProposal(resolution, actionId);
    expect(proposal).toMatchObject({
      type: 'share_property',
      confirmLabel: 'Continue to share',
    });
    expect(proposal).toHaveProperty(
      'navigateTo',
      `/inventory?sharePropertyId=${property.id}&copilotAction=${actionId}`
    );
  });

  it('asks for a reference instead of guessing a record', () => {
    expect(resolveCopilotAction('Mark the visit completed', [])).toEqual({
      kind: 'guidance',
      reply:
        'Select one calendar event with &, then ask me to mark it completed.',
    });
    expect(
      resolveCopilotAction('Share these', [property, secondProperty])
    ).toEqual({
      kind: 'guidance',
      reply: 'Choose one property at a time so I open the right share flow.',
    });
  });

  it('does not turn instructional questions into mutations', () => {
    expect(
      resolveCopilotAction('How do I complete &JP Nagar property visit?', [
        event,
      ])
    ).toBeNull();
    expect(
      resolveCopilotAction('Show me how to share #JP Nagar Plot', [property])
    ).toBeNull();
  });

  it('does not turn status questions or negated commands into proposals', () => {
    expect(
      resolveCopilotAction('Was &JP Nagar property visit marked completed?', [
        event,
      ])
    ).toBeNull();
    expect(
      resolveCopilotAction("Don't mark &JP Nagar property visit completed", [
        event,
      ])
    ).toBeNull();
    expect(
      resolveCopilotAction('Who shared #JP Nagar Plot last?', [property])
    ).toBeNull();
  });

  it('leaves non-calendar completion requests to the normal help path', () => {
    expect(resolveCopilotAction('Complete my profile', [])).toBeNull();
    expect(
      resolveCopilotAction('Finish setting up #JP Nagar Plot', [property])
    ).toBeNull();
    expect(
      resolveCopilotAction('Finish setting up an appointment reminder', [])
    ).toBeNull();
    expect(
      resolveCopilotAction(
        'Finish setting up a reminder for &JP Nagar property visit',
        [event]
      )
    ).toBeNull();
    expect(resolveCopilotAction('Complete the calendar event', [])).toEqual({
      kind: 'guidance',
      reply:
        'Select one calendar event with &, then ask me to mark it completed.',
    });
  });

  it('does not treat generic sends for other entities as property shares', () => {
    expect(resolveCopilotAction('Send @Alice a message', [contact])).toBeNull();
    expect(
      resolveCopilotAction('Send the reminder for &JP Nagar property visit', [
        event,
      ])
    ).toBeNull();
    expect(resolveCopilotAction('Share the property', [])).toEqual({
      kind: 'guidance',
      reply: 'Select one property with #, then ask me to share it.',
    });
  });

  it('validates the execution payload', () => {
    expect(
      readCopilotActionExecutionRequest({
        actionId,
        type: 'complete_event',
        entityId: event.id,
        platform: 'mobile',
      })
    ).toEqual({
      actionId,
      type: 'complete_event',
      entityId: event.id,
      platform: 'mobile',
    });
    expect(
      readCopilotActionExecutionRequest({
        actionId: 'bad',
        type: 'complete_event',
        entityId: event.id,
        platform: 'web',
      })
    ).toHaveProperty('error');
  });
});
