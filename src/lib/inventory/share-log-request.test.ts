import { describe, expect, it } from 'vitest';

import {
  SHARE_LOG_ATTEMPTS,
  postShareLog,
  type ShareLogResponse,
} from './share-log-request';

function scripted(steps: Array<ShareLogResponse | Error | null>): {
  post: (body: string) => Promise<ShareLogResponse | null>;
  sent: string[][];
} {
  const sent: string[][] = [];
  let i = 0;
  return {
    sent,
    post: async (body) => {
      sent.push(
        (
          JSON.parse(body) as { recipients: Array<{ contact_id: string }> }
        ).recipients.map((r) => r.contact_id)
      );
      const step = steps[Math.min(i++, steps.length - 1)];
      if (step instanceof Error) throw step;
      return step;
    },
  };
}

const payload = {
  property_id: 'p-1',
  recipients: [{ contact_id: 'c-1' }, { contact_id: 'c-2' }],
  channel: 'whatsapp' as const,
};

describe('[JRN-021] postShareLog', () => {
  it('is complete when every recipient was recorded, in one request', async () => {
    const { post, sent } = scripted([{ data: { recorded: 2, failed: [] } }]);
    expect(await postShareLog(post, payload)).toEqual({
      recorded: 2,
      complete: true,
      error: null,
    });
    expect(sent).toEqual([['c-1', 'c-2']]);
  });

  it('retries only the recipients the server reported as failed', async () => {
    const { post, sent } = scripted([
      { data: { recorded: 1, failed: ['c-2'] } },
      { data: { recorded: 1, failed: [] } },
    ]);
    expect(await postShareLog(post, payload)).toEqual({
      recorded: 2,
      complete: true,
      error: null,
    });
    expect(sent).toEqual([['c-1', 'c-2'], ['c-2']]);
  });

  it('treats a 200 with a short recorded count as unrecorded once retries run out', async () => {
    const { post, sent } = scripted([
      { data: { recorded: 1, failed: ['c-2'] } },
      { data: { recorded: 0, failed: ['c-2'] } },
    ]);
    const outcome = await postShareLog(post, payload);
    expect(outcome.complete).toBe(false);
    expect(outcome.recorded).toBe(1);
    expect(outcome.error).toBe('1 of 2 shares could not be recorded');
    expect(sent).toHaveLength(SHARE_LOG_ATTEMPTS);
  });

  it('does not retry a short count the server gave no failed recipient for', async () => {
    const { post, sent } = scripted([{ data: { recorded: 1 } }]);
    const outcome = await postShareLog(post, payload);
    expect(outcome.complete).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it('retries a transport failure and succeeds when a later attempt lands', async () => {
    const { post, sent } = scripted([
      new Error('Network request failed'),
      { data: { recorded: 2, failed: [] } },
    ]);
    expect((await postShareLog(post, payload)).complete).toBe(true);
    expect(sent).toHaveLength(2);
  });

  it('gives up at once on a refusal and reports its message', async () => {
    const { post, sent } = scripted([
      Object.assign(new Error('Forbidden'), { status: 403 }),
    ]);
    expect(await postShareLog(post, payload)).toEqual({
      recorded: 0,
      complete: false,
      error: 'Forbidden',
    });
    expect(sent).toHaveLength(1);
  });

  it('sends each contact once', async () => {
    const { post, sent } = scripted([{ data: { recorded: 1, failed: [] } }]);
    const outcome = await postShareLog(post, {
      ...payload,
      recipients: [{ contact_id: 'c-1' }, { contact_id: 'c-1' }],
    });
    expect(outcome.complete).toBe(true);
    expect(sent).toEqual([['c-1']]);
  });
});
