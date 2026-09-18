import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEAL_FINANCIAL_FIELDS,
  INTERNAL_ONLY_DEAL_FIELDS,
  STAKEHOLDER_HIDDEN_DEAL_FIELDS,
  TOKEN_FIELDS,
  containsInternalDealField,
  derivedToken,
  parseFinancialsPatch,
  projectDealForExternal,
  tokenSourceFor,
} from './financials';

describe('[TXW-004] internal-only financial fields', () => {
  it('projectDealForExternal strips every internal field and keeps the rest', () => {
    const row = {
      id: 'd1',
      title: 'Adithi — Site #19',
      value: 16200000,
      agreed_consideration: 16200000,
      registered_consideration: 14000000,
      other_component: 2200000,
      token_amount: 500000,
      token_received_at: '2026-09-01',
      token_instrument_ref: 'UTR123',
      tds_status: 'expected',
      tds_amount: 162000,
      payment_instrument_refs: 'DD 4471',
      brokerage_received_amount: 0,
      deal_room_id: 'room',
      source_journey_item_id: 'item',
      notes: 'seller flexible on possession',
    };
    const projected = projectDealForExternal(row) as Record<string, unknown>;
    for (const field of STAKEHOLDER_HIDDEN_DEAL_FIELDS) {
      expect(projected, field).not.toHaveProperty(field);
    }
    expect(projected).toEqual({
      id: 'd1',
      title: 'Adithi — Site #19',
      value: 16200000,
    });
  });

  it('every financial column is on both deny-lists, and notes only on the stakeholder one', () => {
    for (const field of DEAL_FINANCIAL_FIELDS) {
      expect(INTERNAL_ONLY_DEAL_FIELDS).toContain(field);
      expect(STAKEHOLDER_HIDDEN_DEAL_FIELDS).toContain(field);
    }
    expect(INTERNAL_ONLY_DEAL_FIELDS).not.toContain('notes');
    expect(STAKEHOLDER_HIDDEN_DEAL_FIELDS).toContain('notes');
  });

  it('the v1 API and public routes never select an internal field', () => {
    const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
    const v1 = read('src/app/api/v1/deals/route.ts');
    expect(containsInternalDealField(v1)).toEqual([]);

    const publicDir = join(process.cwd(), 'src/app/api/public');
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        return statSync(p).isDirectory()
          ? walk(p)
          : p.endsWith('.ts')
            ? [p]
            : [];
      });
    for (const file of walk(publicDir)) {
      expect(
        containsInternalDealField(readFileSync(file, 'utf8')),
        file
      ).toEqual([]);
    }
  });

  it('containsInternalDealField matches whole identifiers only', () => {
    expect(containsInternalDealField('select notes_count, id')).toEqual([]);
    expect(containsInternalDealField('d.registered_consideration')).toEqual([
      'registered_consideration',
    ]);
  });
});

describe('parseFinancialsPatch', () => {
  it('returns only the fields named, rounded to paise', () => {
    expect(
      parseFinancialsPatch(
        { agreed_consideration: '16200000.456', tds_status: 'expected' },
        'deal'
      )
    ).toEqual({
      ok: true,
      value: { agreed_consideration: 16200000.46, tds_status: 'expected' },
    });
  });

  it('rejects negative money, bad dates and unknown TDS states', () => {
    expect(parseFinancialsPatch({ token_amount: -1 }, 'deal')).toEqual({
      ok: false,
      error: 'Token amount must be a non-negative amount',
    });
    expect(
      parseFinancialsPatch({ token_received_at: 'yesterday' }, 'deal')
    ).toEqual({
      ok: false,
      error: 'token_received_at must be YYYY-MM-DD',
    });
    expect(parseFinancialsPatch({ tds_status: 'paid' }, 'deal')).toEqual({
      ok: false,
      error: 'Unknown TDS status',
    });
    expect(parseFinancialsPatch({}, 'deal')).toEqual({
      ok: false,
      error: 'Nothing to update',
    });
  });

  it('[TXW-006] refuses token fields on a Den-linked deal', () => {
    const result = parseFinancialsPatch({ token_amount: 100000 }, 'token_safe');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Token Safe/);
    expect(
      parseFinancialsPatch({ agreed_consideration: 1 }, 'token_safe')
    ).toEqual({
      ok: true,
      value: { agreed_consideration: 1 },
    });
  });
});

describe('[TXW-006] token source of truth', () => {
  it('is Token Safe when the deal closes a Den room, the deal otherwise', () => {
    expect(tokenSourceFor({ deal_room_id: 'r' })).toBe('token_safe');
    expect(tokenSourceFor({ deal_room_id: null })).toBe('deal');
  });

  it('derives the Den token from the escrow and ignores the deal columns', () => {
    const deal = {
      deal_room_id: 'room',
      token_amount: 999,
      token_received_at: '2020-01-01',
      token_instrument_ref: 'stale',
    };
    expect(
      derivedToken(deal, {
        amount_minor: 50000000,
        status: 'funded',
        provider_ref: 'ESC-1',
        funded_at: '2026-09-02T09:00:00Z',
      })
    ).toEqual({
      source: 'token_safe',
      amount: 500000,
      received_at: '2026-09-02',
      reference: 'ESC-1',
      status: 'funded',
    });
    expect(
      derivedToken(deal, {
        amount_minor: 50000000,
        status: 'proposed',
        provider_ref: null,
        funded_at: null,
      })
    ).toMatchObject({ source: 'token_safe', amount: null, status: 'proposed' });
    expect(derivedToken(deal, null)).toMatchObject({
      source: 'token_safe',
      amount: null,
    });
  });

  it('reads the deal columns for a non-Den deal', () => {
    expect(
      derivedToken(
        {
          deal_room_id: null,
          token_amount: 250000,
          token_received_at: '2026-09-10',
          token_instrument_ref: 'UTR9',
        },
        null
      )
    ).toEqual({
      source: 'deal',
      amount: 250000,
      received_at: '2026-09-10',
      reference: 'UTR9',
      status: null,
    });
  });
});

describe('[TXW-006] Token Safe ownership is enforced below the API', () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      'supabase/migrations/20260918010100_transaction_workspace_stage_events.sql'
    ),
    'utf8'
  );

  it('refuses token columns on a Den-linked deal by trigger', () => {
    expect(sql).toMatch(
      /CREATE TRIGGER enforce_deal_token_source_trigger\s+BEFORE INSERT OR UPDATE OF deal_room_id, token_amount, token_received_at, token_instrument_ref ON deals/
    );
    expect(sql).toMatch(/IF NEW\.deal_room_id IS NOT NULL AND \(/);
    for (const column of TOKEN_FIELDS) {
      expect(sql).toContain(`NEW.${column} IS NOT NULL`);
    }
  });
});
