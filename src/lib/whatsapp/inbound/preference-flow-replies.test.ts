import { beforeEach, describe, expect, it, vi } from 'vitest';

const getPublishedPreferenceFlow = vi.fn();
const sendPreferenceFlowToContact = vi.fn();
const sendPreferenceTapReply = vi.fn();

vi.mock('@/lib/whatsapp/meta-flow-service', () => ({
  getPublishedPreferenceFlow: (...args: unknown[]) =>
    getPublishedPreferenceFlow(...args),
  sendPreferenceFlowToContact: (...args: unknown[]) =>
    sendPreferenceFlowToContact(...args),
  applyPreferenceFlowResponse: vi.fn(),
}));
vi.mock('@/lib/whatsapp/preference-tap-reply', () => ({
  sendPreferenceTapReply: (...args: unknown[]) =>
    sendPreferenceTapReply(...args),
}));
vi.mock('@/lib/whatsapp/preference-match-followup', () => ({
  sendPreferenceMatchFollowUp: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));

const { handlePreferenceFlowTrigger } =
  await import('./preference-flow-replies');

const trigger = () =>
  handlePreferenceFlowTrigger('acc-1', 'c1', 'u-owner', 'conv-1', 'wamid.1');

beforeEach(() => {
  vi.clearAllMocks();
  getPublishedPreferenceFlow.mockResolvedValue({ id: 'flow-1' });
  sendPreferenceFlowToContact.mockResolvedValue({ success: true });
});

describe('[CNV-013] handlePreferenceFlowTrigger', () => {
  it('hands the quoted message id to the tap reply and stops at the list that carries the form row', async () => {
    sendPreferenceTapReply.mockResolvedValue({
      matchCount: 0,
      replySent: true,
      formOffered: true,
    });

    expect(await trigger()).toBe(true);

    expect(sendPreferenceTapReply).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: 'c1', contextMessageId: 'wamid.1' })
    );
    expect(sendPreferenceFlowToContact).not.toHaveBeenCalled();
  });

  it('sends the form as the stand-in for a list that did not arrive, worded to follow the reply', async () => {
    sendPreferenceTapReply.mockResolvedValue({
      matchCount: 0,
      replySent: true,
      formOffered: false,
    });

    expect(await trigger()).toBe(true);

    expect(sendPreferenceFlowToContact).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: 'c1',
        bodyText:
          "Here's the quickest way to tell me what to try next — the full form takes under a minute.",
      })
    );
  });

  it('sends the form with its own wording when the reply itself never went', async () => {
    sendPreferenceTapReply.mockResolvedValue({
      matchCount: 0,
      replySent: false,
      formOffered: false,
    });

    expect(await trigger()).toBe(true);

    expect(sendPreferenceFlowToContact).toHaveBeenCalledWith(
      expect.objectContaining({ bodyText: undefined })
    );
  });

  it('stands down for an account with no published flow', async () => {
    getPublishedPreferenceFlow.mockResolvedValue(null);
    expect(await trigger()).toBe(false);
    expect(sendPreferenceTapReply).not.toHaveBeenCalled();
  });
});
