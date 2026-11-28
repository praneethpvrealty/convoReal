import { describe, expect, it, vi } from 'vitest';
import { resolveVerifiedUser } from './verified-user';

const getUserNever = () =>
  vi.fn(async () => {
    throw new Error('getUser must not be called');
  });

describe('resolveVerifiedUser', () => {
  it('[ACC-012] takes the user id from locally verified claims without asking GoTrue', async () => {
    const getUser = getUserNever();
    const result = await resolveVerifiedUser({
      getClaims: async () => ({
        data: { claims: { sub: 'user-1' } },
        error: null,
      }),
      getUser,
    });
    expect(result).toEqual({ userId: 'user-1', error: null });
    expect(getUser).not.toHaveBeenCalled();
  });

  it('[ACC-012] treats a token that fails verification as signed out, without a GoTrue fallback', async () => {
    const getUser = getUserNever();
    const invalid = Object.assign(new Error('Invalid JWT signature'), {
      code: 'invalid_jwt',
    });
    const result = await resolveVerifiedUser({
      getClaims: async () => ({ data: null, error: invalid }),
      getUser,
    });
    expect(result.userId).toBeNull();
    expect(result.error).toBe(invalid);
    expect(getUser).not.toHaveBeenCalled();
  });

  it('[ACC-012] treats a missing session and a token with no subject as signed out', async () => {
    const getUser = getUserNever();
    expect(
      await resolveVerifiedUser({
        getClaims: async () => ({ data: null, error: null }),
        getUser,
      })
    ).toEqual({ userId: null, error: null });
    expect(
      await resolveVerifiedUser({
        getClaims: async () => ({
          data: { claims: { sub: '' } },
          error: null,
        }),
        getUser,
      })
    ).toEqual({ userId: null, error: null });
    expect(getUser).not.toHaveBeenCalled();
  });

  it('[ACC-012] asks GoTrue when local verification cannot run', async () => {
    const getUser = vi.fn(async () => ({
      data: { user: { id: 'user-2' } },
      error: null,
    }));
    const result = await resolveVerifiedUser({
      getClaims: async () => {
        throw new Error('signing keys unreachable');
      },
      getUser,
    });
    expect(result).toEqual({ userId: 'user-2', error: null });
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it('[ACC-012] asks GoTrue when the signing keys cannot be fetched, which supabase-js returns as an error', async () => {
    const failures = [
      Object.assign(new Error('fetch failed'), {
        name: 'AuthRetryableFetchError',
        status: 0,
      }),
      Object.assign(new Error('upstream unavailable'), {
        name: 'AuthApiError',
        status: 503,
      }),
      Object.assign(new Error('unexpected'), { name: 'AuthUnknownError' }),
    ];
    for (const failure of failures) {
      const getUser = vi.fn(async () => ({
        data: { user: { id: 'user-3' } },
        error: null,
      }));
      const result = await resolveVerifiedUser({
        getClaims: async () => ({ data: null, error: failure }),
        getUser,
      });
      expect(result).toEqual({ userId: 'user-3', error: null });
      expect(getUser).toHaveBeenCalledTimes(1);
    }
  });

  it('[ACC-012] does not ask GoTrue about a dead refresh token or an expired token', async () => {
    const verdicts = [
      Object.assign(
        new Error('Invalid Refresh Token: Refresh Token Not Found'),
        {
          name: 'AuthApiError',
          status: 400,
          code: 'refresh_token_not_found',
        }
      ),
      Object.assign(new Error('JWT has expired'), {
        name: 'AuthInvalidJwtError',
        status: 400,
      }),
    ];
    for (const verdict of verdicts) {
      const getUser = getUserNever();
      const result = await resolveVerifiedUser({
        getClaims: async () => ({ data: null, error: verdict }),
        getUser,
      });
      expect(result).toEqual({ userId: null, error: verdict });
      expect(getUser).not.toHaveBeenCalled();
    }
  });

  it('[ACC-012] reports signed out when GoTrue refuses the fallback', async () => {
    const refused = new Error('no session');
    const result = await resolveVerifiedUser({
      getClaims: async () => {
        throw new Error('signing keys unreachable');
      },
      getUser: async () => ({ data: { user: null }, error: refused }),
    });
    expect(result).toEqual({ userId: null, error: refused });
  });
});
