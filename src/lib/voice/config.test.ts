import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isVoiceMode,
  resolveDialCredentials,
  type VoiceAgentConfig,
} from './config';

const identity = (s: string) => `decrypted:${s}`;

function config(overrides: Partial<VoiceAgentConfig> = {}): VoiceAgentConfig {
  return {
    account_id: 'acc-1',
    mode: 'dedicated',
    provider: null,
    api_key_encrypted: null,
    agent_ref: 'agent-own',
    phone_number: null,
    webhook_token: 'tok',
    is_active: true,
    reminder_calls_enabled: false,
    reminder_audio_enabled: false,
    ...overrides,
  };
}

describe('isVoiceMode', () => {
  it('accepts the three modes and nothing else', () => {
    expect(isVoiceMode('shared')).toBe(true);
    expect(isVoiceMode('dedicated')).toBe(true);
    expect(isVoiceMode('byo')).toBe(true);
    expect(isVoiceMode('platform')).toBe(false);
    expect(isVoiceMode(null)).toBe(false);
  });
});

describe('resolveDialCredentials — shared', () => {
  beforeEach(() => {
    process.env.VOICE_SHARED_AGENT_ID = 'agent-pool';
  });
  afterEach(() => {
    delete process.env.VOICE_SHARED_AGENT_ID;
  });

  it('dials the platform pool with platform credentials', () => {
    const res = resolveDialCredentials(
      config({ mode: 'shared' }),
      null,
      identity
    );
    expect(res).toEqual({
      ok: true,
      agentId: 'agent-pool',
      apiKey: null,
      provider: null,
      mode: 'shared',
    });
  });

  it('is the default for an account with no config row', () => {
    const res = resolveDialCredentials(null, null, identity);
    expect(res.ok && res.agentId).toBe('agent-pool');
  });

  it('never lets a campaign point the pool at a private agent', () => {
    const res = resolveDialCredentials(
      config({ mode: 'shared' }),
      'agent-private',
      identity
    );
    expect(res.ok && res.agentId).toBe('agent-pool');
  });

  it('fails clearly when the deployment has no pool agent', () => {
    delete process.env.VOICE_SHARED_AGENT_ID;
    const res = resolveDialCredentials(
      config({ mode: 'shared' }),
      null,
      identity
    );
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toContain('VOICE_SHARED_AGENT_ID');
  });
});

describe('resolveDialCredentials — dedicated', () => {
  it('uses the account agent with platform credentials', () => {
    const res = resolveDialCredentials(config(), null, identity);
    expect(res).toEqual({
      ok: true,
      agentId: 'agent-own',
      apiKey: null,
      provider: null,
      mode: 'dedicated',
    });
  });

  it('lets a campaign override the account default', () => {
    const res = resolveDialCredentials(config(), 'agent-campaign', identity);
    expect(res.ok && res.agentId).toBe('agent-campaign');
  });

  it('fails when no agent is named anywhere', () => {
    const res = resolveDialCredentials(
      config({ agent_ref: null }),
      null,
      identity
    );
    expect(res.ok).toBe(false);
  });
});

describe('resolveDialCredentials — byo', () => {
  it('decrypts the account key and carries its provider', () => {
    const res = resolveDialCredentials(
      config({ mode: 'byo', api_key_encrypted: 'cipher', provider: 'custom' }),
      null,
      identity
    );
    expect(res).toEqual({
      ok: true,
      agentId: 'agent-own',
      apiKey: 'decrypted:cipher',
      provider: 'custom',
      mode: 'byo',
    });
  });

  it('refuses to fall back to platform credentials with no key stored', () => {
    const res = resolveDialCredentials(config({ mode: 'byo' }), null, identity);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toContain('no provider API key');
  });

  it('reports an unreadable key instead of throwing', () => {
    const res = resolveDialCredentials(
      config({ mode: 'byo', api_key_encrypted: 'corrupt' }),
      null,
      () => {
        throw new Error('bad key');
      }
    );
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toContain('could not be read');
  });
});
