import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const daily = readFileSync(
  '.github/workflows/daily-ai-billing-smoke.yml',
  'utf8'
);
const releaseGate = readFileSync(
  '.github/workflows/release-gate-e2e.yml',
  'utf8'
);

describe('production AI smoke workflow configuration', () => {
  it.each([
    ['daily', daily],
    ['release gate', releaseGate],
  ])('uses public deployment values in the %s workflow', (_, workflow) => {
    expect(workflow).toContain('E2E_BASE_URL: https://www.convoreal.com');
    expect(workflow).toContain(
      'NEXT_PUBLIC_SUPABASE_URL: https://ucqzafsbckmkeumgpxtb.supabase.co'
    );
    expect(workflow).not.toContain('secrets.E2E_BASE_URL');
    expect(workflow).not.toContain('secrets.NEXT_PUBLIC_SUPABASE_URL');
    expect(workflow).not.toContain('secrets.AI_SMOKE_EMAIL');
    expect(workflow).not.toContain('secrets.AI_SMOKE_PHONE');
  });

  it('keeps the privileged credential in the protected environment', () => {
    for (const workflow of [daily, releaseGate]) {
      expect(workflow).toContain('environment: production-smoke');
      expect(workflow).toContain(
        'SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}'
      );
    }
  });

  it('runs after its workflow or smoke script changes on main', () => {
    expect(daily).toContain('branches: [main]');
    expect(daily).toContain("'e2e/daily-ai-billing-smoke.mjs'");
    expect(daily).toContain("'.github/workflows/daily-ai-billing-smoke.yml'");
  });
});
