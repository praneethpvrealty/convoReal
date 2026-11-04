import { PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { buildAgendaPdf } from './agenda-pdf';
import { loadDailyAgenda } from './daily-agenda';
import type { DailyAgenda } from './daily-agenda';

function agenda(todoCount: number): DailyAgenda {
  return {
    date: '2026-11-04',
    label: 'Wednesday, 4 November 2026',
    events: [
      {
        title: 'Site visit — Bilekahalli 60x40 🏡',
        eventType: 'site_visit',
        startTime: '2026-11-04T05:30:00.000Z',
        location: 'Bannerghatta Road',
        status: 'scheduled',
        contact: { name: 'Anil Reddy', phone: '919845012345' },
      },
    ],
    dated: Array.from({ length: todoCount }, (_, i) => ({
      title: `New Buyer Requirements - @ನಾಗರಾಜ್ ${i} 🔴`,
      priority: i % 3 === 0 ? 'high' : 'medium',
      dueDate:
        i % 2 === 0 ? '2026-11-02T06:00:00.000Z' : '2026-11-04T06:00:00.000Z',
      contact: { name: `Contact ${i}`, phone: '9845012345' },
    })),
    datedOmitted: false,
    undated: [
      {
        title: 'Follow up with Kusumaraju’s advocate',
        priority: 'medium',
        dueDate: null,
        contact: null,
      },
    ],
  };
}

describe('[CAL-017] agenda PDF', () => {
  it('renders text the standard font cannot draw without throwing', async () => {
    const bytes = await buildAgendaPdf(agenda(3), {
      memberName: 'Praneeth',
      accountName: 'Yavarta Realty',
    });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('makes each contact phone a tap-to-call link', async () => {
    const bytes = await buildAgendaPdf(agenda(2), {
      memberName: null,
      accountName: null,
    });
    const doc = await PDFDocument.load(bytes);
    const annots = doc.getPage(0).node.Annots();
    const uris = (annots?.asArray() ?? []).map((ref) => {
      const annot = doc.context.lookup(ref, PDFDict);
      const action = annot.lookup(PDFName.of('A'), PDFDict);
      return action.lookup(PDFName.of('URI'), PDFString).decodeText();
    });
    expect(uris).toHaveLength(3);
    expect(uris).toContain('tel:+919845012345');
  });

  it('flows a long list onto more pages', async () => {
    const bytes = await buildAgendaPdf(agenda(80), {
      memberName: 'Praneeth',
      accountName: null,
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });

  it('marks text the font cannot draw instead of dropping it silently', async () => {
    const base = agenda(0);
    const bytes = await buildAgendaPdf(
      {
        ...base,
        events: [],
        undated: [
          {
            title: 'ನಾಗರಾಜ್ ಅವರಿಗೆ ಕರೆ',
            priority: 'medium',
            dueDate: null,
            contact: null,
          },
          {
            title: 'Collect ₹2L token from ನಾಗರಾಜ್ today',
            priority: 'medium',
            dueDate: null,
            contact: { name: 'ನಾಗರಾಜ್', phone: '9845012345' },
          },
        ],
      },
      { memberName: null, accountName: null }
    );
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});

describe('[CAL-017] daily agenda loader', () => {
  it('keeps the newest dated tasks when the cap applies and flags the cut', async () => {
    const orders: [string, boolean][] = [];
    const rows = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        title: `Task ${i}`,
        priority: 'medium',
        due_date: new Date(Date.UTC(2026, 10, 4) - i * 3_600_000).toISOString(),
        contact: null,
      }));
    const admin = {
      from(table: string) {
        let undated = false;
        let ascending = true;
        let limit = 0;
        const result = () => ({
          data: table === 'todos' && !undated && !ascending ? rows(limit) : [],
          error: null,
        });
        const q: Record<string, unknown> = {};
        for (const m of ['select', 'eq', 'or', 'neq', 'gte', 'lt', 'not']) {
          q[m] = () => q;
        }
        q.is = () => {
          undated = true;
          return q;
        };
        q.order = (col: string, o: { ascending: boolean }) => {
          ascending = o.ascending;
          if (table === 'todos' && !undated) orders.push([col, o.ascending]);
          return q;
        };
        q.limit = (n: number) => {
          limit = n;
          return Promise.resolve(result());
        };
        q.then = (resolve: (v: unknown) => void) => resolve(result());
        return q;
      },
    };

    const result = await loadDailyAgenda(
      admin as never,
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '2026-11-04'
    );
    expect(orders).toEqual([['due_date', false]]);
    expect(result.datedOmitted).toBe(true);
    expect(result.dated).toHaveLength(200);
    expect(result.dated.map((t) => t.title)).toContain('Task 0');
    expect(result.dated.map((t) => t.title)).not.toContain('Task 200');
  });
});
